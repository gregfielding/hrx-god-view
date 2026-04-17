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
 * Call after any prescreen interview SMS succeeds (invites, reminders, chases) so cooldown reflects
 * the latest outreach.
 */
export async function touchLastInterviewInvitedAt(
  db: Firestore,
  userId: string,
  sentAt: admin.firestore.Timestamp,
): Promise<void> {
  const uid = String(userId || '').trim();
  if (!uid) return;
  try {
    await db.doc(`users/${uid}`).set(
      {
        lastInterviewInvitedAt: sentAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    /* best-effort */
  }
}
