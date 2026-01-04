/**
 * Sender Verification Functions
 * 
 * Functions to verify and test sender identities (Twilio numbers and Gmail connections)
 */

import { onCall } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { google } from 'googleapis';
import { defineString, defineSecret } from 'firebase-functions/params';
import twilio from 'twilio';

const db = admin.firestore();

// Google OAuth2 configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  redirectUri.value()
);

// Twilio configuration
const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');

function getTwilioClient() {
  return twilio(twilioAccountSid.value(), twilioAuthToken.value());
}

export interface VerificationResult {
  success: boolean;
  status: 'active' | 'pending' | 'error' | 'not_configured';
  message: string;
  details?: {
    verifiedAt?: Date;
    error?: string;
    webhookConfigured?: boolean;
    tokenValid?: boolean;
    email?: string;
    phoneNumber?: string;
  };
}

/**
 * Verify Twilio number assignment and webhook configuration
 */
export const verifyTwilioNumber = onCall(
  {
    secrets: [twilioAccountSid, twilioAuthToken],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { tenantId, recruiterId } = request.data as {
      tenantId: string;
      recruiterId: string;
    };

    if (!tenantId || !recruiterId) {
      throw new HttpsError('invalid-argument', 'tenantId and recruiterId are required');
    }

    try {
      // Get recruiter number assignment
      const recruiterNumberDoc = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('recruiterNumbers')
        .doc(recruiterId)
        .get();

      if (!recruiterNumberDoc.exists) {
        return {
          success: false,
          status: 'not_configured' as const,
          message: 'No Twilio number assigned to this recruiter',
        } as VerificationResult;
      }

      const recruiterNumber = recruiterNumberDoc.data();
      
      if (recruiterNumber?.useMainNumber || !recruiterNumber?.twilioNumberSid) {
        return {
          success: true,
          status: 'active' as const,
          message: 'Using main tenant number',
          details: {
            verifiedAt: new Date(),
            phoneNumber: recruiterNumber?.twilioNumber || 'Main number',
          },
        } as VerificationResult;
      }

      // Verify number exists in Twilio and webhook is configured
      const client = getTwilioClient();
      const number = await client.incomingPhoneNumbers(recruiterNumber.twilioNumberSid).fetch();
      
      const webhookConfigured = !!(number.smsUrl && number.smsUrl.includes('handleInboundSms'));

      // Update verification status
      await recruiterNumberDoc.ref.update({
        status: webhookConfigured ? 'active' : 'error',
        lastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        verificationError: webhookConfigured ? null : 'Webhook not configured',
      });

      return {
        success: webhookConfigured,
        status: webhookConfigured ? 'active' : 'error' as const,
        message: webhookConfigured 
          ? 'Twilio number is active and webhook is configured'
          : 'Twilio number exists but webhook is not configured',
        details: {
          verifiedAt: new Date(),
          webhookConfigured,
          phoneNumber: number.phoneNumber,
        },
      } as VerificationResult;
    } catch (error: any) {
      logger.error('Error verifying Twilio number:', error);
      
      // Update verification status
      try {
        await db
          .collection('tenants')
          .doc(tenantId)
          .collection('recruiterNumbers')
          .doc(recruiterId)
          .update({
            status: 'error',
            lastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            verificationError: error.message || 'Verification failed',
          });
      } catch (updateError) {
        logger.warn('Failed to update verification status:', updateError);
      }

      return {
        success: false,
        status: 'error' as const,
        message: `Verification failed: ${error.message || 'Unknown error'}`,
        details: {
          error: error.message,
        },
      } as VerificationResult;
    }
  }
);

/**
 * Verify Gmail connection and API access
 */
export const verifyGmailConnection = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { userId } = request.data as {
    userId: string;
  };

  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId is required');
  }

  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return {
        success: false,
        status: 'not_configured' as const,
        message: 'User not found',
      } as VerificationResult;
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      return {
        success: false,
        status: 'not_configured' as const,
        message: 'Gmail not connected',
      } as VerificationResult;
    }

    // Test Gmail API access
    oauth2Client.setCredentials(gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress || gmailTokens.email;

    // Check token expiry
    const expiryDate = gmailTokens.expiry_date;
    const isExpired = expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000; // 5 minute buffer

    // Update verification status
    await userDoc.ref.update({
      gmailLastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      gmailVerificationError: null,
    });

    return {
      success: true,
      status: isExpired ? 'error' : 'active' as const,
      message: isExpired 
        ? 'Gmail connection is active but token is expired'
        : 'Gmail connection is active and token is valid',
      details: {
        verifiedAt: new Date(),
        tokenValid: !isExpired,
        email,
      },
    } as VerificationResult;
  } catch (error: any) {
    logger.error('Error verifying Gmail connection:', error);

    // Handle token expiration
    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      await db.collection('users').doc(userId).update({
        gmailConnected: false,
        gmailLastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        gmailVerificationError: 'Token expired or revoked',
      });

      return {
        success: false,
        status: 'error' as const,
        message: 'Gmail token expired. Please reconnect your Gmail account.',
        details: {
          error: 'Token expired or revoked',
        },
      } as VerificationResult;
    }

    // Update verification status
    try {
      await db.collection('users').doc(userId).update({
        gmailLastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        gmailVerificationError: error.message || 'Verification failed',
      });
    } catch (updateError) {
      logger.warn('Failed to update Gmail verification status:', updateError);
    }

    return {
      success: false,
      status: 'error' as const,
      message: `Verification failed: ${error.message || 'Unknown error'}`,
      details: {
        error: error.message,
      },
    } as VerificationResult;
  }
});

/**
 * Test sender identity by sending a test message
 */
export const testSenderIdentity = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, userId, senderType, testRecipient } = request.data as {
    tenantId: string;
    userId: string;
    senderType: 'gmail' | 'recruiter_sms' | 'system';
    testRecipient?: {
      email?: string;
      phone?: string;
    };
  };

  if (!tenantId || !userId || !senderType) {
    throw new HttpsError('invalid-argument', 'tenantId, userId, and senderType are required');
  }

  try {
    const { sendMessage } = await import('./routingOrchestrator');
    const { resolveSenderIdentity } = await import('./senderIdentity');

    // Resolve sender identity
    const senderIdentity = await resolveSenderIdentity(tenantId, {
      metadata: {
        senderId: senderType === 'gmail' ? 'gmail' : senderType === 'recruiter_sms' ? 'recruiter_sms' : 'system',
        senderType,
      },
      source: senderType === 'recruiter_sms' || senderType === 'gmail' ? 'recruiter' : 'system',
      sourceId: senderType === 'recruiter_sms' || senderType === 'gmail' ? userId : undefined,
    });

    if (!senderIdentity || !senderIdentity.enabled) {
      return {
        success: false,
        message: 'Sender identity not available or disabled',
      };
    }

    // Get recruiter's own email/phone for testing
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const recipientEmail = testRecipient?.email || userData?.email || userData?.gmailTokens?.email;
    const recipientPhone = testRecipient?.phone || userData?.phoneE164;

    const testResults: any[] = [];

    // Test email if Gmail or system
    if (senderType === 'gmail' || senderType === 'system') {
      if (!recipientEmail) {
        testResults.push({
          channel: 'email',
          success: false,
          message: 'Recipient email not found. Please provide testRecipient.email',
        });
      } else if (senderIdentity.emailProvider === 'gmail' && !senderIdentity.gmailUserId) {
        testResults.push({
          channel: 'email',
          success: false,
          message: 'Gmail sender requires gmailUserId',
        });
      } else {
        try {
          // Create a test user document for the recipient (or use existing)
          // For testing, we'll send to the recruiter's own email
          const testUserId = userId; // Send to self for testing
          
          // Send test email
          const emailResult = await sendMessage({
            tenantId,
            userId: testUserId,
            messageTypeId: 'direct_message',
            variables: {
              _directMessage: true,
              _message: '<p>This is a test message from HRX One sender verification.</p>',
              _subject: 'Test: Sender Verification',
            },
            overrideChannels: ['email'],
            metadata: {
              senderId: senderType === 'gmail' ? 'gmail' : 'system',
              senderType,
              source: senderType === 'gmail' ? 'recruiter' : 'system',
              sourceId: senderType === 'gmail' ? userId : undefined,
            },
          });

          testResults.push({
            channel: 'email',
            success: emailResult.success,
            message: emailResult.success 
              ? 'Test email sent successfully'
              : `Failed to send test email: ${emailResult.deliveryResults.find(r => r.channel === 'email')?.error || 'Unknown error'}`,
            messageId: emailResult.deliveryResults.find(r => r.channel === 'email')?.messageId,
          });
        } catch (error: any) {
          testResults.push({
            channel: 'email',
            success: false,
            message: `Error sending test email: ${error.message}`,
          });
        }
      }
    }

    // Test SMS if recruiter_sms or system
    if (senderType === 'recruiter_sms' || senderType === 'system') {
      if (!recipientPhone) {
        testResults.push({
          channel: 'sms',
          success: false,
          message: 'Recipient phone not found. Please provide testRecipient.phone',
        });
      } else {
        try {
          // Send test SMS to recruiter's own phone
          const testUserId = userId; // Send to self for testing
          
          const smsResult = await sendMessage({
            tenantId,
            userId: testUserId,
            messageTypeId: 'direct_message',
            variables: {
              _directMessage: true,
              _message: 'This is a test SMS from HRX One sender verification.',
            },
            overrideChannels: ['sms'],
            metadata: {
              senderId: senderType === 'recruiter_sms' ? 'recruiter_sms' : 'system',
              senderType,
              source: senderType === 'recruiter_sms' ? 'recruiter' : 'system',
              sourceId: senderType === 'recruiter_sms' ? userId : undefined,
            },
          });

          testResults.push({
            channel: 'sms',
            success: smsResult.success,
            message: smsResult.success 
              ? 'Test SMS sent successfully'
              : `Failed to send test SMS: ${smsResult.deliveryResults.find(r => r.channel === 'sms')?.error || 'Unknown error'}`,
            messageId: smsResult.deliveryResults.find(r => r.channel === 'sms')?.messageId,
          });
        } catch (error: any) {
          testResults.push({
            channel: 'sms',
            success: false,
            message: `Error sending test SMS: ${error.message}`,
          });
        }
      }
    }

    const allSuccess = testResults.every(r => r.success);
    const allFailed = testResults.every(r => !r.success);

    return {
      success: allSuccess,
      message: allSuccess 
        ? 'All test messages sent successfully'
        : allFailed
        ? 'All test messages failed'
        : 'Some test messages succeeded',
      results: testResults,
    };
  } catch (error: any) {
    logger.error('Error testing sender identity:', error);
    return {
      success: false,
      message: `Test failed: ${error.message || 'Unknown error'}`,
    };
  }
});

