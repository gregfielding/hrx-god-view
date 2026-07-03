/**
 * Automations API
 * 
 * Internal/cron endpoints for automated messaging workflows.
 * 
 * Implements: HRX One Messaging API Spec — Section 5 Automations API
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendMessage, MessageContext } from './routingOrchestrator';
import { verifyRequestAuthHrx } from './httpAuth';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * POST /internal/automations/profile-incomplete/run
 * 
 * Scan for users with incomplete profiles and send reminders.
 * 
 * Implements: HRX Messaging API Spec §5.1
 */
export const profileIncompleteAutomation = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // Bulk SMS fan-out with a caller-controlled limit and no scheduler or
      // client wired to it — HRX-admin token required (2026-07-03 audit; was
      // fully unauthenticated with only a TODO).
      const callerAuth = await verifyRequestAuthHrx(request, response);
      if (!callerAuth) return;

      const { dryRun = false, limit = 100, tenantId } = request.body;

      if (!tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required' },
        });
        return;
      }

      // Get users with incomplete profiles
      // This is a simplified check - in production, define what "incomplete" means
      const usersSnapshot = await db
        .collection('users')
        .where('tenantId', '==', tenantId)
        .limit(limit)
        .get();

      let processedCount = 0;
      let sentCount = 0;
      let skippedDueToPreferences = 0;
      let skippedOtherReasons = 0;

      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Check if profile is incomplete (simplified - check for missing required fields)
        const requiredFields = ['firstName', 'lastName', 'email', 'phoneE164'];
        const missingFields = requiredFields.filter(field => !userData[field]);

        if (missingFields.length === 0) {
          skippedOtherReasons++;
          continue;
        }

        // Check if reminder was sent recently (within last 7 days)
        const recentReminders = await db
          .collection('messageLogs')
          .where('userId', '==', userId)
          .where('messageTypeId', '==', 'profile_incomplete_reminder')
          .where('createdAt', '>', admin.firestore.Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
          .limit(1)
          .get();

        if (!recentReminders.empty) {
          skippedOtherReasons++;
          continue;
        }

        processedCount++;

        if (dryRun) {
          logger.info(`[DRY RUN] Would send profile incomplete reminder to ${userId}`);
          continue;
        }

        // Send reminder
        try {
          const messageContext: MessageContext = {
            userId,
            tenantId,
            messageTypeId: 'profile_incomplete_reminder',
            variables: {
              firstName: userData.firstName || 'there',
              missingFields: missingFields.join(', '),
              profileUrl: `https://app.hrxone.com/profile`, // TODO: Generate actual URL
            },
            source: 'automation',
            sourceId: 'profile_incomplete',
          };

          const result = await sendMessage(messageContext);

          if (result.success) {
            sentCount++;
          } else {
            skippedDueToPreferences++;
          }
        } catch (error: any) {
          logger.error(`Error sending profile reminder to ${userId}:`, error);
          skippedOtherReasons++;
        }
      }

      response.status(200).json({
        success: true,
        processedCount,
        sentCount,
        skippedDueToPreferences,
        skippedOtherReasons,
      });
    } catch (error: any) {
      logger.error('Error in profileIncompleteAutomation:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /internal/automations/shift-confirmations/run
 * 
 * Send upcoming shift confirmation messages and handle follow-ups.
 * 
 * Implements: HRX Messaging API Spec §5.2
 */
export const shiftConfirmationsAutomation = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // Same lockdown rationale as profileIncompleteAutomation above.
      const callerAuth = await verifyRequestAuthHrx(request, response);
      if (!callerAuth) return;

      const { windowHours = 24, dryRun = false, limit = 100, tenantId } = request.body;

      if (!tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required' },
        });
        return;
      }

      const now = new Date();
      const windowStart = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + (windowHours + 24) * 60 * 60 * 1000);

      // Get shifts starting within the window
      // This is simplified - adjust query based on your shift data structure
      const shiftsSnapshot = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('shifts')
        .where('startDate', '>=', admin.firestore.Timestamp.fromDate(windowStart))
        .where('startDate', '<=', admin.firestore.Timestamp.fromDate(windowEnd))
        .limit(limit)
        .get();

      let shiftsConsidered = 0;
      let confirmationsSent = 0;
      let alreadyConfirmed = 0;
      let skippedDueToPreferences = 0;

      for (const shiftDoc of shiftsSnapshot.docs) {
        const shiftData = shiftDoc.data();
        shiftsConsidered++;

        // Check if already confirmed
        if (shiftData.status === 'confirmed' || shiftData.confirmed === true) {
          alreadyConfirmed++;
          continue;
        }

        // Get assigned worker
        const workerId = shiftData.workerId || shiftData.userId;
        if (!workerId) {
          continue;
        }

        const workerDoc = await db.collection('users').doc(workerId).get();
        if (!workerDoc.exists) {
          continue;
        }

        const workerData = workerDoc.data();

        if (dryRun) {
          logger.info(`[DRY RUN] Would send shift confirmation to ${workerId} for shift ${shiftDoc.id}`);
          continue;
        }

        // Send confirmation request
        try {
          const messageContext: MessageContext = {
            userId: workerId,
            tenantId,
            messageTypeId: 'shift_confirmation',
            variables: {
              firstName: workerData?.firstName || 'there',
              shiftDate: shiftData.startDate?.toDate?.()?.toLocaleDateString() || 'soon',
              shiftStartTime: shiftData.startTime || 'TBD',
              shiftEndTime: shiftData.endTime || 'TBD',
              locationName: shiftData.locationName || 'TBD',
              jobTitle: shiftData.jobTitle || 'position',
            },
            source: 'automation',
            sourceId: shiftDoc.id,
          };

          const result = await sendMessage(messageContext);

          if (result.success) {
            confirmationsSent++;
          } else {
            skippedDueToPreferences++;
          }
        } catch (error: any) {
          logger.error(`Error sending shift confirmation to ${workerId}:`, error);
          skippedDueToPreferences++;
        }
      }

      response.status(200).json({
        success: true,
        shiftsConsidered,
        confirmationsSent,
        alreadyConfirmed,
        skippedDueToPreferences,
      });
    } catch (error: any) {
      logger.error('Error in shiftConfirmationsAutomation:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /internal/automations/retry-failed-messages
 * 
 * Retry transiently failed messages.
 * 
 * Implements: HRX Messaging API Spec §5.3
 */
export const retryFailedMessagesAutomation = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // Same lockdown rationale as profileIncompleteAutomation above. This
      // one is cross-tenant (queries messageLogs globally), so HRX-only is
      // doubly required.
      const callerAuth = await verifyRequestAuthHrx(request, response);
      if (!callerAuth) return;

      const { sinceMinutes = 60, limit = 50 } = request.body;

      const sinceTimestamp = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() - sinceMinutes * 60 * 1000)
      );

      // Find failed messages that are retryable
      const failedMessagesQuery = await db
        .collection('messageLogs')
        .where('status', '==', 'failed')
        .where('createdAt', '>=', sinceTimestamp)
        .where('retryable', '==', true) // Would need to add this field
        .limit(limit)
        .get();

      let candidatesFound = failedMessagesQuery.size;
      let retriedCount = 0;

      for (const messageLogDoc of failedMessagesQuery.docs) {
        const messageLog = messageLogDoc.data();

        // Check if already retried
        if (messageLog.retryCount && messageLog.retryCount >= 3) {
          continue;
        }

        // Retry the message
        try {
          const messageContext: MessageContext = {
            userId: messageLog.userId,
            tenantId: messageLog.tenantId,
            messageTypeId: messageLog.messageTypeId,
            variables: messageLog.context?.variables || {},
            source: 'retry',
            sourceId: messageLogDoc.id,
          };

          const result = await sendMessage(messageContext);

          if (result.success) {
            // Update original log
            await messageLogDoc.ref.update({
              retryCount: admin.firestore.FieldValue.increment(1),
              lastRetryAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            retriedCount++;
          }
        } catch (error: any) {
          logger.error(`Error retrying message ${messageLogDoc.id}:`, error);
        }
      }

      response.status(200).json({
        success: true,
        candidatesFound,
        retriedCount,
      });
    } catch (error: any) {
      logger.error('Error in retryFailedMessagesAutomation:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

