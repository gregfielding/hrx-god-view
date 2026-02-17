/**
 * Canonical conversation types (tenant-scoped inbox).
 * Spec: HRX Messaging & Notifications — Cursor Build Spec (v1) §3
 */

import type { Timestamp } from 'firebase/firestore';

export type ConversationType = 'recruiter' | 'support' | 'system' | 'broadcast_response';
export type ConversationStatus = 'open' | 'closed' | 'pending_worker' | 'pending_internal';
export type ParticipantRole = 'worker' | 'recruiter' | 'admin' | 'ai' | 'system';
export type MessageChannel = 'in_app' | 'sms' | 'email' | 'push';
export type MessageVisibility = 'participants' | 'internal_only';

export interface ConversationParticipant {
  uid: string;
  role: ParticipantRole;
  displayName?: string;
}

export interface ConversationTopic {
  entityType: 'application' | 'assignment' | 'support' | 'general';
  entityId?: string;
  label?: string;
}

export interface ChannelEndpoints {
  sms?: {
    workerPhoneE164: string;
    twilioNumberE164: string;
  };
  email?: {
    workerEmail: string;
    fromAddress?: string;
  };
}

export interface Conversation {
  tenantId: string;
  type: ConversationType;
  status: ConversationStatus;
  participantUids: string[];
  participants?: ConversationParticipant[];
  assignedToUid: string | null;
  topic?: ConversationTopic;
  lastMessageAt: Timestamp;
  lastMessagePreview: string;
  unreadByUid: Record<string, number>;
  createdAt: Timestamp;
  createdByUid: string | 'system';
  channelEndpoints?: ChannelEndpoints;
  id?: string;
}

export interface MessageSender {
  uid?: string;
  role: ParticipantRole;
}

export interface MessageBody {
  text: string;
  html?: string;
}

export interface MessageProvider {
  name: 'twilio' | 'fcm' | 'sendgrid' | 'gmail';
  messageId?: string;
  status?: string;
  errorCode?: string;
  deliveredAt?: Timestamp;
}

export type MessageDeliveryStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'delivered'
  | 'undelivered';

export interface MessageDelivery {
  status: MessageDeliveryStatus;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  deliveredAt?: Timestamp;
  errorCode?: string;
  errorMessage?: string;
}

export interface ConversationMessage {
  tenantId: string;
  conversationId: string;
  createdAt: Timestamp;
  sender: MessageSender;
  body: MessageBody;
  channel: MessageChannel;
  direction?: 'inbound' | 'outbound';
  visibility: MessageVisibility;
  provider?: MessageProvider;
  delivery?: MessageDelivery;
  id?: string;
}
