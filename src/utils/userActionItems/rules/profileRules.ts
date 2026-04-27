import type { ScoreSummary } from '../../scoreSummary';
import { getRecruiterPrimaryScore100FromSummary } from '../../scoring/recruiterOperationalScore';
import { getRecruiterDecisionSummary } from '../../scoring/recruiterDecisionSummary';
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

  const signalsReady = input.actionSignalsReady !== false;
  if (input.enabled && signalsReady && !input.hasInterview) {
    out.push(
      makeActionItem({
        dedupeKey: 'user:interview',
        type: 'interview_missing',
        category: 'profile',
        severity: 'high',
        actor: 'recruiter',
        title: 'Interview missing',
        shortDescription: 'Schedule or record an interview when one is required for this role or pipeline.',
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

  const operational = getRecruiterPrimaryScore100FromSummary(input.scoreSummary as ScoreSummary | null | undefined);
  const prescreen = input.prescreenInterviewAi;
  const decisionLine =
    prescreen && prescreen.overallScore != null
      ? getRecruiterDecisionSummary({ ai: prescreen, scoreSummary: input.scoreSummary as ScoreSummary | null })
      : null;

  if (input.enabled && operational != null && operational < 60) {
    const short =
      decisionLine?.adjustmentSummaryLines[0] ??
      `Operational score is ${Math.round(operational)}/100 — review the Score tab before the next candidate-facing step.`;
    out.push(
      makeActionItem({
        dedupeKey: 'user:score_low',
        type: 'score_review_recommended',
        category: 'watchout',
        severity: 'medium',
        actor: 'recruiter',
        title: 'Operational score suggests review',
        shortDescription: short,
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

  if (
    input.enabled &&
    prescreen &&
    decisionLine &&
    operational != null &&
    operational >= 72 &&
    decisionLine.autoAdvanceEligible === false &&
    decisionLine.autoAdvanceBlockedReasons.length > 0
  ) {
    const one = decisionLine.autoAdvanceBlockedReasons[0] ?? '';
    if (one) {
      out.push(
        makeActionItem({
          dedupeKey: 'user:score_auto_advance_gate',
          type: 'score_auto_advance_blocked',
          category: 'watchout',
          severity: 'low',
          actor: 'recruiter',
          title: 'Strong score — auto-advance blocked',
          shortDescription: one,
          scope: { kind: 'global' },
          blocking: 'informational',
          sourceType: 'derived',
          sourceId: input.uid,
          ctaLabel: 'Score',
          ctaTarget: { kind: 'profileTab', tab: 'Score' },
          priority: 78,
        }),
      );
    }
  }

  return out;
}
