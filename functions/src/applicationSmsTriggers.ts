/**
 * Application SMS Triggers
 * Sends SMS notifications when applications are created or status changes
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { sendWorkerMessageInternal } from './twilio';
import { resolveTemplate } from './smsTemplates';
import { shouldSendNotification } from './utils/notificationSettings';
import { resolveTemplateVariables, TemplateVariableContext } from './utils/templateVariableResolver';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Define secrets for Twilio (required for SMS sending)
const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const twilioMessagingPhoneNumber = defineSecret('TWILIO_MESSAGING_PHONE_NUMBER');
const twilioA2PCampaign = defineSecret('TWILIO_A2P_CAMPAIGN');

/**
 * Firestore trigger: Send SMS when a new application is created
 */
export const onApplicationCreated = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    secrets: [twilioAccountSid, twilioAuthToken, twilioMessagingPhoneNumber, twilioA2PCampaign],
  },
  async (event) => {
    const applicationId = event.params.applicationId;
    const tenantId = event.params.tenantId;
    const applicationData = event.data?.data();

    if (!applicationData) {
      logger.error(`onApplicationCreated: Missing data for ${applicationId}`);
      return { success: false };
    }

    try {
      logger.info(`New application created: ${applicationId} in tenant ${tenantId}`);

      // Get user ID from application (userId or candidateId)
      // Also try to extract from applicationId if it follows pattern: {userId}_{jobId}
      let userId = applicationData.userId || applicationData.candidateId;
      
      // If no userId in document, try to extract from applicationId (common pattern: {userId}_{jobId})
      if (!userId && applicationId.includes('_')) {
        const parts = applicationId.split('_');
        // First part is usually the userId, but check if it's a valid user ID format
        const potentialUserId = parts[0];
        if (potentialUserId && potentialUserId.length > 10) {
          // Verify this looks like a Firebase user ID (typically 28 characters)
          // Try to fetch user to verify
          try {
            const userCheck = await admin.firestore().doc(`users/${potentialUserId}`).get();
            if (userCheck.exists) {
              userId = potentialUserId;
              logger.info(`Extracted userId ${userId} from applicationId ${applicationId}`);
            }
          } catch (err: any) {
            // If lookup fails, continue without this userId
            logger.info(`Could not verify userId from applicationId: ${err?.message || err}`);
          }
        }
      }
      
      if (!userId) {
        logger.warn(`Application ${applicationId} has no userId or candidateId, and could not extract from applicationId, skipping SMS`);
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

        // Try to find matching template
        let message = '';
        let templateFound = false;

        try {
          const templatesSnapshot = await db
            .collection(`tenants/${tenantId}/smsTemplates`)
            .where('category', '==', 'application')
            .where('triggerType', '==', 'applicationCreated')
            .where('enabled', '==', true)
            .limit(1)
            .get();

          if (!templatesSnapshot.empty) {
            const templateDoc = templatesSnapshot.docs[0];
            const template = templateDoc.data();

            // Build context for variable resolution
            const context: TemplateVariableContext = {
              userId: userId,
              userData: userData,
              applicationId: applicationId,
              applicationData: applicationData,
              jobOrderId: applicationData.jobOrderId,
              jobPostId: applicationData.jobId || applicationData.postId,
              tenantId: tenantId,
              status: applicationData.status || 'submitted',
            };

            // Resolve all variables using standardized resolver
            const variables = await resolveTemplateVariables(context);

            message = resolveTemplate(template.messageTemplate, variables);
            templateFound = true;
            logger.info(`Using template ${templateDoc.id} for application ${applicationId}`);
          }
        } catch (templateError: any) {
          logger.warn(`Failed to fetch template for application ${applicationId}:`, templateError);
          // Fall back to default message
        }

        // Fallback to default message if no template found
        if (!templateFound) {
          // Use resolver for fallback too (for consistency)
          const context: TemplateVariableContext = {
            userId: userId,
            userData: userData,
            applicationId: applicationId,
            applicationData: applicationData,
            jobOrderId: applicationData.jobOrderId,
            jobPostId: applicationData.jobId || applicationData.postId,
            tenantId: tenantId,
          };
          const variables = await resolveTemplateVariables(context);
          
          const firstName = variables.firstName;
          const jobTitle = variables.jobTitle;
          const locationCity = variables.locationCity;
          
          message = `Hi ${firstName}. Thank you for applying to be a ${jobTitle}${locationCity ? ` in ${locationCity}` : ''}. We are currently reviewing applicants and will be in touch soon.`;
        }

        if (message) {
          // Check notification settings
          const shouldSend = await shouldSendNotification(userId, 'applicationUpdates', 'sms');
          
          if (!shouldSend) {
            logger.info(`SMS disabled for user ${userId} - skipping application created notification`);
            return { success: true };
          }

          // Send SMS
          const result = await sendWorkerMessageInternal(
            userData.phoneE164,
            message,
            {
              systemContext: true,
              source: 'application_created',
              sourceId: applicationId
            }
          );

          if (result.success) {
            logger.info(`SMS sent for new application ${applicationId} to ${userData.phoneE164}. Message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
          } else {
            logger.warn(`Failed to send SMS for application ${applicationId}: ${result.error}`);
          }
        }

        return { success: true };
      } catch (userError: any) {
        logger.error(`Error fetching user data for application ${applicationId}:`, userError);
        // Don't throw - allow application creation to succeed even if SMS fails
        return { success: true };
      }
    } catch (error: any) {
      logger.error(`Error in onApplicationCreated for ${applicationId}:`, error);
      // Don't throw - trigger should not fail application creation
      return { success: false, error: error.message };
    }
  }
);

/**
 * Firestore trigger: Send SMS when application status changes
 */
export const onApplicationStatusChanged = onDocumentUpdated(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    secrets: [twilioAccountSid, twilioAuthToken, twilioMessagingPhoneNumber, twilioA2PCampaign],
  },
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

            // Build context for variable resolution
            const context: TemplateVariableContext = {
              userId: userId,
              userData: userData,
              applicationId: applicationId,
              applicationData: after,
              jobOrderId: after.jobOrderId,
              jobPostId: after.jobId || after.postId,
              tenantId: tenantId,
              status: newStatus,
            };

            // Resolve all variables using standardized resolver
            const variables = await resolveTemplateVariables(context);

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
          // Use resolver for fallback too (for consistency)
          const context: TemplateVariableContext = {
            userId: userId,
            userData: userData,
            applicationId: applicationId,
            applicationData: after,
            jobOrderId: after.jobOrderId,
            jobPostId: after.jobId || after.postId,
            tenantId: tenantId,
            status: newStatus,
          };
          const variables = await resolveTemplateVariables(context);
          
          const firstName = variables.firstName;
          const jobTitle = variables.jobTitle;

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

