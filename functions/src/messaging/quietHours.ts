/**
 * Quiet Hours Support
 * 
 * Respects user experience & compliance by delaying non-critical messages during late-night hours.
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 2 Quiet Hours
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export interface QuietHoursConfig {
  enabled: boolean;
  timezone: string; // e.g., "America/Los_Angeles"
  startLocal: string; // e.g., "21:00"
  endLocal: string; // e.g., "08:00"
  allowedMessageTypes?: string[]; // Message types allowed during quiet hours
  updatedAt?: admin.firestore.Timestamp;
}

export interface QuietHoursCheckArgs {
  tenantId: string;
  messageTypeId: string;
  userLocalTime?: Date; // Optional: if not provided, uses tenant timezone
}

/**
 * Default quiet hours configuration
 */
const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  enabled: true,
  timezone: 'America/Los_Angeles',
  startLocal: '21:00',
  endLocal: '08:00',
  allowedMessageTypes: [
    'shift_cancelled_sms',
    'system_security_alert_sms',
    'stop_confirmation',
    'help_response',
    // Application lifecycle — always deliver so user gets confirmation / status
    'application_received',
    'application_screened',
    'application_advanced',
    'application_offered',
    'application_hired',
    'application_waitlisted',
    'application_rejected',
    'application_status_change',
    // Assignment lifecycle — always deliver
    'assignment_created',
    'assignment_status_change',
    'assignment_confirmed',
    'assignment_active',
    'assignment_completed',
    'assignment_cancelled',
    'worker_onboarding_pipeline_started',
    'on_call_employment_started',
    'payroll_onboarding_invite_needed',
    'onboarding_reminder',
  ],
};

/**
 * Get tenant quiet hours configuration
 */
async function getQuietHoursConfig(tenantId: string): Promise<QuietHoursConfig> {
  try {
    const configDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messagingConfig')
      .doc('quietHours')
      .get();

    if (configDoc.exists) {
      return configDoc.data() as QuietHoursConfig;
    }

    return DEFAULT_QUIET_HOURS;
  } catch (error: any) {
    logger.error(`Error fetching quiet hours config for tenant ${tenantId}:`, error);
    return DEFAULT_QUIET_HOURS;
  }
}

/**
 * Parse time string (HH:MM) to hours and minutes
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Check if current time is within quiet hours
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 2.3 Implementation
 */
export async function isQuietHours(
  args: QuietHoursCheckArgs
): Promise<boolean> {
  const { tenantId, messageTypeId, userLocalTime } = args;

  try {
    const config = await getQuietHoursConfig(tenantId);

    // If quiet hours are disabled, always allow
    if (!config.enabled) {
      return false;
    }

    // Check if message type is in allowed list
    if (config.allowedMessageTypes?.includes(messageTypeId)) {
      return false; // Not quiet hours for this message type
    }

    // Get current time in tenant timezone
    const now = userLocalTime || new Date();
    
    // For simplicity, we'll use the tenant timezone from config
    // In production, you might want to use a library like date-fns-tz
    // For now, we'll parse the local time string and compare
    
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const startTime = parseTime(config.startLocal);
    const endTime = parseTime(config.endLocal);
    const startTimeMinutes = startTime.hours * 60 + startTime.minutes;
    const endTimeMinutes = endTime.hours * 60 + endTime.minutes;

    // Handle quiet hours that span midnight (e.g., 21:00 to 08:00)
    if (startTimeMinutes > endTimeMinutes) {
      // Quiet hours span midnight
      if (currentTimeMinutes >= startTimeMinutes || currentTimeMinutes < endTimeMinutes) {
        return true; // Within quiet hours
      }
    } else {
      // Quiet hours within same day
      if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
        return true; // Within quiet hours
      }
    }

    return false; // Not quiet hours
  } catch (error: any) {
    logger.error(`Error checking quiet hours:`, error);
    // On error, allow the message (fail open) but log the error
    return false;
  }
}

