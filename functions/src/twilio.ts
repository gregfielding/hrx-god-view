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
  // const uid = request.auth.uid; // TODO: Get uid from request when auth is restored

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

    // TODO: Update user profile with verified phone when auth is restored
    // await db.doc(`users/${uid}`).set({
    //   phoneE164,
    //   phoneVerified: true,
    //   updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    // }, { merge: true });

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
    cors: true,
  },
  async (request) => {
  // Validate authentication
  if (!request.auth) {
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

    // Check if recipient has opted in to SMS
    const recipientDoc = await db.doc(`users/${to}`).get();
    const recipientData = recipientDoc.data();
    
    if (!recipientData) {
      // If user not found, try to find by phone number
      const usersQuery = await db.collection('users')
        .where('phoneE164', '==', to)
        .limit(1)
        .get();
      
      if (usersQuery.empty) {
        throw new HttpsError('not-found', 'Recipient not found in system');
      }
      
      const recipientUserDoc = usersQuery.docs[0];
      const recipientUserData = recipientUserDoc.data();
      
      if (!recipientUserData.smsOptIn) {
        throw new HttpsError('permission-denied', 'Recipient has not opted in to receive SMS messages');
      }
    } else {
      if (!recipientData.smsOptIn) {
        throw new HttpsError('permission-denied', 'Recipient has not opted in to receive SMS messages');
      }
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

    const client = getTwilioClient();
    const messagingPhoneNumber = getMessagingPhoneNumber();
    const a2pCampaign = getA2PCampaign();
    
    // Send SMS via Twilio with A2P 10DLC campaign
    const messageResult = await client.messages.create({
      from: messagingPhoneNumber,
      to: to,
      body: messageContent,
      messagingServiceSid: a2pCampaign, // Use A2P 10DLC campaign for better deliverability
    });

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
    
    // Handle specific Twilio errors
    if (error.code === 21211) {
      throw new HttpsError('invalid-argument', 'Invalid phone number format');
    } else if (error.code === 21614) {
      throw new HttpsError('invalid-argument', 'Phone number is not SMS capable');
    } else if (error.code === 21617) {
      throw new HttpsError('permission-denied', 'Recipient has opted out of SMS messages');
    }
    
    // If it's already an HttpsError, re-throw it
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to send message. Please try again.');
  }
});
