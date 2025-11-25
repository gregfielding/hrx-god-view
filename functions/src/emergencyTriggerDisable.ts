import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from './utils/logger';

export const firestoreLogAILogCreated = onDocumentCreated('ai_logs/{logId}', async (event) => {
  logger.info('Emergency AI log trigger called; logging is no longer persisted.', {
    context: 'emergencyTriggerDisable',
    extra: { logId: event.params.logId }
  });
});
