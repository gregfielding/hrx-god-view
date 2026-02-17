/**
 * Callables for tenant-scoped conversations (worker inbox + admin Messages).
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { appendConversationMessage, updateConversationRollups } from './conversationsModel';
import { createOutboundRequest, updateCanonicalMessageDelivery } from '../smsOutboundQueue';

const db = admin.firestore();

function conversationRef(tenantId: string, conversationId: string) {
  return db.collection('tenants').doc(tenantId).collection('conversations').doc(conversationId);
}

function isInternalForTenant(user: admin.firestore.DocumentData | undefined, tenantId: string): boolean {
  if (!user) return false;
  const u = user as Record<string, unknown>;
  if (u.role === 'HRX') return true;
  const sl = String(u.securityLevel ?? '');
  if (['5', '6', '7', 'Admin'].includes(sl)) return true;
  const tenantIds = u.tenantIds;
  if (tenantIds && typeof tenantIds === 'object' && tenantId in tenantIds) {
    const t = (tenantIds as Record<string, { securityLevel?: string }>)[tenantId];
    if (t && ['5', '6', '7', 'Admin'].includes(String(t.securityLevel ?? ''))) return true;
  }
  return false;
}

function isAssignedToTenant(user: admin.firestore.DocumentData | undefined, tenantId: string): boolean {
  if (!user) return false;
  const u = user as Record<string, unknown>;
  if (u.tenantId === tenantId || u.activeTenantId === tenantId) return true;
  const tenantIds = u.tenantIds;
  if (Array.isArray(tenantIds) && tenantIds.includes(tenantId)) return true;
  if (tenantIds && typeof tenantIds === 'object' && tenantId in tenantIds) return true;
  return false;
}

/**
 * Send a message in a conversation. Caller must be a participant or internal (admin) for the tenant.
 */
export const sendConversationMessage = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const senderUid = request.auth.uid;
  const { tenantId, conversationId, text } = request.data as {
    tenantId: string;
    conversationId: string;
    text?: string;
  };
  const bodyText = (text ?? (request.data as any).body ?? '').trim();
  if (!tenantId || !conversationId || !bodyText) {
    throw new HttpsError('invalid-argument', 'tenantId, conversationId, and text (or body) are required');
  }

  const convRef = conversationRef(tenantId, conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) throw new HttpsError('not-found', 'Conversation not found');
  const conv = convSnap.data()!;
  const participantUids = (conv.participantUids as string[]) ?? [];

  let senderRole: 'worker' | 'recruiter' | 'admin' = 'worker';
  let channel: 'in_app' | 'sms' = 'in_app';

  if (participantUids.includes(senderUid)) {
    senderRole = 'worker';
    channel = 'in_app';
  } else {
    const userSnap = await db.collection('users').doc(senderUid).get();
    const user = userSnap.exists ? userSnap.data() : undefined;
    if (isInternalForTenant(user, tenantId) && isAssignedToTenant(user, tenantId)) {
      senderRole = 'recruiter';
      channel = 'sms';
    } else {
      throw new HttpsError('permission-denied', 'Not a participant or internal for this tenant');
    }
  }

  const now = admin.firestore.Timestamp.now();
  // messageId is the Firestore doc id (conversations/{id}/messages/{messageId}); stable and returned for sendSmsFromConversation linkage
  const messageId = await appendConversationMessage({
    tenantId,
    conversationId,
    sender: { uid: senderUid, role: senderRole },
    channel,
    body: { text: bodyText },
    visibility: 'participants',
    direction: senderRole === 'worker' ? 'inbound' : 'outbound',
  }) as string;

  const unreadByUid = (conv.unreadByUid as Record<string, number>) ?? {};
  participantUids.forEach((uid) => {
    if (uid !== senderUid) unreadByUid[uid] = (unreadByUid[uid] ?? 0) + 1;
  });
  await updateConversationRollups({
    tenantId,
    conversationId,
    lastMessageAt: now,
    lastMessagePreview: bodyText.slice(0, 100),
    unreadByUid,
  });

  logger.info('Conversation message sent', { conversationId, messageId, senderUid });
  return { messageId };
});

/**
 * Mark a conversation as read for the current user (clear unread count).
 */
export const markConversationRead = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const uid = request.auth.uid;
  const { tenantId, conversationId } = request.data as { tenantId: string; conversationId: string };
  if (!tenantId || !conversationId) {
    throw new HttpsError('invalid-argument', 'tenantId and conversationId are required');
  }

  const convRef = conversationRef(tenantId, conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) throw new HttpsError('not-found', 'Conversation not found');
  const conv = convSnap.data()!;
  const participantUids = (conv.participantUids as string[]) ?? [];
  if (!participantUids.includes(uid)) {
    throw new HttpsError('permission-denied', 'Not a participant');
  }

  const unreadByUid = (conv.unreadByUid as Record<string, number>) ?? {};
  unreadByUid[uid] = 0;
  await convRef.update({ unreadByUid });

  return {};
});

/**
 * Enqueue outbound SMS from a canonical conversation (admin Messages send).
 * Caller must be internal for tenant. Reads conversation channelEndpoints.sms and creates
 * tenants/{tenantId}/smsOutboundRequests doc; worker processes and sends via Twilio.
 */
export const sendSmsFromConversation = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const senderUid = request.auth.uid;
  const { tenantId, conversationId, text, conversationMessageId } = request.data as {
    tenantId: string;
    conversationId: string;
    text: string;
    conversationMessageId?: string;
  };
  const bodyText = (text ?? '').trim();
  if (!tenantId || !conversationId || !bodyText) {
    throw new HttpsError('invalid-argument', 'tenantId, conversationId, and text are required');
  }

  const userSnap = await db.collection('users').doc(senderUid).get();
  const user = userSnap.exists ? userSnap.data() : undefined;
  if (!isInternalForTenant(user, tenantId) || !isAssignedToTenant(user, tenantId)) {
    throw new HttpsError('permission-denied', 'Not authorized for this tenant');
  }

  const convRef = conversationRef(tenantId, conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) throw new HttpsError('not-found', 'Conversation not found');
  const conv = convSnap.data()!;
  const sms = (conv.channelEndpoints as { sms?: { workerPhoneE164?: string; twilioNumberE164?: string } } | undefined)?.sms;
  if (!sms?.workerPhoneE164 || !sms?.twilioNumberE164) {
    throw new HttpsError('failed-precondition', 'Conversation has no SMS endpoints');
  }

  const requestId = await createOutboundRequest({
    tenantId,
    conversationId,
    conversationMessageId,
    toPhoneE164: sms.workerPhoneE164,
    fromPhoneE164: sms.twilioNumberE164,
    body: bodyText,
    source: 'manual',
    requestedByUid: senderUid,
  });

  if (conversationMessageId) {
    await updateCanonicalMessageDelivery({
      tenantId,
      conversationId,
      conversationMessageId,
      patch: { delivery: { status: 'queued' } },
    });
  }

  logger.info('sendSmsFromConversation: enqueued', { conversationId, requestId });
  return { success: true, requestId };
});
