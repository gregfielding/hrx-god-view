/**
 * Notification Settings Helper Functions
 * Manages user notification preferences for SMS, push, and in-app notifications
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

export type NotificationType = 
  | 'applicationUpdates' 
  | 'bulkMessages' 
  | 'directMessages' 
  | 'semiAutomated' 
  | 'fullyAutomated' 
  | 'assignmentUpdates' 
  | 'shiftUpdates';

export type NotificationChannel = 'sms' | 'push' | 'inApp';

export interface NotificationSettings {
  sms: {
    enabled: boolean;
    applicationUpdates: boolean;
    bulkMessages: boolean;
    directMessages: boolean;
    semiAutomated: boolean;
    fullyAutomated: boolean;
    assignmentUpdates: boolean;
    shiftUpdates: boolean;
  };
  push: {
    enabled: boolean;
    applicationUpdates: boolean;
    bulkMessages: boolean;
    directMessages: boolean;
    semiAutomated: boolean;
    fullyAutomated: boolean;
    assignmentUpdates: boolean;
    shiftUpdates: boolean;
  };
  inApp: {
    enabled: boolean;
    applicationUpdates: boolean;
    bulkMessages: boolean;
    directMessages: boolean;
    semiAutomated: boolean;
    fullyAutomated: boolean;
    assignmentUpdates: boolean;
    shiftUpdates: boolean;
  };
}

/**
 * Get user's notification settings with defaults
 */
export async function getUserNotificationSettings(
  userId: string
): Promise<NotificationSettings> {
  try {
    const userDoc = await db.doc(`users/${userId}`).get();
    if (!userDoc.exists) {
      throw new Error(`User ${userId} not found`);
    }

    const userData = userDoc.data();
    
    // Get master SMS opt-in (legacy field)
    const smsOptIn = userData?.smsOptIn !== false; // Default to true if not set
    const phoneVerified = userData?.phoneVerified === true;
    const hasPushTokens = Array.isArray(userData?.pushTokens) && userData.pushTokens.length > 0;

    // Get notification settings if they exist
    const settings = userData?.notificationSettings as Partial<NotificationSettings> | undefined;

    // Build default settings
    const defaultSettings: NotificationSettings = {
      sms: {
        enabled: smsOptIn && phoneVerified,
        applicationUpdates: smsOptIn && phoneVerified,
        bulkMessages: smsOptIn && phoneVerified,
        directMessages: smsOptIn && phoneVerified,
        semiAutomated: smsOptIn && phoneVerified,
        fullyAutomated: smsOptIn && phoneVerified,
        assignmentUpdates: smsOptIn && phoneVerified,
        shiftUpdates: smsOptIn && phoneVerified,
      },
      push: {
        enabled: hasPushTokens,
        applicationUpdates: hasPushTokens,
        bulkMessages: hasPushTokens,
        directMessages: hasPushTokens,
        semiAutomated: hasPushTokens,
        fullyAutomated: hasPushTokens,
        assignmentUpdates: hasPushTokens,
        shiftUpdates: hasPushTokens,
      },
      inApp: {
        enabled: true, // Always enabled
        applicationUpdates: true,
        bulkMessages: true,
        directMessages: true,
        semiAutomated: true,
        fullyAutomated: true,
        assignmentUpdates: true,
        shiftUpdates: true,
      },
    };

    // Merge with existing settings
    if (settings) {
      return {
        sms: { ...defaultSettings.sms, ...(settings.sms || {}) },
        push: { ...defaultSettings.push, ...(settings.push || {}) },
        inApp: { ...defaultSettings.inApp, ...(settings.inApp || {}) },
      };
    }

    return defaultSettings;
  } catch (error: any) {
    console.error(`Error getting notification settings for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Check if notification should be sent via specific channel
 */
export async function shouldSendNotification(
  userId: string,
  notificationType: NotificationType,
  channel: NotificationChannel
): Promise<boolean> {
  try {
    const settings = await getUserNotificationSettings(userId);

    // Check channel master toggle first
    if (channel === 'sms' && !settings.sms.enabled) {
      return false;
    }
    if (channel === 'push' && !settings.push.enabled) {
      return false;
    }
    // inApp is always enabled (can't disable in-app notifications)

    // Check type-specific setting
    const channelSettings = settings[channel];
    return channelSettings[notificationType] === true;
  } catch (error: any) {
    console.error(`Error checking notification permission for user ${userId}:`, error);
    // Default to false on error (fail safe)
    return false;
  }
}

/**
 * Update user notification settings
 */
export async function updateUserNotificationSettings(
  userId: string,
  updates: Partial<NotificationSettings>
): Promise<void> {
  try {
    const userRef = db.doc(`users/${userId}`);
    
    // Get current settings
    const currentSettings = await getUserNotificationSettings(userId);
    
    // Merge updates
    const mergedSettings: NotificationSettings = {
      sms: { ...currentSettings.sms, ...(updates.sms || {}) },
      push: { ...currentSettings.push, ...(updates.push || {}) },
      inApp: { ...currentSettings.inApp, ...(updates.inApp || {}) },
    };

    // Update Firestore
    await userRef.update({
      notificationSettings: mergedSettings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    console.error(`Error updating notification settings for user ${userId}:`, error);
    throw error;
  }
}

