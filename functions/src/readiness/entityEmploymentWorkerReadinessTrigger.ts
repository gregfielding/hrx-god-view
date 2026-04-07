import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { C1_TENANT_ID } from './c1WorkerScope';
import { persistWorkerReadinessV1ForUidIfChanged } from './workerReadinessV1Persist';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/**
 * When C1 `entity_employments` changes, refresh `users.{uid}.workerReadinessV1` (overall state + profile snapshot).
 */
export const syncWorkerReadinessV1FromEntityEmployment = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/entity_employments/{employmentId}',
    region: 'us-central1',
    maxInstances: 3,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    if (tenantId !== C1_TENANT_ID) return;

    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const row = after || before;
    if (!row) return;

    const uid = String(row.userId || row.candidateId || '').trim();
    if (!uid) return;

    try {
      const { wrote } = await persistWorkerReadinessV1ForUidIfChanged(db, uid);
      if (wrote) {
        logger.info('synced workerReadinessV1 (entity_employments)', { uid, employmentId: event.params.employmentId });
      }
    } catch (error) {
      logger.error('failed to sync workerReadinessV1 from entity_employments', {
        uid,
        employmentId: event.params.employmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
