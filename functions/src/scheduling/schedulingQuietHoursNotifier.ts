/**
 * schedulingQuietHoursNotifier — delivers deferred worker notices at 8am
 * worksite-local (Greg's quiet-hours decision, 2026-07-19).
 *
 * The overnight AI triage applies portal cancellations at ~4:30am PT with
 * notifications suppressed; each suppressed cancellation queues a doc in
 * tenants/{t}/deferred_notices with a `sendAfter` timestamp (8am in the
 * worksite's timezone). This cron runs hourly through the US morning
 * (12:00–16:00 UTC = 8am ET through 8-9am PT) and sends every due, unsent
 * notice via the standard worker-notification path.
 *
 * The JO mute system is honored AT SEND TIME (not queue time): a job order
 * muted after the queue write still silences its notices — same jo.muted
 * check the assignment push trigger uses.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const schedulingQuietHoursNotifier = onSchedule(
  {
    schedule: '0 12-16 * * *', // hourly, 8am ET rollout → 8-9am PT
    timeZone: 'UTC',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const tenantsSnap = await db.collection('tenants').get();
    let sent = 0;
    let muted = 0;
    for (const tenant of tenantsSnap.docs) {
      try {
        const due = await db
          .collection(`tenants/${tenant.id}/deferred_notices`)
          .where('sent', '==', false)
          .where('sendAfter', '<=', now)
          .limit(200)
          .get();
        for (const notice of due.docs) {
          const n = notice.data() || {};
          const uid = String(n.userId ?? '');
          if (!uid) {
            await notice.ref.update({ sent: true, skippedReason: 'no userId' });
            continue;
          }
          // Honor JO mute at delivery time.
          const joId = String(n.jobOrderId ?? '');
          if (joId) {
            try {
              const jo = await db.doc(`tenants/${tenant.id}/job_orders/${joId}`).get();
              if (jo.exists && jo.data()?.muted === true) {
                await notice.ref.update({
                  sent: true,
                  skippedReason: 'job order muted',
                  resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                muted += 1;
                continue;
              }
            } catch {
              /* mute check best-effort — deliver on failure */
            }
          }
          try {
            await sendNotificationAndPush({
              uid,
              tenantId: tenant.id,
              title: String(n.title ?? 'Schedule update'),
              body: String(n.body ?? ''),
              type: 'assignment',
              category: 'assignments',
              deepLink: '/c1/workers/assignments',
              entityId: String(n.assignmentId ?? ''),
              source: 'automation',
            });
            await notice.ref.update({
              sent: true,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            sent += 1;
          } catch (err) {
            // Leave unsent — next hourly run retries.
            logger.warn('[quietHours] send failed; will retry', {
              tenantId: tenant.id,
              noticeId: notice.id,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        logger.error('[quietHours] tenant failed', {
          tenantId: tenant.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info('[quietHours] complete', { sent, muted });
  },
);
