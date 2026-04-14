/**
 * Maps AI hiring engine outcomes (`evaluateAiHiringDecision`) to hiringLifecycle fields.
 * **Mirror of `shared/hiringLifecycleInterviewSubmitMap.ts`** — keep both in sync.
 */

import type { AiHiringDecisionResultLike, HiringLifecycleCore } from './hiringLifecycleTypes';

/** reasonCode → lifecycle blocker code (subset of HIRING_BLOCKER_CODES). */
export const AI_REASON_CODE_TO_BLOCKER: Readonly<Partial<Record<string, string>>> = {
  below_score_threshold: 'SCORE_BELOW_MINIMUM',
  below_job_fit_threshold: 'JOB_FIT_GATE_FAILED',
  failed_job_requirement: 'JOB_FIT_GATE_FAILED',
  recommendation_decline: 'RECRUITER_REVIEW_REQUIRED',
  capacity_reached: 'TARGET_HEADCOUNT_REACHED',
  onboarding_throttled: 'TARGET_HEADCOUNT_REACHED',
  not_in_top_percent: 'AUTO_ADVANCE_CAP_REACHED',
  moderate_flags_present: 'RECRUITER_REVIEW_REQUIRED',
  critical_flag_drug: 'COMPLIANCE_HOLD',
  critical_flag_background: 'COMPLIANCE_HOLD',
  critical_flag_physical: 'COMPLIANCE_HOLD',
  no_show_overlay_review: 'RECRUITER_REVIEW_REQUIRED',
};

/**
 * Collect unique blockers from reason codes (stable order: follow reasonCodes array order).
 */
export function blockersFromAiReasonCodes(reasonCodes: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rc of reasonCodes) {
    const mapped = AI_REASON_CODE_TO_BLOCKER[rc];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

/**
 * When stage is `abandoned`, pick a meaningful subStatus from reason codes + decision.
 */
export function abandonedSubStatusFromInterviewSubmit(reasonCodes: readonly string[]): string {
  if (reasonCodes.includes('recommendation_decline')) return 'rejected_by_policy';
  if (reasonCodes.includes('below_score_threshold') || reasonCodes.includes('below_job_fit_threshold'))
    return 'rejected_by_policy';
  if (reasonCodes.includes('failed_job_requirement')) return 'rejected_by_policy';
  if (
    reasonCodes.includes('critical_flag_drug') ||
    reasonCodes.includes('critical_flag_background') ||
    reasonCodes.includes('critical_flag_physical')
  ) {
    return 'rejected_by_policy';
  }
  return 'rejected_by_policy';
}

function holdSplit(reasonCodes: readonly string[]): 'waitlist' | 'review' {
  if (reasonCodes.includes('capacity_reached') || reasonCodes.includes('onboarding_throttled')) {
    return 'waitlist';
  }
  return 'review';
}

/**
 * Pure mapping: decision + reasonCodes + phase6 queue → lifecycle core.
 */
export function mapInterviewSubmitToLifecycleCore(input: {
  hiringResult: AiHiringDecisionResultLike;
  phase6AutomationQueued: boolean;
}): HiringLifecycleCore {
  const { hiringResult, phase6AutomationQueued } = input;
  const { decision, reasonCodes } = hiringResult;
  const codes = [...reasonCodes] as string[];

  if (decision === 'reject') {
    return {
      stage: 'abandoned',
      subStatus: abandonedSubStatusFromInterviewSubmit(codes),
      blockers: blockersFromAiReasonCodes(codes),
      nextAction: 'none',
    };
  }

  if (decision === 'review') {
    return {
      stage: 'review',
      subStatus: 'ai_prescreen_complete',
      blockers: blockersFromAiReasonCodes(codes),
      nextAction: 'recruiter_review',
    };
  }

  if (decision === 'hold') {
    if (holdSplit(codes) === 'waitlist') {
      return {
        stage: 'waitlisted',
        subStatus: 'target_reached_queue',
        blockers: blockersFromAiReasonCodes(codes),
        nextAction: 'recruiter_decide_waitlist',
      };
    }
    return {
      stage: 'review',
      subStatus: 'manual_review_required',
      blockers: blockersFromAiReasonCodes(codes),
      nextAction: 'recruiter_review',
    };
  }

  if (phase6AutomationQueued) {
    return {
      stage: 'waitlisted',
      subStatus: 'phase6_queue_pending',
      blockers: [],
      nextAction: 'system_wait',
    };
  }

  return {
    stage: 'qualified',
    subStatus: 'ai_prescreen_complete',
    blockers: [],
    nextAction: 'none',
  };
}

/** @internal — exported for tests */
export const __testing = {
  holdSplit,
  abandonedSubStatusFromInterviewSubmit,
};
