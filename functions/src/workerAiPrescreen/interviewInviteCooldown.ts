/**
 * User-level interview invite cooldown: `lastInterviewInvitedAt` + `lastInterviewCompletedAt`
 * to prevent duplicate invite spam and automation loops.
 *
 * Cooldown window defaults to 10 days (tunable in the 7–14 day range). Legacy `interviewInviteSentAt`
 * is honored when `lastInterviewInvitedAt` is absent.
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { isWithinMs } from '../recruiter/userGroupInterviewInviteValidation';

/** Tunable 7–14d policy; exported for logging / admin tooling. */
export const INTERVIEW_REINVITE_COOLDOWN_DAYS = 10;
export const INTERVIEW_REINVITE_COOLDOWN_MS = INTERVIEW_REINVITE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/**
 * True when we should not start another **cold** interview invite (auto new user, group backfill,
 * apply-wizard first SMS). Do not use for same-application chase / prescreen reminder follow-ups.
 */
export function userInInterviewReinviteCooldown(userData: Record<string, unknown>): boolean {
  const invitedAt = userData.lastInterviewInvitedAt ?? userData.interviewInviteSentAt;
  if (isWithinMs(invitedAt, INTERVIEW_REINVITE_COOLDOWN_MS)) return true;
  if (isWithinMs(userData.lastInterviewCompletedAt, INTERVIEW_REINVITE_COOLDOWN_MS)) return true;
  return false;
}

/**
 * Recruiter profile "Order interview" SMS only: blocks duplicate sends from **this** action.
 * Do not reuse {@link userInInterviewReinviteCooldown} here — workers often have
 * `lastInterviewInvitedAt` from group/auto flows while still showing zero interviews in UI.
 */
export const RECRUITER_ORDER_INTERVIEW_PROFILE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function recruiterProfileOrderInterviewSmsInCooldown(userData: Record<string, unknown>): boolean {
  return isWithinMs(userData.recruiterOrderInterviewSmsLastSentAt, RECRUITER_ORDER_INTERVIEW_PROFILE_COOLDOWN_MS);
}

/**
 * Call after any prescreen interview SMS succeeds (invites, reminders, chases) so cooldown reflects
 * the latest outreach.
 *
 * Pass `{ stampCadenceStart: true }` ONLY from a cold/first invite (cooldown-gated senders) to also
 * anchor the 5-day cadence hard stop via `interviewCadenceStartedAt`. Chases / reminders must NOT
 * pass it — unlike `lastInterviewInvitedAt`, the cadence anchor must not advance on every text, or
 * the 5-day stop would never trigger. (Field name mirrors
 * `interviewCadence.INTERVIEW_CADENCE_STARTED_AT_FIELD`; inlined to avoid an import cycle.)
 */
export async function touchLastInterviewInvitedAt(
  db: Firestore,
  userId: string,
  sentAt: admin.firestore.Timestamp,
  opts?: { stampCadenceStart?: boolean },
): Promise<void> {
  const uid = String(userId || '').trim();
  if (!uid) return;
  try {
    const data: Record<string, unknown> = {
      lastInterviewInvitedAt: sentAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (opts?.stampCadenceStart) data.interviewCadenceStartedAt = sentAt;
    await db.doc(`users/${uid}`).set(data, { merge: true });
  } catch {
    /* best-effort */
  }
}
