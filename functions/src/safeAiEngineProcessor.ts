import { createSafeFirestoreTrigger } from './utils/safeFunctionTemplate';
import { logger } from './utils/logger';

export const processAILog = createSafeFirestoreTrigger(async () => {
  logger.info('processAILog trigger invoked but ai_logs no longer exists.', {
    context: 'safeAiEngineProcessor.processAILog'
  });
});
