/**
 * Lightweight callable: list parsed resumes for a user. Lives outside resumeParser.ts so this
 * function does not load compromise/OpenAI/pdf/vision — avoids Cloud Run OOM on cold start.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from './integrations/callableBrowserCors';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const getUserParsedResumes = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    cors: CALLABLE_BROWSER_CORS,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.data?.userId;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new HttpsError('invalid-argument', 'userId is required');
    }

    try {
      const resumesSnapshot = await db
        .collection('parsedResumes')
        .where('userId', '==', userId.trim())
        .orderBy('uploadDate', 'desc')
        .get();

      const resumes = resumesSnapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      return { resumes };
    } catch (e) {
      logger.error('getUserParsedResumes', e);
      throw new HttpsError('internal', 'Failed to get parsed resumes');
    }
  },
);
