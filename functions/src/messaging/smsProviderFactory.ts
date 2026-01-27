/**
 * SMS Provider Factory
 * 
 * Centralized provider selection based on environment configuration.
 * 
 * Implements: HRX One Mock SMS Provider Plan — Section 5 Provider Factory & Environment Flag
 */

import { SmsProvider } from './SmsProvider';
import { TwilioSmsProvider } from './TwilioSmsProvider';
import { MockSmsProvider } from './MockSmsProvider';
import { logger } from 'firebase-functions/v2';

let cachedProvider: SmsProvider | null = null;

function maskE164(phone: string | undefined): string {
  const s = String(phone || '').trim();
  if (!s) return '(unset)';
  const digits = s.replace(/[^\d+]/g, '');
  const last4 = digits.replace(/[^\d]/g, '').slice(-4);
  return last4 ? `***${last4}` : '(set)';
}

/**
 * Get the SMS provider instance (singleton)
 * 
 * Reads SMS_PROVIDER environment variable:
 * - "twilio" -> TwilioSmsProvider (production)
 * - "mock" or unset -> MockSmsProvider (testing/dev)
 */
export function getSmsProvider(): SmsProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const mode = process.env.SMS_PROVIDER ?? 'mock';
  const fromMasked = maskE164(process.env.TWILIO_MESSAGING_PHONE_NUMBER);
  logger.info('[SMS] Provider selection', { mode, from: fromMasked });

  if (mode === 'twilio') {
    logger.info('Initializing TwilioSmsProvider (production mode)');
    cachedProvider = new TwilioSmsProvider();
  } else {
    logger.info('Initializing MockSmsProvider (testing/dev mode)');
    cachedProvider = new MockSmsProvider();
  }

  return cachedProvider;
}

/**
 * Reset the SMS provider (useful for testing)
 */
export function resetSmsProvider(): void {
  cachedProvider = null;
}

