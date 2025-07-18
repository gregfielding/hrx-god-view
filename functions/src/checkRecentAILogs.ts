import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

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
    try {
      const { fieldPath, timeWindowMinutes, expectedKeys } = request.data;
      
      if (!fieldPath || !timeWindowMinutes || !expectedKeys) {
        const response: CheckRecentAILogsResponse = {
          logFound: false,
          logValid: false,
          missingKeys: expectedKeys || [],
          extraKeys: [],
          error: 'Missing required parameters'
        };
        return response;
      }

      // Calculate time window
      const now = new Date();
      const timeWindowStart = new Date(now.getTime() - (timeWindowMinutes * 60 * 1000));

      // Query for recent logs matching the field path
      const logsRef = db.collection('ai_logs');
      const query = logsRef
        .where('fieldPath', '==', fieldPath)
        .where('timestamp', '>=', timeWindowStart)
        .orderBy('timestamp', 'desc')
        .limit(1);

      const snapshot = await query.get();

      if (snapshot.empty) {
        const response: CheckRecentAILogsResponse = {
          logFound: false,
          logValid: false,
          missingKeys: expectedKeys,
          extraKeys: []
        };
        return response;
      }

      // Get the most recent log
      const logDoc = snapshot.docs[0];
      const logEntry = logDoc.data();

      // Validate the log entry against expected keys
      const actualKeys = Object.keys(logEntry);
      const missingKeys = expectedKeys.filter((key: string) => !actualKeys.includes(key));
      const extraKeys = actualKeys.filter((key: string) => !expectedKeys.includes(key));

      const logValid = missingKeys.length === 0;

      const response: CheckRecentAILogsResponse = {
        logFound: true,
        logValid,
        missingKeys,
        extraKeys,
        logEntry
      };
      return response;

    } catch (error) {
      console.error('Error checking recent AI logs:', error);
      const response: CheckRecentAILogsResponse = {
        logFound: false,
        logValid: false,
        missingKeys: request.data?.expectedKeys || [],
        extraKeys: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      return response;
    }
  }
); 