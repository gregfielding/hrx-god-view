/**
 * completeExpiredOpenShiftAssignments — daily cron.
 *
 * Open-shift (standing-crew) assignments are created `status: 'active'`
 * with no completion event. Two ways they end:
 *
 *  1. `openShiftSetEndDate` stamps an `endDate` on the assignment but
 *     leaves the status `active` — flip to `completed` once that date is
 *     in the past.
 *  2. Single-date open shifts (`shiftMode: 'single'`, e.g. Fieldglass
 *     auto-created event gigs) keep their date in the shift doc's
 *     `shiftDate` and have NO `endDate` field — so their assignments are
 *     born `endDate: ''` ("ongoing") and nothing ever ends them. For
 *     empty-endDate assignments, resolve the real end from the parent
 *     shift doc (`shiftDate` for single mode, `endDate` for multi) and
 *     flip once it has passed, stamping the derived `endDate` on the
 *     assignment so downstream queries see a closed range. Shifts that
 *     are genuinely ongoing/rolling (no resolvable end) stay active.
 *
 * This cron does NOT generate any new timecard rows (the resolver already
 * stops at endDate) and sends no notifications — `completed` is the
 * natural terminal state for a finished assignment.
 *
 * Scoped per tenant via the auto-indexed `isOpenShift == true` +
 * `noFixedTimes == true` filters (unioned by doc id — same definition of
 * "open assignment" as `openShiftSetEndDate`), so it only ever reads the
 * handful of open-shift assignments, not the whole assignments collection.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const BATCH_LIMIT = 400; // Firestore hard cap is 500; stay under it.

/** Today as YYYY-MM-DD in UTC. A removed worker is completed once the day
 *  after their endDate begins; a one-day UTC grace is acceptable for a
 *  daily housekeeping job that only affects "live vs done" classification. */
function todayUtcIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** YYYY-MM-DD from a date-only string, datetime string, or Timestamp. */
function toDateOnly(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  return '';
}

export const completeExpiredOpenShiftAssignments = onSchedule(
  {
    schedule: '0 13 * * *', // 13:00 UTC daily
    timeZone: 'UTC',
    memory: '512MiB',
  },
  async () => {
    const todayIso = todayUtcIso();
    const tenantsSnap = await db.collection('tenants').get();

    let scanned = 0;
    let flipped = 0;
    let flippedViaShift = 0;
    let shiftLookups = 0;

    for (const tenant of tenantsSnap.docs) {
      // Union of both open-assignment markers; some writers set only one.
      const [byFlag, byNoTimes] = await Promise.all([
        tenant.ref.collection('assignments').where('isOpenShift', '==', true).get(),
        tenant.ref.collection('assignments').where('noFixedTimes', '==', true).get(),
      ]);
      const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      for (const d of [...byFlag.docs, ...byNoTimes.docs]) docs.set(d.id, d);

      // Parent-shift end date per `${jobOrderId}/${shiftId}` ('' = no
      // resolvable end → ongoing; cached so a crew of N costs one read).
      const shiftEndCache = new Map<string, Promise<string>>();
      const resolveShiftEnd = (jobOrderId: string, shiftId: string): Promise<string> => {
        const key = `${jobOrderId}/${shiftId}`;
        let p = shiftEndCache.get(key);
        if (!p) {
          shiftLookups += 1;
          p = tenant.ref
            .collection('job_orders')
            .doc(jobOrderId)
            .collection('shifts')
            .doc(shiftId)
            .get()
            .then((snap) => {
              if (!snap.exists) return '';
              const s = snap.data() || {};
              // Rolling standing-crew shifts (shiftType 'open') have no
              // natural end — their shiftDate is when the crew STARTED,
              // not when it ends. Only an explicitly stamped endDate
              // ends them (the "End open shift" button). Treating them
              // as single-mode killed every standing crew the morning
              // after creation (Proof of the Pudding crews, 2026-07-21).
              if (String(s.shiftType || '').toLowerCase() === 'open') {
                return toDateOnly(s.endDate);
              }
              const mode = String(s.shiftMode || 'single').toLowerCase();
              if (mode === 'single') return toDateOnly(s.shiftDate);
              return toDateOnly(s.endDate);
            })
            .catch(() => '');
          shiftEndCache.set(key, p);
        }
        return p;
      };

      let batch = db.batch();
      let inBatch = 0;

      for (const docSnap of docs.values()) {
        scanned += 1;
        const a = docSnap.data() || {};
        const status = String(a.status || '').toLowerCase();
        if (status !== 'active' && status !== 'in_progress') continue;

        const stampedEnd = toDateOnly(a.endDate);
        let effectiveEnd = stampedEnd;
        let reason = 'open_shift_ended';

        if (!stampedEnd) {
          // No endDate on the assignment — ask the parent shift.
          const jobOrderId = String(a.jobOrderId || '');
          const shiftId = String(a.shiftId || '');
          if (!jobOrderId || !shiftId) continue;
          const shiftEnd = await resolveShiftEnd(jobOrderId, shiftId);
          if (!shiftEnd) continue; // genuinely ongoing / rolling → leave active
          const start = toDateOnly(a.startDate);
          effectiveEnd = start && shiftEnd < start ? start : shiftEnd;
          reason = 'open_shift_date_passed';
        }

        if (!effectiveEnd || effectiveEnd >= todayIso) continue; // not past yet

        const update: Record<string, unknown> = {
          status: 'completed',
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedReason: reason,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (!stampedEnd) {
          update.endDate = effectiveEnd; // make the closed range visible to downstream queries
          flippedViaShift += 1;
        }
        batch.set(docSnap.ref, update, { merge: true });
        inBatch += 1;
        flipped += 1;

        if (inBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      }

      if (inBatch > 0) await batch.commit();
    }

    logger.info('completeExpiredOpenShiftAssignments', {
      tenants: tenantsSnap.size,
      openShiftAssignmentsScanned: scanned,
      flippedToCompleted: flipped,
      flippedViaShiftDate: flippedViaShift,
      shiftLookups,
      todayIso,
    });
  },
);
