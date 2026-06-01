/**
 * addRetroactiveWorker — admin-only flow to register a worker on a job
 * order AFTER the work has already happened, so the recruiter can enter
 * their timesheet.
 *
 * Models after `placementsCreateAssignments` but:
 *   - Skips application creation + the apply-wizard SMS chain.
 *   - Skips the "you've been placed" cadence + shift reminders.
 *   - Marks each per-day assignment with `retroactive: true` so the
 *     downstream SMS / cadence triggers can short-circuit (see the
 *     gate in workerShiftRemindersV2 + onAssignmentCreatedAutoSeed).
 *
 * For each enabled day in the shift's date range (inclusive), writes
 * one assignment doc at `tenants/{tid}/assignments/{shiftId}__{userId}__{date}`
 * — same id shape the existing per-day expander uses, so the timesheet
 * grid resolver picks them up via its standard query.
 *
 * Caller must be HRX or have securityLevel >= 5 on the tenant.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

interface Input {
  tenantId: string;
  jobOrderId: string;
  shiftId: string;
  userId: string;
}

interface Output {
  ok: true;
  assignmentsCreated: number;
  /** First assignment id — handy for the client when a single-day shift
   *  was added and we want to deep-link to its timesheet row. */
  sampleAssignmentId: string | null;
  /** Per-day date list for the recruiter's eyeball check. */
  dates: string[];
}

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) {
    throw new HttpsError('permission-denied', 'No access to this tenant');
  }
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const secRaw = tenantMeta.securityLevel ?? data.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to add workers retroactively');
}

/** Inclusive date iterator. Both inputs are `YYYY-MM-DD`. */
function eachDate(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const cursor = new Date(startIso + 'T12:00:00Z');
  const end = new Date(endIso + 'T12:00:00Z');
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return out;
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function pickStr(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function pickNum(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export const addRetroactiveWorker = onCall<Input, Promise<Output>>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '1GiB',
    timeoutSeconds: 120,
  },
  async (req): Promise<Output> => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, jobOrderId, shiftId, userId } = req.data || ({} as Input);
    if (!tenantId || !jobOrderId || !shiftId || !userId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, jobOrderId, shiftId, userId are required',
      );
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    // Read JO + shift + user in parallel.
    const [joSnap, shiftSnap, userSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get(),
      db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`).get(),
      db.doc(`users/${userId}`).get(),
    ]);
    if (!joSnap.exists) throw new HttpsError('not-found', 'Job order not found');
    if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found');
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');

    const jo = joSnap.data() as Record<string, unknown>;
    const shift = shiftSnap.data() as Record<string, unknown>;
    const user = userSnap.data() as Record<string, unknown>;

    // Date range: prefer shift.startDate/endDate, fall back to shiftDate (single-day).
    const startDate =
      pickStr(shift, ['startDate', 'shiftDate']) ||
      pickStr(shift, ['shiftDate']);
    const endDate =
      pickStr(shift, ['endDate']) ||
      startDate; // single-day shift → end == start
    if (!startDate || !endDate) {
      throw new HttpsError('failed-precondition', 'Shift is missing startDate/endDate');
    }

    const startTime =
      pickStr(shift, ['startTime', 'defaultStartTime']) || '09:00';
    const endTime = pickStr(shift, ['endTime', 'defaultEndTime']) || '17:00';
    const payRate = pickNum(shift, ['payRate']) ?? pickNum(jo, ['payRate']) ?? 0;
    const billRate = pickNum(shift, ['billRate']) ?? pickNum(jo, ['billRate']) ?? 0;
    const jobTitle =
      pickStr(shift, ['jobTitle', 'defaultJobTitle']) ||
      pickStr(jo, ['jobTitle']);
    const shiftTitle = pickStr(shift, ['shiftTitle']) || pickStr(jo, ['title']);
    const accountId = pickStr(jo, ['accountId', 'recruiterAccountId', 'companyId']);
    const hiringEntityId = pickStr(jo, ['hiringEntityId']);
    const worksiteId = pickStr(jo, ['worksiteId', 'locationId']);

    const firstName = pickStr(user, ['firstName']);
    const lastName = pickStr(user, ['lastName']);
    const email = pickStr(user, ['email', 'contactEmail', 'primaryEmail']);
    const phone = pickStr(user, ['phone', 'phoneE164', 'phoneNumber']);

    const dates = eachDate(startDate, endDate);
    if (dates.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        `Shift date range produced 0 days (start=${startDate}, end=${endDate})`,
      );
    }

    // Write one assignment per day. Each carries an aligned weeklySchedule
    // so the timesheet grid resolver picks them up — see the 2026-05-29
    // fix in resolveWeeklySchedule for the historical context.
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let firstId: string | null = null;

    for (const d of dates) {
      const dow = new Date(d + 'T12:00:00Z').getUTCDay();
      const assignmentId = `${shiftId}__${userId}__${d}`;
      const ref = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
      if (!firstId) firstId = assignmentId;
      batch.set(ref, {
        tenantId,
        jobOrderId,
        shiftId,
        candidateId: userId,
        userId,
        workerId: userId,
        firstName,
        lastName,
        email,
        phone,
        startDate: d,
        endDate: d,
        startTime,
        endTime,
        payRate,
        billRate,
        jobTitle,
        shiftTitle,
        accountId,
        hiringEntityId,
        worksiteId,
        // Aligned per-day weeklySchedule (one DOW only, matching this date).
        weeklySchedule: {
          [String(dow)]: { enabled: true, startTime, endTime },
        },
        // Status starts confirmed — the recruiter is recording work that
        // already happened; there's no offer-acceptance flow to run.
        status: 'confirmed',
        latestStatus: 'confirmed',
        // **Retroactive marker.** Downstream SMS / cadence / reminder
        // triggers gate on this so the worker doesn't get a "you've been
        // placed" / "shift starting soon" text for a shift that already
        // ended (or is happening today).
        retroactive: true,
        notificationsSuppressed: true,
        assignmentSource: 'retroactive_admin_add',
        placementMode: 'retroactive',
        createdBy: req.auth!.uid,
        createdAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();

    logger.info('[addRetroactiveWorker] created', {
      tenantId,
      jobOrderId,
      shiftId,
      userId,
      callerUid: req.auth.uid,
      assignmentsCreated: dates.length,
      startDate,
      endDate,
    });

    return {
      ok: true,
      assignmentsCreated: dates.length,
      sampleAssignmentId: firstId,
      dates,
    };
  },
);
