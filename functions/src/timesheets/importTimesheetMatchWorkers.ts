/**
 * importTimesheetMatchWorkers — Phase 1 of the customer-CSV timesheet
 * importer. Given the parsed importable rows (email + name), match each
 * to an HRX user and resolve whether they're payable through the chosen
 * hiring entity's Everee tenant.
 *
 * Read-only (no writes). Server-side because matching arbitrary emails to
 * user docs + checking Everee linkage isn't something the client can do
 * under Firestore rules. Emails are deduped + cached so N rows for the
 * same worker cost one lookup.
 *
 * "Payable" gate (per product decision: block + flag, never silently
 * drop): a row is blocked when the entity isn't Everee-enabled, no HRX
 * user matches the email, the email is ambiguous, or the matched worker
 * has no Everee linkage for this entity (needs onboarding).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import {
  resolveExternalWorkerId,
  resolveEvereeWorkerUuid,
} from '../payroll/workerContextResolver';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface MatchRowInput {
  rowIndex: number;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface MatchRowResult {
  rowIndex: number;
  email: string;
  matched: boolean;
  ambiguous: boolean;
  userId: string | null;
  displayName: string | null;
  evereeWorkerId: string | null;
  evereeLinked: boolean;
  block: boolean;
  blockReason: string | null;
}

interface MatchWorkersResponse {
  evereeTenantId: string | null;
  entityEvereeEnabled: boolean;
  results: MatchRowResult[];
}

/** sec 5–7 on the active tenant (or HRX) — same gate as the timesheet
 *  grid + createDraftTimesheetEntry. */
async function assertTimesheetEditor(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const userSnap = await db.collection('users').doc(uid).get();
  const data = (userSnap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Importing timesheets requires tenant security level 5–7.');
}

/** Find an HRX user by email. Tries the raw + lowercased value; when
 *  several users share the email, prefers one tied to this tenant. */
async function findUserByEmail(
  email: string,
  tenantId: string,
): Promise<{ id: string; data: Record<string, any> } | null | 'ambiguous'> {
  const variants = Array.from(
    new Set([email, email.toLowerCase(), email.trim()].map((v) => v.trim()).filter(Boolean)),
  );
  const found = new Map<string, Record<string, any>>();
  for (const v of variants) {
    const snap = await db.collection('users').where('email', '==', v).limit(5).get();
    snap.forEach((d) => found.set(d.id, d.data() as Record<string, any>));
  }
  if (found.size === 0) return null;
  if (found.size === 1) {
    const [id, data] = [...found.entries()][0];
    return { id, data };
  }
  // Multiple users share this email — prefer one attached to this tenant.
  for (const [id, data] of found) {
    const tids = data.tenantIds;
    if (tids && typeof tids === 'object' && tids[tenantId]) return { id, data };
  }
  return 'ambiguous';
}

export const importTimesheetMatchWorkers = onCall(
  { cors: true },
  async (request): Promise<MatchWorkersResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, rows } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      rows?: MatchRowInput[];
    };
    if (!tenantId || !hiringEntityId || !Array.isArray(rows)) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and rows[] are required');
    }
    if (rows.length > 2000) {
      throw new HttpsError('invalid-argument', 'Too many rows in one match call (max 2000).');
    }
    await assertTimesheetEditor(
      request.auth.uid,
      request.auth.token as Record<string, unknown>,
      tenantId,
    );

    const evereeCfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    const evereeTenantId = evereeCfg?.evereeTenantId ?? null;
    const entityEvereeEnabled = !!evereeTenantId;

    // Resolve once per unique email.
    type Resolved =
      | { kind: 'none' }
      | { kind: 'ambiguous' }
      | {
          kind: 'user';
          userId: string;
          displayName: string;
          evereeWorkerId: string | null;
          evereeLinked: boolean;
        };
    const cache = new Map<string, Resolved>();

    const resolveEmail = async (email: string): Promise<Resolved> => {
      const key = email.toLowerCase().trim();
      const cached = cache.get(key);
      if (cached) return cached;

      const u = await findUserByEmail(key, tenantId);
      let resolved: Resolved;
      if (u === null) {
        resolved = { kind: 'none' };
      } else if (u === 'ambiguous') {
        resolved = { kind: 'ambiguous' };
      } else {
        const displayName =
          [u.data.firstName, u.data.lastName].filter(Boolean).join(' ') ||
          (u.data.displayName as string) ||
          email;
        let evereeLinked = false;
        let evereeWorkerId: string | null = null;
        if (evereeTenantId) {
          const ext = await resolveExternalWorkerId(tenantId, u.id, evereeTenantId);
          evereeLinked = !!ext;
          if (evereeLinked) {
            evereeWorkerId = await resolveEvereeWorkerUuid(tenantId, u.id, evereeTenantId);
          }
        }
        resolved = { kind: 'user', userId: u.id, displayName, evereeWorkerId, evereeLinked };
      }
      cache.set(key, resolved);
      return resolved;
    };

    const results: MatchRowResult[] = [];
    for (const row of rows) {
      const email = String(row.email || '').trim();
      const base: MatchRowResult = {
        rowIndex: row.rowIndex,
        email,
        matched: false,
        ambiguous: false,
        userId: null,
        displayName: null,
        evereeWorkerId: null,
        evereeLinked: false,
        block: true,
        blockReason: null,
      };

      if (!email) {
        results.push({ ...base, blockReason: 'No email address.' });
        continue;
      }

      const r = await resolveEmail(email);
      if (r.kind === 'none') {
        results.push({ ...base, blockReason: `No HRX worker found for ${email}.` });
        continue;
      }
      if (r.kind === 'ambiguous') {
        results.push({
          ...base,
          ambiguous: true,
          blockReason: 'Multiple HRX users share this email — resolve manually.',
        });
        continue;
      }

      // Matched to a user.
      const matchedBase: MatchRowResult = {
        ...base,
        matched: true,
        userId: r.userId,
        displayName: r.displayName,
        evereeWorkerId: r.evereeWorkerId,
        evereeLinked: r.evereeLinked,
      };
      if (!entityEvereeEnabled) {
        results.push({
          ...matchedBase,
          blockReason: 'Selected hiring entity is not configured for Everee payroll.',
        });
      } else if (!r.evereeLinked) {
        results.push({
          ...matchedBase,
          blockReason: `${r.displayName} isn't linked to Everee for this entity — needs onboarding.`,
        });
      } else {
        results.push({ ...matchedBase, block: false, blockReason: null });
      }
    }

    return { evereeTenantId, entityEvereeEnabled, results };
  },
);
