import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { CALLABLE_BROWSER_CORS } from './integrations/callableBrowserCors';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from './messaging/twilioSecrets';
import { sendWorkerMessageInternal } from './twilio';
import { buildWorkerProfileUrl } from './utils/workerUrls';

function getMaxSecurityLevel(userData: any): number {
  const levels: number[] = [];
  const topLevel = Number.parseInt(String(userData?.securityLevel ?? '0'), 10);
  if (Number.isFinite(topLevel)) levels.push(topLevel);

  const tenantIds = userData?.tenantIds;
  if (tenantIds && typeof tenantIds === 'object') {
    Object.values(tenantIds).forEach((entry: any) => {
      const level = Number.parseInt(String(entry?.securityLevel ?? '0'), 10);
      if (Number.isFinite(level)) levels.push(level);
    });
  }

  return levels.length > 0 ? Math.max(...levels) : 0;
}

export const sendProfileUpdateReminder = onCall(
  {
    /** Same explicit origins as other web callables — `cors: true` can omit custom domains like hrxone.com. */
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request) => {
  const actorUid = request.auth?.uid;
  const targetUid = String(request.data?.uid || '').trim();
  const tenantId = String(request.data?.tenantId || '').trim();

  if (!actorUid) throw new HttpsError('unauthenticated', 'You must be signed in.');
  if (!targetUid) throw new HttpsError('invalid-argument', 'Missing uid.');
  if (!tenantId) throw new HttpsError('invalid-argument', 'Missing tenantId.');

  const db = admin.firestore();
  const [actorSnap, targetSnap] = await Promise.all([
    db.collection('users').doc(actorUid).get(),
    db.collection('users').doc(targetUid).get(),
  ]);

  if (!targetSnap.exists) throw new HttpsError('not-found', 'Target user not found.');

  const actorLevel = getMaxSecurityLevel(actorSnap.exists ? actorSnap.data() : {});
  if (actorLevel < 5 || actorLevel > 7) {
    throw new HttpsError('permission-denied', 'Only security levels 5, 6, and 7 can send profile reminders.');
  }

  const targetData = targetSnap.data() || {};
  const phoneDigits = String(targetData.phone || '').replace(/\D/g, '');
  const phoneE164 = targetData.phoneE164 || (phoneDigits.length === 10 ? `+1${phoneDigits}` : '');
  if (!phoneE164) {
    throw new HttpsError('failed-precondition', 'User does not have a valid phone number.');
  }

  const firstName = String(targetData.firstName || targetData.displayName || 'there').trim().split(/\s+/)[0] || 'there';
  const preferredLanguage = String(targetData.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
  const profileUrl = buildWorkerProfileUrl();

  const englishMessage =
    `Hi ${firstName}, we are trying to get you hired for a job but your profile is still not complete. ` +
    `Can you please update your qualifications here ${profileUrl} Thank you - C1 Staffing`;
  const spanishMessage =
    `Hola ${firstName}, estamos tratando de ayudarte a conseguir trabajo, pero tu perfil todavia no esta completo. ` +
    `Puedes actualizar tus calificaciones aqui ${profileUrl} Gracias - C1 Staffing`;
  const messageBody = preferredLanguage === 'es' ? spanishMessage : englishMessage;

  const sentAt = admin.firestore.Timestamp.now();

  const smsResult = await sendWorkerMessageInternal(phoneE164, messageBody, {
    tenantId,
    userId: targetUid,
    source: 'recruiter',
    sourceId: actorUid,
    messageTypeId: 'profile_update_reminder',
    systemContext: true,
  });

  if (!smsResult.success) {
    throw new HttpsError('internal', smsResult.error || 'Failed to send profile update reminder.');
  }

  await Promise.all([
    db.collection('users').doc(targetUid).update({
      profileUpdateReminderLastSentAt: sentAt,
      profileUpdateReminderLastSentBy: actorUid,
      updatedAt: sentAt,
    }),
    db.collection('users').doc(targetUid).collection('activityLogs').add({
      action: 'Profile Update Reminder',
      actionType: 'sms_sent',
      description: `Profile update reminder sent to ${firstName} via SMS`,
      severity: 'medium',
      source: 'system',
      metadata: {
        reminderType: 'profile_update',
        sentByUserId: actorUid,
        tenantId,
        preferredLanguage,
        phoneE164,
      },
      timestamp: sentAt,
      createdAt: sentAt,
    }),
  ]);

  return {
    success: true,
    sentAt: sentAt.toDate().toISOString(),
  };
  },
);
