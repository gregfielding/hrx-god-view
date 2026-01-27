/**
 * Mock SMS Provider
 * 
 * Mock implementation that never sends real SMS.
 * Used for local/dev/staging and while waiting for Twilio A2P approval.
 * 
 * Implements: HRX One Mock SMS Provider Plan — Section 4 MockSmsProvider
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from './SmsProvider';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export class MockSmsProvider implements SmsProvider {
  async sendSms(params: SmsSendParams): Promise<SmsSendResult> {
    try {
      // Test hook: force a Twilio opt-out error (21610) end-to-end in emulators.
      // Use by including `FORCE_TWILIO_21610` in the message body.
      if (String(params.body || '').includes('FORCE_TWILIO_21610')) {
        logger.info('[MOCK SMS] Forcing Twilio 21610 opt-out error for testing', {
          to: params.to,
          tenantId: params.tenantId,
          threadId: params.threadId,
        });
        return {
          success: false,
          errorCode: '21610',
          errorMessage: 'The message was not sent because the recipient has opted out (mock 21610).',
        };
      }

      // Write debug log entry for visibility
      const debugRef = db
        .collection('test_logs')
        .doc('mockSms')
        .collection('events')
        .doc();

      await debugRef.set({
        id: debugRef.id,
        tenantId: params.tenantId,
        to: params.to,
        from: params.from,
        body: params.body,
        messageTypeId: params.messageTypeId,
        userId: params.userId ?? null,
        threadId: params.threadId ?? null,
        createdAt: FieldValue.serverTimestamp(),
        provider: 'mock',
      });

      logger.info(`[MOCK SMS] Would send SMS to ${params.to}: "${params.body.substring(0, 50)}${params.body.length > 50 ? '...' : ''}"`);

      // Pretend Twilio accepted the message
      return {
        success: true,
        providerMessageId: `mock-${debugRef.id}`,
      };
    } catch (error: any) {
      logger.error('Error in MockSmsProvider:', error);
      // Even in mock mode, return failure if we can't log
      return {
        success: false,
        errorCode: 'MOCK_ERROR',
        errorMessage: error.message || 'Failed to log mock SMS',
      };
    }
  }
}

