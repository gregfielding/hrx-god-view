import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isC1WorkerScope } from './c1WorkerScope';
import { persistWorkerReadinessV1ForUidIfChanged } from './workerReadinessV1Persist';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/**
 * Recomputes `workerReadinessV1` (profile + overall worker state) for C1 workers on `users/{uid}` writes.
 * Writes are skipped when the persisted payload is unchanged (avoids loops when only `workerReadinessV1` echoes).
 */
export const syncWorkerProfileReadinessV1 = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: 'us-central1',
    maxInstances: 3,
    retry: false,
    /** Cold start + readiness merge exceeds 256 MiB in production. */
    memory: '512MiB',
  },
  async (event) => {
    const uid = event.params.uid as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;

    if (!after) return;
    if (!isC1WorkerScope(after)) return;

    try {
      const { wrote, skippedReason } = await persistWorkerReadinessV1ForUidIfChanged(db, uid);
      if (wrote) {
        logger.info('synced workerReadinessV1 (users write)', { uid });
      } else if (skippedReason && skippedReason !== 'unchanged') {
        logger.warn('workerReadinessV1 persist skipped', { uid, skippedReason });
      }
    } catch (error) {
      logger.error('failed to sync workerReadinessV1 from users write', {
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
