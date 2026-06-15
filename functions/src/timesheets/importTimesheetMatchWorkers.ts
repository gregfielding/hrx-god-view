/**
 * importTimesheetMatchWorkers — Phase 1 + 2 of the customer-CSV timesheet
 * importer. Given the parsed importable rows (email, name, workDate),
 * for each row:
 *   - match the email to an HRX user + check Everee linkage for the
 *     chosen paying entity (Phase 1 — the payable/blocked gate), and
 *   - best-effort pair an HRX assignment for that worker + work date and
 *     resolve pay rate / job title / worksite / workers-comp from the
 *     assignment + its job order + shift (Phase 2).
 *
 * Read-only (no writes). Server-side because matching arbitrary emails +
 * reading assignments/JOs/shifts isn't something the client can do under
 * Firestore rules. Emails are deduped + cached; JOs/shifts are cached
 * across rows so a week of one crew costs a handful of reads.
 *
 * Block semantics (per product decision — block + flag, never silently
 * drop): a row is hard-`block`ed when the entity isn't Everee-enabled, no
 * HRX user matches, the email is ambiguous, or the worker has no Everee
 * linkage (needs onboarding). A matched+linked row with no paired
 * assignment is NOT blocked — it's flagged `needsPayRate` so the
 * recruiter can enter a rate inline (Phase 3); pay rate otherwise comes
 * from the paired assignment.
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
  /** YYYY-MM-DD — used to pair an assignment whose window contains it. */
  workDate?: string;
  site?: string;
  role?: string;
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
  // ── Phase 2: paired assignment + resolved pay context ──
  assignmentId: string | null;
  jobOrderId: string | null;
  shiftId: string | null;
  jobTitle: string | null;
  worksiteId: string | null;
  worksiteName: string | null;
  workersCompCode: string | null;
  payRate: number | null;
  /** 'assignment' when payRate came from a paired assignment, else 'none'. */
  payRateSource: 'assignment' | 'none';
  /** True when matched+linked but no pay rate resolved (needs inline entry). */
  needsPayRate: boolean;
}

interface MatchWorkersResponse {
  evereeTenantId: string | null;
  entityEvereeEnabled: boolean;
  results: MatchRowResult[];
}

type Assignment = Record<string, any> & { id: string };

/** sec 5–7 on the active tenant (or HRX). */
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
  for (const [id, data] of found) {
    const tids = data.tenantIds;
    if (tids && typeof tids === 'object' && tids[tenantId]) return { id, data };
  }
  return 'ambiguous';
}

/** All of a worker's assignments (by userId + candidateId), deduped, with
 *  terminal-cancelled ones dropped. */
async function loadWorkerAssignments(tenantId: string, userId: string): Promise<Assignment[]> {
  const col = db.collection(`tenants/${tenantId}/assignments`);
  const [byUser, byCand] = await Promise.all([
    col.where('userId', '==', userId).get(),
    col.where('candidateId', '==', userId).get(),
  ]);
  const seen = new Map<string, Assignment>();
  for (const snap of [byUser, byCand]) {
    snap.forEach((d) => {
      const data = d.data() as Record<string, any>;
      const st = String(data.status || '').toLowerCase();
      if (st === 'cancelled' || st === 'canceled' || st === 'declined') return;
      seen.set(d.id, { id: d.id, ...data });
    });
  }
  return [...seen.values()];
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const dateOnly = (v: unknown): string => {
  if (typeof v === 'string' && ISO.test(v)) return v.slice(0, 10);
  return '';
};

/** Pick the assignment whose [startDate, endDate] window contains
 *  `workDate` (empty endDate = ongoing). Prefer a paying rate + the most
 *  recent start. */
function pairAssignment(assignments: Assignment[], workDate: string): Assignment | null {
  if (!workDate) return null;
  const inWindow = assignments.filter((a) => {
    const start = dateOnly(a.startDate);
    if (!start || workDate < start) return false;
    const end = dateOnly(a.endDate);
    return !end || workDate <= end;
  });
  if (inWindow.length === 0) return null;
  inWindow.sort((a, b) => {
    const ar = Number(a.payRate) > 0 ? 1 : 0;
    const br = Number(b.payRate) > 0 ? 1 : 0;
    if (ar !== br) return br - ar; // paying rate first
    return dateOnly(b.startDate).localeCompare(dateOnly(a.startDate)); // most recent start
  });
  return inWindow[0];
}

const pickStr = (...c: unknown[]): string | undefined => {
  for (const v of c) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};

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

    // ── Caches ──
    type Resolved =
      | { kind: 'none' }
      | { kind: 'ambiguous' }
      | {
          kind: 'user';
          userId: string;
          displayName: string;
          evereeWorkerId: string | null;
          evereeLinked: boolean;
          assignments: Assignment[];
        };
    const emailCache = new Map<string, Resolved>();
    const joCache = new Map<string, Record<string, any> | null>();
    const shiftCache = new Map<string, Record<string, any> | null>();

    const loadJobOrder = async (jobOrderId: string): Promise<Record<string, any> | null> => {
      if (joCache.has(jobOrderId)) return joCache.get(jobOrderId) ?? null;
      let jo: Record<string, any> | null = null;
      for (const path of [
        `tenants/${tenantId}/job_orders/${jobOrderId}`,
        `tenants/${tenantId}/jobOrders/${jobOrderId}`,
        `tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`,
      ]) {
        try {
          const snap = await db.doc(path).get();
          if (snap.exists) {
            jo = snap.data() as Record<string, any>;
            break;
          }
        } catch {
          /* walk next */
        }
      }
      joCache.set(jobOrderId, jo);
      return jo;
    };

    const loadShift = async (
      jobOrderId: string,
      shiftId: string,
    ): Promise<Record<string, any> | null> => {
      const key = `${jobOrderId}/${shiftId}`;
      if (shiftCache.has(key)) return shiftCache.get(key) ?? null;
      let shift: Record<string, any> | null = null;
      try {
        const snap = await db
          .doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`)
          .get();
        shift = snap.exists ? (snap.data() as Record<string, any>) : null;
      } catch {
        shift = null;
      }
      shiftCache.set(key, shift);
      return shift;
    };

    const resolveEmail = async (email: string): Promise<Resolved> => {
      const key = email.toLowerCase().trim();
      const cached = emailCache.get(key);
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
        const assignments = await loadWorkerAssignments(tenantId, u.id);
        resolved = {
          kind: 'user',
          userId: u.id,
          displayName,
          evereeWorkerId,
          evereeLinked,
          assignments,
        };
      }
      emailCache.set(key, resolved);
      return resolved;
    };

    const EMPTY_FIELDS = {
      assignmentId: null,
      jobOrderId: null,
      shiftId: null,
      jobTitle: null,
      worksiteId: null,
      worksiteName: null,
      workersCompCode: null,
      payRate: null,
      payRateSource: 'none' as const,
      needsPayRate: true,
    };

    const results: MatchRowResult[] = [];
    for (const row of rows) {
      const email = String(row.email || '').trim();
      const workDate = dateOnly(row.workDate);
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
        ...EMPTY_FIELDS,
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

      // Matched to a user — resolve hard-block first.
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
        continue;
      }
      if (!r.evereeLinked) {
        results.push({
          ...matchedBase,
          blockReason: `${r.displayName} isn't linked to Everee for this entity — needs onboarding.`,
        });
        continue;
      }

      // Payable. Best-effort assignment pairing + field resolution.
      const assignment = pairAssignment(r.assignments, workDate);
      if (!assignment) {
        results.push({ ...matchedBase, block: false, blockReason: null }); // needsPayRate stays true
        continue;
      }
      const jobOrderId = pickStr(assignment.jobOrderId) ?? null;
      const shiftId = pickStr(assignment.shiftId) ?? null;
      const jo = jobOrderId ? await loadJobOrder(jobOrderId) : null;
      const shift = jobOrderId && shiftId ? await loadShift(jobOrderId, shiftId) : null;
      const firstGigPosition =
        Array.isArray(jo?.gigPositions) && jo!.gigPositions.length > 0
          ? (jo!.gigPositions[0] as Record<string, any>)
          : null;
      const payRate =
        Number(assignment.payRate) > 0
          ? Number(assignment.payRate)
          : Number(jo?.payRate) > 0
            ? Number(jo?.payRate)
            : 0;
      results.push({
        ...matchedBase,
        block: false,
        blockReason: null,
        assignmentId: assignment.id,
        jobOrderId,
        shiftId,
        jobTitle:
          pickStr(assignment.jobTitle, shift?.defaultJobTitle, jo?.jobTitle) ?? null,
        worksiteId: pickStr(jo?.worksiteId, jo?.locationId) ?? null,
        worksiteName: pickStr(jo?.worksiteName, jo?.locationName) ?? null,
        workersCompCode:
          pickStr(
            shift?.workersCompCode,
            jo?.workersCompCode,
            jo?.workersCompClassCode,
            firstGigPosition?.workersCompClassCode,
          ) ?? null,
        payRate: payRate || null,
        payRateSource: payRate > 0 ? 'assignment' : 'none',
        needsPayRate: !(payRate > 0),
      });
    }

    return { evereeTenantId, entityEvereeEnabled, results };
  },
);
