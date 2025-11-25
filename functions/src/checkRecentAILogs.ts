import { onCall } from 'firebase-functions/v2/https';
import { logger } from './utils/logger';

// Request interface for checking recent AI logs
interface CheckRecentAILogsRequest {
  fieldPath: string;
  timeWindowMinutes: number;
  expectedKeys: string[];
}

interface CheckRecentAILogsResponse {
  logFound: boolean;
  logValid: boolean;
  missingKeys: string[];
  extraKeys: string[];
  logEntry?: any;
  error?: string;
}

export const checkRecentAILogs = onCall(
  { 
    cors: true,
    maxInstances: 10 
  },
  async (request: { data: CheckRecentAILogsRequest }) => {
    const { fieldPath, timeWindowMinutes, expectedKeys } = request.data || {};

    logger.info('checkRecentAILogs invoked but Firestore logging is disabled.', {
      context: 'checkRecentAILogs',
      extra: { fieldPath, timeWindowMinutes }
    });

    const response: CheckRecentAILogsResponse = {
      logFound: false,
      logValid: false,
      missingKeys: expectedKeys || [],
      extraKeys: [],
      error: 'AI logging has been disabled; no Firestore log data is available.'
    };
    return response;
  }
);