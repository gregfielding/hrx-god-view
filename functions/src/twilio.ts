import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import twilio from 'twilio';
import cors from 'cors';

// Initialize Firebase Admin (guarded like other working callables)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Get Twilio configuration from environment variables
import { defineSecret } from 'firebase-functions/params';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import { maybeEmitPhoneVerifiedCategoryScore } from './categoryScoreEvolution/activityCategoryScoreEmit';

// Twilio Verify is only used here (kept local)
const verifyServiceSid = defineSecret('TWILIO_VERIFY_SERVICE_SID');

// Helper to get Twilio client (lazy initialization)
function getTwilioClient() {
  return twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
}

function getVerifyServiceSid() {
  return verifyServiceSid.value();
}

function getMessagingPhoneNumber() {
  return TWILIO_MESSAGING_PHONE_NUMBER.value() || process.env.TWILIO_MESSAGING_PHONE_NUMBER;
}

function getA2PCampaign() {
  return TWILIO_A2P_CAMPAIGN.value() || process.env.TWILIO_A2P_CAMPAIGN;
}

// Initialize CORS middleware
const corsHandler = cors({ origin: true });

/**
 * Send OTP via Twilio Verify (HTTP version with CORS)
 */
export const sendOtpHttp = onRequest(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, verifyServiceSid],
    invoker: 'public',
  },
  async (request, response) => {
    // Use cors middleware
    return corsHandler(request, response, async () => {
      if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
      }

      if (request.method !== 'POST') {
        response.status(405).send('Method Not Allowed');
        return;
      }

      try {
        const { phoneE164 } = request.body;

        // Validate phone format (E.164)
        if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
          response.status(400).json({ error: 'Invalid phone number format. Use E.164 format (e.g., +17025550147)' });
          return;
        }

        const client = getTwilioClient();
        const verifyServiceSid = getVerifyServiceSid();
        
        // Send OTP via Twilio Verify
        await client.verify.v2.services(verifyServiceSid).verifications.create({
          to: phoneE164,
          channel: 'sms',
        });

        logger.info(`OTP sent to ${phoneE164}`);
        response.status(200).json({ success: true });
      } catch (error: any) {
        logger.error('Failed to send OTP:', error);
        
        // Handle specific Twilio errors
        if (error.code === 60200) {
          response.status(400).json({ error: 'Invalid phone number. Please check and try again.' });
        } else if (error.code === 60203) {
          response.status(429).json({ error: 'Maximum verification attempts reached. Please try again later.' });
        } else if (error.code === 60212) {
          response.status(429).json({ error: 'Too many verification attempts. Please try again later.' });
        } else {
          response.status(500).json({ error: 'Failed to send verification code. Please try again.' });
        }
      }
    });
  }
);

/**
 * Send OTP via Twilio Verify (Callable version - keeping for compatibility)
 */
export const sendOtp = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, verifyServiceSid],
    cors: true,
    invoker: 'public', // Allow unauthenticated calls for now
  },
  async (request) => {
  // For now, allow unauthenticated calls for testing
  // TODO: Add proper authentication back
  // if (!request.auth) {
  //   throw new HttpsError('unauthenticated', 'Must be signed in to verify phone');
  // }

  const { phoneE164 } = request.data as { phoneE164: string };
  const uid = request.auth?.uid; // Get uid from request auth if available

  // Validate phone format (E.164)
  if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new HttpsError('invalid-argument', 'Invalid phone number format. Use E.164 format (e.g., +17025550147)');
  }

  try {
    const client = getTwilioClient();
    const verifyServiceSid = getVerifyServiceSid();
    
    // Send OTP via Twilio Verify
    await client.verify.v2.services(verifyServiceSid).verifications.create({
      to: phoneE164,
      channel: 'sms',
    });

    // Store phone number in user profile when sending OTP
    if (uid) {
      await db.doc(`users/${uid}`).set({
        phoneE164,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info(`Stored phone number for user ${uid}: ${phoneE164}`);
    }

    logger.info(`OTP sent to ${phoneE164}`);
    return { success: true };
  } catch (error: any) {
    logger.error('Failed to send OTP:', error);
    
    // Handle specific Twilio errors
    if (error.code === 60200) {
      throw new HttpsError('invalid-argument', 'Invalid phone number. Please check and try again.');
    } else if (error.code === 60203) {
      throw new HttpsError('resource-exhausted', 'Maximum verification attempts reached. Please try again later.');
    } else if (error.code === 60212) {
      throw new HttpsError('resource-exhausted', 'Too many verification attempts. Please try again later.');
    }
    
    throw new HttpsError('internal', 'Failed to send verification code. Please try again.');
  }
});

/**
 * Verify OTP code via Twilio Verify
 */
export const checkOtp = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, verifyServiceSid],
    cors: true,
    invoker: 'public', // Allow unauthenticated calls for now
  },
  async (request) => {
  // For now, allow unauthenticated calls for testing
  // TODO: Add proper authentication back
  // if (!request.auth) {
  //   throw new HttpsError('unauthenticated', 'Must be signed in to verify phone');
  // }

  const { phoneE164, code } = request.data as { phoneE164: string; code: string };
  const uid = request.auth?.uid; // Get uid from request auth if available

  // Validate inputs
  if (!phoneE164 || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new HttpsError('invalid-argument', 'Invalid phone number format');
  }

  if (!code || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Invalid code format. Please enter a 6-digit code.');
  }

  try {
    const client = getTwilioClient();
    const verifyServiceSid = getVerifyServiceSid();
    
    // Verify OTP via Twilio Verify
    const verificationCheck = await client.verify.v2.services(verifyServiceSid)
      .verificationChecks.create({
        to: phoneE164,
        code: code,
      });

    if (verificationCheck.status !== 'approved') {
      throw new HttpsError('permission-denied', 'Invalid verification code. Please try again.');
    }

    // Update user profile with verified phone
    if (uid) {
      const prevSnap = await db.doc(`users/${uid}`).get();
      const wasVerified =
        prevSnap.exists && (prevSnap.data() as Record<string, unknown>)?.phoneVerified === true;
      await db.doc(`users/${uid}`).set({
        phoneE164,
        phoneVerified: true,
        phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        phoneVerification: {
          verified: true,
          phoneNumber: phoneE164,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          method: 'firebase_auth_phone',
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info(`Updated user ${uid} with verified phone: ${phoneE164}`);
      if (!wasVerified) {
        try {
          await maybeEmitPhoneVerifiedCategoryScore(db, { uid });
        } catch (e) {
          logger.warn('checkOtp.activity_category_score_failed', {
            uid,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else {
      // If no UID available, try to find user by phone number
      const usersQuery = await db.collection('users')
        .where('phoneE164', '==', phoneE164)
        .limit(1)
        .get();
      
      if (!usersQuery.empty) {
        const userDoc = usersQuery.docs[0];
        const wasVerified = (userDoc.data() as Record<string, unknown>)?.phoneVerified === true;
        await userDoc.ref.update({
          phoneVerified: true,
          phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          phoneVerification: {
            verified: true,
            phoneNumber: phoneE164,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            method: 'firebase_auth_phone',
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Updated user ${userDoc.id} with verified phone: ${phoneE164}`);
        if (!wasVerified) {
          try {
            await maybeEmitPhoneVerifiedCategoryScore(db, { uid: userDoc.id });
          } catch (e) {
            logger.warn('checkOtp.activity_category_score_failed', {
              uid: userDoc.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else {
        logger.warn(`Phone verified but no user found for ${phoneE164}`);
      }
    }

    logger.info(`Phone verified: ${phoneE164}`);
    return { success: true };
  } catch (error: any) {
    logger.error('Failed to verify OTP:', error);
    
    // Handle specific Twilio errors
    if (error.code === 60202) {
      throw new HttpsError('invalid-argument', 'Invalid verification code. Please try again.');
    } else if (error.code === 60203) {
      throw new HttpsError('resource-exhausted', 'Maximum verification attempts reached. Please try again later.');
    } else if (error.code === 60204) {
      throw new HttpsError('deadline-exceeded', 'Verification code expired. Please request a new one.');
    }
    
    // If it's already an HttpsError, re-throw it
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to verify code. Please try again.');
  }
});

/**
 * Internal helper to send SMS via Twilio (for use in Firestore triggers and scheduled functions)
 * This version doesn't require authentication context
 * 
 * ⚠️ LEGACY FUNCTION - PATCHED FOR COMPLIANCE
 * This function now enforces STOP/HELP compliance and uses unified logging.
 * Prefer using routingOrchestrator.sendMessage() for new code.
 * 
 * Phase 1.1 Migration: Added STOP enforcement, unified logging, removed /sms_messages writes
 */
export async function sendWorkerMessageInternal(
  to: string,
  messageContent: string,
  context?: {
    systemContext?: boolean;
    source?: string;
    sourceId?: string;
    tenantId?: string;        // NEW: Tenant ID for proper logging
    messageTypeId?: string;   // NEW: Message type for unified framework
    userId?: string;          // NEW: User ID if known
  }
): Promise<{ success: boolean; messageId: string | null; status: string; error?: string; errorCode?: string }> {
  // Validate inputs
  if (!to || !/^\+[1-9]\d{7,14}$/.test(to)) {
    logger.error('Invalid recipient phone number format:', to);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: 'Invalid recipient phone number format'
    };
  }

  if (!messageContent || messageContent.trim() === '') {
    logger.error('Message content is required');
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: 'Message content is required'
    };
  }

  try {
    // Check SMS opt-in for recipient and get userId for activity log
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', to)
      .limit(1)
      .get();
    
    let recipientUserId: string | null = context?.userId || null;
    let recipientUserData: any = null;
    let tenantId: string | null = context?.tenantId || null;
    
    if (!usersQuery.empty) {
      const recipientUserDoc = usersQuery.docs[0];
      recipientUserId = recipientUserId || recipientUserDoc.id;
      recipientUserData = recipientUserDoc.data();
      
      // Get tenantId from user if not provided
      if (!tenantId && recipientUserData?.tenantId) {
        tenantId = recipientUserData.tenantId;
      }
      
      // PHASE 1.1: Check BOTH smsOptIn AND smsBlockedSystem (STOP enforcement)
      // This ensures STOP keyword always works, even in legacy code paths
      if (recipientUserData?.smsOptIn === false) {
        logger.info(`Skipping SMS to ${to} - user has opted out (smsOptIn=false)`);
        
        // Log the blocked attempt if we have tenantId
        if (tenantId && recipientUserId) {
          try {
            const { logMessage } = await import('./messaging/messageLogging');
            await logMessage({
              tenantId,
              userId: recipientUserId,
              messageTypeId: context?.messageTypeId || 'legacy_sms',
              channel: 'sms',
              direction: 'outbound',
              fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
              fromUserId: context?.sourceId || undefined,
              contentSent: messageContent,
              language: (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null,
              status: 'not_sent',
              failureReason: 'User opted out (smsOptIn=false)',
            });
          } catch (logError: any) {
            logger.warn(`Failed to log blocked SMS attempt: ${logError.message}`);
          }
        }
        
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'Recipient has opted out of SMS messages'
        };
      }
      
      // PHASE 1.1: Check smsBlockedSystem (STOP keyword enforcement)
      if (recipientUserData?.smsBlockedSystem === true) {
        logger.info(`Skipping SMS to ${to} - user has sent STOP keyword (smsBlockedSystem=true)`);
        
        // Log the blocked attempt if we have tenantId
        if (tenantId && recipientUserId) {
          try {
            const { logMessage } = await import('./messaging/messageLogging');
            await logMessage({
              tenantId,
              userId: recipientUserId,
              messageTypeId: context?.messageTypeId || 'legacy_sms',
              channel: 'sms',
              direction: 'outbound',
              fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
              fromUserId: context?.sourceId || undefined,
              contentSent: messageContent,
              language: (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null,
              status: 'not_sent',
              failureReason: 'User sent STOP keyword (smsBlockedSystem=true)',
            });
          } catch (logError: any) {
            logger.warn(`Failed to log blocked SMS attempt: ${logError.message}`);
          }
        }
        
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'Recipient has blocked SMS messages (STOP keyword)'
        };
      }
      
      // Check if phone is verified (preferred but not required)
      if (!recipientUserData?.phoneVerified) {
        logger.warn(`Sending SMS to unverified phone: ${to}`);
      }
    }

    // Early-funnel SMS coordination (same policy as routingOrchestrator deliverSms).
    // Runs even when phone lookup failed, as long as context carries tenantId + userId.
    if (tenantId && recipientUserId && context?.messageTypeId) {
      const { checkEarlyFunnelSmsGate } = await import('./messaging/earlyFunnelSmsPolicy');
      const gate = await checkEarlyFunnelSmsGate({
        tenantId,
        userId: recipientUserId,
        messageTypeId: context.messageTypeId,
      });
      if (gate.allowed === false) {
        logger.info('sendWorkerMessageInternal: early_funnel_suppressed', {
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
          reason: gate.reason,
          lastMessageTypeId: gate.lastMessageTypeId,
        });
        try {
          const { logMessage } = await import('./messaging/messageLogging');
          const lang = (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null;
          await logMessage({
            tenantId,
            userId: recipientUserId,
            messageTypeId: context.messageTypeId,
            channel: 'sms',
            direction: 'outbound',
            fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
            fromUserId: context?.sourceId || undefined,
            contentSent: messageContent,
            language: lang,
            status: 'suppressed_early_funnel',
            failureReason: JSON.stringify({
              reason: gate.reason,
              lastMessageTypeId: gate.lastMessageTypeId,
              elapsedMs: gate.elapsedMs,
            }),
          });
        } catch (logErr: any) {
          logger.warn(`Failed to log suppressed early-funnel SMS: ${logErr.message}`);
        }
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'early_funnel_cooldown',
        };
      }
    }

    // Same messageTypeId + same user within 60s (last-line defense; orchestrator uses deliverSms).
    if (tenantId && recipientUserId && context?.messageTypeId) {
      const { checkSmsDuplicateMessageTypeGuard } = await import('./messaging/smsDuplicateMessageGuard');
      const dup = await checkSmsDuplicateMessageTypeGuard({
        tenantId,
        userId: recipientUserId,
        messageTypeId: context.messageTypeId,
      });
      if (dup.allowed === false) {
        logger.info('duplicate_message_guard', {
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
          elapsedMs: dup.elapsedMs,
        });
        try {
          const { logMessage } = await import('./messaging/messageLogging');
          const lang = (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null;
          await logMessage({
            tenantId,
            userId: recipientUserId,
            messageTypeId: context.messageTypeId,
            channel: 'sms',
            direction: 'outbound',
            fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
            fromUserId: context?.sourceId || undefined,
            contentSent: messageContent,
            language: lang,
            status: 'suppressed_duplicate_message_guard',
            failureReason: JSON.stringify({
              reason: 'duplicate_message_guard',
              elapsedMs: dup.elapsedMs,
            }),
          });
        } catch (logErr: any) {
          logger.warn(`Failed to log suppressed duplicate-guard SMS: ${logErr.message}`);
        }
        return {
          success: false,
          messageId: null,
          status: 'skipped',
          error: 'duplicate_message_guard',
        };
      }
    }

    // Get Twilio configuration
    let client;
    let messagingPhoneNumber;
    let a2pCampaign;
    
    try {
      client = getTwilioClient();
      messagingPhoneNumber = getMessagingPhoneNumber();
      a2pCampaign = getA2PCampaign();
    } catch (configError: any) {
      logger.error('Failed to load Twilio configuration:', configError);
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: `Twilio configuration error: ${configError.message}`
      };
    }
    
    // Send SMS via Twilio
    const messageParams: any = {
      to: to,
      body: messageContent,
    };
    
    // Prefer Messaging Service when configured so Twilio Link Shortening (go.hrxone.com) is used
    if (a2pCampaign && a2pCampaign.trim() !== '') {
      messageParams.messagingServiceSid = a2pCampaign;
      messageParams.shortenUrls = true; // Twilio Link Shortening (go.hrxone.com)
      logger.info(`Using A2P messaging service (link shortening): ${a2pCampaign}`);
    } else if (messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
      messageParams.from = messagingPhoneNumber;
      logger.info(`Using direct phone number: ${messagingPhoneNumber}`);
    } else {
      logger.error('Twilio messaging configuration is missing');
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: 'Twilio messaging configuration is missing'
      };
    }
    
    let messageResult;
    try {
      messageResult = await client.messages.create(messageParams);
    } catch (twilioError: any) {
      // When using Messaging Service, fall back to direct number on invalid SID (21705) or A2P (30034)
      if ((twilioError.code === 21705 || twilioError.code === 30034) && messageParams.messagingServiceSid && messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
        logger.warn(`Messaging Service failed (${twilioError.code}), falling back to direct number ${messagingPhoneNumber}. Error: ${twilioError.message}`);
        try {
          messageResult = await client.messages.create({
            to: to,
            body: messageContent,
            from: messagingPhoneNumber,
          });
        } catch (fallbackError: any) {
          logger.error(`Fallback to direct number also failed: ${fallbackError.message}`);
          return {
            success: false,
            messageId: null,
            status: 'failed',
            error: twilioError.code === 30034
              ? 'SMS delivery failed: A2P 10DLC registration required'
              : `SMS delivery failed: ${fallbackError.message}`,
            errorCode: String(twilioError.code ?? fallbackError.code),
          };
        }
      } else if (twilioError.code === 30034) {
        logger.error(`A2P 10DLC registration required. SMS not sent to ${to}. Error: ${twilioError.message}`);
        return {
          success: false,
          messageId: null,
          status: 'failed',
          error: 'SMS delivery failed: A2P 10DLC registration required',
          errorCode: '30034'
        };
      } else {
        throw twilioError;
      }
    }

    // PHASE 1.1: Use unified logger instead of legacy /sms_messages collection
    // This ensures all messages are logged to /tenants/{tenantId}/messageLogs
    if (tenantId && recipientUserId) {
      try {
        const { logMessage, updateMessageLogStatus } = await import('./messaging/messageLogging');
        const logId = await logMessage({
          tenantId,
          userId: recipientUserId,
          messageTypeId: context?.messageTypeId || 'legacy_sms',
          channel: 'sms',
          direction: 'outbound',
          fromIdentity: context?.source === 'recruiter' ? 'recruiter' : 'system',
          fromUserId: context?.sourceId || undefined,
          contentSent: messageContent,
          language: (recipientUserData?.preferredLanguage || 'en') as 'en' | 'es' | null,
          status: 'queued',
          providerMessageId: messageResult.sid,
        });
        
        // Update log with final status
        if (logId) {
          const finalStatus: 'sent' | 'failed' | 'not_sent' = 
            messageResult.status === 'failed' || messageResult.status === 'undelivered' ? 'failed' :
            messageResult.status === 'sent' || messageResult.status === 'delivered' ? 'sent' : 'sent';
          
          await updateMessageLogStatus(logId, finalStatus, {
            tenantId,
            providerMessageId: messageResult.sid,
            failureReason: messageResult.errorMessage || messageResult.errorCode || undefined,
          });
        }
      } catch (logError: any) {
        // Don't fail SMS send if logging fails, but log the error
        logger.warn(`Failed to log SMS to unified logger: ${logError.message}`);
        
        // PHASE 1.1: DEPRECATED - Only write to legacy collection if unified logging fails
        // This is a fallback during migration period
        logger.warn('Falling back to legacy /sms_messages collection (should not happen in production)');
        await db.collection('sms_messages').add({
          messageId: messageResult.sid,
          from: context?.source || 'system',
          sourceId: context?.sourceId || null,
          to: to,
          content: messageContent,
          template: null,
          status: messageResult.status,
          errorCode: messageResult.errorCode || null,
          errorMessage: messageResult.errorMessage || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          systemContext: context?.systemContext || false,
          _deprecated: true, // Mark as deprecated
          _migrationNote: 'Legacy collection - should use /tenants/{tenantId}/messageLogs',
        });
      }
    } else {
      // If we don't have tenantId/userId, log warning but still send SMS
      // This should be rare and indicates a data issue
      logger.warn(`SMS sent but cannot log to unified system - missing tenantId or userId for ${to}`);
      
      // PHASE 1.1: DEPRECATED - Only write to legacy collection if we can't determine tenant/user
      // This is a fallback during migration period
      await db.collection('sms_messages').add({
        messageId: messageResult.sid,
        from: context?.source || 'system',
        sourceId: context?.sourceId || null,
        to: to,
        content: messageContent,
        template: null,
        status: messageResult.status,
        errorCode: messageResult.errorCode || null,
        errorMessage: messageResult.errorMessage || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        systemContext: context?.systemContext || false,
        _deprecated: true, // Mark as deprecated
        _migrationNote: 'Legacy collection - missing tenantId/userId for unified logging',
      });
    }

    // Log to user's activity log if user exists
    if (recipientUserId) {
      try {
        const activityLogData = {
          action: 'SMS Sent',
          actionType: 'sms_sent' as const,
          description: context?.source 
            ? `SMS sent via ${context.source}` 
            : 'SMS notification received',
          severity: 'medium' as const,
          source: 'system' as const,
          metadata: {
            messageId: messageResult.sid,
            phoneNumber: to,
            /** Full outbound copy for recruiter activity log (same as sent to device). */
            messageBody: messageContent,
            messagePreview:
              messageContent.length > 200 ? `${messageContent.substring(0, 200)}…` : messageContent,
            source: context?.source || 'system',
            sourceId: context?.sourceId || null,
            targetType: 'sms',
          },
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('users').doc(recipientUserId)
          .collection('activityLogs')
          .add(activityLogData);
        
        logger.info(`Activity log created for SMS to user ${recipientUserId}`);
      } catch (activityLogError: any) {
        // Don't fail SMS send if activity log fails
        logger.warn(`Failed to create activity log for SMS: ${activityLogError.message}`);
      }
    }

    logger.info(`SMS sent internally: ${messageResult.sid} to ${to}`);

    if (tenantId && recipientUserId && context?.messageTypeId) {
      try {
        const { recordEarlyFunnelSmsSent } = await import('./messaging/earlyFunnelSmsPolicy');
        await recordEarlyFunnelSmsSent({
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
        });
      } catch (recErr: any) {
        logger.warn(`recordEarlyFunnelSmsSent failed: ${recErr?.message || recErr}`);
      }
      try {
        const { recordSmsDuplicateMessageGuardSent } = await import('./messaging/smsDuplicateMessageGuard');
        await recordSmsDuplicateMessageGuardSent({
          tenantId,
          userId: recipientUserId,
          messageTypeId: context.messageTypeId,
        });
      } catch (recErr: any) {
        logger.warn(`recordSmsDuplicateMessageGuardSent failed: ${recErr?.message || recErr}`);
      }
    }

    return { 
      success: true, 
      messageId: messageResult.sid,
      status: messageResult.status 
    };
  } catch (error: any) {
    logger.error('Failed to send SMS internally:', error);
    
    // Handle specific Twilio errors
    if (error.code === 21211 || error.code === 21614) {
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: 'Invalid phone number format or not SMS capable'
      };
    } else if (error.code === 21617) {
      return {
        success: false,
        messageId: null,
        status: 'failed',
        error: 'Recipient has opted out of SMS messages'
      };
    }
    
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Send worker message via Twilio Programmable Messaging (Callable function with auth)
 */
export const sendWorkerMessage = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    // Explicitly allow all ingress (Firebase callable functions handle auth automatically)
    // This ensures Cloud Run doesn't block requests before Firebase can process them
  },
  async (request) => {
  // Log function invocation for debugging
  logger.info('sendWorkerMessage function invoked', {
    hasAuth: !!request.auth,
    authUid: request.auth?.uid || 'none',
    hasData: !!request.data,
    dataKeys: request.data ? Object.keys(request.data as any) : []
  });

  // Validate authentication
  if (!request.auth) {
    logger.error('sendWorkerMessage: No authentication provided');
    throw new HttpsError('unauthenticated', 'Must be signed in to send messages');
  }

  const { to, message, template } = request.data as { 
    to: string; 
    message?: string; 
    template?: 'shift_reminder' | 'onboarding' | 'status_update' | 'custom';
  };
  const senderUid = request.auth.uid;

  // Validate inputs
  if (!to || !/^\+[1-9]\d{7,14}$/.test(to)) {
    throw new HttpsError('invalid-argument', 'Invalid recipient phone number format');
  }

  if (!message && !template) {
    throw new HttpsError('invalid-argument', 'Message content or template is required');
  }

  try {
    // Check if sender has permission to send worker messages
    const senderDoc = await db.doc(`users/${senderUid}`).get();
    const senderData = senderDoc.data();
    
    if (!senderData) {
      throw new HttpsError('not-found', 'Sender profile not found');
    }

    // Check if sender has appropriate permissions (Admin, Manager, or Recruiter)
    const securityLevel = parseInt(senderData.securityLevel || '0');
    const isAdmin = securityLevel >= 5;
    const isManager = senderData.role === 'Manager' || senderData.managerId;
    const isRecruiter = senderData.recruiter === true;
    
    if (!isAdmin && !isManager && !isRecruiter) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to send worker messages');
    }

    // Find recipient by phone number (phoneE164 field)
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', to)
      .limit(1)
      .get();
    
    if (usersQuery.empty) {
      // If user not found by phone, log warning but allow SMS to proceed
      // (user might be external or phone might be stored differently)
      logger.warn(`Recipient not found in system for phone ${to}, but allowing SMS to proceed`);
    } else {
      const recipientUserDoc = usersQuery.docs[0];
      const recipientUserData = recipientUserDoc.data();
      
      // Check SMS opt-in - if field exists and is false, block SMS
      // If field doesn't exist, default to allowing SMS (for verified phones)
      if (recipientUserData.smsOptIn === false) {
        throw new HttpsError('permission-denied', 'Recipient has opted out of SMS messages');
      }
      // If smsOptIn is true or undefined, allow SMS to proceed
    }

    // Prepare message content
    let messageContent = message;
    
    if (template && !message) {
      // Use template
      const templates = {
        shift_reminder: 'Hi! This is a reminder about your upcoming shift. Please confirm your availability.',
        onboarding: 'Welcome to the team! Please check your email for onboarding details and next steps.',
        status_update: 'Your application status has been updated. Please check your account for details.',
        custom: 'You have a new message from HRX. Please check your account for details.'
      };
      
      messageContent = templates[template];
    }

    if (!messageContent) {
      throw new HttpsError('invalid-argument', 'Message content is required');
    }

    // Get Twilio configuration with error handling
    let client;
    let messagingPhoneNumber;
    let a2pCampaign;
    
    try {
      client = getTwilioClient();
      messagingPhoneNumber = getMessagingPhoneNumber();
      a2pCampaign = getA2PCampaign();
    } catch (configError: any) {
      logger.error('Failed to load Twilio configuration:', configError);
      throw new HttpsError('internal', `Twilio configuration error: ${configError.message}. Please ensure all required secrets are set: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER or TWILIO_A2P_CAMPAIGN.`);
    }
    
    // Send SMS via Twilio
    // Use direct phone number to avoid A2P 10DLC registration requirements
    // (A2P 10DLC requires brand/campaign registration which can take time)
    const messageParams: any = {
      to: to,
      body: messageContent,
    };
    
    // Prefer Messaging Service when configured so Twilio Link Shortening (go.hrxone.com) is used
    if (a2pCampaign && a2pCampaign.trim() !== '') {
      messageParams.messagingServiceSid = a2pCampaign;
      messageParams.shortenUrls = true; // Twilio Link Shortening (go.hrxone.com)
      logger.info(`Using A2P messaging service (link shortening): ${a2pCampaign}`);
    } else if (messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
      messageParams.from = messagingPhoneNumber;
      logger.info(`Using direct phone number: ${messagingPhoneNumber}`);
    } else {
      throw new HttpsError('internal', 'Twilio messaging configuration is missing. Please configure TWILIO_MESSAGING_PHONE_NUMBER or TWILIO_A2P_CAMPAIGN.');
    }
    
    logger.info(`Attempting to send SMS to ${to} with params:`, { to, hasMessagingService: !!messageParams.messagingServiceSid, hasFrom: !!messageParams.from });
    
    let messageResult;
    try {
      messageResult = await client.messages.create(messageParams);
    } catch (twilioError: any) {
      // Handle A2P 10DLC registration errors (30034) - try fallback if using Messaging Service
      if (twilioError.code === 30034 && messageParams.messagingServiceSid && messagingPhoneNumber) {
        logger.warn(`A2P 10DLC registration required for Messaging Service, falling back to direct phone number ${messagingPhoneNumber}`);
        const fallbackParams: any = {
          to: to,
          body: messageContent,
          from: messagingPhoneNumber,
        };
        try {
          messageResult = await client.messages.create(fallbackParams);
        } catch (fallbackError: any) {
          // If fallback also fails with 30034, log warning but don't fail the assignment
          if (fallbackError.code === 30034) {
            logger.error(`Both Messaging Service and direct phone number require A2P 10DLC registration. Assignment created but SMS not sent. Error: ${fallbackError.message}`);
            // Return success but indicate SMS was not sent
            return {
              success: false,
              messageId: null,
              status: 'failed',
              error: 'SMS delivery failed: A2P 10DLC registration required. Please notify worker manually.',
              errorCode: '30034'
            };
          }
          throw fallbackError;
        }
      } else if (twilioError.code === 21705 && messageParams.messagingServiceSid && messagingPhoneNumber) {
        // If Messaging Service SID is invalid (error 21705), fall back to direct phone number
        logger.warn(`Messaging Service SID ${messageParams.messagingServiceSid} is invalid, falling back to direct phone number ${messagingPhoneNumber}`);
        const fallbackParams: any = {
          to: to,
          body: messageContent,
          from: messagingPhoneNumber,
        };
        messageResult = await client.messages.create(fallbackParams);
      } else if (twilioError.code === 30034) {
        // Direct phone number also requires A2P 10DLC registration
        logger.error(`A2P 10DLC registration required for phone number ${messagingPhoneNumber}. Assignment created but SMS not sent. Error: ${twilioError.message}`);
        // Return success but indicate SMS was not sent
        return {
          success: false,
          messageId: null,
          status: 'failed',
          error: 'SMS delivery failed: A2P 10DLC registration required. Please notify worker manually.',
          errorCode: '30034'
        };
      } else {
        // Re-throw other errors
        throw twilioError;
      }
    }

    // Log message to Firestore for audit trail
    await db.collection('sms_messages').add({
      messageId: messageResult.sid,
      from: senderUid,
      to: to,
      content: messageContent,
      template: template || null,
      status: messageResult.status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Worker message sent: ${messageResult.sid} from ${senderUid} to ${to}`);
    return { 
      success: true, 
      messageId: messageResult.sid,
      status: messageResult.status 
    };
  } catch (error: any) {
    logger.error('Failed to send worker message:', error);
    logger.error('Error details:', {
      code: error.code,
      message: error.message,
      status: error.status,
      moreInfo: error.moreInfo,
      stack: error.stack
    });
    
    // Handle specific Twilio errors
    if (error.code === 21211) {
      throw new HttpsError('invalid-argument', 'Invalid phone number format');
    } else if (error.code === 21614) {
      throw new HttpsError('invalid-argument', 'Phone number is not SMS capable');
    } else if (error.code === 21617) {
      throw new HttpsError('permission-denied', 'Recipient has opted out of SMS messages');
    } else if (error.code === 20003) {
      throw new HttpsError('permission-denied', 'Twilio authentication failed. Please check credentials.');
    } else if (error.code === 20429) {
      throw new HttpsError('resource-exhausted', 'Too many requests to Twilio. Please try again later.');
    } else if (error.code === 21608) {
      throw new HttpsError('invalid-argument', 'Invalid messaging service SID or phone number configuration.');
    }
    
    // If it's already an HttpsError, re-throw it with more context
    if (error instanceof HttpsError) {
      throw error;
    }
    
    // Provide more specific error message for debugging
    const errorMessage = error.message || 'Unknown error';
    const errorCode = error.code || 'unknown';
    logger.error(`Twilio error: ${errorCode} - ${errorMessage}`);
    
    throw new HttpsError('internal', `Failed to send SMS: ${errorMessage} (Code: ${errorCode}). Check Firebase function logs for details.`);
  }
});
