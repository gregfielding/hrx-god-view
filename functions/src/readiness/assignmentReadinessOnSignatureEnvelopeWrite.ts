import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { persistAssignmentReadinessV1IfChanged } from './assignmentReadinessPersist';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

export const syncAssignmentReadinessV1OnSignatureEnvelopeWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/signature_envelopes/{envelopeId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const row = after || before;
    if (!row) return;

    const assignmentId = String(row.assignmentId || '').trim();
    if (!assignmentId) return;

    try {
      const { wrote } = await persistAssignmentReadinessV1IfChanged(db, tenantId, assignmentId);
      if (wrote) {
        logger.info('synced assignmentReadinessV1 (signature_envelope)', { tenantId, assignmentId });
      }
    } catch (error) {
      logger.error('failed to sync assignmentReadinessV1 from signature_envelope', {
        tenantId,
        assignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
