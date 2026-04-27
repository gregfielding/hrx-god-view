import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { didRelevantAssignmentFieldsChange } from '../utils/didRelevantAssignmentFieldsChange';
import { persistAssignmentReadinessV1IfChanged } from './assignmentReadinessPersist';
import { shouldRecomputeNoShowRiskForAssignmentWrite } from './noShowRiskAssignmentWriteGate';
import { maybeEmitCategoryScoreOnAssignmentWrite } from '../categoryScoreEvolution/emitCategoryScoreFromDomainEvents';

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

export const syncAssignmentReadinessV1OnAssignmentWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/assignments/{assignmentId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const assignmentId = event.params.assignmentId as string;
    if (!event.data?.after?.exists) return;

    const beforeData = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const afterData = event.data.after.data() as Record<string, unknown>;

    if (!didRelevantAssignmentFieldsChange(beforeData, afterData)) {
      logger.debug('[assignment-readiness] skipped — no relevant field changes', { tenantId, assignmentId });
      return;
    }

    try {
      const { wrote } = await persistAssignmentReadinessV1IfChanged(db, tenantId, assignmentId);
      if (wrote) {
        logger.info('synced assignmentReadinessV1', { tenantId, assignmentId });
      }
    } catch (error) {
      logger.error('failed to sync assignmentReadinessV1', {
        tenantId,
        assignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await recomputeHrxReadinessSnapshotForAssignment(db, tenantId, assignmentId);
    } catch (error) {
      logger.error('failed to sync readinessSnapshotV1 (assignment write)', {
        tenantId,
        assignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (shouldRecomputeNoShowRiskForAssignmentWrite({ before: beforeData, after: afterData })) {
      try {
        // Lazy-load persist so this trigger does not synchronously require the full no-show module graph at cold start.
        const { recomputeNoShowRiskPredictionForAssignment } = await import('./persistNoShowRiskPredictionForAssignment');
        await recomputeNoShowRiskPredictionForAssignment(db, tenantId, assignmentId);
      } catch (error) {
        logger.error('failed to sync noShowRiskPredictionV1 (assignment write)', {
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await maybeEmitCategoryScoreOnAssignmentWrite(db, tenantId, assignmentId, beforeData, afterData);
  }
);
