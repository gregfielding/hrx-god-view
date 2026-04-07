import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { persistAssignmentReadinessV1IfChanged } from './assignmentReadinessPersist';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/**
 * When an onboarding instance changes, refresh readiness on its assignment (doc id may differ from `assignmentId`).
 */
export const syncAssignmentReadinessV1OnOnboardingInstanceWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/onboarding_instances/{instanceId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const instanceId = event.params.instanceId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const row = after || before;
    if (!row) return;

    const assignmentId = String(row.assignmentId || instanceId || '').trim();
    if (!assignmentId) return;

    try {
      const { wrote } = await persistAssignmentReadinessV1IfChanged(db, tenantId, assignmentId);
      if (wrote) {
        logger.info('synced assignmentReadinessV1 (onboarding_instance)', { tenantId, assignmentId, instanceId });
      }
    } catch (error) {
      logger.error('failed to sync assignmentReadinessV1 from onboarding_instance', {
        tenantId,
        assignmentId,
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
