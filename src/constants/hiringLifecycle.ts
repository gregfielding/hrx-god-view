/**
 * Client UI + guards for hiring lifecycle (canonical vocabulary lives in `shared/hiringLifecycleTypes.ts`).
 */

import {
  HIRING_LIFECYCLE_STAGES,
  HIRING_NEXT_ACTIONS,
  HIRING_BLOCKER_CODES,
  type HiringLifecycleStage,
  type HiringNextAction,
  type HiringBlockerCode,
} from '../shared/hiringLifecycleTypes';

export {
  HIRING_LIFECYCLE_STAGES,
  HIRING_NEXT_ACTIONS,
  HIRING_BLOCKER_CODES,
  type HiringLifecycleStage,
  type HiringNextAction,
  type HiringBlockerCode,
};

/** Settings → workflow overview: linear funnel + branch states (display order). */
export const HIRING_LIFECYCLE_WORKFLOW_OVERVIEW_CHIPS = [
  { stage: 'applied' as const, label: 'Apply', kind: 'linear' as const },
  { stage: 'profile_incomplete' as const, label: 'Profile', kind: 'linear' as const },
  { stage: 'interview_pending' as const, label: 'Interview', kind: 'linear' as const },
  { stage: 'qualified' as const, label: 'Qualified', kind: 'linear' as const },
  { stage: 'review' as const, label: 'Review', kind: 'branch' as const },
  { stage: 'waitlisted' as const, label: 'Waitlist', kind: 'branch' as const },
  { stage: 'hired' as const, label: 'Hired', kind: 'linear' as const },
  { stage: 'onboarding' as const, label: 'Onboarding', kind: 'linear' as const },
  { stage: 'active' as const, label: 'Active', kind: 'linear' as const },
  { stage: 'abandoned' as const, label: 'Closed', kind: 'linear' as const },
] as const satisfies ReadonlyArray<{
  stage: HiringLifecycleStage;
  label: string;
  kind: 'linear' | 'branch';
}>;

/** Recruiter/admin display labels for lifecycle stage. */
export const HIRING_LIFECYCLE_STAGE_LABELS: Record<HiringLifecycleStage, string> = {
  applied: 'Applied',
  profile_incomplete: 'Profile incomplete',
  interview_pending: 'Interview pending',
  qualified: 'Qualified',
  review: 'Review',
  waitlisted: 'Waitlisted',
  hired: 'Hired',
  onboarding: 'Onboarding',
  active: 'Active',
  abandoned: 'Closed',
};

/** Subset of nextAction values referenced in admin helper copy. */
export const HIRING_NEXT_ACTION_UI_EXAMPLES = [
  'recruiter_review',
  'recruiter_decide_waitlist',
  'worker_complete_prescreen',
] as const;

/** Short labels for nextAction chips in admin UI. */
export const HIRING_NEXT_ACTION_LABELS: Record<HiringNextAction, string> = {
  none: 'No action',
  worker_complete_prescreen: 'Worker: prescreen',
  worker_schedule_interview: 'Worker: interview',
  worker_complete_onboarding_step: 'Worker: onboarding step',
  recruiter_review: 'Recruiter review',
  recruiter_decide_waitlist: 'Waitlist decision',
  recruiter_confirm_hire: 'Confirm hire',
  compliance_resolve: 'Compliance',
  system_wait: 'System wait',
  offer_follow_up: 'Offer follow-up',
};

const _stageSet = new Set<string>(HIRING_LIFECYCLE_STAGES);
const _nextSet = new Set<string>(HIRING_NEXT_ACTIONS);

export function isHiringLifecycleStage(value: string): value is HiringLifecycleStage {
  return _stageSet.has(value);
}

export function isHiringNextAction(value: string): value is HiringNextAction {
  return _nextSet.has(value);
}
