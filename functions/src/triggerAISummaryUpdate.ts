import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from './utils/logger';

export const triggerAISummaryUpdate = onDocumentCreated(
  'tenants/{tenantId}/ai_logs/{logId}',
  async (event) => {
    logger.info('triggerAISummaryUpdate invoked but ai_logs has been removed.', {
      context: 'triggerAISummaryUpdate',
      extra: {
        tenantId: event.params.tenantId,
        logId: event.params.logId
      }
    });
    // Nothing else to do—AI summaries are now driven by direct events instead of Firestore logs.
  }
);
