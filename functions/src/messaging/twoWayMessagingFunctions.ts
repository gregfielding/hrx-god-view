/**
 * Cloud Functions for Two-Way Messaging
 * 
 * Provides callable functions for recruiter messaging UI
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 2.4 Outbound SMS from Recruiter
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  findOrCreateThread,
  sendOutboundMessage,
  getThreadWithMessages,
  getRecruiterThreads,
  updateThreadStatus,
  SmsThread,
  ThreadStatus,
} from './twoWayMessaging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Send message from recruiter to candidate
 */
export const sendRecruiterMessage = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { threadId, body, language } = request.data as {
    threadId: string;
    body: string;
    language?: 'en' | 'es';
  };

  if (!threadId || !body) {
    throw new HttpsError('invalid-argument', 'threadId and body are required');
  }

  try {
    const recruiterId = request.auth.uid;
    const result = await sendOutboundMessage(threadId, recruiterId, body, { language });
    // With queueing, message is created asynchronously by the queue worker
    // Return requestId so client can track status
    return { success: result.success, requestId: result.requestId };
  } catch (error: any) {
    logger.error('Error sending recruiter message:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to send message: ${error.message}`);
  }
});

/**
 * Get thread with messages
 */
export const getThread = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { threadId, limit } = request.data as {
    threadId: string;
    limit?: number;
  };

  if (!threadId) {
    throw new HttpsError('invalid-argument', 'threadId is required');
  }

  try {
    const { thread, messages } = await getThreadWithMessages(threadId, { limit });
    return { success: true, thread, messages };
  } catch (error: any) {
    logger.error('Error getting thread:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get thread: ${error.message}`);
  }
});

/**
 * Get threads for recruiter
 */
export const getThreads = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, status, limit } = request.data as {
    tenantId: string;
    status?: ThreadStatus;
    limit?: number;
  };

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
  }

  try {
    const recruiterId = request.auth.uid;
    const threads = await getRecruiterThreads(recruiterId, tenantId, { status, limit });
    return { success: true, threads };
  } catch (error: any) {
    logger.error('Error getting threads:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get threads: ${error.message}`);
  }
});

/**
 * Update thread status
 */
export const updateThread = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { threadId, status } = request.data as {
    threadId: string;
    status: ThreadStatus;
  };

  if (!threadId || !status) {
    throw new HttpsError('invalid-argument', 'threadId and status are required');
  }

  try {
    await updateThreadStatus(threadId, status);
    return { success: true };
  } catch (error: any) {
    logger.error('Error updating thread:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to update thread: ${error.message}`);
  }
});

/**
 * Create or find thread for candidate
 */
export const createThread = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { candidateId, candidatePhone, twilioNumber, tenantId, jobOrderId, applicationId } = request.data as {
    candidateId: string;
    candidatePhone: string;
    twilioNumber: string;
    tenantId: string;
    jobOrderId?: string;
    applicationId?: string;
  };

  if (!candidateId || !candidatePhone || !twilioNumber || !tenantId) {
    throw new HttpsError('invalid-argument', 'candidateId, candidatePhone, twilioNumber, and tenantId are required');
  }

  try {
    const recruiterId = request.auth.uid;
    const thread = await findOrCreateThread(candidateId, candidatePhone, twilioNumber, tenantId, {
      primaryRecruiterId: recruiterId,
      jobOrderId,
      applicationId,
    });
    return { success: true, thread };
  } catch (error: any) {
    logger.error('Error creating thread:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to create thread: ${error.message}`);
  }
});

