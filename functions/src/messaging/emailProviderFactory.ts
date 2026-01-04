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

  // Get config from environment or secrets
  const apiKey = sendGridApiKey.value() || process.env.SENDGRID_API_KEY;
  const fromEmail = sendGridFromEmail.value() || process.env.SENDGRID_FROM_EMAIL || 'noreply@hrxone.com';
  const fromName = sendGridFromName.value() || process.env.SENDGRID_FROM_NAME || 'HRX One';

  if (!apiKey) {
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

