/**
 * Unit tests for the worker AI pre-screen dashboard action builder.
 *
 * Anchors the 30-day "system interview" freshness contract — Greg's
 * 2026-04-26 fix request: "There should only be 1 'system' interview in
 * a 30 day span." A profile-first (no applicationId) interview must
 * suppress the per-application "Complete my interview" action item, and
 * the suppression must expire after 30 days.
 */

import {
  buildWorkerAiPrescreenDashboardActions,
  interviewApplicationIdsFromUserInterviews,
  latestWorkerAiPrescreenInterviewAtMs,
} from '../workerAiPrescreenDashboardActions';

const NOW_MS = Date.UTC(2026, 3, 26, 15, 0, 0); // 2026-04-26 15:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;

function tsAt(ms: number) {
  // Mimic Firestore Timestamp's `toMillis()` API.
  return { toMillis: () => ms };
}

function applicationWithReminder(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      status: 'submitted',
      workerAiPrescreenReminderSentAt: tsAt(NOW_MS - 2 * DAY_MS),
      workerAiPrescreenReminderLastOutcome: 'eligible_invite',
      ...overrides,
    },
  };
}

describe('latestWorkerAiPrescreenInterviewAtMs', () => {
  it('returns the most recent timestamp across all prescreen rows', () => {
    const rows = [
      { interviewKind: 'worker_ai_prescreen', timestamp: tsAt(NOW_MS - 10 * DAY_MS) },
      { interviewKind: 'worker_ai_prescreen', timestamp: tsAt(NOW_MS - 1 * DAY_MS) },
      { interviewKind: 'worker_ai_prescreen', timestamp: tsAt(NOW_MS - 5 * DAY_MS) },
    ];
    expect(latestWorkerAiPrescreenInterviewAtMs(rows)).toBe(NOW_MS - 1 * DAY_MS);
  });

  it('ignores interviews of other kinds', () => {
    const rows = [
      { interviewKind: 'recruiter_interview', timestamp: tsAt(NOW_MS - 1 * DAY_MS) },
      { interviewKind: 'worker_ai_prescreen', timestamp: tsAt(NOW_MS - 10 * DAY_MS) },
    ];
    expect(latestWorkerAiPrescreenInterviewAtMs(rows)).toBe(NOW_MS - 10 * DAY_MS);
  });

  it('falls through submittedAt → timestamp → createdAt', () => {
    const rows = [
      // Only `createdAt` set.
      { interviewKind: 'worker_ai_prescreen', createdAt: tsAt(NOW_MS - 7 * DAY_MS) },
    ];
    expect(latestWorkerAiPrescreenInterviewAtMs(rows)).toBe(NOW_MS - 7 * DAY_MS);
  });

  it('parses ISO string fallbacks (legacy dev rows)', () => {
    const iso = new Date(NOW_MS - 3 * DAY_MS).toISOString();
    const rows = [{ interviewKind: 'worker_ai_prescreen', timestamp: iso }];
    expect(latestWorkerAiPrescreenInterviewAtMs(rows)).toBe(NOW_MS - 3 * DAY_MS);
  });

  it('returns 0 when there are no prescreen rows', () => {
    expect(latestWorkerAiPrescreenInterviewAtMs([])).toBe(0);
    expect(
      latestWorkerAiPrescreenInterviewAtMs([{ interviewKind: 'recruiter_interview' }]),
    ).toBe(0);
  });
});

describe('interviewApplicationIdsFromUserInterviews', () => {
  it('only collects ids for application-bound prescreen rows', () => {
    const rows = [
      { interviewKind: 'worker_ai_prescreen', applicationId: 'app-1' },
      { interviewKind: 'worker_ai_prescreen', applicationId: '' }, // profile-first
      { interviewKind: 'worker_ai_prescreen' }, // profile-first (missing field)
      { interviewKind: 'recruiter_interview', applicationId: 'app-2' },
      { interviewKind: 'worker_ai_prescreen', applicationId: 'app-3' },
    ];
    const ids = interviewApplicationIdsFromUserInterviews(rows);
    expect(Array.from(ids).sort()).toEqual(['app-1', 'app-3']);
  });
});

describe('buildWorkerAiPrescreenDashboardActions — 30-day freshness window', () => {
  it('suppresses all items when a prescreen interview was completed within 30 days', () => {
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [applicationWithReminder('app-1')],
      completedApplicationIds: new Set(),
      // Profile-first interview completed 5 minutes ago, NOT tied to app-1.
      latestPrescreenInterviewAtMs: NOW_MS - 5 * 60 * 1000,
      nowMs: NOW_MS,
    });
    expect(items).toEqual([]);
  });

  it('suppresses on the EXACT 30-day boundary minus 1ms (still fresh)', () => {
    const justInside = NOW_MS - (30 * DAY_MS - 1);
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [applicationWithReminder('app-1')],
      completedApplicationIds: new Set(),
      latestPrescreenInterviewAtMs: justInside,
      nowMs: NOW_MS,
    });
    expect(items).toEqual([]);
  });

  it('does NOT suppress when the prescreen interview is older than 30 days', () => {
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [applicationWithReminder('app-1')],
      completedApplicationIds: new Set(),
      latestPrescreenInterviewAtMs: NOW_MS - 31 * DAY_MS,
      nowMs: NOW_MS,
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('worker_ai_prescreen_interview');
  });

  it('preserves legacy behavior when latestPrescreenInterviewAtMs is omitted', () => {
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [applicationWithReminder('app-1')],
      completedApplicationIds: new Set(),
      // No `latestPrescreenInterviewAtMs` passed — defaults to 0, no suppression.
      nowMs: NOW_MS,
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('worker_ai_prescreen_interview');
  });

  it('still respects per-application completion (no fresh interview, but app-bound row exists)', () => {
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [applicationWithReminder('app-1')],
      completedApplicationIds: new Set(['app-1']),
      latestPrescreenInterviewAtMs: 0,
      nowMs: NOW_MS,
    });
    expect(items).toEqual([]);
  });

  it('suppresses regardless of which application triggered the SMS — that is the bug fix', () => {
    // Worker has 3 active applications all with SMS invites, plus a
    // single profile-first interview completed yesterday. Pre-fix this
    // would have shown the action item; post-fix all three are suppressed.
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [
        applicationWithReminder('app-1'),
        applicationWithReminder('app-2'),
        applicationWithReminder('app-3'),
      ],
      completedApplicationIds: new Set(), // no app-bound interview rows
      latestPrescreenInterviewAtMs: NOW_MS - 1 * DAY_MS,
      nowMs: NOW_MS,
    });
    expect(items).toEqual([]);
  });

  it('honors a custom freshnessWindowMs override (defensive against future tuning)', () => {
    // 7-day window for argument's sake; interview is 10 days old, so it
    // should NOT suppress under the override.
    const items = buildWorkerAiPrescreenDashboardActions({
      applications: [applicationWithReminder('app-1')],
      completedApplicationIds: new Set(),
      latestPrescreenInterviewAtMs: NOW_MS - 10 * DAY_MS,
      freshnessWindowMs: 7 * DAY_MS,
      nowMs: NOW_MS,
    });
    expect(items).toHaveLength(1);
  });
});
