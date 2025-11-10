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

// Define secrets for Twilio credentials
const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const verifyServiceSid = defineSecret('TWILIO_VERIFY_SERVICE_SID');
const messagingPhoneNumber = defineSecret('TWILIO_MESSAGING_PHONE_NUMBER');
const a2pCampaign = defineSecret('TWILIO_A2P_CAMPAIGN');

// Helper to get Twilio client (lazy initialization)
function getTwilioClient() {
  return twilio(twilioAccountSid.value(), twilioAuthToken.value());
}

function getVerifyServiceSid() {
  return verifyServiceSid.value();
}

function getMessagingPhoneNumber() {
  return messagingPhoneNumber.value();
}

function getA2PCampaign() {
  return a2pCampaign.value();
}

// Initialize CORS middleware
const corsHandler = cors({ origin: true });

/**
 * Send OTP via Twilio Verify (HTTP version with CORS)
 */
export const sendOtpHttp = onRequest(
  {
    secrets: [twilioAccountSid, twilioAuthToken, verifyServiceSid],
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
    secrets: [twilioAccountSid, twilioAuthToken, verifyServiceSid],
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
    secrets: [twilioAccountSid, twilioAuthToken, verifyServiceSid],
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
      await db.doc(`users/${uid}`).set({
        phoneE164,
        phoneVerified: true,
        phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info(`Updated user ${uid} with verified phone: ${phoneE164}`);
    } else {
      // If no UID available, try to find user by phone number
      const usersQuery = await db.collection('users')
        .where('phoneE164', '==', phoneE164)
        .limit(1)
        .get();
      
      if (!usersQuery.empty) {
        const userDoc = usersQuery.docs[0];
        await userDoc.ref.update({
          phoneVerified: true,
          phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Updated user ${userDoc.id} with verified phone: ${phoneE164}`);
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
 * Send worker message via Twilio Programmable Messaging
 */
export const sendWorkerMessage = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken, messagingPhoneNumber, a2pCampaign],
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
    
    if (messagingPhoneNumber && messagingPhoneNumber.trim() !== '') {
      // Use direct phone number (works immediately without A2P 10DLC registration)
      messageParams.from = messagingPhoneNumber;
      logger.info(`Using direct phone number: ${messagingPhoneNumber}`);
    } else if (a2pCampaign && a2pCampaign.trim() !== '') {
      // Fallback to Messaging Service if phone number not configured
      // Note: Requires A2P 10DLC registration to work
      messageParams.messagingServiceSid = a2pCampaign;
      logger.info(`Using A2P messaging service: ${a2pCampaign}`);
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
