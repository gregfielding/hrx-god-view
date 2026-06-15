/**
 * completeExpiredOpenShiftAssignments — daily cron.
 *
 * Open-shift (standing-crew) assignments are created `status: 'active'`
 * with no completion event. When a worker is removed from the crew (or
 * the whole shift is ended), `openShiftSetEndDate` stamps an `endDate`
 * but leaves the status `active` — so the assignment keeps appearing in
 * "live assignment" queries past its end date. This cron flips those to
 * `completed` once their `endDate` is in the past, so they drop out of
 * live queries / overlap checks. It does NOT generate any new timecard
 * rows (the resolver already stops at endDate) and sends no notifications
 * — `completed` is the natural terminal state for a finished assignment.
 *
 * Scoped per tenant via the auto-indexed `isOpenShift == true` filter, so
 * it only ever reads the handful of open-shift assignments, not the whole
 * assignments collection.
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

    for (const tenant of tenantsSnap.docs) {
      const snap = await tenant.ref
        .collection('assignments')
        .where('isOpenShift', '==', true)
        .get();

      let batch = db.batch();
      let inBatch = 0;

      for (const docSnap of snap.docs) {
        scanned += 1;
        const a = docSnap.data() || {};
        const status = String(a.status || '').toLowerCase();
        if (status !== 'active' && status !== 'in_progress') continue;
        const end = typeof a.endDate === 'string' ? a.endDate.trim() : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) continue; // ongoing / no end → leave active
        if (end >= todayIso) continue; // end date hasn't passed yet

        batch.set(
          docSnap.ref,
          {
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            completedReason: 'open_shift_ended',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
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
      todayIso,
    });
  },
);
