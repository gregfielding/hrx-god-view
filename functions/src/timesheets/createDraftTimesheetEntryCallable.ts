/**
 * createDraftTimesheetEntry — get-or-create a draft TimesheetEntryV2.
 *
 * **TS.1.P1.D primitive.** The minimum data-layer thing that lets the
 * recruiter grid transition from "all empty rows" to "rows backed by
 * real entry docs." Phase 3 will wrap this in inline editing UX; for
 * now it ships behind the minimal "+ Add entry" affordance on the
 * grid's empty rows. The callable is the single source of truth for
 * entry creation regardless of how the affordance evolves later — UI
 * choices compose ON TOP of this primitive, never around it.
 *
 * **Contract:**
 *   - Input: `{ tenantId, assignmentId, workDate }` where workDate is
 *     `YYYY-MM-DD` in worksite-local time.
 *   - Output: `{ ok: true; entryId: string; created: boolean }`.
 *     `created: false` means the doc already existed — the callable
 *     is fully idempotent and the affordance can fire it redundantly
 *     (e.g. user double-clicks) without producing duplicates or
 *     errors.
 *
 * **Permission gate:** sec ≥ 5 on the active tenant (or HRX). Matches
 * the `/timesheets` route gate exactly so a recruiter who sees the
 * grid can create entries; a sec-3 worker cannot.
 *
 * **Validation (defense-in-depth):**
 *   1. Assignment must exist under the requested tenant.
 *   2. workDate must fall inside the assignment's `[startDate,
 *      endDate]` active window.
 *   3. `weeklySchedule[dow].enabled === true` for that workDate's
 *      day-of-week, with valid `startTime` / `endTime`. Without this
 *      check, a malicious or buggy client could create entries for
 *      days the worker isn't actually scheduled — which Phase 2's
 *      rules engine would then dutifully compute pay against.
 *
 * **Snapshot semantics.** The entry captures the assignment's state
 * at create-time:
 *   - Schedule (`scheduledStartTime` / `scheduledEndTime` /
 *     `scheduledBreakMinutes`) snapshots the weeklySchedule + denorm
 *     break minutes — frozen for this row's lifetime so a later
 *     schedule change doesn't retroactively alter past entries.
 *   - Rates (`payRate` / `billRate`) snapshot from the assignment.
 *   - `hiringEntityId` / `worksiteState` prefer the P1.B denorm
 *     fields. When absent (assignment write-time hook hasn't fired
 *     yet, OR the doc predates the backfill), we re-resolve via the
 *     same `resolveMissingDenormUpdates` helper the backfill uses —
 *     single source of truth for the JO chain.
 *
 * **Idempotency.** Doc id is deterministic
 * `{assignmentId}_{YYYY-MM-DD}`. Inside a transaction we read the
 * doc; if it exists, we return its id (and `created: false`) without
 * touching it. No `lastClickedAt` mutation, no audit churn — the
 * caller can call this from any number of UI surfaces without
 * coordinating.
 *
 * @see TS.1 build plan §4.2 — entry creation contract
 * @see functions/src/timesheets/backfillAssignmentDenormFieldsCallable.ts
 *      (shared resolver chain)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  makeCaches,
  resolveMissingDenormUpdates,
} from './backfillAssignmentDenormFieldsCallable';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/* -------------------------------------------------------------------------
 * Types — exported so the client wrapper can stay typed end-to-end.
 * ------------------------------------------------------------------------- */

export interface CreateDraftTimesheetEntryInput {
  tenantId: string;
  assignmentId: string;
  /** YYYY-MM-DD in worksite-local time. */
  workDate: string;
}

export interface CreateDraftTimesheetEntryResult {
  ok: true;
  entryId: string;
  /** `false` if the entry already existed (idempotent return). */
  created: boolean;
}

/* -------------------------------------------------------------------------
 * Internal helpers
 * ------------------------------------------------------------------------- */

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function isYyyyMmDd(s: unknown): s is string {
  return typeof s === 'string' && YYYY_MM_DD.test(s.trim());
}

/**
 * DOW (0=Sun..6=Sat) for a YYYY-MM-DD calendar date. Calendar-day
 * semantic, so it's timezone-independent: Cloud Functions running in
 * UTC produce the same DOW as the worksite-local DOW for the same
 * date string.
 */
function dowFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return -1;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  if (Number.isNaN(dt.getTime())) return -1;
  return dt.getDay();
}

/** Lexicographic YYYY-MM-DD comparison — same convention as the
 *  client-side resolver. Avoids parsing two strings into Dates. */
function isoDateLte(a: string, b: string): boolean {
  return a <= b;
}
function isoDateGte(a: string, b: string): boolean {
  return a >= b;
}

/**
 * Resolve the caller's effective security level. Mirrors
 * `setAssignmentOutcome.ts` (workforce domain) — prefer nested
 * `tenantIds[tenantId].securityLevel`, fall back to top-level
 * `securityLevel`, HRX always passes. Refactor candidate when we
 * hit rule-of-three (third callable using this exact pattern).
 */
async function resolveCallerSecurityLevel(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<{ securityLevel: number; isHrx: boolean }> {
  const isHrx = authToken?.hrx === true;
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    return { securityLevel: 0, isHrx };
  }
  const data = userSnap.data() as Record<string, unknown>;
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const nested = tenantIds?.[tenantId];
  const raw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const parsed = Number.parseInt(String(raw ?? '0'), 10);
  return { securityLevel: Number.isNaN(parsed) ? 0 : parsed, isHrx };
}

async function assertTimesheetEditor(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  const { securityLevel, isHrx } = await resolveCallerSecurityLevel(uid, authToken, tenantId);
  if (isHrx) return;
  if (securityLevel >= 5 && securityLevel <= 7) return;
  throw new HttpsError(
    'permission-denied',
    'Creating timesheet entries requires tenant security level 5, 6, or 7.',
  );
}

function normalizeInput(raw: unknown): CreateDraftTimesheetEntryInput {
  const d = (raw || {}) as Record<string, unknown>;
  const tenantId = String(d.tenantId || '').trim();
  const assignmentId = String(d.assignmentId || '').trim();
  const workDate = String(d.workDate || '').trim();
  if (!tenantId || !assignmentId) {
    throw new HttpsError(
      'invalid-argument',
      'tenantId and assignmentId are required.',
    );
  }
  if (!isYyyyMmDd(workDate)) {
    throw new HttpsError(
      'invalid-argument',
      'workDate must be YYYY-MM-DD.',
    );
  }
  return { tenantId, assignmentId, workDate };
}

/* -------------------------------------------------------------------------
 * Schedule lookup
 *
 * Returns the scheduled times for a (assignment, workDate) tuple, OR
 * a structured "not scheduled" result that the caller turns into an
 * HttpsError with a precise reason. We surface the reason rather than
 * a generic `failed-precondition` because the recruiter UI may want
 * to display "this assignment ended Apr 30, can't create entries for
 * May 8" vs "this worker isn't scheduled on Wednesdays."
 * ------------------------------------------------------------------------- */

interface ScheduleResolution {
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

type ScheduleCheck =
  | { ok: true; resolution: ScheduleResolution }
  | { ok: false; reason: string };

function checkAssignmentScheduledForDate(
  assignmentId: string,
  assignment: Record<string, unknown>,
  workDate: string,
): ScheduleCheck {
  const startDate = assignment.startDate;
  if (!isYyyyMmDd(startDate)) {
    return { ok: false, reason: `Assignment ${assignmentId} has a missing or malformed startDate.` };
  }
  if (!isoDateGte(workDate, startDate.trim())) {
    return {
      ok: false,
      reason: `workDate ${workDate} is before the assignment's startDate ${startDate}.`,
    };
  }
  const endDate = assignment.endDate;
  if (endDate !== undefined && endDate !== null && endDate !== '') {
    if (!isYyyyMmDd(endDate)) {
      return {
        ok: false,
        reason: `Assignment ${assignmentId} has a malformed endDate ("${String(endDate)}").`,
      };
    }
    if (!isoDateLte(workDate, endDate.trim())) {
      return {
        ok: false,
        reason: `workDate ${workDate} is after the assignment's endDate ${endDate}.`,
      };
    }
  }

  // Open shift (standing-crew, no fixed times): there's no weeklySchedule
  // to validate against. The date-window check above is the only gate —
  // the recruiter enters total hours manually (actualHoursOverride), so
  // the entry is created with no scheduled start/end/break.
  if (assignment.isOpenShift === true || assignment.noFixedTimes === true) {
    return { ok: true, resolution: { startTime: '', endTime: '', breakMinutes: 0 } };
  }

  const dow = dowFromIso(workDate);
  if (dow < 0 || dow > 6) {
    return { ok: false, reason: `workDate ${workDate} could not be parsed.` };
  }

  const schedule = assignment.weeklySchedule;
  if (!schedule || typeof schedule !== 'object') {
    return {
      ok: false,
      reason: `Assignment ${assignmentId} has no weeklySchedule — cannot create entries.`,
    };
  }
  const day = (schedule as Record<string, unknown>)[String(dow)];
  if (!day || typeof day !== 'object') {
    return {
      ok: false,
      reason: `Worker isn't scheduled on this day of the week.`,
    };
  }
  const d = day as { enabled?: unknown; startTime?: unknown; endTime?: unknown };
  if (d.enabled !== true) {
    return {
      ok: false,
      reason: `Worker isn't scheduled on this day of the week.`,
    };
  }
  if (typeof d.startTime !== 'string' || typeof d.endTime !== 'string' || !d.startTime || !d.endTime) {
    return {
      ok: false,
      reason: `weeklySchedule day is enabled but missing startTime / endTime.`,
    };
  }

  const breakMinutes =
    typeof assignment.shiftBreakDefaultMinutes === 'number' &&
    Number.isFinite(assignment.shiftBreakDefaultMinutes)
      ? (assignment.shiftBreakDefaultMinutes as number)
      : 0;

  return {
    ok: true,
    resolution: {
      startTime: d.startTime,
      endTime: d.endTime,
      breakMinutes,
    },
  };
}

/* -------------------------------------------------------------------------
 * Denorm-fallback resolution
 *
 * When the assignment doesn't already have hiringEntityId /
 * worksiteState (P1.B denorm fields) populated, fall back to the
 * shared resolver chain. This is the same code path the backfill +
 * P1.B.2 trigger use — single source of truth for the JO chain.
 * Adds 0-2 doc reads per missing field, only on the rare not-yet-
 * backfilled assignments.
 * ------------------------------------------------------------------------- */

async function resolveDenormFallbacks(
  tenantId: string,
  assignmentId: string,
  assignmentData: Record<string, unknown>,
): Promise<{
  hiringEntityId: string | null;
  worksiteState: string | null;
  /** TS.1.P4 Slice 5.5 — read directly from JO.recruiterAccountId /
   *  accountId via the shared resolver. Snapshotted onto the entry. */
  accountId: string | null;
}> {
  const directHiringEntityId =
    typeof assignmentData.hiringEntityId === 'string' &&
    assignmentData.hiringEntityId.trim().length > 0
      ? assignmentData.hiringEntityId.trim()
      : null;
  const directWorksiteState =
    typeof assignmentData.worksiteState === 'string' &&
    assignmentData.worksiteState.trim().length > 0
      ? assignmentData.worksiteState.trim()
      : null;
  const directAccountId =
    typeof assignmentData.accountId === 'string' &&
    assignmentData.accountId.trim().length > 0
      ? assignmentData.accountId.trim()
      : null;

  if (directHiringEntityId && directWorksiteState && directAccountId) {
    return {
      hiringEntityId: directHiringEntityId,
      worksiteState: directWorksiteState,
      accountId: directAccountId,
    };
  }

  // At least one denorm field is missing. Run the shared resolver
  // chain. The backfill helper handles per-field error isolation
  // internally and returns whatever it could resolve in `updates`.
  let resolved;
  try {
    resolved = await resolveMissingDenormUpdates({
      fdb: db,
      tenantId,
      assignmentId,
      assignmentData,
      caches: makeCaches(),
    });
  } catch (err) {
    logger.warn('[TS.1.P1.D] denorm fallback resolver threw', {
      tenantId,
      assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      hiringEntityId: directHiringEntityId,
      worksiteState: directWorksiteState,
      accountId: directAccountId,
    };
  }

  const fallbackHiringEntityId =
    typeof resolved.updates.hiringEntityId === 'string' &&
    resolved.updates.hiringEntityId.trim().length > 0
      ? resolved.updates.hiringEntityId.trim()
      : null;
  const fallbackWorksiteState =
    typeof resolved.updates.worksiteState === 'string' &&
    resolved.updates.worksiteState.trim().length > 0
      ? resolved.updates.worksiteState.trim()
      : null;
  const fallbackAccountId =
    typeof resolved.updates.accountId === 'string' &&
    resolved.updates.accountId.trim().length > 0
      ? resolved.updates.accountId.trim()
      : null;

  return {
    hiringEntityId: directHiringEntityId ?? fallbackHiringEntityId,
    worksiteState: directWorksiteState ?? fallbackWorksiteState,
    accountId: directAccountId ?? fallbackAccountId,
  };
}

/* -------------------------------------------------------------------------
 * Callable
 * ------------------------------------------------------------------------- */

export const createDraftTimesheetEntryCallable = onCall(
  // Memory: rely on the 512MiB global default set in index.ts. The
  // earlier 256MiB override was tuned to the working set of THIS
  // callable, but the deployed container bundles all 150+ functions
  // in functions/src/index.ts, which alone needs ~285 MiB to bootstrap
  // (dotenv + SendGrid + feature flags + firestoreTriggers). Cold
  // starts under 256MiB OOM at the readiness probe and the request
  // 500s before the handler ever runs. See logs from
  // createdrafttimesheetentrycallable on 2026-05-07.
  { cors: true, timeoutSeconds: 30 },
  async (request): Promise<CreateDraftTimesheetEntryResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const actorUid = request.auth.uid;
    const input = normalizeInput(request.data);

    await assertTimesheetEditor(
      actorUid,
      request.auth.token as Record<string, unknown>,
      input.tenantId,
    );

    const entryId = `${input.assignmentId}_${input.workDate}`;
    const entryRef = db.doc(
      `tenants/${input.tenantId}/timesheet_entries/${entryId}`,
    );
    const assignmentRef = db.doc(
      `tenants/${input.tenantId}/assignments/${input.assignmentId}`,
    );

    // Fast-path idempotency check OUTSIDE the transaction. If the
    // entry already exists, we don't even need to read the assignment
    // — the row is already populated. This is the hot path when the
    // UI fires the callable redundantly (double-click, etc.).
    const existingSnap = await entryRef.get();
    if (existingSnap.exists) {
      logger.debug('[TS.1.P1.D][createDraftTimesheetEntry] already exists', {
        tenantId: input.tenantId,
        assignmentId: input.assignmentId,
        workDate: input.workDate,
      });
      return { ok: true, entryId, created: false };
    }

    // Slow path: doesn't exist yet. Read assignment, validate
    // schedule, resolve denorm fallbacks, create entry inside a
    // transaction so the existence check is atomic with the write
    // (prevents a race where two parallel callable invocations both
    // see "doesn't exist" and both write).
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      throw new HttpsError('not-found', `Assignment ${input.assignmentId} not found.`);
    }
    const assignmentData = assignmentSnap.data() as Record<string, unknown>;

    const scheduleCheck = checkAssignmentScheduledForDate(
      input.assignmentId,
      assignmentData,
      input.workDate,
    );
    if (scheduleCheck.ok === false) {
      throw new HttpsError('failed-precondition', scheduleCheck.reason);
    }

    const denormResolved = await resolveDenormFallbacks(
      input.tenantId,
      input.assignmentId,
      assignmentData,
    );

    const jobOrderId =
      typeof assignmentData.jobOrderId === 'string' && assignmentData.jobOrderId.trim().length > 0
        ? assignmentData.jobOrderId.trim()
        : '';
    const candidateId =
      typeof assignmentData.candidateId === 'string' && assignmentData.candidateId.trim().length > 0
        ? assignmentData.candidateId.trim()
        : '';
    if (!jobOrderId || !candidateId) {
      throw new HttpsError(
        'failed-precondition',
        `Assignment ${input.assignmentId} is missing required fields (jobOrderId and candidateId).`,
      );
    }
    const payRate =
      typeof assignmentData.payRate === 'number' && Number.isFinite(assignmentData.payRate)
        ? (assignmentData.payRate as number)
        : 0;
    const billRate =
      typeof assignmentData.billRate === 'number' && Number.isFinite(assignmentData.billRate)
        ? (assignmentData.billRate as number)
        : 0;

    // TS.1.P4 Slice 5.5 — snapshot shiftId from the assignment doc
    // (placementsApi writes it on every create). accountId comes from
    // the resolved denorm chain (JO.recruiterAccountId / JO.accountId).
    // Both fields default to '' rather than undefined so reads can do
    // direct equality without `?? ''` dance.
    const shiftId =
      typeof assignmentData.shiftId === 'string' && assignmentData.shiftId.trim().length > 0
        ? assignmentData.shiftId.trim()
        : '';

    const entryData: Record<string, unknown> = {
      id: entryId,
      tenantId: input.tenantId,
      assignmentId: input.assignmentId,
      jobOrderId,
      hiringEntityId: denormResolved.hiringEntityId ?? '',
      shiftId,
      accountId: denormResolved.accountId ?? '',
      workerId: candidateId,
      workDate: input.workDate,
      workState: denormResolved.worksiteState ?? '',

      scheduledStartTime: scheduleCheck.resolution.startTime,
      scheduledEndTime: scheduleCheck.resolution.endTime,
      scheduledBreakMinutes: scheduleCheck.resolution.breakMinutes,

      breaks: [],

      totalRegularHours: 0,
      totalOTHours: 0,
      totalFlsaOTHours: 0,
      totalNonFlsaOTHours: 0,
      totalDoubleTimeHours: 0,
      mealBreakPenaltyHours: 0,
      restBreakPenaltyHours: 0,

      tips: 0,
      bonusAmount: 0,

      payRate,
      billRate,

      status: 'draft',

      createdBy: actorUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actorUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const created = await db.runTransaction(async (tx) => {
      // Re-check inside the transaction. If a parallel call beat us
      // to it, return the existing doc rather than throwing.
      const txSnap = await tx.get(entryRef);
      if (txSnap.exists) {
        return false;
      }
      tx.set(entryRef, entryData);
      return true;
    });

    if (created) {
      logger.info('[TS.1.P1.D][createDraftTimesheetEntry] created', {
        tenantId: input.tenantId,
        assignmentId: input.assignmentId,
        workDate: input.workDate,
        entryId,
        actorUid,
        hiringEntityId: denormResolved.hiringEntityId,
        workState: denormResolved.worksiteState,
      });
    } else {
      logger.debug('[TS.1.P1.D][createDraftTimesheetEntry] race-resolved as existing', {
        tenantId: input.tenantId,
        assignmentId: input.assignmentId,
        workDate: input.workDate,
      });
    }

    return { ok: true, entryId, created };
  },
);
