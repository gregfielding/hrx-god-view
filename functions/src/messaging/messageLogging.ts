/**
 * Message Logging & Analytics Foundation
 * 
 * Unified logging system for all messages sent through the messaging framework.
 * Provides audit trail, analytics, and compliance tracking.
 * 
 * Based on: hrxone-unified-messaging-framework-v1.md Section 12
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { Channel } from './messageTypesRegistry';

const db = admin.firestore();

export type MessageDirection = 'outbound' | 'inbound';
export type MessageFromIdentity = 'system' | 'recruiter' | 'candidate' | 'ai';
export type MessageStatus = 
  | 'queued' 
  | 'sent' 
  | 'delivered' 
  | 'blocked'
  | 'failed' 
  | 'bounced'              // Email-specific: message bounced (invalid address, mailbox full, etc.)
  | 'not_sent' 
  | 'read'
  | 'suppressed_rate_limit'
  | 'suppressed_early_funnel'
  | 'suppressed_duplicate_message_guard'
  | 'suppressed_quiet_hours'
  | 'suppressed_notification_settings'
  | 'ai_draft_created'
  | 'ai_draft_approved';
export type MessageLanguage = 'en' | 'es' | null;

export interface MessageLog {
  id?: string;
  tenantId: string;                // Required even though path encodes it
  userId: string;
  threadId?: string;               // For chat/conversation threading
  messageTypeId: string;
  channel: Channel;
  direction: MessageDirection;
  fromIdentity: MessageFromIdentity;
  fromUserId?: string;              // From spec
  contentOriginal?: string;         // From spec (renamed from bodyOriginal)
  contentSent: string;              // From spec (renamed from body)
  language: MessageLanguage;
  status: MessageStatus;
  failureReason?: string;
  providerMessageId?: string;       // Twilio message SID, email message ID, etc.
  /** Outbound SMS: E.164 (or best-effort) destination. */
  recipientPhoneE164?: string;
  /** Outbound email: recipient address at send time. */
  recipientEmail?: string;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface PreferenceChangeLog {
  id?: string;
  userId: string;
  tenantId: string;
  preferenceType: 'smsOptIn' | 'smsBlockedSystem' | 'preferredLanguage' | 'channelsAllowedPerType' | 'emailEnabled' | 'pushEnabled';
  oldValue: any;
  newValue: any;
  source: 'signup' | 'settings' | 'keyword' | 'admin' | 'system';
  timestamp: admin.firestore.Timestamp | admin.firestore.FieldValue;
  changedBy?: string;              // userId if changed by admin/user
  reason?: string;                 // Optional reason for the change
}

/**
 * Log a message to the unified message log
 * 
 * Implements: HRX Firestore Collections Spec §3 - /tenants/{tenantId}/messageLogs/{logId}
 */
export async function logMessage(messageLog: Omit<MessageLog, 'id' | 'createdAt'>): Promise<string> {
  try {
    if (!messageLog.tenantId) {
      logger.error('Message log missing tenantId');
      return '';
    }
    
    const logData: Omit<MessageLog, 'id'> = {
      ...messageLog,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const logRef = await db
      .collection('tenants')
      .doc(messageLog.tenantId)
      .collection('messageLogs')
      .add(logData);
    logger.info(`Message logged: ${logRef.id} for user ${messageLog.userId} via ${messageLog.channel}`);
    return logRef.id;
  } catch (error: any) {
    logger.error('Error logging message:', error);
    // Don't throw - logging failure shouldn't break message delivery
    return '';
  }
}

/**
 * Update message log status
 */
export async function updateMessageLogStatus(
  messageLogId: string,
  status: MessageStatus,
  additionalData?: {
    providerMessageId?: string;
    failureReason?: string;
    deliveredAt?: admin.firestore.Timestamp;
    readAt?: admin.firestore.Timestamp;
    tenantId?: string;
  }
): Promise<void> {
  try {
    const updateData: any = {
      status,
    };
    
    if (additionalData?.providerMessageId) {
      updateData.providerMessageId = additionalData.providerMessageId;
    }
    
    if (additionalData?.failureReason) {
      updateData.failureReason = additionalData.failureReason;
    }
    
    // Find message log if tenantId not provided
    let tenantId = additionalData?.tenantId;
    if (!tenantId) {
      const logQuery = await db
        .collectionGroup('messageLogs')
        .where(admin.firestore.FieldPath.documentId(), '==', messageLogId)
        .limit(1)
        .get();
      
      if (!logQuery.empty) {
        const logData = logQuery.docs[0].data() as MessageLog;
        tenantId = logData.tenantId || logQuery.docs[0].ref.parent.parent?.id;
      }
    }
    
    if (!tenantId) {
      logger.error(`Could not determine tenantId for message log ${messageLogId}`);
      return;
    }
    
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageLogs')
      .doc(messageLogId)
      .update(updateData);
  } catch (error: any) {
    logger.error(`Error updating message log ${messageLogId}:`, error);
    // Don't throw - logging failure shouldn't break operations
  }
}

/**
 * Log a preference change
 */
export async function logPreferenceChange(
  preferenceChange: Omit<PreferenceChangeLog, 'id' | 'timestamp'>
): Promise<string> {
  try {
    const logData: Omit<PreferenceChangeLog, 'id'> = {
      ...preferenceChange,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const logRef = await db
      .collection('users')
      .doc(preferenceChange.userId)
      .collection('preferenceChangeLogs')
      .add(logData);
    
    logger.info(`Preference change logged: ${logRef.id} for user ${preferenceChange.userId}`);
    return logRef.id;
  } catch (error: any) {
    logger.error('Error logging preference change:', error);
    // Don't throw - logging failure shouldn't break operations
    return '';
  }
}

/**
 * Get message logs for a user
 */
export async function getUserMessageLogs(
  userId: string,
  options?: {
    limit?: number;
    startAfter?: admin.firestore.DocumentSnapshot;
    channel?: Channel;
    messageTypeId?: string;
    direction?: MessageDirection;
  }
): Promise<MessageLog[]> {
  try {
      // Get user to find tenantId
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();
      const tenantId = userData?.tenantId || 'default'; // Fallback
      
      let query: admin.firestore.Query = db
        .collection('tenants')
        .doc(tenantId)
        .collection('messageLogs')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc');
    
    if (options?.channel) {
      query = query.where('channel', '==', options.channel);
    }
    
    if (options?.messageTypeId) {
      query = query.where('messageTypeId', '==', options.messageTypeId);
    }
    
    if (options?.direction) {
      query = query.where('direction', '==', options.direction);
    }
    
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    
    if (options?.startAfter) {
      query = query.startAfter(options.startAfter);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as MessageLog[];
  } catch (error: any) {
    logger.error(`Error getting message logs for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Get message logs for a tenant (admin view)
 */
export async function getTenantMessageLogs(
  tenantId: string,
  options?: {
    limit?: number;
    startAfter?: admin.firestore.DocumentSnapshot;
    channel?: Channel;
    messageTypeId?: string;
    status?: MessageStatus;
    startDate?: admin.firestore.Timestamp;
    endDate?: admin.firestore.Timestamp;
  }
): Promise<MessageLog[]> {
  try {
      let query: admin.firestore.Query = db
        .collection('tenants')
        .doc(tenantId)
        .collection('messageLogs')
        .orderBy('createdAt', 'desc');
    
    if (options?.channel) {
      query = query.where('channel', '==', options.channel);
    }
    
    if (options?.messageTypeId) {
      query = query.where('messageTypeId', '==', options.messageTypeId);
    }
    
    if (options?.status) {
      query = query.where('status', '==', options.status);
    }
    
    if (options?.startDate) {
      query = query.where('createdAt', '>=', options.startDate);
    }
    
    if (options?.endDate) {
      query = query.where('createdAt', '<=', options.endDate);
    }
    
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    
    if (options?.startAfter) {
      query = query.startAfter(options.startAfter);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as MessageLog[];
  } catch (error: any) {
    logger.error(`Error getting message logs for tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Get analytics for a tenant
 */
export interface MessageAnalytics {
  totalMessages: number;
  messagesByChannel: Record<Channel, number>;
  messagesByStatus: Record<MessageStatus, number>;
  messagesByType: Record<string, number>;
  deliveryRate: number;
  failureRate: number;
  optOutRate?: number;
  period: {
    start: admin.firestore.Timestamp;
    end: admin.firestore.Timestamp;
  };
}

export async function getMessageAnalytics(
  tenantId: string,
  startDate: admin.firestore.Timestamp,
  endDate: admin.firestore.Timestamp
): Promise<MessageAnalytics> {
  try {
    const logs = await getTenantMessageLogs(tenantId, {
      startDate,
      endDate,
    });
    
    const analytics: MessageAnalytics = {
      totalMessages: logs.length,
      messagesByChannel: {
        sms: 0,
        email: 0,
        push: 0,
      },
      messagesByStatus: {
        queued: 0,
        sent: 0,
        delivered: 0,
        blocked: 0,
        failed: 0,
        bounced: 0,
        not_sent: 0,
        read: 0,
        suppressed_rate_limit: 0,
        suppressed_early_funnel: 0,
        suppressed_duplicate_message_guard: 0,
        suppressed_quiet_hours: 0,
        suppressed_notification_settings: 0,
        ai_draft_created: 0,
        ai_draft_approved: 0,
      },
      messagesByType: {},
      deliveryRate: 0,
      failureRate: 0,
      period: {
        start: startDate,
        end: endDate,
      },
    };
    
    let deliveredCount = 0;
    let failedCount = 0;
    
    logs.forEach(log => {
      // Count by channel
      analytics.messagesByChannel[log.channel] = (analytics.messagesByChannel[log.channel] || 0) + 1;
      
      // Count by status
      analytics.messagesByStatus[log.status] = (analytics.messagesByStatus[log.status] || 0) + 1;
      
      // Count by type
      analytics.messagesByType[log.messageTypeId] = (analytics.messagesByType[log.messageTypeId] || 0) + 1;
      
      // Track delivery/failure
      if (log.status === 'delivered' || log.status === 'read') {
        deliveredCount++;
      }
      if (log.status === 'failed' || log.status === 'bounced') {
        failedCount++;
      }
    });
    
    // Calculate rates
    if (logs.length > 0) {
      analytics.deliveryRate = deliveredCount / logs.length;
      analytics.failureRate = failedCount / logs.length;
    }
    
    return analytics;
  } catch (error: any) {
    logger.error(`Error getting analytics for tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Get delivery rate for a specific message type
 */
export async function getMessageTypeDeliveryRate(
  tenantId: string,
  messageTypeId: string,
  startDate: admin.firestore.Timestamp,
  endDate: admin.firestore.Timestamp
): Promise<number> {
  try {
    const logs = await getTenantMessageLogs(tenantId, {
      messageTypeId,
      startDate,
      endDate,
    });
    
    if (logs.length === 0) {
      return 0;
    }
    
    const deliveredCount = logs.filter(
      log => log.status === 'delivered' || log.status === 'read'
    ).length;
    
    return deliveredCount / logs.length;
  } catch (error: any) {
    logger.error(`Error getting delivery rate for ${messageTypeId}:`, error);
    throw error;
  }
}

