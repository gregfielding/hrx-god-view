/**
 * Twilio SMS Provider
 * 
 * Real Twilio implementation for production use.
 * Wraps existing Twilio client logic in the SmsProvider interface.
 * 
 * Implements: HRX One Mock SMS Provider Plan — Section 3 TwilioSmsProvider
 */

import { logger } from 'firebase-functions/v2';
import twilio from 'twilio';
import { defineSecret } from 'firebase-functions/params';
import {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from './SmsProvider';

// Define secrets for Twilio credentials
const twilioAccountSid = defineSecret('TWILIO_ACCOUNT_SID');
const twilioAuthToken = defineSecret('TWILIO_AUTH_TOKEN');
const messagingPhoneNumber = defineSecret('TWILIO_MESSAGING_PHONE_NUMBER');
const a2pCampaign = defineSecret('TWILIO_A2P_CAMPAIGN');

export class TwilioSmsProvider implements SmsProvider {
  private client: twilio.Twilio | null = null;
  private initialized: boolean = false;

  private initialize(): void {
    if (!this.initialized) {
      try {
        const accountSid = twilioAccountSid.value() || process.env.TWILIO_ACCOUNT_SID;
        const authToken = twilioAuthToken.value() || process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
          throw new Error('Twilio credentials not configured');
        }

        this.client = twilio(accountSid, authToken);
        this.initialized = true;
      } catch (error: any) {
        logger.error('Failed to initialize Twilio client:', error);
        throw error;
      }
    }
  }

  async sendSms(params: SmsSendParams): Promise<SmsSendResult> {
    this.initialize();

    if (!this.client) {
      return {
        success: false,
        errorCode: 'TWILIO_NOT_INITIALIZED',
        errorMessage: 'Twilio client not initialized',
      };
    }

    try {
      // Get Twilio configuration
      const fromNumber = messagingPhoneNumber.value() || process.env.TWILIO_MESSAGING_PHONE_NUMBER;
      const messagingServiceSid = a2pCampaign.value() || process.env.TWILIO_A2P_CAMPAIGN;

      // Build message parameters
      const messageParams: any = {
        to: params.to,
        body: params.body,
      };

      // Use direct phone number if available, otherwise use Messaging Service
      if (fromNumber && fromNumber.trim() !== '') {
        messageParams.from = fromNumber;
        logger.info(`Using direct phone number: ${fromNumber}`);
      } else if (messagingServiceSid && messagingServiceSid.trim() !== '') {
        messageParams.messagingServiceSid = messagingServiceSid;
        logger.info(`Using A2P messaging service: ${messagingServiceSid}`);
      } else {
        return {
          success: false,
          errorCode: 'TWILIO_CONFIG_MISSING',
          errorMessage: 'Twilio messaging configuration is missing (TWILIO_MESSAGING_PHONE_NUMBER or TWILIO_A2P_CAMPAIGN)',
        };
      }

      // Send SMS via Twilio
      const message = await this.client.messages.create(messageParams);

      logger.info(`SMS sent via Twilio: ${message.sid} to ${params.to}`);

      return {
        success: true,
        providerMessageId: message.sid,
      };
    } catch (err: any) {
      // Handle A2P 10DLC registration errors
      if (err.code === 30034) {
        logger.error(`A2P 10DLC registration required. SMS not sent to ${params.to}`);
        return {
          success: false,
          errorCode: '30034',
          errorMessage: 'SMS delivery failed: A2P 10DLC registration required',
        };
      }

      // Handle other Twilio errors
      const errorCode = err?.code?.toString?.() ?? 'TWILIO_ERROR';
      const errorMessage = err?.message ?? 'Unknown Twilio error';

      logger.error(`Twilio SMS send failed:`, {
        errorCode,
        errorMessage,
        to: params.to,
        messageTypeId: params.messageTypeId,
      });

      // Do NOT throw; return structured failure so caller can log it
      return {
        success: false,
        errorCode,
        errorMessage,
      };
    }
  }
}

