import { createSafeFirestoreTrigger } from './utils/safeFunctionTemplate';
import { logger } from './utils/logger';

export const firestoreLogAILogUpdated = createSafeFirestoreTrigger(async () => {
  logger.info('firestoreLogAILogUpdated invoked but ai_logs has been removed.', {
    context: 'safeFirestoreAILogUpdated'
  });
});
