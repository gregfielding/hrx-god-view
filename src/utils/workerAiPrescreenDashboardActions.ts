/**
 * Worker home dashboard — AI pre-screen follow-up (post SMS invite / profile nudge).
 */

import { C1_WORKER_AI_PRESCREEN_PATH } from '../constants/c1WorkerRoutes';
import type { WorkerDashboardActionItem } from './workerDashboardActionItems';

/**
 * Default freshness window for a completed worker AI prescreen interview.
 * Within this window, ANY prescreen interview (application-bound OR
 * profile-first / system) suppresses per-application "Complete my
 * interview" action items, regardless of whether the interview was
 * captured against the specific application that triggered the SMS
 * invite. Rationale: prescreen answers don't change meaningfully on a
 * day-to-day basis, and forcing the worker to re-take the interview for
 * each application creates a "I just did this" frustration loop.
 *
 * Source of the 30-day number: Greg, 2026-04-26 — "There should only be
 * 1 'system' interview in a 30 day span."
 */
const DEFAULT_PRESCREEN_FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function tsMillis(v: unknown): number {
  if (v == null) return 0;
  const t = v as { toMillis?: () => number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  // ISO string fallback — older interview rows in dev sometimes carry
  // strings instead of Firestore Timestamps.
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

/** `users/{uid}/interviews` rows that complete pre-screen for an application. */
export function interviewApplicationIdsFromUserInterviews(
  rows: Array<Record<string, unknown>>,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (String(r.interviewKind || '') !== 'worker_ai_prescreen') continue;
    const aid = String(r.applicationId || '').trim();
    if (aid) out.add(aid);
  }
  return out;
}

/**
 * Most recent `worker_ai_prescreen` interview timestamp across ALL the
 * worker's interview rows, regardless of `applicationId`. Returns 0 if
 * the worker has no completed prescreen interviews yet.
 *
 * Used by `buildWorkerAiPrescreenDashboardActions` to enforce the
 * one-system-interview-per-30-days rule (see
 * `DEFAULT_PRESCREEN_FRESHNESS_WINDOW_MS`).
 */
export function latestWorkerAiPrescreenInterviewAtMs(
  rows: Array<Record<string, unknown>>,
): number {
  let latest = 0;
  for (const r of rows) {
    if (String(r.interviewKind || '') !== 'worker_ai_prescreen') continue;
    // Prefer `submittedAt` if present, then `timestamp`, then `createdAt`.
    // The submit callable writes `timestamp` + `createdAt` to the same
    // value today, so the order here is mostly defensive against future
    // schema drift.
    const t = tsMillis(r.submittedAt) || tsMillis(r.timestamp) || tsMillis(r.createdAt);
    if (t > latest) latest = t;
  }
  return latest;
}

export function buildWorkerAiPrescreenDashboardActions(args: {
  applications: Array<{ id: string; data: Record<string, unknown> }>;
  completedApplicationIds: Set<string>;
  /** Most recent prescreen interview timestamp across the worker's
   *  history (any kind). When non-zero AND within `freshnessWindowMs` of
   *  `nowMs`, ALL per-application interview action items are suppressed.
   *  Defaults to 0 (no freshness signal — preserve legacy behavior). */
  latestPrescreenInterviewAtMs?: number;
  /** Override for the 30-day default. Tests inject a custom value here.
   *  Production callers should leave the default alone. */
  freshnessWindowMs?: number;
  /** `Date.now()` injected for test determinism. */
  nowMs?: number;
}): WorkerDashboardActionItem[] {
  const {
    applications,
    completedApplicationIds,
    latestPrescreenInterviewAtMs = 0,
    freshnessWindowMs = DEFAULT_PRESCREEN_FRESHNESS_WINDOW_MS,
    nowMs = Date.now(),
  } = args;

  // Fast path: a recent prescreen interview suppresses all per-application
  // interview prompts. Profile-first (system) interviews count, so this
  // is what fixes the "I just did the interview but the dashboard still
  // tells me to do it" bug.
  if (
    latestPrescreenInterviewAtMs > 0 &&
    nowMs - latestPrescreenInterviewAtMs < freshnessWindowMs
  ) {
    return [];
  }

  const submitted = applications.filter((a) => String(a.data.status || '').toLowerCase() === 'submitted');
  const candidates = submitted.filter((a) => {
    if (!a.data.workerAiPrescreenReminderSentAt) return false;
    if (completedApplicationIds.has(a.id)) return false;
    const outcome = String(a.data.workerAiPrescreenReminderLastOutcome || '');
    return (
      outcome === 'eligible_invite' ||
      outcome === 'ineligible_nudge' ||
      outcome === 'combined_first_touch'
    );
  });
  if (candidates.length === 0) return [];

  candidates.sort(
    (a, b) => tsMillis(a.data.workerAiPrescreenReminderSentAt) - tsMillis(b.data.workerAiPrescreenReminderSentAt),
  );
  const pick = candidates[0];
  const outcome = String(pick.data.workerAiPrescreenReminderLastOutcome || '');

  if (outcome === 'eligible_invite' || outcome === 'combined_first_touch') {
    return [
      {
        id: 'worker_ai_prescreen_interview',
        category: 'important',
        titleKey: 'dashboard.actionItems.aiPrescreenInterviewTitle',
        descriptionKey: 'dashboard.actionItems.aiPrescreenInterviewDescription',
        sortOrder: 550,
        primaryLabelKey: 'dashboard.actionItems.aiPrescreenInterviewPrimary',
        primaryKind: 'navigate',
        href: `${C1_WORKER_AI_PRESCREEN_PATH}?applicationId=${encodeURIComponent(pick.id)}&entry=dashboard_cta`,
        sourceReason: 'AI pre-screen SMS sent; interview not completed for application',
        qaEvaluatedFields: { applicationId: pick.id },
      },
    ];
  }

  return [
    {
      id: 'worker_ai_prescreen_complete_profile',
      category: 'important',
      titleKey: 'dashboard.actionItems.aiPrescreenProfileTitle',
      descriptionKey: 'dashboard.actionItems.aiPrescreenProfileDescription',
      sortOrder: 545,
      primaryLabelKey: 'dashboard.actionItems.aiPrescreenProfilePrimary',
      primaryKind: 'navigate',
      href: '/c1/workers/profile',
      sourceReason: 'AI pre-screen profile-completion SMS sent',
      qaEvaluatedFields: { applicationId: pick.id },
    },
  ];
}
