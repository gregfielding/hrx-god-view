/**
 * Group Messaging - Bulk SMS to user groups or arrays of users
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import { normalizeUserPhoneToE164 } from './utils/phoneE164Normalize';

/**
 * Send SMS to all members of a user group
 */
export const sendGroupMessage = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request) => {
  const start = Date.now();

  // Validate authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to send group messages');
  }

  const senderUid = request.auth.uid;
  const { tenantId, userGroupId, recipientIds, message, template } = request.data as {
    tenantId: string;
    userGroupId?: string;
    recipientIds?: string[];
    message: string;
    template?: 'shift_reminder' | 'onboarding' | 'status_update' | 'custom';
  };

  // Validate inputs
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
  }

  if (!userGroupId && (!recipientIds || recipientIds.length === 0)) {
    throw new HttpsError('invalid-argument', 'Either userGroupId or recipientIds array is required');
  }

  if (!message && !template) {
    throw new HttpsError('invalid-argument', 'Message content or template is required');
  }

  try {
    // Check sender permissions
    const senderDoc = await db.doc(`users/${senderUid}`).get();
    const senderData = senderDoc.data();

    if (!senderData) {
      throw new HttpsError('not-found', 'Sender profile not found');
    }

    const securityLevel = parseInt(senderData.securityLevel || '0');
    const isAdmin = securityLevel >= 5;
    const isManager = senderData.role === 'Manager' || senderData.managerId;
    const isRecruiter = senderData.recruiter === true;

    if (!isAdmin && !isManager && !isRecruiter) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to send group messages');
    }

    // Get recipient user IDs
    let recipientUserIds: string[] = [];

    if (userGroupId) {
      // Fetch all members of the user group
      const groupDoc = await db.doc(`tenants/${tenantId}/userGroups/${userGroupId}`).get();
      if (!groupDoc.exists) {
        throw new HttpsError('not-found', 'User group not found');
      }

      const groupData = groupDoc.data();
      const members = groupData?.members || [];
      
      if (Array.isArray(members)) {
        recipientUserIds = members;
      } else if (typeof members === 'object') {
        // If members is an object/map, extract keys
        recipientUserIds = Object.keys(members);
      }

      logger.info(`Found ${recipientUserIds.length} members in user group ${userGroupId}`);
    } else if (recipientIds) {
      recipientUserIds = recipientIds;
    }

    if (recipientUserIds.length === 0) {
      throw new HttpsError('invalid-argument', 'No recipients found');
    }

    // Prepare message content
    let messageContent = message;
    if (template && !message) {
      const templates = {
        shift_reminder: 'Hi! This is a reminder about your upcoming shift. Please confirm your availability.',
        onboarding: 'Welcome to the team! Please check your email for onboarding details and next steps.',
        status_update: 'Your application status has been updated. Please check your account for details.',
        custom: 'You have a new message from HRX. Please check your account for details.',
      };
      messageContent = templates[template];
    }

    // Fetch phone numbers for all recipients
    logger.info(`Fetching phone numbers for ${recipientUserIds.length} recipients`);
    
    const recipientsWithPhones: Array<{ userId: string; phoneE164: string }> = [];
    
    // Batch fetch users (Firestore limit is 10 per batch in v1)
    const BATCH_SIZE = 10;
    for (let i = 0; i < recipientUserIds.length; i += BATCH_SIZE) {
      const batch = recipientUserIds.slice(i, i + BATCH_SIZE);
      
      const userDocs = await Promise.all(
        batch.map(userId => db.doc(`users/${userId}`).get())
      );

      for (const userDoc of userDocs) {
        if (!userDoc.exists) continue;
        
        const userData = userDoc.data();
        const phoneE164 = normalizeUserPhoneToE164(userData);
        if (phoneE164 && userData?.smsOptIn !== false) {
          recipientsWithPhones.push({
            userId: userDoc.id,
            phoneE164,
          });
        }
      }
    }

    logger.info(`Found ${recipientsWithPhones.length} recipients with SMS-capable numbers out of ${recipientUserIds.length} total`);

    if (recipientsWithPhones.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'No recipients found with a phone number on file and SMS enabled (phone OTP verification is not required)'
      );
    }

    // Send SMS in batches to respect rate limits
    let sent = 0;
    let failed = 0;
    const errors: Array<{ userId: string; phone: string; error: string }> = [];

    const SMS_BATCH_SIZE = 10; // Send 10 SMS per second to respect rate limits
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay

    for (let i = 0; i < recipientsWithPhones.length; i += SMS_BATCH_SIZE) {
      const batch = recipientsWithPhones.slice(i, i + SMS_BATCH_SIZE);

      await Promise.all(
        batch.map(async (recipient) => {
          try {
            // PHASE 3: Route through orchestrator instead of direct Twilio call
            const { sendLegacyGroupMessage } = await import('./messaging/legacyMessageHelpers');
            const result = await sendLegacyGroupMessage({
              tenantId: senderData.tenantId || '',
              userId: recipient.userId,
              phoneE164: recipient.phoneE164,
              message: messageContent!,
              source: 'group_message',
              sourceId: userGroupId || `bulk_${senderUid}_${Date.now()}`,
            });

            if (result.success) {
              sent++;
            } else {
              failed++;
              errors.push({
                userId: recipient.userId,
                phone: recipient.phoneE164,
                error: result.error || 'Unknown error',
              });
            }
          } catch (error: any) {
            failed++;
            errors.push({
              userId: recipient.userId,
              phone: recipient.phoneE164,
              error: error.message || 'Unknown error',
            });
          }
        })
      );

      // Delay between batches (except for the last batch)
      if (i + SMS_BATCH_SIZE < recipientsWithPhones.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    logger.info(`Group message sent: ${sent} successful, ${failed} failed out of ${recipientsWithPhones.length} total`);

    return {
      success: true,
      totalRecipients: recipientUserIds.length,
      recipientsWithPhones: recipientsWithPhones.length,
      sent,
      failed,
      errors: errors.length > 0 ? errors.slice(0, 10) : [], // Limit error details to first 10
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    logger.error('Failed to send group message:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Failed to send group message: ${error.message}`);
  }
});

