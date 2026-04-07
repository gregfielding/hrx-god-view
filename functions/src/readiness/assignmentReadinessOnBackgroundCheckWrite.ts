import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  persistAssignmentReadinessV1IfChanged,
  resolveAssignmentReadinessLinkagesFromBackgroundCheckData,
  type AssignmentReadinessLinkage,
} from './assignmentReadinessPersist';

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

function mergeLinkages(rows: AssignmentReadinessLinkage[][]): Map<string, AssignmentReadinessLinkage> {
  const map = new Map<string, AssignmentReadinessLinkage>();
  for (const list of rows) {
    for (const row of list) {
      map.set(`${row.tenantId}::${row.assignmentId}`, row);
    }
  }
  return map;
}

export const syncAssignmentReadinessV1OnBackgroundCheckWrite = onDocumentWritten(
  {
    document: 'backgroundChecks/{checkId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const checkId = event.params.checkId as string;
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;

    let beforeLinks: AssignmentReadinessLinkage[] = [];
    let afterLinks: AssignmentReadinessLinkage[] = [];
    try {
      [beforeLinks, afterLinks] = await Promise.all([
        resolveAssignmentReadinessLinkagesFromBackgroundCheckData(db, before),
        resolveAssignmentReadinessLinkagesFromBackgroundCheckData(db, after),
      ]);
    } catch (error) {
      logger.error('failed to resolve assignment linkages from backgroundChecks write', {
        checkId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const targets = mergeLinkages([beforeLinks, afterLinks]);
    if (targets.size === 0) return;

    for (const { tenantId, assignmentId } of targets.values()) {
      try {
        const { wrote } = await persistAssignmentReadinessV1IfChanged(db, tenantId, assignmentId);
        if (wrote) {
          logger.info('synced assignmentReadinessV1 (background_check)', {
            checkId,
            tenantId,
            assignmentId,
          });
        }
      } catch (error) {
        logger.error('failed to sync assignmentReadinessV1 from background_check', {
          checkId,
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        await recomputeHrxReadinessSnapshotForAssignment(db, tenantId, assignmentId);
      } catch (error) {
        logger.error('failed to sync readinessSnapshotV1 (background_check)', {
          checkId,
          tenantId,
          assignmentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
);
