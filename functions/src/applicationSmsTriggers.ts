/**
 * Application SMS Triggers
 * Sends SMS notifications when applications are created or status changes
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { sendLegacyApplicationStatusMessage } from './messaging/legacyMessageHelpers';
import { shouldSendNotification } from './utils/notificationSettings';
import { resolveTemplateVariables, TemplateVariableContext } from './utils/templateVariableResolver';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Define secrets for Twilio (required for SMS sending)
// SendGrid uses process.env (SENDGRID_API_KEY, etc.) - set in .env or Firebase config to avoid secret/env conflict
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

    logger.info(`onApplicationCreated invoked`, {
      applicationId,
      tenantId,
      hasData: !!applicationData,
      status: applicationData?.status,
    });

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

        // Require at least one phone number (attempt send even if not verified)
        const phoneE164 = (userData.phoneE164 || userData.phone || '').trim();
        if (!phoneE164) {
          logger.info(`User ${userId} has no phone number, skipping SMS for application ${applicationId}`);
          return { success: true };
        }

        // Try to find matching template
        let message = '';
        let templateFound = false;

        try {
          // PHASE 2.1: Use new template engine with legacy fallback
          const { getTemplateWithLegacyFallback } = await import('./messaging/templateMigration');
          const { renderTemplate } = await import('./messaging/templateEngine');
          
          const templateResult = await getTemplateWithLegacyFallback(
            tenantId,
            'application_received',
            'sms',
            (userData.preferredLanguage || 'en') as 'en' | 'es',
            'application',
            'applicationCreated'
          );

          if (templateResult) {
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

            // Render template (new engine handles STOP footer automatically)
            message = await renderTemplate(templateResult.template, variables, tenantId);
            templateFound = true;
            logger.info(`Using ${templateResult.source} template for application ${applicationId}`);
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
          // Check notification settings (SMS enabled unless user has opted out)
          const shouldSend = await shouldSendNotification(userId, 'applicationUpdates', 'sms');
          if (!shouldSend) {
            logger.info(`SMS disabled for user ${userId} - skipping application created notification`);
            return { success: true };
          }

          // PHASE 3: Route through orchestrator instead of direct Twilio call
          const result = await sendLegacyApplicationStatusMessage({
            tenantId,
            userId,
            phoneE164,
            message,
            source: 'application_created',
            sourceId: applicationId,
            applicationId,
            status: applicationData.status || 'submitted',
            applicationData,
            jobOrderId: applicationData.jobOrderId,
            jobPostId: applicationData.jobId || applicationData.postId,
          });

          if (result.success) {
            logger.info(`SMS sent for new application ${applicationId} to ${phoneE164}. Message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
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

    logger.info(`onApplicationStatusChanged invoked`, {
      applicationId,
      tenantId,
      hasBefore: !!before,
      hasAfter: !!after,
      oldStatus: before?.status,
      newStatus: after?.status,
    });

    if (!before || !after) {
      logger.error(`onApplicationStatusChanged: Missing before/after data for ${applicationId}`);
      return { success: false };
    }

    try {
      // Check for status changes
      const statusChanged = before.status !== after.status;

      if (!statusChanged) {
        logger.info(`Application ${applicationId}: no status change (${after.status}), skipping SMS`);
        return { success: true };
      }

      const oldStatus = before.status;
      const newStatus = after.status;

      // Do not send any notifications when the candidate withdraws
      if (newStatus === 'withdrawn') {
        logger.info(`Application ${applicationId} status changed to withdrawn - skipping all notifications`);
        return { success: true };
      }

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

        // Require at least one phone number (attempt send even if not verified)
        const phoneE164 = (userData.phoneE164 || userData.phone || '').trim();
        if (!phoneE164) {
          logger.info(`User ${userId} has no phone number, skipping SMS for application ${applicationId}`);
          return { success: true };
        }

        // Try to find matching template
        let message = '';
        let templateFound = false;

        try {
          // PHASE 2.1: Use new template engine with legacy fallback
          // When status becomes 'submitted' (e.g. re-apply after withdraw), use same template as new application
          let messageTypeId = 'application_status_change';
          if (newStatus === 'submitted') messageTypeId = 'application_received';
          else if (newStatus === 'screened') messageTypeId = 'application_screened';
          else if (newStatus === 'advanced') messageTypeId = 'application_advanced';
          else if (newStatus === 'hired') messageTypeId = 'application_hired';
          else if (newStatus === 'rejected') messageTypeId = 'application_rejected';
          else if (newStatus === 'waitlisted') messageTypeId = 'application_waitlisted';

          const { getTemplateWithLegacyFallback } = await import('./messaging/templateMigration');
          const { renderTemplate } = await import('./messaging/templateEngine');
          
          const templateResult = await getTemplateWithLegacyFallback(
            tenantId,
            messageTypeId,
            'sms',
            (userData.preferredLanguage || 'en') as 'en' | 'es',
            'application',
            newStatus === 'submitted' ? 'applicationCreated' : 'applicationStatusChange',
            newStatus === 'submitted' ? 'applicationCreated' : newStatus
          );

          if (templateResult) {
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

            // Render template (new engine handles STOP footer automatically)
            message = await renderTemplate(templateResult.template, variables, tenantId);
            templateFound = true;
            logger.info(`Using ${templateResult.source} template for application ${applicationId} status change to ${newStatus}`);
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
            case 'submitted':
              // Re-apply (withdrawn → submitted) or first-time; same message as application_received
              message = `Thanks for submitting your application for ${jobTitle}, ${firstName}. We'll review it and get back to you soon.`;
              logger.info(`Application ${applicationId}: using fallback message for status=submitted (re-apply or status change)`);
              break;
            case 'screened':
              message = `Hi ${firstName}, your application for ${jobTitle} has been screened. We'll contact you soon.`;
              break;
            case 'advanced':
            case 'interview':
              message = `Hi ${firstName}, your application for ${jobTitle} has advanced to the next stage. Check your account for details.`;
              break;
            case 'offer':
              message = `Hi ${firstName}, you've received an offer for ${jobTitle}. Please check your account for details.`;
              break;
            case 'hired':
              message = `Welcome to the team ${firstName}! Your application for ${jobTitle} has been accepted.`;
              break;
            case 'waitlisted':
              message = `Hi ${firstName}, you've been waitlisted for ${jobTitle}. We'll contact you if a spot opens up.`;
              break;
            case 'rejected':
            case 'withdrawn':
              if (newStatus === 'rejected') {
                message = `Thank you for your interest, ${firstName}. Unfortunately we won't need you for this role at this time.`;
              } else {
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

          logger.info(`Sending application status SMS for ${applicationId} (${oldStatus} → ${newStatus}) to ${phoneE164}`);
          // PHASE 3: Route through orchestrator instead of direct Twilio call
          const result = await sendLegacyApplicationStatusMessage({
            tenantId,
            userId,
            phoneE164,
            message,
            source: 'application_status_changed',
            sourceId: applicationId,
            applicationId,
            status: newStatus,
            applicationData: after,
            jobOrderId: after.jobOrderId,
            jobPostId: after.jobId || after.postId,
          });

          if (result.success) {
            logger.info(`SMS sent for application status change ${applicationId} (${oldStatus} → ${newStatus}) to ${phoneE164}`);
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

