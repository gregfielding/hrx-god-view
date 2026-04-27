/**
 * When work-authorization attestation on `users/{uid}` changes, refresh `readinessSnapshotV1` on live assignments
 * that reference this worker (collection group). Uses `recomputeHrxReadinessSnapshotForAssignment` from the esbuild bundle.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { listLiveAssignmentTenantPairsForUserCollectionGroup } from './hrxReadinessSnapshotFanout';
import { getWorkAuthorizedStatusForReadiness } from '../utils/workAuthorizedStatusReadiness';

if (!admin.apps.length) admin.initializeApp();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { recomputeHrxReadinessSnapshotForAssignment } = require('./syncHrxReadinessSnapshotV1.cjs') as {
  recomputeHrxReadinessSnapshotForAssignment: (
    db: admin.firestore.Firestore,
    tenantId: string,
    assignmentId: string
  ) => Promise<unknown>;
};

const db = admin.firestore();

export const syncHrxReadinessSnapshotV1OnUserWrite = onDocumentWritten(
  {
    document: 'users/{userId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const userId = event.params.userId as string;
    const beforeData = event.data?.before?.exists ? event.data.before.data() : undefined;
    const afterData = event.data?.after?.exists ? event.data.after.data() : undefined;

    const beforeDerived = getWorkAuthorizedStatusForReadiness(beforeData);
    const afterDerived = getWorkAuthorizedStatusForReadiness(afterData);
    if (beforeDerived === afterDerived) {
      return;
    }

    const pairs = await listLiveAssignmentTenantPairsForUserCollectionGroup(db, userId, 50, 50);
    if (pairs.length === 0) {
      return;
    }

    logger.info('hrxReadinessSnapshotV1 user work-auth change; fan-out recompute', {
      userId,
      beforeDerived,
      afterDerived,
      assignmentCount: pairs.length,
    });

    for (const { tenantId, assignmentId } of pairs) {
      try {
        await recomputeHrxReadinessSnapshotForAssignment(db, tenantId, assignmentId);
      } catch (error) {
        logger.error('failed to sync readinessSnapshotV1 (users write)', {
          userId,
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
);
