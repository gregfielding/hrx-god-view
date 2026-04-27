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
  | 'system'
  | 'opportunity'
  | 'profile_action'
  | 'support';

export type NotificationCategory = 'assignments' | 'applications' | 'opportunities' | 'profile' | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type NotificationSource = 'system' | 'recruiter' | 'automation';

export type NotificationChannel = 'push' | 'sms' | 'email' | 'web';

export interface WorkerNotificationRouting {
  deepLink?: string | null;
  ctaUrl?: string | null;
  entityId?: string | null;
  threadId?: string | null;
}

export interface WorkerNotificationDeliveryChannelStatus {
  status: 'written' | 'queued' | 'sent' | 'failed';
  writtenAt?: Timestamp;
  queuedAt?: Timestamp;
  attemptedAt?: Timestamp;
  sentAt?: Timestamp;
  error?: string;
}

export interface WorkerNotificationDeliveryStatus {
  inbox?: WorkerNotificationDeliveryChannelStatus;
  push?: WorkerNotificationDeliveryChannelStatus;
  sms?: WorkerNotificationDeliveryChannelStatus;
}

export interface WorkerNotification {
  uid: string;
  tenantId: string;
  type: NotificationType;
  /** Inbox filter category (assignments, applications, opportunities, profile, system). */
  category?: NotificationCategory;
  title: string;
  body: string;
  severity: NotificationSeverity;
  createdAt: Timestamp;
  readAt: Timestamp | null;
  source: NotificationSource;
  channel: NotificationChannel;
  /** Preferred link for tap/click; push payload and Inbox use this to open the correct screen. */
  deepLink?: string;
  /** Entity id (e.g. assignmentId, jobId) for the notification. */
  entityId?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  threadId?: string;
  entity?: { kind: string; id: string };
  metadata?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
  schemaVersion?: number;
  routing?: WorkerNotificationRouting;
  delivery?: WorkerNotificationDeliveryStatus;
  deliveryStatus?: 'inbox_written' | 'queued' | 'sent' | 'failed';
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
