/**
 * Bulk Send API
 *
 * HTTP endpoints for bulk email (SendGrid) and bulk SMS (Twilio) using system sender only.
 * Each sent message is logged to messageLogs and to the recipient's activityLogs.
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

const db = admin.firestore();

const BULK_MESSAGE_TYPE_EMAIL = 'bulk_direct_email';
const BULK_MESSAGE_TYPE_SMS = 'bulk_direct_sms';

/** CORS middleware so browser preflight (OPTIONS) from localhost/production gets proper headers. */
const corsHandler = cors({ origin: true });

function setCors(response: any) {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    if (!roles[tenantId]) {
      response.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this tenant' },
      });
      return null;
    }
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
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
export const bulkSendEmailApi = onRequest(async (request, response) => {
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

      const { tenantId, initiatedByUserId, recipientUserIds, subject, bodyHtml, bodyPlain } = request.body || {};
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

      const systemIdentity = await resolveSenderIdentity(tenantId, {});
      const emailProvider = getEmailProvider(systemIdentity);
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

          const result = await emailProvider.sendEmail({
            tenantId,
            to: { email, name: userData?.firstName ? [userData.firstName, userData.lastName].filter(Boolean).join(' ') : email.split('@')[0] },
            subject,
            htmlBody: bodyHtml,
            textBody,
            messageTypeId: BULK_MESSAGE_TYPE_EMAIL,
            userId: initiatedByUserId,
          });

          const status = result.success ? 'sent' : 'failed';
          const messageLogId = await logMessage({
            tenantId,
            userId,
            messageTypeId: BULK_MESSAGE_TYPE_EMAIL,
            channel: 'email',
            direction: 'outbound',
            fromIdentity: 'system',
            fromUserId: initiatedByUserId,
            contentSent: textBody || subject,
            language: null,
            status: result.success ? 'sent' : 'failed',
            failureReason: result.success ? undefined : (result.errorMessage || result.errorCode),
            providerMessageId: result.providerMessageId,
          });

          if (result.success) {
            sent++;
            try {
              await db.collection('users').doc(userId).collection('activityLogs').add({
                userId: auth.uid,
                userName: auth.userName,
                action: 'Bulk email sent',
                actionType: 'email_sent',
                description: subject,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                metadata: { messageLogId, channel: 'email', subject },
                severity: 'low',
                source: 'system',
              });
            } catch (activityErr: any) {
              logger.warn(`Failed to write activityLog for ${userId}`, { error: activityErr.message });
            }
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
});

/**
 * POST /bulkSendSmsApi
 * Body: { tenantId, initiatedByUserId, recipientUserIds: string[], body: string }
 */
export const bulkSendSmsApi = onRequest(async (request, response) => {
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
      if (!tenantId || !initiatedByUserId || !Array.isArray(recipientUserIds) || body == null || body === '') {
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
      if (!auth) return;
      if (auth.uid !== initiatedByUserId) {
        response.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'initiatedByUserId must match authenticated user' },
        });
        return;
      }

      const smsProvider = getSmsProvider();
      const fromNumber =
        (process.env.TWILIO_MESSAGING_PHONE_NUMBER as string) || '';

      const errors: { userId: string; error: string }[] = [];
      let sent = 0;

      for (const userId of recipientUserIds) {
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          const userData = userDoc.data();
          const phoneE164 = userData?.phoneE164 || userData?.phone;
          if (!phoneE164 || typeof phoneE164 !== 'string') {
            errors.push({ userId, error: 'Missing phone number' });
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

          const result = await smsProvider.sendSms({
            tenantId,
            to: phoneE164,
            from: fromNumber,
            body: String(body).trim(),
            messageTypeId: BULK_MESSAGE_TYPE_SMS,
            userId,
          });

          const messageLogId = await logMessage({
            tenantId,
            userId,
            messageTypeId: BULK_MESSAGE_TYPE_SMS,
            channel: 'sms',
            direction: 'outbound',
            fromIdentity: 'system',
            fromUserId: initiatedByUserId,
            contentSent: String(body).trim(),
            language: null,
            status: result.success ? 'sent' : 'failed',
            failureReason: result.success ? undefined : (result.errorMessage || result.errorCode),
            providerMessageId: result.providerMessageId,
          });

          if (result.success) {
            sent++;
            try {
              await db.collection('users').doc(userId).collection('activityLogs').add({
                userId: auth.uid,
                userName: auth.userName,
                action: 'Bulk SMS sent',
                actionType: 'sms_sent',
                description: String(body).trim().slice(0, 50) + (String(body).length > 50 ? '…' : ''),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                metadata: { messageLogId, channel: 'sms' },
                severity: 'low',
                source: 'system',
              });
            } catch (activityErr: any) {
              logger.warn(`Failed to write activityLog for ${userId}`, { error: activityErr.message });
            }
          } else {
            errors.push({ userId, error: result.errorMessage || result.errorCode || 'Send failed' });
          }
        } catch (err: any) {
          logger.error(`Bulk SMS failed for user ${userId}`, { error: err.message });
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
      logger.error('bulkSendSmsApi error', { error: error.message, stack: error.stack });
      setCors(response);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  });
});
