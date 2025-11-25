import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from './utils/logger';

export const firestoreLogAILogCreated = onDocumentCreated('ai_logs/{logId}', async (event) => {
  logger.info('firestoreLogAILogCreated (disabled) invoked.', {
    context: 'firestoreLogAILogCreatedDisabled',
    extra: { logId: event.params.logId }
  });
});
