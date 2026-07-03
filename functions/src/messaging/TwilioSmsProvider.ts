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
import {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from './SmsProvider';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './twilioSecrets';
import { shortenUrlsInBody } from './linkShortener';

export class TwilioSmsProvider implements SmsProvider {
  private client: twilio.Twilio | null = null;
  private initialized: boolean = false;

  private initialize(): void {
    if (!this.initialized) {
      try {
        const accountSid = TWILIO_ACCOUNT_SID.value() || process.env.TWILIO_ACCOUNT_SID;
        const authToken = TWILIO_AUTH_TOKEN.value() || process.env.TWILIO_AUTH_TOKEN;

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

    const to = (params.to || '').trim();
    if (!to) {
      logger.warn('TwilioSmsProvider: missing or empty "to" (phone). Ensure user has phone or phoneE164.');
      return {
        success: false,
        errorCode: 'MISSING_TO',
        errorMessage: 'Required parameter "params[\'to\']" missing (no destination phone).',
      };
    }

    try {
      // Get Twilio configuration
      const fromNumber = TWILIO_MESSAGING_PHONE_NUMBER.value() || process.env.TWILIO_MESSAGING_PHONE_NUMBER;
      const messagingServiceSid = TWILIO_A2P_CAMPAIGN.value() || process.env.TWILIO_A2P_CAMPAIGN;

      // Self-hosted link shortening (hrxone.com/l/…) — replaces Twilio's
      // per-message-billed `shortenUrls` feature. Fail-open: on any error
      // the original body (long links) goes out unchanged.
      const body = await shortenUrlsInBody(params.body, {
        tenantId: params.tenantId,
        userId: params.userId,
        messageTypeId: params.messageTypeId,
      });

      // Build message parameters
      const messageParams: any = {
        to,
        body,
      };

      // Prefer Messaging Service when configured (sticky sender, throughput)
      const usedMessagingService = messagingServiceSid && messagingServiceSid.trim() !== '';
      if (usedMessagingService) {
        messageParams.messagingServiceSid = messagingServiceSid;
        logger.info(`Using A2P messaging service: ${messagingServiceSid}`);
      } else if (fromNumber && fromNumber.trim() !== '') {
        messageParams.from = fromNumber;
        logger.info(`Using direct phone number: ${fromNumber}`);
      } else {
        return {
          success: false,
          errorCode: 'TWILIO_CONFIG_MISSING',
          errorMessage: 'Twilio messaging configuration is missing (TWILIO_MESSAGING_PHONE_NUMBER or TWILIO_A2P_CAMPAIGN)',
        };
      }

      // Send SMS via Twilio
      let message;
      try {
        message = await this.client.messages.create(messageParams);
      } catch (twilioErr: any) {
        // When using Messaging Service, fall back to direct number on invalid SID (21705) or A2P (30034)
        if ((twilioErr.code === 21705 || twilioErr.code === 30034) && usedMessagingService && fromNumber && fromNumber.trim() !== '') {
          logger.warn(
            `Messaging Service failed (${twilioErr.code}), falling back to direct number`,
            { to, error: twilioErr.message }
          );
          message = await this.client.messages.create({
            to,
            body,
            from: fromNumber,
          });
        } else {
          throw twilioErr;
        }
      }

      logger.info(`SMS sent via Twilio: ${message.sid} to ${to}`);

      return {
        success: true,
        providerMessageId: message.sid,
      };
    } catch (err: any) {
      // Handle A2P 10DLC registration errors (when no fallback was possible)
      if (err.code === 30034) {
        logger.error(`A2P 10DLC registration required. SMS not sent to ${to}`);
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
        to,
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

