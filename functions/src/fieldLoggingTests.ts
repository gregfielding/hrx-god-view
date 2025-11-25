import { onCall } from 'firebase-functions/v2/https';
import { logger } from './utils/logger';

const disabledMessage = 'AI field logging tests relied on ai_logs; with logging disabled these helpers are no-ops.';

function buildResponse(name: string, extra: Record<string, unknown> = {}) {
  logger.info(`${name} invoked but field logging tests are disabled.`, {
    context: 'fieldLoggingTests',
    extra
  });
  return {
    success: false,
    message: disabledMessage
  };
}

export const testFieldLevelLogging = onCall(async (request) => buildResponse('testFieldLevelLogging', request.data));
export const testAllAIFields = onCall(async (request) => buildResponse('testAllAIFields', request.data));
export const testFieldValidation = onCall(async (request) => buildResponse('testFieldValidation', request.data));
export const testCORSErrorHandling = onCall(async (request) => buildResponse('testCORSErrorHandling', request.data));
export const testFailedLogRetry = onCall(async (request) => buildResponse('testFailedLogRetry', request.data));
export const testFieldChangeAnalytics = onCall(async (request) => buildResponse('testFieldChangeAnalytics', request.data));
