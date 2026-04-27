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

/**
 * Content-based safety net. A number of tenants have misconfigured templates or
 * automation rule bodies that contain waitlist copy even though the routing
 * `messageTypeId` / `triggerKey` / `status` is something else (e.g.
 * `application_status_change` fallback, `applicationReceived` rule body).
 *
 * This helper lets upstream callers (orchestrator, dispatcher) refuse to deliver
 * a rendered body that reads like a waitlist notice when the global gate is off.
 *
 * Matches English "waitlist" / "wait list" / "waitlisted" and Spanish
 * "lista de espera" / "en espera" (case-insensitive). Does NOT match generic
 * phrases like "wait a moment" or "we'll be in touch".
 */
const WAITLIST_CONTENT_PATTERNS: RegExp[] = [
  /\bwait[\s-]?list(ed|ing)?\b/i,
  /\bwaiting\s+list\b/i,
  /\blista\s+de\s+espera\b/i,
  /\ben\s+espera\b/i,
];

export function containsWaitlistCopy(...parts: Array<string | null | undefined>): boolean {
  for (const part of parts) {
    if (!part) continue;
    const s = String(part);
    if (!s) continue;
    if (WAITLIST_CONTENT_PATTERNS.some((r) => r.test(s))) return true;
  }
  return false;
}

export function logWaitlistNotificationsSuppressed(context: string, extra?: Record<string, unknown>): void {
  logger.info(`application_waitlisted notifications suppressed (${context})`, {
    enableEnv: process.env.ENABLE_APPLICATION_WAITLIST_NOTIFICATIONS,
    disableEnv: process.env.DISABLE_APPLICATION_WAITLIST_NOTIFICATIONS,
    ...extra,
  });
}
