/**
 * Global gate for "application waitlisted" SMS/email/push/inbox driven by application status.
 *
 * Default: **off** (no waitlist notifications). Set `ENABLE_APPLICATION_WAITLIST_NOTIFICATIONS=true`
 * in the Functions runtime env to allow them after product issues are resolved.
 *
 * Emergency override: set `DISABLE_APPLICATION_WAITLIST_NOTIFICATIONS=true` to force off even if enable is set.
 */

import { logger } from 'firebase-functions/v2';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';

function envTruthy(key: string): boolean {
  const v = String(process.env[key] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * When false, callers must not send any channel for waitlisted application status
 * (including tenant message-automation rules and orchestrator fallbacks).
 */
export function shouldSendApplicationWaitlistNotifications(): boolean {
  if (envTruthy('DISABLE_APPLICATION_WAITLIST_NOTIFICATIONS')) {
    return false;
  }
  return envTruthy('ENABLE_APPLICATION_WAITLIST_NOTIFICATIONS');
}

export function isApplicationStatusWaitlisted(rawStatus: unknown): boolean {
  const n = normalizeApplicationStatus(String(rawStatus ?? ''));
  return n === 'waitlisted';
}

export function logWaitlistNotificationsSuppressed(context: string, extra?: Record<string, unknown>): void {
  logger.info(`application_waitlisted notifications suppressed (${context})`, {
    enableEnv: process.env.ENABLE_APPLICATION_WAITLIST_NOTIFICATIONS,
    disableEnv: process.env.DISABLE_APPLICATION_WAITLIST_NOTIFICATIONS,
    ...extra,
  });
}
