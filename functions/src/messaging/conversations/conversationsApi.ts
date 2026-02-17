/**
 * Callables for tenant-scoped conversations (worker inbox).
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { appendConversationMessage, updateConversationRollups } from './conversationsModel';

const db = admin.firestore();

function conversationRef(tenantId: string, conversationId: string) {
  return db.collection('tenants').doc(tenantId).collection('conversations').doc(conversationId);
}

/**
 * Send a message in a conversation. Caller must be a participant.
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
  if (!participantUids.includes(senderUid)) {
    throw new HttpsError('permission-denied', 'Not a participant');
  }

  const now = admin.firestore.Timestamp.now();
  const messageId = await appendConversationMessage({
    tenantId,
    conversationId,
    sender: { uid: senderUid, role: 'worker' },
    channel: 'in_app',
    body: { text: bodyText },
    visibility: 'participants',
  });

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
