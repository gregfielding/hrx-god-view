/**
 * Tenant-Scoped Notification Settings
 * 
 * Manages notification preferences in tenant-scoped collections.
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 3 Tenant-Scoped Consent & Notification Settings
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Notification Settings document structure
 * /tenants/{tenantId}/notificationSettings/{userId}
 */
export interface TenantNotificationSettings {
  userId: string;
  tenantId: string;

  // High level overrides
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;

  // Per message type overrides
  channelsAllowedPerType?: {
    [messageTypeId: string]: {
      email?: boolean;
      sms?: boolean;
      push?: boolean;
    };
  };

  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

/**
 * Get tenant-scoped notification settings for a user
 * Falls back to user document fields for backward compatibility
 */
export async function getTenantNotificationSettings(
  tenantId: string,
  userId: string
): Promise<TenantNotificationSettings | null> {
  try {
    const settingsDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('notificationSettings')
      .doc(userId)
      .get();
    
    if (settingsDoc.exists) {
      return settingsDoc.data() as TenantNotificationSettings;
    }
    
    return null;
  } catch (error: any) {
    logger.error(`Error getting tenant notification settings for ${userId} in tenant ${tenantId}:`, error);
    return null;
  }
}

/**
 * Update tenant-scoped notification settings
 */
export async function updateTenantNotificationSettings(
  tenantId: string,
  userId: string,
  updates: Partial<TenantNotificationSettings>
): Promise<void> {
  try {
    const settingsRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('notificationSettings')
      .doc(userId);
    
    const settingsDoc = await settingsRef.get();
    
    const updateData: Partial<TenantNotificationSettings> = {
      ...updates,
      userId,
      tenantId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    if (!settingsDoc.exists) {
      // Create new settings document with defaults
      await settingsRef.set({
        userId,
        tenantId,
        emailEnabled: updates.emailEnabled ?? true,
        smsEnabled: updates.smsEnabled ?? true,
        pushEnabled: updates.pushEnabled ?? true,
        channelsAllowedPerType: updates.channelsAllowedPerType || {},
        ...updateData,
      });
    } else {
      await settingsRef.update(updateData);
    }
    
    logger.info(`Updated notification settings for user ${userId} in tenant ${tenantId}`);
  } catch (error: any) {
    logger.error(`Error updating tenant notification settings for ${userId} in tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Check if a channel is allowed for a user and message type
 * 
 * Order of precedence (strongest → weakest):
 * 1. Per-message-type setting (channelsAllowedPerType[messageTypeId].channel)
 * 2. Global channel toggle on notificationSettings (smsEnabled, emailEnabled, pushEnabled)
 * 3. User-level defaults or system defaults (true)
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 3.4 Notification Settings Resolution
 */
export function isChannelAllowedForUser(
  channel: 'sms' | 'email' | 'push',
  messageTypeId: string,
  notificationSettings: TenantNotificationSettings | null
): boolean {
  // 1. Check per-message-type setting first (strongest)
  const perType = notificationSettings?.channelsAllowedPerType?.[messageTypeId];
  if (perType && typeof perType[channel] === 'boolean') {
    return perType[channel]!;
  }

  // 2. Check global channel toggle
  if (channel === 'sms') {
    return notificationSettings?.smsEnabled ?? true;
  }
  if (channel === 'email') {
    return notificationSettings?.emailEnabled ?? true;
  }
  if (channel === 'push') {
    return notificationSettings?.pushEnabled ?? true;
  }

  // 3. Default to allowed
  return true;
}

