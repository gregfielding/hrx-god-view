import type { ScoreSummary } from '../../scoreSummary';
import { getCanonicalStoredAiScore } from '../../scoreSummary';
import type { ActionItem } from '../../../types/actionItems';
import { makeActionItem } from '../actionItemFactory';
import type { ActionItemsV1Input } from '../actionItemsV1Input';

export function runProfileRules(input: ActionItemsV1Input): ActionItem[] {
  const out: ActionItem[] = [];

  if (input.enabled && input.phone.trim().length > 0 && !input.phoneVerified) {
    out.push(
      makeActionItem({
        dedupeKey: 'user:phone_verify',
        type: 'phone_verification_required',
        category: 'profile',
        severity: 'medium',
        actor: 'worker',
        title: 'Phone not verified',
        shortDescription: 'Verify this number so SMS and operational alerts are reliable.',
        scope: { kind: 'global' },
        blocking: 'soft',
        sourceType: 'user_doc',
        sourceId: input.uid,
        ctaLabel: 'Open Overview',
        ctaTarget: { kind: 'profileTab', tab: 'Overview' },
        priority: 40,
      }),
    );
  }

  if (input.enabled && !input.hasInterview) {
    out.push(
      makeActionItem({
        dedupeKey: 'user:interview',
        type: 'interview_missing',
        category: 'profile',
        severity: 'high',
        actor: 'recruiter',
        title: 'No interview on file',
        shortDescription: 'Schedule or record an interview to stabilize readiness and scoring.',
        scope: { kind: 'global' },
        blocking: 'hard',
        sourceType: 'derived',
        sourceId: input.uid,
        ctaLabel: 'Interview',
        ctaTarget: { kind: 'profileTab', tab: 'Interview' },
        priority: 15,
      }),
    );
  }

  const ai = getCanonicalStoredAiScore(input.scoreSummary as ScoreSummary | null | undefined);
  if (input.enabled && ai != null && ai < 60) {
    out.push(
      makeActionItem({
        dedupeKey: 'user:score_low',
        type: 'score_review_recommended',
        category: 'watchout',
        severity: 'medium',
        actor: 'recruiter',
        title: 'Low AI score — review profile gaps',
        shortDescription: `Stored AI score is ${Math.round(ai)}. Review Score tab for missing fields and next actions.`,
        scope: { kind: 'global' },
        blocking: 'informational',
        sourceType: 'derived',
        sourceId: input.uid,
        ctaLabel: 'Score',
        ctaTarget: { kind: 'profileTab', tab: 'Score' },
        priority: 80,
      }),
    );
  }

  return out;
}
