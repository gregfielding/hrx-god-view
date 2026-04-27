/**
 * Guards for application_received / "thanks for applying" SMS so stale applications
 * don't surprise users after bulk edits, imports, or late trigger runs.
 *
 * Override: APPLICATION_RECEIVED_MAX_SUBMIT_AGE_MS (milliseconds), e.g. 1209600000 for 14d.
 */

import { logger } from 'firebase-functions/v2';

function firestoreTsMillis(value: unknown): number {
  if (value == null) return 0;
  const v = value as { toMillis?: () => number; _seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

function maxSubmitAgeMs(): number {
  const raw = process.env.APPLICATION_RECEIVED_MAX_SUBMIT_AGE_MS;
  if (raw && /^\d+$/.test(String(raw).trim())) {
    return parseInt(String(raw).trim(), 10);
  }
  // Default 21 days — re-applies should refresh appliedAt/submittedAt
  return 21 * 24 * 60 * 60 * 1000;
}

/**
 * Best-effort "when did they submit" from application doc (not updatedAt — that moves on unrelated edits).
 */
export function getApplicationSubmitAnchorMillis(data: Record<string, unknown>): number | null {
  const su = firestoreTsMillis(data.submittedAt);
  const ap = firestoreTsMillis(data.appliedAt);
  if (su > 0 && ap > 0) return Math.max(su, ap);
  if (su > 0) return su;
  if (ap > 0) return ap;
  return null;
}

export function shouldSkipStaleApplicationReceivedSms(
  applicationId: string,
  data: Record<string, unknown>,
  nowMs: number = Date.now()
): boolean {
  const anchor = getApplicationSubmitAnchorMillis(data);
  if (anchor == null || anchor <= 0) {
    return false;
  }
  const maxAge = maxSubmitAgeMs();
  if (nowMs - anchor <= maxAge) {
    return false;
  }
  logger.info(
    `application_received SMS skipped: submission anchor older than ${maxAge}ms`,
    {
      applicationId,
      anchorMs: anchor,
      ageMs: nowMs - anchor,
    }
  );
  return true;
}
