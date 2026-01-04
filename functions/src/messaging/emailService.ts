/**
 * Email Service Factory
 * 
 * Provides singleton EmailProvider instance.
 * 
 * Implements: HRX One Email Provider Spec — Section 3 Configuration
 */

import { EmailProvider } from './EmailProvider';
import { SendGridEmailProvider, SendGridConfig } from './sendGridEmailProvider';
import { defineSecret } from 'firebase-functions/params';

// Define secrets
const sendGridApiKey = defineSecret('SENDGRID_API_KEY');
const sendGridFromEmail = defineSecret('SENDGRID_FROM_EMAIL');
const sendGridFromName = defineSecret('SENDGRID_FROM_NAME');

let emailProvider: EmailProvider | null = null;

/**
 * Get the email provider instance (singleton)
 */
export function getEmailProvider(): EmailProvider {
  if (!emailProvider) {
    // Get config from environment or secrets
    const apiKey = sendGridApiKey.value() || process.env.SENDGRID_API_KEY;
    const fromEmail = sendGridFromEmail.value() || process.env.SENDGRID_FROM_EMAIL;
    const fromName = sendGridFromName.value() || process.env.SENDGRID_FROM_NAME;

    if (!apiKey || !fromEmail) {
      throw new Error('SendGrid configuration missing: SENDGRID_API_KEY and SENDGRID_FROM_EMAIL are required');
    }

    const config: SendGridConfig = {
      apiKey,
      defaultFromEmail: fromEmail,
      defaultFromName: fromName || 'HRX One',
    };

    emailProvider = new SendGridEmailProvider(config);
  }

  return emailProvider;
}

/**
 * Reset the email provider (useful for testing)
 */
export function resetEmailProvider(): void {
  emailProvider = null;
}

