/**
 * Worker home dashboard — AI pre-screen follow-up (post SMS invite / profile nudge).
 */

import { C1_WORKER_AI_PRESCREEN_PATH } from '../constants/c1WorkerRoutes';
import type { WorkerDashboardActionItem } from './workerDashboardActionItems';

function tsMillis(v: unknown): number {
  if (v == null) return 0;
  const t = v as { toMillis?: () => number };
  if (typeof t.toMillis === 'function') return t.toMillis();
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

export function buildWorkerAiPrescreenDashboardActions(args: {
  applications: Array<{ id: string; data: Record<string, unknown> }>;
  completedApplicationIds: Set<string>;
}): WorkerDashboardActionItem[] {
  const { applications, completedApplicationIds } = args;
  const submitted = applications.filter((a) => String(a.data.status || '').toLowerCase() === 'submitted');
  const candidates = submitted.filter((a) => {
    if (!a.data.workerAiPrescreenReminderSentAt) return false;
    if (completedApplicationIds.has(a.id)) return false;
    const outcome = String(a.data.workerAiPrescreenReminderLastOutcome || '');
    return outcome === 'eligible_invite' || outcome === 'ineligible_nudge';
  });
  if (candidates.length === 0) return [];

  candidates.sort(
    (a, b) => tsMillis(a.data.workerAiPrescreenReminderSentAt) - tsMillis(b.data.workerAiPrescreenReminderSentAt),
  );
  const pick = candidates[0];
  const outcome = String(pick.data.workerAiPrescreenReminderLastOutcome || '');

  if (outcome === 'eligible_invite') {
    return [
      {
        id: 'worker_ai_prescreen_interview',
        category: 'important',
        titleKey: 'dashboard.actionItems.aiPrescreenInterviewTitle',
        descriptionKey: 'dashboard.actionItems.aiPrescreenInterviewDescription',
        sortOrder: 550,
        primaryLabelKey: 'dashboard.actionItems.aiPrescreenInterviewPrimary',
        primaryKind: 'navigate',
        href: `${C1_WORKER_AI_PRESCREEN_PATH}?applicationId=${encodeURIComponent(pick.id)}`,
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
