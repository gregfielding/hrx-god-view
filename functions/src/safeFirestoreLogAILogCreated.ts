import { createSafeFirestoreTrigger } from './utils/safeFunctionTemplate';
import { logger } from './utils/logger';

export const firestoreLogAILogCreated = createSafeFirestoreTrigger(async () => {
  logger.info('firestoreLogAILogCreated invoked but ai_logs has been removed.', {
    context: 'safeFirestoreLogAILogCreated'
  });
  // No-op: Firestore logging has been decommissioned.
});
