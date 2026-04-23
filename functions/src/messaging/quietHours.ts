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
    'application_received_interview_next_step',
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
    // Shift-cadence reminders tied to a scheduled start time — bypass quiet hours
    // (a 6 AM shift means T-2h fires at 4 AM; the whole point is to wake the worker).
    'assignment_reminder_2h_instructions',
    'assignment_reminder_15m_clockin',
    'assignment_checkin_0h',
    'assignment_reminder_23h_escalate',
    'assignment_reminder_22h_final',
    // Reply receipts are short auto-acknowledgements sent in direct response
    // to a worker's inbound SMS — they must always go out.
    'assignment_confirmation_receipt',
    'assignment_cancellation_receipt',
    'assignment_checked_in_receipt',
    // Walk-off warning is operational / safety-adjacent and MUST bypass
    // quiet hours — a worker standing confused in a parking lot at 5 AM
    // still needs the "drivers are paid from start time, please wait"
    // response in real time.
    'assignment_walk_off_warning',
    // No-show recruiter alert has no worker-facing SMS today; listed here
    // for completeness in case a future variant adds a worker ping.
    'assignment_noshow_notify_recruiter',
    // Onboarding / hire lifecycle — always deliver
    'worker_hired',
    'worker_onboarding_pipeline_started',
    'on_call_employment_started',
    'payroll_onboarding_invite_needed',
    'onboarding_reminder',
  ],
};

/**
 * Compute "now" as minutes-since-midnight in the configured IANA timezone.
 * Previously this file used `Date#getHours`, which returns hours in the process's local
 * time — in Cloud Functions that's UTC, not the tenant's America/Los_Angeles. That bug
 * caused quiet hours to trigger at the wrong real-world time (e.g. legitimate mid-afternoon
 * PDT sends were being suppressed because UTC was in the 21:00–08:00 window).
 */
function getTimezoneMinutesSinceMidnight(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now);
    const hStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const mStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    // Some locales render midnight as "24" — normalise.
    if (h === 24) h = 0;
    return h * 60 + m;
  } catch (err) {
    logger.warn('quietHours.getTimezoneMinutesSinceMidnight_fallback', {
      timezone,
      err: (err as Error)?.message || String(err),
    });
    return now.getHours() * 60 + now.getMinutes();
  }
}

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

    // Get current time-of-day in the tenant's configured timezone.
    // If the caller passed `userLocalTime`, we trust that it's already expressed in local
    // time (this is how existing tests pass a deterministic hour). Otherwise we take
    // UTC "now" and project it into `config.timezone` with Intl.
    const now = userLocalTime || new Date();
    const currentTimeMinutes = userLocalTime
      ? now.getHours() * 60 + now.getMinutes()
      : getTimezoneMinutesSinceMidnight(now, config.timezone);

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

