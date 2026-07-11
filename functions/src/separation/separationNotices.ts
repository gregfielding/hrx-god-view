/**
 * Worker-facing separation notices (T5 — Greg: email + SMS, professional
 * tone). Fired best-effort at the end of separateWorker; a send failure
 * never fails the separation itself (the audit record notes what landed).
 *
 * Channels:
 *   - SMS   via the outbound queue (same consent/dedupe machinery as every
 *           other system text; dedupe key prevents double-sends on retry)
 *   - Email via the tenant email provider
 *   - In-app + push via sendNotificationAndPush
 *
 * Copy is deliberately neutral: it states the employment end and the
 * final-pay expectation, and points at a human. It never mentions reason
 * categories or rehire eligibility.
 */

import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { createOutboundRequest } from '../messaging/smsOutboundQueue';
import { getOrCreateThreadForUser } from '../messaging/twoWayMessaging';
import { getEmailProvider } from '../messaging/emailService';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';

export interface SeparationNoticeInput {
  tenantId: string;
  userId: string;
  entityName: string;
  /** ISO date — worker's last day. */
  lastDay: string;
  requestedByUid: string;
}

export interface SeparationNoticeResult {
  sms: 'sent' | 'skipped' | 'failed';
  email: 'sent' | 'skipped' | 'failed';
  push: 'sent' | 'failed';
}

function noticeBodies(args: { firstName: string; entityName: string; lastDay: string }) {
  const { firstName, entityName, lastDay } = args;
  const smsBody =
    `Hi ${firstName}, this is C1 Staffing. Your employment with ${entityName} ` +
    `ends effective ${lastDay}. Any final wages owed will be paid per your ` +
    `state's requirements. Questions? Reply here or call your recruiter. ` +
    `Thank you for your work with us.`;
  const subject = `Your employment with ${entityName} — separation notice`;
  const textBody =
    `Hi ${firstName},\n\n` +
    `This letter confirms that your employment with ${entityName} ends effective ${lastDay}.\n\n` +
    `Any final wages owed to you will be paid in accordance with applicable state law. ` +
    `Your pay stubs and tax documents remain available through your Everee account.\n\n` +
    `If you have any questions about your final pay or this notice, please contact your ` +
    `recruiter or reply to this email.\n\n` +
    `Thank you for the work you've done with us.\n\n` +
    `C1 Staffing`;
  const htmlBody = textBody
    .split('\n\n')
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return { smsBody, subject, textBody, htmlBody };
}

export async function sendSeparationNotices(
  input: SeparationNoticeInput,
): Promise<SeparationNoticeResult> {
  const db = admin.firestore();
  const result: SeparationNoticeResult = { sms: 'skipped', email: 'skipped', push: 'failed' };

  const userSnap = await db.doc(`users/${input.userId}`).get();
  const u = userSnap.data() || {};
  const firstName = String(u.firstName || '').trim() || 'there';
  const phoneE164 = String(u.phoneE164 || u.phone || '').trim();
  const email = String(u.email || '').trim();
  const { smsBody, subject, textBody, htmlBody } = noticeBodies({
    firstName,
    entityName: input.entityName,
    lastDay: input.lastDay,
  });

  // SMS — through the outbound queue so consent/opt-out and thread mapping
  // behave exactly like every other system text.
  if (phoneE164) {
    try {
      const twilioNumber = (process.env.TWILIO_MESSAGING_PHONE_NUMBER || '').trim();
      let threadId: string | undefined;
      if (twilioNumber) {
        try {
          threadId = await getOrCreateThreadForUser({
            tenantId: input.tenantId,
            userId: input.userId,
            phoneE164,
            twilioNumber,
            primaryRecruiterId: null,
          });
        } catch {
          /* thread mapping is best-effort */
        }
      }
      await createOutboundRequest({
        tenantId: input.tenantId,
        toPhoneE164: phoneE164,
        ...(twilioNumber ? { fromPhoneE164: twilioNumber } : {}),
        ...(threadId ? { threadId } : {}),
        recipientUserId: input.userId,
        body: smsBody,
        messageTypeId: 'separation_notice',
        source: 'automation',
        requestedByUid: input.requestedByUid,
        dedupeKey: `separation:${input.tenantId}:${input.userId}:${input.entityName}:${input.lastDay}`,
        dedupeWindowHours: 168,
      });
      result.sms = 'sent';
    } catch (err) {
      result.sms = 'failed';
      logger.warn('[separationNotices] sms failed', {
        userId: input.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Email.
  if (email) {
    try {
      await getEmailProvider().sendEmail({
        tenantId: input.tenantId,
        to: { email, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined },
        subject,
        htmlBody,
        textBody,
        messageTypeId: 'separation_notice',
        userId: input.userId,
      });
      result.email = 'sent';
    } catch (err) {
      result.email = 'failed';
      logger.warn('[separationNotices] email failed', {
        userId: input.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // In-app + push.
  try {
    await sendNotificationAndPush({
      uid: input.userId,
      tenantId: input.tenantId,
      title: 'Employment update',
      body: `Your employment with ${input.entityName} ends effective ${input.lastDay}. Check your email for details.`,
      severity: 'warning',
      source: 'system',
    });
    result.push = 'sent';
  } catch (err) {
    logger.warn('[separationNotices] push failed', {
      userId: input.userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
