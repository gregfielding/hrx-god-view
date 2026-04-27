import { onCall } from 'firebase-functions/v2/https';
import { logger } from './utils/logger';

export const runAILogTests = onCall(async (request) => {
  logger.info('runAILogTests invoked but the AI log test harness has been retired.', {
    context: 'testHarness.runAILogTests',
    extra: { testType: request.data?.testType }
  });

  return {
    success: false,
    message: 'The ai_logs collection has been removed; automated AI log tests are no longer available.'
  };
});
