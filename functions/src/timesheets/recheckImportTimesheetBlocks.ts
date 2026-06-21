/**
 * recheckImportTimesheetBlocks — re-evaluate the block state of CSV-import
 * timesheet rows whose worker is matched but was previously "not linked to
 * Everee / needs onboarding".
 *
 * The block reason is a SNAPSHOT computed at import/match time. When the
 * worker later finishes Everee onboarding (their `externalWorkerId` appears),
 * the persisted block goes stale — the Grid keeps showing "needs onboarding"
 * even though they're now linked. This callable re-resolves the linkage for a
 * set of entries (via the same `resolveImportWorkerLinkage` the match +
 * reassign paths use), re-derives `matchStatus`, and updates each entry's
 * import sidecar in place. Now-linked rows leave the Blocked filter.
 *
 * Scope: only entries with a matched `workerId` (so unmatched
 * "No HRX worker named X" rows are skipped — those need a worker pick via the
 * pencil). Never touches a row that's already live in Everee (submitted/paid).
 * Same sec 5–7 (or HRX) gate as the other import callables.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { resolveImportWorkerLinkage } from './importWorkerLinkage';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type ImportMatchStatus = 'ready' | 'needs_rate' | 'needs_wc' | 'blocked';

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
  throw new HttpsError('permission-denied', 'Editing timesheets requires tenant security level 5–7.');
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface RecheckSummary {
  rechecked: number;
  cleared: number;
  stillBlocked: number;
  /** Entries that couldn't be re-checked (unmatched / live / missing). */
  skipped: number;
}

export const recheckImportTimesheetBlocks = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 300 },
  async (request): Promise<RecheckSummary> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, entryIds } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      entryIds?: string[];
    };
    if (!tenantId || !hiringEntityId || !Array.isArray(entryIds) || entryIds.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, hiringEntityId, and a non-empty entryIds[] are required',
      );
    }
    await assertTimesheetEditor(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);
    const uid = request.auth.uid;

    // Entity context — resolved once for the whole batch.
    const cfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    const evereeTenantId = cfg?.evereeTenantId ?? null;
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const entityData = (entitySnap.data() || {}) as Record<string, any>;
    const is1099 = String(entityData.workerType || '').trim() === '1099';
    const entityLabel =
      String(entityData.name || entityData.displayName || entityData.legalName || '').trim() ||
      'this entity';

    const summary: RecheckSummary = { rechecked: 0, cleared: 0, stillBlocked: 0, skipped: 0 };
    const nameCache = new Map<string, string>();
    const ids = entryIds.map(String).slice(0, 1000);

    const recheckOne = async (entryId: string): Promise<void> => {
      const ref = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
      const snap = await ref.get();
      if (!snap.exists) {
        summary.skipped += 1;
        return;
      }
      const entry = snap.data() as Record<string, any>;
      const imp = (entry.import || {}) as Record<string, any>;
      const live =
        entry.status === 'sent_to_everee' ||
        entry.status === 'paid' ||
        imp.matchStatus === 'submitted' ||
        imp.matchStatus === 'paid';
      const userId = String(entry.workerId || '').trim();
      if (entry.source !== 'csv_import' || live || !userId) {
        // Unmatched (no worker), live, or not an import row → can't re-link here.
        summary.skipped += 1;
        return;
      }

      let displayName = nameCache.get(userId);
      if (displayName === undefined) {
        const u = (await db.doc(`users/${userId}`).get()).data() || {};
        displayName =
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          String(u.displayName || '').trim() ||
          'This worker';
        nameCache.set(userId, displayName);
      }

      const linkage = await resolveImportWorkerLinkage(db, {
        tenantId,
        hiringEntityId,
        entityLabel,
        evereeTenantId,
        userId,
        displayName,
      });

      const payRate = num(entry.payRate);
      const wcCode =
        (typeof entry.workersCompCode === 'string' && entry.workersCompCode.trim()) ||
        (typeof imp.workersCompCode === 'string' && imp.workersCompCode.trim()) ||
        '';
      const matchStatus: ImportMatchStatus = linkage.blockReason
        ? 'blocked'
        : !(payRate > 0)
          ? 'needs_rate'
          : !is1099 && !wcCode
            ? 'needs_wc'
            : 'ready';

      summary.rechecked += 1;
      const changed =
        imp.matchStatus !== matchStatus ||
        (imp.blockReason ?? null) !== (linkage.blockReason ?? null) ||
        imp.evereeLinked !== linkage.evereeLinked ||
        (imp.evereeWorkerId ?? null) !== (linkage.evereeWorkerId ?? null);
      if (changed) {
        await ref.update({
          'import.matchStatus': matchStatus,
          'import.blockReason': linkage.blockReason,
          'import.evereeLinked': linkage.evereeLinked,
          'import.evereeWorkerId': linkage.evereeWorkerId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: uid,
        });
      }
      if (matchStatus === 'blocked') summary.stillBlocked += 1;
      else summary.cleared += 1;
    };

    // Bounded concurrency — each recheck does a handful of reads + one write.
    const CONCURRENCY = 8;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => recheckOne(id)));
    }

    return summary;
  },
);
