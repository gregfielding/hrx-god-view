/**
 * Canonical conversation model (tenant-scoped).
 * tenants/{tenantId}/conversations/{conversationId}/messages/{messageId}
 */

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const db = admin.firestore();

function conversationsRef(tenantId: string) {
  return db.collection('tenants').doc(tenantId).collection('conversations');
}

function messagesRef(tenantId: string, conversationId: string) {
  return conversationsRef(tenantId).doc(conversationId).collection('messages');
}

/** Topic for support conversations (SMS bridge). */
export interface ConversationTopic {
  type: string;
  label: string;
}

/**
 * Find or create a conversation for SMS (worker phone + Twilio number).
 * Idempotent: same (tenantId, workerUid, workerPhoneE164, twilioNumberE164) returns same conversation.
 */
export async function findOrCreateConversationForSms(params: {
  tenantId: string;
  workerUid: string;
  workerPhoneE164: string;
  twilioNumberE164: string;
  topic: ConversationTopic;
}): Promise<{ conversationId: string; ref: admin.firestore.DocumentReference }> {
  const ref = conversationsRef(params.tenantId);
  const existing = await ref
    .where('channelEndpoints.sms.workerPhoneE164', '==', params.workerPhoneE164)
    .where('channelEndpoints.sms.twilioNumberE164', '==', params.twilioNumberE164)
    .where('status', '==', 'open')
    .orderBy('lastMessageAt', 'desc')
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    return { conversationId: doc.id, ref: doc.ref };
  }

  const newRef = ref.doc();
  const now = FieldValue.serverTimestamp();
  await newRef.create({
    tenantId: params.tenantId,
    participantUids: [params.workerUid],
    type: 'support',
    status: 'open',
    topic: params.topic,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: '',
    unreadByUid: {},
    channelEndpoints: {
      sms: {
        workerPhoneE164: params.workerPhoneE164,
        twilioNumberE164: params.twilioNumberE164,
        provider: 'twilio',
      },
    },
  });
  return { conversationId: newRef.id, ref: newRef };
}

type AppendMessageParams = {
  tenantId: string;
  conversationId: string;
  sender: { uid?: string; role: string };
  channel: 'in_app' | 'sms' | 'email' | 'push';
  body: { text: string; html?: string };
  visibility?: 'participants' | 'internal_only';
  direction?: 'inbound' | 'outbound';
  provider?: { name: string; messageId?: string; status?: string };
  createdAt?: admin.firestore.FieldValue;
};

/**
 * Append a message to a conversation. Caller must ensure participant access.
 * When messageId is provided (e.g. tw_MessageSid), uses create() for idempotency; returns { created }.
 * When messageId is omitted, uses set() with auto ID; returns the new doc id (string).
 */
export async function appendConversationMessage(
  params: AppendMessageParams & { messageId: string }
): Promise<{ created: boolean }>;
export async function appendConversationMessage(params: AppendMessageParams): Promise<string>;
export async function appendConversationMessage(params: AppendMessageParams & { messageId?: string }): Promise<string | { created: boolean }> {
  const now = params.createdAt ?? FieldValue.serverTimestamp();
  const payload = {
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    createdAt: now,
    sender: params.sender,
    body: params.body,
    channel: params.channel,
    direction: params.direction ?? null,
    visibility: params.visibility ?? 'participants',
    provider: params.provider ?? null,
  };

  if (params.messageId) {
    const docRef = messagesRef(params.tenantId, params.conversationId).doc(params.messageId);
    try {
      await docRef.create(payload);
      return { created: true };
    } catch (err: any) {
      if (err?.code === 6) {
        // ALREADY_EXISTS - Twilio retry
        return { created: false };
      }
      throw err;
    }
  }

  const docRef = messagesRef(params.tenantId, params.conversationId).doc();
  await docRef.set({ ...payload, createdAt: now });
  return docRef.id;
}

/**
 * Update conversation rollups after a new message.
 * Can be called with explicit fields or with lastMessageText + senderUid (for bridge).
 */
export async function updateConversationRollups(params: {
  tenantId: string;
  conversationId: string;
  lastMessageAt?: admin.firestore.FieldValue | Timestamp;
  lastMessagePreview?: string;
  unreadByUid?: Record<string, number>;
  lastMessageText?: string;
  senderUid?: string;
  /** Optional: for inbox display and filtering (bridge path). */
  lastMessageDirection?: 'inbound' | 'outbound';
  /** Optional: for inbox display and filtering (bridge path). */
  lastMessageChannel?: 'sms' | 'in_app' | 'email' | 'push';
}): Promise<void> {
  const convRef = conversationsRef(params.tenantId).doc(params.conversationId);
  if (params.lastMessageText != null && params.senderUid != null) {
    const preview = params.lastMessageText.slice(0, 180);
    // Sender is not "unread". Other participants (e.g. internal assignee) can be incremented in a follow-up when assignedToUid / internal participants exist.
    const updateData: Record<string, unknown> = {
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      [`unreadByUid.${params.senderUid}`]: 0,
    };
    if (params.lastMessageDirection != null) updateData.lastMessageDirection = params.lastMessageDirection;
    if (params.lastMessageChannel != null) updateData.lastMessageChannel = params.lastMessageChannel;
    await convRef.update(updateData);
    return;
  }
  if (
    params.lastMessageAt != null &&
    params.lastMessagePreview != null &&
    params.unreadByUid != null
  ) {
    await convRef.update({
      lastMessageAt: params.lastMessageAt,
      lastMessagePreview: params.lastMessagePreview,
      unreadByUid: params.unreadByUid,
    });
    return;
  }
  throw new Error('updateConversationRollups: provide either (lastMessageText, senderUid) or (lastMessageAt, lastMessagePreview, unreadByUid)');
}
