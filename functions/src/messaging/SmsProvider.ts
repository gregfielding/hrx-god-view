/**
 * SMS Provider Interface
 * 
 * Provider-agnostic interface for SMS sending.
 * Allows switching between Mock (testing) and Twilio (production) providers.
 * 
 * Implements: HRX One Mock SMS Provider Plan — Section 2 SmsProvider Interface
 */

export interface SmsSendParams {
  tenantId: string;
  to: string;              // Destination phone (E.164 format)
  from: string;            // Twilio number / Messaging Service number
  body: string;
  messageTypeId: string;   // Maps to messageTypes registry
  userId?: string;         // HRX user ID related to this message
  threadId?: string;       // smsThreads threadId, if applicable
}

export interface SmsSendResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SmsProvider {
  sendSms(params: SmsSendParams): Promise<SmsSendResult>;
}

