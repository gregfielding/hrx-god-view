/**
 * Application SMS Triggers
 * Sends SMS notifications when application status changes
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendWorkerMessageInternal } from './twilio';
import { resolveTemplate } from './smsTemplates';
import { shouldSendNotification } from './utils/notificationSettings';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Firestore trigger: Send SMS when application status changes
 */
export const onApplicationStatusChanged = onDocumentUpdated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    const applicationId = event.params.applicationId;
    const tenantId = event.params.tenantId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) {
      logger.error(`onApplicationStatusChanged: Missing before/after data for ${applicationId}`);
      return { success: false };
    }

    try {
      // Check for status changes
      const statusChanged = before.status !== after.status;

      if (!statusChanged) {
        // No status change, nothing to do
        return { success: true };
      }

      const oldStatus = before.status;
      const newStatus = after.status;

      logger.info(`Application ${applicationId} status changed from ${oldStatus} to ${newStatus}`);

      // Get user ID from application (userId or candidateId)
      const userId = after.userId || after.candidateId;
      if (!userId) {
        logger.warn(`Application ${applicationId} has no userId or candidateId, skipping SMS`);
        return { success: true };
      }

      // Fetch user data to get phone number
      try {
        const userDoc = await admin.firestore().doc(`users/${userId}`).get();
        const userData = userDoc.data();

        if (!userData) {
          logger.warn(`User ${userId} not found for application ${applicationId}`);
          return { success: true };
        }

        // Check if user has verified phone
        if (!userData.phoneE164 || !userData.phoneVerified) {
          logger.info(`User ${userId} has no verified phone, skipping SMS for application ${applicationId}`);
          return { success: true };
        }

        // Fetch job order details for message
        let jobTitle = 'a position';
        if (after.jobOrderId) {
          try {
            const jobOrderDoc = await admin.firestore()
              .doc(`tenants/${tenantId}/job_orders/${after.jobOrderId}`)
              .get();
            const jobOrderData = jobOrderDoc.data();
            if (jobOrderData?.jobTitle) {
              jobTitle = jobOrderData.jobTitle;
            }
          } catch (err) {
            logger.warn(`Failed to fetch job order ${after.jobOrderId} for application ${applicationId}:`, err);
          }
        }

        // Try to find matching template
        let message = '';
        let templateFound = false;

        try {
          const templatesSnapshot = await db
            .collection(`tenants/${tenantId}/smsTemplates`)
            .where('category', '==', 'application')
            .where('triggerType', '==', 'applicationStatusChange')
            .where('triggerStatus', '==', newStatus)
            .where('enabled', '==', true)
            .limit(1)
            .get();

          if (!templatesSnapshot.empty) {
            const templateDoc = templatesSnapshot.docs[0];
            const template = templateDoc.data();

            // Prepare variables for template
            const variables: Record<string, any> = {
              firstName: userData.firstName || 'there',
              lastName: userData.lastName || '',
              jobTitle: jobTitle,
              locationCity: after.locationCity || '',
              locationName: after.locationName || '',
              applicationStatus: newStatus,
              applicationId: applicationId,
              tenantName: tenantId, // TODO: Fetch actual tenant name
              applicationDate: after.createdAt?.toDate?.()?.toLocaleDateString() || '',
            };

            message = resolveTemplate(template.messageTemplate, variables);
            templateFound = true;
            logger.info(`Using template ${templateDoc.id} for application ${applicationId} status change`);
          }
        } catch (templateError: any) {
          logger.warn(`Failed to fetch template for application ${applicationId}:`, templateError);
          // Fall back to default messages
        }

        // Fallback to default messages if no template found
        if (!templateFound) {
          const firstName = userData.firstName || 'there';

          switch (newStatus) {
            case 'screened':
              message = `Hi ${firstName}, your application for ${jobTitle} has been screened. We'll contact you soon.`;
              break;
            case 'advanced':
            case 'interview':
              message = `Congratulations ${firstName}! Your application for ${jobTitle} has advanced to the next stage. Check your account for details.`;
              break;
            case 'offer':
              message = `Congratulations ${firstName}! You've received an offer for ${jobTitle}. Please check your account for details.`;
              break;
            case 'hired':
              message = `Welcome to the team ${firstName}! Your application for ${jobTitle} has been accepted.`;
              break;
            case 'rejected':
            case 'withdrawn':
              if (newStatus === 'rejected') {
                message = `Thank you for your interest, ${firstName}. Your application for ${jobTitle} has been reviewed.`;
              } else {
                // Withdrawn - usually user-initiated, may not need SMS
                logger.info(`Application ${applicationId} withdrawn - skipping SMS`);
                return { success: true };
              }
              break;
            default:
              // Unknown status, skip SMS
              logger.info(`Unknown status ${newStatus} for application ${applicationId}, skipping SMS`);
              return { success: true };
          }
        }

        if (message) {
          // Check notification settings
          const shouldSend = await shouldSendNotification(userId, 'applicationUpdates', 'sms');
          
          if (!shouldSend) {
            logger.info(`SMS disabled for user ${userId} - skipping application status change notification`);
            return { success: true };
          }

          // Send SMS
          const result = await sendWorkerMessageInternal(
            userData.phoneE164,
            message,
            {
              systemContext: true,
              source: 'application_status_changed',
              sourceId: applicationId
            }
          );

          if (result.success) {
            logger.info(`SMS sent for application status change ${applicationId} (${oldStatus} → ${newStatus}) to ${userData.phoneE164}`);
          } else {
            logger.warn(`Failed to send SMS for application ${applicationId}: ${result.error}`);
          }
        }

        return { success: true };
      } catch (userError: any) {
        logger.error(`Error fetching user data for application ${applicationId}:`, userError);
        // Don't throw - allow application update to succeed even if SMS fails
        return { success: true };
      }
    } catch (error: any) {
      logger.error(`Error in onApplicationStatusChanged for ${applicationId}:`, error);
      // Don't throw - trigger should not fail application update
      return { success: false, error: error.message };
    }
  }
);

