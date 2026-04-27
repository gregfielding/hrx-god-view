import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from './utils/logger';

export const processAILog = onDocumentCreated('ai_logs/{logId}', async (event) => {
  logger.info('aiEngineProcessor trigger fired but Firestore AI logs were removed.', {
    context: 'aiEngineProcessor.processAILog',
    extra: { logId: event.params.logId }
  });
});
