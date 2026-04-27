/**
 * Callable test functions for SMS Queue
 * Can be invoked from frontend or Firebase CLI
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { createOutboundRequest } from './smsOutboundQueue';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Test: Create a simple outbound request
 * Useful for quick smoke testing
 */
export const testCreateOutboundRequest = onCall(
  {
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { tenantId, toPhoneE164, body, threadId } = request.data as {
      tenantId: string;
      toPhoneE164: string;
      body?: string;
      threadId?: string;
    };

    if (!tenantId || !toPhoneE164) {
      throw new HttpsError('invalid-argument', 'tenantId and toPhoneE164 are required');
    }

    try {
      const requestId = await createOutboundRequest({
        tenantId,
        threadId,
        toPhoneE164,
        body: body || 'Test message from callable function',
        source: 'manual',
        requestedByUid: request.auth.uid,
      });

      logger.info(`Test request created: ${requestId}`);

      return {
        success: true,
        requestId,
        message: 'Request created. Check Firestore and Cloud Tasks console to verify processing.',
      };
    } catch (error: any) {
      logger.error('Error creating test request:', error);
      throw new HttpsError('internal', `Failed to create request: ${error.message}`);
    }
  }
);

/**
 * Test: Check request status
 */
export const testCheckRequestStatus = onCall(
  {
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { tenantId, requestId } = request.data as {
      tenantId: string;
      requestId: string;
    };

    if (!tenantId || !requestId) {
      throw new HttpsError('invalid-argument', 'tenantId and requestId are required');
    }

    try {
      const requestDoc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsOutboundRequests')
        .doc(requestId)
        .get();

      if (!requestDoc.exists) {
        throw new HttpsError('not-found', 'Request not found');
      }

      const requestData = requestDoc.data();

      return {
        success: true,
        request: {
          id: requestDoc.id,
          status: requestData?.status,
          attemptCount: requestData?.attemptCount,
          twilioMessageSid: requestData?.twilioMessageSid,
          lastError: requestData?.lastError,
          createdAt: requestData?.createdAt,
          sentAt: requestData?.sentAt,
        },
      };
    } catch (error: any) {
      if (error instanceof HttpsError) {
        throw error;
      }
      logger.error('Error checking request status:', error);
      throw new HttpsError('internal', `Failed to check status: ${error.message}`);
    }
  }
);

/**
 * Test: Verify idempotency
 */
export const testIdempotency = onCall(
  {
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { tenantId, toPhoneE164, body, threadId } = request.data as {
      tenantId: string;
      toPhoneE164: string;
      body: string;
      threadId?: string;
    };

    if (!tenantId || !toPhoneE164 || !body) {
      throw new HttpsError('invalid-argument', 'tenantId, toPhoneE164, and body are required');
    }

    try {
      // Create first request
      const requestId1 = await createOutboundRequest({
        tenantId,
        threadId,
        toPhoneE164,
        body,
        source: 'manual',
        requestedByUid: request.auth.uid,
      });

      // Immediately create second with same params
      const requestId2 = await createOutboundRequest({
        tenantId,
        threadId,
        toPhoneE164,
        body,
        source: 'manual',
        requestedByUid: request.auth.uid,
      });

      // Get both requests to check idempotency keys
      const req1 = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsOutboundRequests')
        .doc(requestId1)
        .get();

      const req2 = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsOutboundRequests')
        .doc(requestId2)
        .get();

      const key1 = req1.data()?.idempotencyKey;
      const key2 = req2.data()?.idempotencyKey;

      const isIdempotent = requestId1 === requestId2 || key1 === key2;

      return {
        success: true,
        isIdempotent,
        requestId1,
        requestId2,
        idempotencyKey1: key1,
        idempotencyKey2: key2,
        message: isIdempotent
          ? '✅ Idempotency working: duplicate requests detected'
          : '❌ Idempotency failed: different requests created',
      };
    } catch (error: any) {
      logger.error('Error testing idempotency:', error);
      throw new HttpsError('internal', `Failed to test idempotency: ${error.message}`);
    }
  }
);
