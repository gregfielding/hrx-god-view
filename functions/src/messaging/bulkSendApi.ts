/**
 * Bulk Send API
 *
 * HTTP endpoints for bulk email (SendGrid) and bulk SMS (Twilio) using system sender only.
 * Each sent message is logged to messageLogs; `messageLogging.logMessage` mirrors successful sends to activityLogs.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import cors from 'cors';
import { resolveSenderIdentity } from './senderIdentity';
import { getEmailProvider } from './emailProviderFactory';
import { getSmsProvider } from './smsProviderFactory';
import { logMessage } from './messageLogging';
import { getTenantSmsConsent } from './tenantConsent';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN } from './twilioSecrets';
import { workerHasTenantAssociation } from '../onboarding/onCallOnboardingGuards';

const db = admin.firestore();

const BULK_MESSAGE_TYPE_EMAIL = 'bulk_direct_email';
const BULK_MESSAGE_TYPE_SMS = 'bulk_direct_sms';

/**
 * Replace template variables in message body with user data
 * Supports: {{firstName}}, {{lastName}}, {{fullName}}, {{email}}, {{phone}}
 */
function replaceTemplateVariables(body: string, userData: admin.firestore.DocumentData | undefined): string {
  if (!userData) return body;
  
  let rendered = body;
  
  // Extract values with fallbacks
  const firstName = userData.firstName || userData.first_name || '';
  const lastName = userData.lastName || userData.last_name || '';
  const fullName = userData.displayName || 
                   [firstName, lastName].filter(Boolean).join(' ') ||
                   userData.name ||
                   '';
  const email = userData.email || '';
  const phone = userData.phoneE164 || userData.phone || '';
  
  // Replace variables (case-insensitive, supports both {{var}} and {var})
  const replacements: Record<string, string> = {
    '{{firstName}}': firstName,
    '{{lastName}}': lastName,
    '{{fullName}}': fullName,
    '{{email}}': email,
    '{{phone}}': phone,
    '{firstName}': firstName,
    '{lastName}': lastName,
    '{fullName}': fullName,
    '{email}': email,
    '{phone}': phone,
  };
  
  for (const [placeholder, value] of Object.entries(replacements)) {
    // Escape special regex characters in placeholder
    const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPlaceholder, 'gi');
    rendered = rendered.replace(regex, value);
  }
  
  return rendered;
}

/** Normalize phone to E.164 for Twilio. Handles (xxx)xxx-xxxx, xxx-xxx-xxxx, +1..., 10/11 digits. */
function toE164(phone: string | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && phone.trim().startsWith('+')) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

/** CORS middleware so browser preflight (OPTIONS) from localhost/production gets proper headers. */
const corsHandler = cors({ origin: true });

function setCors(response: any) {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, X-Firebase-AppCheck',
  );
  response.set('Access-Control-Max-Age', '3600');
}

async function verifyAuthAndTenant(
  request: any,
  response: any,
  tenantId: string
): Promise<{ uid: string; userName: string } | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    response.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return null;
  }
  try {
    const token = authHeader.replace('Bearer ', '').trim();
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const roles = (decoded as any).roles || {};
    const hasJwtTenantRole = Boolean(roles[tenantId]);
    const isHrx = Boolean((decoded as any).hrx);

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const hasFirestoreTenantLink = workerHasTenantAssociation(userData, tenantId);

    /** JWT roles map is not always populated; staff often have tenant linkage only on users/{uid}. */
    if (!hasJwtTenantRole && !isHrx && !hasFirestoreTenantLink) {
      response.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this tenant' },
      });
      return null;
    }
    const userName =
      [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') ||
      userData?.displayName ||
      userData?.email ||
      'System';
    return { uid, userName };
  } catch (err: any) {
    logger.warn('Bulk send auth failed', { error: err.message });
    response.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: err.message || 'Invalid token' },
    });
    return null;
  }
}

/**
 * POST /bulkSendEmailApi
 * Body: { tenantId, initiatedByUserId, recipientUserIds: string[], subject, bodyHtml, bodyPlain? }
 */
export const bulkSendEmailApi = onRequest(
  { memory: '512MiB' },
  async (request, response) => {
  return corsHandler(request, response, async () => {
    setCors(response);
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    try {
      if (request.method !== 'POST') {
        response.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' },
        });
        return;
      }

      const { tenantId, initiatedByUserId, recipientUserIds, subject, bodyHtml, bodyPlain, senderType } = request.body || {};
      if (!tenantId || !initiatedByUserId || !Array.isArray(recipientUserIds) || !subject || !bodyHtml) {
        response.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message: 'tenantId, initiatedByUserId, recipientUserIds, subject, and bodyHtml are required',
          },
        });
        return;
      }

      const auth = await verifyAuthAndTenant(request, response, tenantId);
      if (!auth) return;
      if (auth.uid !== initiatedByUserId) {
        response.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'initiatedByUserId must match authenticated user' },
        });
        return;
      }

      // Resolve sender identity based on senderType
      // 'system' = SendGrid with noreply@hrxone.com, no signature
      // 'gmail' = Gmail API with user's email, includes signature
      const isGmailSender = senderType === 'gmail';
      let senderIdentity;
      if (isGmailSender) {
        // Resolve recruiter Gmail sender
        senderIdentity = await resolveSenderIdentity(tenantId, {
          source: 'recruiter',
          sourceId: initiatedByUserId,
        });
        // Verify Gmail is actually connected
        if (!senderIdentity.gmailUserId || senderIdentity.emailProvider !== 'gmail') {
          response.status(400).json({
            success: false,
            error: {
              code: 'INVALID_ARGUMENT',
              message: 'Gmail not connected. Please connect Gmail in settings to send from your account.',
            },
          });
          return;
        }
      } else {
        // System sender (default)
        senderIdentity = await resolveSenderIdentity(tenantId, {});
      }

      const emailProvider = getEmailProvider(senderIdentity);
      const textBody = bodyPlain || (bodyHtml ? bodyHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() : '');

      const errors: { userId: string; error: string }[] = [];
      let sent = 0;

      for (const userId of recipientUserIds) {
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          const userData = userDoc.data();
          const email = userData?.email || userData?.gmailTokens?.email;
          if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push({ userId, error: 'Missing or invalid email' });
            continue;
          }

          // Replace template variables in email body (both HTML and plain text)
          const renderedHtmlBody = replaceTemplateVariables(String(bodyHtml), userData);
          const renderedTextBody = replaceTemplateVariables(textBody, userData);

          // For system sender: don't pass userId/gmailUserId to prevent signature lookup
          // For Gmail sender: pass gmailUserId to include signature
          const emailOptions: any = {
            tenantId,
            to: { email, name: userData?.firstName ? [userData.firstName, userData.lastName].filter(Boolean).join(' ') : email.split('@')[0] },
            subject: replaceTemplateVariables(subject, userData), // Also replace in subject
            htmlBody: renderedHtmlBody,
            textBody: renderedTextBody,
            messageTypeId: BULK_MESSAGE_TYPE_EMAIL,
          };

          if (isGmailSender && senderIdentity.emailAddress) {
            // Gmail sender: use Gmail email address and include userId for signature lookup
            emailOptions.fromEmail = senderIdentity.emailAddress;
            emailOptions.gmailUserId = senderIdentity.gmailUserId;
            emailOptions.userId = senderIdentity.gmailUserId;
          }
          // For system sender: don't set fromEmail (will use default noreply@hrxone.com)
          // Don't set userId/gmailUserId to prevent signature lookup

          const result = await emailProvider.sendEmail(emailOptions);

          await logMessage({
            tenantId,
            userId,
            messageTypeId: BULK_MESSAGE_TYPE_EMAIL,
            channel: 'email',
            direction: 'outbound',
            fromIdentity: 'system',
            fromUserId: initiatedByUserId,
            contentSent: renderedTextBody || subject,
            language: null,
            status: result.success ? 'sent' : 'failed',
            failureReason: result.success ? undefined : (result.errorMessage || result.errorCode),
            providerMessageId: result.providerMessageId,
            activityActorUserId: auth.uid,
            activityActorUserName: auth.userName,
            activityBulkSend: true,
            activityMetadata: { subject, messageBody: renderedTextBody },
          });

          if (result.success) {
            sent++;
          } else {
            errors.push({ userId, error: result.errorMessage || result.errorCode || 'Send failed' });
          }
        } catch (err: any) {
          logger.error(`Bulk email failed for user ${userId}`, { error: err.message });
          errors.push({ userId, error: err.message || 'Unknown error' });
        }
      }

      const failed = errors.length;
      response.status(200).json({
        success: failed === 0,
        sent,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      logger.error('bulkSendEmailApi error', { error: error.message, stack: error.stack });
      setCors(response);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  });
  }
);

/**
 * POST /bulkSendSmsApi
 * Body: { tenantId, initiatedByUserId, recipientUserIds: string[], body: string }
 */
/** Manual CORS only (same as bulkSendEmailApi). `cors: true` here + cors middleware broke browser preflight for SMS. */
export const bulkSendSmsApi = onRequest(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    /** Default 256 MiB OOM on cold start (Twilio + admin). */
    memory: '512MiB',
  },
  async (request, response) => {
  logger.info('bulkSendSmsApi invoked', {
    method: request.method,
    hasBody: !!request.body,
    bodyKeys: request.body ? Object.keys(request.body) : [],
  });
  return corsHandler(request, response, async () => {
    setCors(response);
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    try {
      if (request.method !== 'POST') {
        response.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' },
        });
        return;
      }

      const { tenantId, initiatedByUserId, recipientUserIds, body } = request.body || {};
      logger.info('bulkSendSmsApi request parsed', {
        tenantId,
        initiatedByUserId,
        recipientCount: Array.isArray(recipientUserIds) ? recipientUserIds.length : 0,
        bodyLength: body ? String(body).length : 0,
      });
      if (!tenantId || !initiatedByUserId || !Array.isArray(recipientUserIds) || body == null || body === '') {
        logger.warn('bulkSendSmsApi validation failed', {
          hasTenantId: !!tenantId,
          hasInitiatedByUserId: !!initiatedByUserId,
          isArray: Array.isArray(recipientUserIds),
          hasBody: body != null && body !== '',
        });
        response.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message: 'tenantId, initiatedByUserId, recipientUserIds, and body are required',
          },
        });
        return;
      }

      const auth = await verifyAuthAndTenant(request, response, tenantId);
      if (!auth) {
        logger.warn('bulkSendSmsApi auth failed');
        return;
      }
      logger.info('bulkSendSmsApi auth successful', { uid: auth.uid, userName: auth.userName });
      if (auth.uid !== initiatedByUserId) {
        response.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'initiatedByUserId must match authenticated user' },
        });
        return;
      }

      const smsProvider = getSmsProvider();
      const providerType = smsProvider.constructor.name;
      const fromNumber = TWILIO_MESSAGING_PHONE_NUMBER.value() || (process.env.TWILIO_MESSAGING_PHONE_NUMBER as string) || '';
      logger.info('bulkSendSmsApi starting send', {
        providerType,
        smsProviderEnv: process.env.SMS_PROVIDER || '(not set, defaulting to mock)',
        fromNumber: fromNumber ? `${fromNumber.slice(0, 4)}***` : '(not set)',
        recipientCount: recipientUserIds.length,
      });

      const errors: { userId: string; error: string }[] = [];
      let sent = 0;

      for (const userId of recipientUserIds) {
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          if (!userDoc.exists) {
            logger.warn(`bulkSendSmsApi: user ${userId} not found`);
            errors.push({ userId, error: 'User not found' });
            continue;
          }
          const userData = userDoc.data();
          const rawPhone = userData?.phoneE164 || userData?.phone;
          const phoneE164 = toE164(rawPhone);
          logger.info(`bulkSendSmsApi: processing user ${userId}`, {
            rawPhone: rawPhone ? `${rawPhone.slice(0, 4)}***` : '(none)',
            normalizedE164: phoneE164 ? `${phoneE164.slice(0, 4)}***` : '(invalid)',
          });
          if (!phoneE164) {
            errors.push({ userId, error: 'Missing or invalid phone number (need 10+ digits)' });
            continue;
          }

          const consent = await getTenantSmsConsent(tenantId, userId);
          if (consent?.smsBlockedSystem) {
            errors.push({ userId, error: 'User has opted out of SMS' });
            continue;
          }
          if (consent && consent.smsOptIn === false) {
            errors.push({ userId, error: 'User has not opted in to SMS' });
            continue;
          }

          // Replace template variables in message body
          const renderedBody = replaceTemplateVariables(String(body), userData);
          
          logger.info(`bulkSendSmsApi: calling smsProvider.sendSms for ${userId}`, {
            to: phoneE164,
            from: fromNumber ? `${fromNumber.slice(0, 4)}***` : '(not set)',
            bodyLength: renderedBody.trim().length,
            hasTemplateVars: body !== renderedBody,
          });
          const result = await smsProvider.sendSms({
            tenantId,
            to: phoneE164,
            from: fromNumber,
            body: renderedBody.trim(),
            messageTypeId: BULK_MESSAGE_TYPE_SMS,
            userId,
          });
          logger.info(`bulkSendSmsApi: smsProvider result for ${userId}`, {
            success: result.success,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            providerMessageId: result.providerMessageId,
          });

          await logMessage({
            tenantId,
            userId,
            messageTypeId: BULK_MESSAGE_TYPE_SMS,
            channel: 'sms',
            direction: 'outbound',
            fromIdentity: 'system',
            fromUserId: initiatedByUserId,
            contentSent: renderedBody.trim(),
            language: null,
            status: result.success ? 'sent' : 'failed',
            failureReason: result.success ? undefined : (result.errorMessage || result.errorCode),
            providerMessageId: result.providerMessageId,
            activityActorUserId: auth.uid,
            activityActorUserName: auth.userName,
            activityBulkSend: true,
          });

          if (result.success) {
            sent++;
          } else {
            errors.push({ userId, error: result.errorMessage || result.errorCode || 'Send failed' });
          }
        } catch (err: any) {
          logger.error(`Bulk SMS failed for user ${userId}`, { error: err.message });
          errors.push({ userId, error: err.message || 'Unknown error' });
        }
      }

      const failed = errors.length;
      logger.info('bulkSendSmsApi completed', { sent, failed, total: recipientUserIds.length, errors });
      response.status(200).json({
        success: failed === 0,
        sent,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      logger.error('bulkSendSmsApi error', { error: error.message, stack: error.stack });
      setCors(response);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  });
  }
);
