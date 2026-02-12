/**
 * Unified Worker Notifications + Inbox — Firestore schema types
 *
 * Source of truth for worker-facing notifications and threads.
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md
 */

import type { Timestamp } from 'firebase/firestore';

export type NotificationType =
  | 'assignment'
  | 'application'
  | 'document'
  | 'shift'
  | 'payroll'
  | 'general'
  | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type NotificationSource = 'system' | 'recruiter' | 'automation';

export type NotificationChannel = 'push' | 'sms' | 'email' | 'web';

export interface WorkerNotification {
  uid: string;
  tenantId: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  createdAt: Timestamp;
  readAt: Timestamp | null;
  source: NotificationSource;
  channel: NotificationChannel;
  ctaLabel?: string;
  ctaUrl?: string;
  threadId?: string;
  entity?: { kind: string; id: string };
}

export type ThreadTopic = 'recruiting' | 'support' | 'scheduling' | 'general' | string;

export interface WorkerThread {
  tenantId: string;
  participantUids: string[];
  participantTypes?: Record<string, 'worker' | 'recruiter' | 'system'>;
  topic: ThreadTopic;
  subject?: string;
  createdAt: Timestamp;
  lastMessageAt: Timestamp;
  lastMessagePreview: string;
  unreadCountByUid: Record<string, number>;
  closedAt?: Timestamp | null;
  relatedEntity?: { kind: string; id: string };
}

export type MessageDeliveryChannel = 'push' | 'sms' | 'email' | 'web';

export interface WorkerThreadMessage {
  tenantId: string;
  threadId: string;
  senderUid: string;
  senderType?: 'system' | 'user';
  senderDisplayName?: string;
  body: string;
  createdAt: Timestamp;
  deliveryChannels: MessageDeliveryChannel[];
  status?: {
    push?: 'sent' | 'failed';
    sms?: 'sent' | 'failed';
    email?: 'sent' | 'failed';
  };
  attachments?: Array<{ type: 'url' | 'file'; name?: string; url: string }>;
  metadata?: Record<string, unknown>;
}

export type DeviceTokenPlatform = 'ios' | 'android' | 'web';

export interface DeviceTokenDoc {
  token: string;
  platform: DeviceTokenPlatform;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  isActive: boolean;
  appVersion?: string;
}
