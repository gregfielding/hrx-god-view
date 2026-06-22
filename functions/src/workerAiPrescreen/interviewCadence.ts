/**
 * interviewCadence — the single source of truth for the worker AI pre-screen
 * interview outreach cadence and its hard stop.
 *
 * Background: an "interview cadence" is one invite SMS plus its chase
 * reminders (chase 1 = +4h, chase 2 = +24h). The per-invite cadence is short,
 * but workers were getting interview texts for *days* because ~7 independent
 * trigger entry points each re-armed a fresh invite + chase wave, and the only
 * global guard (`userInInterviewReinviteCooldown`, 10 days) is for COLD invites
 * only — chases / follow-ups slip past it.
 *
 * The fix (Greg, 2026-06-22): one shared **5-day hard stop from cadence start**.
 * No interview outreach happens more than 5 days after the person's current
 * cadence started. A genuinely new cadence can begin only after the existing
 * 10-day re-invite cooldown (so the anchor naturally resets ~10 days later).
 *
 * `scheduleInterviewChaseFields` is also centralized here — it was copy-pasted
 * across six senders.
 */

import * as admin from 'firebase-admin';

import { INTERVIEW_REINVITE_COOLDOWN_MS } from './interviewInviteCooldown';

/** After an interview-invite SMS, remind if the prescreen isn't submitted. */
export const CHASE_1_MS = 4 * 60 * 60 * 1000;
export const CHASE_2_MS = 24 * 60 * 60 * 1000;

/** No interview outreach more than this long after the cadence started. */
export const INTERVIEW_CADENCE_HARD_STOP_DAYS = 5;
export const INTERVIEW_CADENCE_HARD_STOP_MS = INTERVIEW_CADENCE_HARD_STOP_DAYS * 24 * 60 * 60 * 1000;

/**
 * Per-USER field stamped when a NEW cadence begins (a cold invite). Unlike
 * `lastInterviewInvitedAt` (which advances on every SMS), this is NOT touched
 * by chases / follow-ups, so it anchors the 5-day hard stop.
 */
export const INTERVIEW_CADENCE_STARTED_AT_FIELD = 'interviewCadenceStartedAt';

function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof admin.firestore.Timestamp) return v.toMillis();
  const anyV = v as { toMillis?: () => number; _seconds?: number };
  if (typeof anyV.toMillis === 'function') return anyV.toMillis();
  if (typeof anyV._seconds === 'number') return anyV._seconds * 1000;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * The canonical per-invite chase scheduling fields, set on the doc that
 * carries the chases (application or user). De-duped from six copies.
 */
export function scheduleInterviewChaseFields(
  sentAt: admin.firestore.Timestamp,
): Record<string, unknown> {
  const t = sentAt.toMillis();
  return {
    workerAiPrescreenChase1Pending: true,
    workerAiPrescreenChase1DueAt: admin.firestore.Timestamp.fromMillis(t + CHASE_1_MS),
    workerAiPrescreenChase2Pending: true,
    workerAiPrescreenChase2DueAt: admin.firestore.Timestamp.fromMillis(t + CHASE_2_MS),
  };
}

/**
 * Effective cadence start (ms) for the hard stop. Prefers the per-user anchor;
 * for legacy rows with no anchor, derives it from a chase-1 due date (= the
 * original invite `sentAt` + 4h) when provided — pass the application's
 * `workerAiPrescreenChase1DueAt` or the user's
 * `workerAiPrescreenProfileFirstChase1DueAt`. Returns null when neither is
 * known.
 */
export function effectiveCadenceStartMs(args: {
  userData?: Record<string, unknown> | null;
  chase1DueAt?: unknown;
}): number | null {
  const fromUser = toMillis(args.userData?.[INTERVIEW_CADENCE_STARTED_AT_FIELD]);
  if (fromUser != null) return fromUser;
  const chase1Due = toMillis(args.chase1DueAt);
  if (chase1Due != null) return chase1Due - CHASE_1_MS;
  return null;
}

/**
 * True when the current cadence started more than 5 days ago — stop ALL
 * outreach for it (chases, follow-ups, re-arms). Returns false when there's no
 * known cadence start (e.g. a brand-new cold invite that hasn't been anchored
 * yet), so first-touch invites are never blocked by this.
 */
export function interviewCadencePastHardStop(args: {
  userData?: Record<string, unknown> | null;
  chase1DueAt?: unknown;
  nowMs?: number;
}): boolean {
  const start = effectiveCadenceStartMs(args);
  if (start == null) return false;
  const now = args.nowMs ?? Date.now();
  return now - start > INTERVIEW_CADENCE_HARD_STOP_MS;
}

/**
 * Fields to merge onto the USER doc when a NEW cadence begins. Anchors the
 * 5-day hard stop.
 */
export function newCadenceStartUserFields(
  sentAt: admin.firestore.Timestamp,
): Record<string, unknown> {
  return { [INTERVIEW_CADENCE_STARTED_AT_FIELD]: sentAt };
}

/**
 * Whether to (re)stamp the cadence anchor on an invite send: true when there's
 * no anchor yet, or the existing one is older than the re-invite cooldown (a
 * genuinely new cadence). Returning false for a still-fresh anchor is what
 * keeps mid-cadence re-arms from sliding the 5-day stop forward.
 */
export function shouldStampNewCadenceStart(
  userData: Record<string, unknown> | null | undefined,
  nowMs?: number,
): boolean {
  const start = toMillis(userData?.[INTERVIEW_CADENCE_STARTED_AT_FIELD]);
  if (start == null) return true;
  const now = nowMs ?? Date.now();
  return now - start > INTERVIEW_REINVITE_COOLDOWN_MS;
}
