/**
 * Email Provider Factory
 * 
 * Centralized provider selection.
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 1.3 Email Provider Factory
 */

import { EmailProvider } from './EmailProvider';
import { SendGridEmailProvider, SendGridConfig } from './sendGridEmailProvider';
import { GmailEmailProvider } from './gmailEmailProvider';
import { SenderIdentity } from './senderIdentity';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';

// Define secrets (exported for use in other functions)
export const sendGridApiKey = defineSecret('SENDGRID_API_KEY');
export const sendGridFromEmail = defineSecret('SENDGRID_FROM_EMAIL');
export const sendGridFromName = defineSecret('SENDGRID_FROM_NAME');

let cachedSendGridProvider: EmailProvider | null = null;
let cachedGmailProvider: EmailProvider | null = null;

/** Get a secret value or env fallback without requiring the secret to be in the function's dependency array (avoids warning in triggers that only use env). */
function getSecretOrEnv(secretFn: () => string, envKey: string): string | undefined {
  try {
    const v = secretFn();
    if (v) return v;
  } catch {
    // Secret not bound to this function (e.g. application triggers)
  }
  return process.env[envKey] as string | undefined;
}

/**
 * Check if SendGrid is configured (safe to call; does not expose secrets).
 * Application triggers use process.env (no SendGrid secrets bound); set SENDGRID_API_KEY etc. in
 * Firebase env or .env so deployed functions have access.
 */
export function isSendGridConfigured(): boolean {
  // Prefer process.env so triggers that don't declare the secret never call .value() (avoids warning)
  const apiKey = process.env.SENDGRID_API_KEY || getSecretOrEnv(() => sendGridApiKey.value(), 'SENDGRID_API_KEY');
  return !!apiKey;
}

/**
 * Get the email provider instance based on sender identity
 * 
 * Returns SendGrid provider for system senders, Gmail provider for Gmail senders.
 */
export function getEmailProvider(senderIdentity?: SenderIdentity): EmailProvider {
  // If sender identity specifies Gmail, use Gmail provider
  if (senderIdentity?.emailProvider === 'gmail') {
    if (!cachedGmailProvider) {
      logger.info('Initializing GmailEmailProvider');
      cachedGmailProvider = new GmailEmailProvider();
    }
    return cachedGmailProvider;
  }

  // Default to SendGrid
  if (cachedSendGridProvider) {
    return cachedSendGridProvider;
  }

  // Prefer process.env so triggers that don't declare SendGrid secrets never call .value() (avoids "No value found for secret" warning)
  const apiKey = process.env.SENDGRID_API_KEY || getSecretOrEnv(() => sendGridApiKey.value(), 'SENDGRID_API_KEY');
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || getSecretOrEnv(() => sendGridFromEmail.value(), 'SENDGRID_FROM_EMAIL') || 'noreply@hrxone.com';
  const fromName = process.env.SENDGRID_FROM_NAME || getSecretOrEnv(() => sendGridFromName.value(), 'SENDGRID_FROM_NAME') || 'HRX One';

  if (!apiKey) {
    logger.warn(
      'SendGrid not available: SENDGRID_API_KEY missing. Set in Firebase env or functions/.env for application triggers.'
    );
    throw new Error('SendGrid configuration missing: SENDGRID_API_KEY is required');
  }

  const config: SendGridConfig = {
    apiKey,
    defaultFromEmail: fromEmail,
    defaultFromName: fromName,
  };

  logger.info('Initializing SendGridEmailProvider');
  cachedSendGridProvider = new SendGridEmailProvider(config);

  return cachedSendGridProvider;
}

/**
 * Reset the email provider (useful for testing)
 */
export function resetEmailProvider(): void {
  cachedSendGridProvider = null;
  cachedGmailProvider = null;
}

