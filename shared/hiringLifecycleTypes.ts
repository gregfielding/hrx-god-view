/**
 * Canonical hiring lifecycle vocabulary (locked). Pure data — no I/O.
 * @see docs/HIRING_LIFECYCLE_STATE_MACHINE.md
 */

/** Terminal success: cleared to work in placement context. */
export const HIRING_LIFECYCLE_STAGES = [
  'applied',
  'profile_incomplete',
  'interview_pending',
  'qualified',
  'review',
  'waitlisted',
  'hired',
  'onboarding',
  'active',
  'abandoned',
] as const;

export type HiringLifecycleStage = (typeof HIRING_LIFECYCLE_STAGES)[number];

export const HIRING_NEXT_ACTIONS = [
  'none',
  'worker_complete_prescreen',
  'worker_schedule_interview',
  'worker_complete_onboarding_step',
  'recruiter_review',
  'recruiter_decide_waitlist',
  'recruiter_confirm_hire',
  'compliance_resolve',
  'system_wait',
  'offer_follow_up',
] as const;

export type HiringNextAction = (typeof HIRING_NEXT_ACTIONS)[number];

/** Standard blocker codes (extend as needed; persisted as strings). */
export const HIRING_BLOCKER_CODES = [
  'ELIGIBILITY_PHONE_MISSING',
  'ELIGIBILITY_RESUME_MISSING',
  'ELIGIBILITY_LOCATION_REQUIRED',
  'ELIGIBILITY_WORK_AUTH_MISSING',
  'INTERVIEW_NOT_COMPLETED',
  'SCORE_BELOW_MINIMUM',
  'JOB_FIT_GATE_FAILED',
  'AUTO_ADVANCE_CAP_REACHED',
  'TARGET_HEADCOUNT_REACHED',
  'RECRUITER_REVIEW_REQUIRED',
  'COMPLIANCE_HOLD',
  'PHASE_PAYROLL_PENDING',
  'PHASE_I9_PENDING',
  'PHASE_EVERIFY_PENDING',
  'PHASE_BACKGROUND_PENDING',
  'PHASE_DRUG_PENDING',
  'OFFER_EXPIRED',
  'WORKER_WITHDRAWN',
] as const;

export type HiringBlockerCode = (typeof HIRING_BLOCKER_CODES)[number];

/**
 * Core lifecycle fields produced by the pure builder (no timestamps).
 * Callers merge onto Firestore with `merge: true`.
 */
export type HiringLifecycleCore = {
  stage: HiringLifecycleStage;
  /** Required for terminal `abandoned` whenever the reason is known. */
  subStatus?: string;
  blockers?: string[];
  nextAction?: HiringNextAction;
};

/**
 * Full persisted shape (includes optional audit timestamps).
 * Timestamps are applied by `applyHiringLifecycleTimestampMetadata`, not by `buildHiringLifecyclePatch`.
 */
export type HiringLifecycle = HiringLifecycleCore & {
  stageEnteredAt?: Partial<Record<HiringLifecycleStage, string>>;
  updatedAt?: string;
};

export type HiringLifecyclePatchResult = {
  hiringLifecycle: HiringLifecycleCore;
};

/** AI hiring decision engine outputs (mirror of functions `evaluateAiHiringDecision`). */
export type AiHiringDecision = 'advance' | 'review' | 'hold' | 'reject';

/**
 * Reason codes from `evaluateAiHiringDecision` / orchestrator (extend when engine adds codes).
 * Kept as a string union for mapping; unknown strings are still handled at runtime.
 */
export type AiHiringReasonCode =
  | 'critical_flag_drug'
  | 'critical_flag_background'
  | 'critical_flag_physical'
  | 'moderate_flags_present'
  | 'below_score_threshold'
  | 'failed_job_requirement'
  | 'capacity_reached'
  | 'onboarding_throttled'
  | 'passed_all_checks'
  | 'advance_with_caution_flags'
  | 'interview_recommendation_review'
  | 'interview_recommendation_review_overridden'
  | 'not_in_top_percent'
  | 'recommendation_decline'
  | 'gig_path_eligible'
  | 'below_job_fit_threshold'
  | 'no_show_overlay_review'
  | 'operational_hard_block'
  | 'operational_soft_block';

export type AiHiringDecisionResultLike = {
  decision: AiHiringDecision;
  eligibleForAutoAdvance: boolean;
  reasonCodes: readonly AiHiringReasonCode[];
};

export type ApplicationCreateContext = {
  kind: 'application_create';
  /** Raw application status (e.g. draft, in_progress, submitted). */
  applicationStatus: string;
  /** Tenant/job: AI prescreen interview required before proceeding. */
  aiPrescreenInterviewRequired: boolean;
  /** Profile/eligibility evaluator satisfied. */
  profileEligible: boolean;
  /** Blocker codes when profile is not eligible. */
  profileBlockerCodes?: readonly string[];
  /** Present when interview already completed. */
  workerAiPrescreenInterviewCompletedAt?: unknown | null;
};

export type StageUpdateIntent =
  | 'recruiter_reject'
  | 'worker_withdraw'
  | 'manual_waitlist'
  | 'manual_review'
  | 'other';

export type StageUpdateContext = {
  kind: 'stage_update';
  /** Next legacy `status` being written (dual-write). */
  nextLegacyStatus: string;
  /** Disambiguate when status alone is not enough. */
  intent?: StageUpdateIntent;
};

export type InterviewSubmitContext = {
  kind: 'interview_submit';
  hiringResult: AiHiringDecisionResultLike;
  /** True when Phase 6 actually wrote `aiAutomationQueue` (pending advance). */
  phase6AutomationQueued: boolean;
};

export type HiringLifecyclePatchContext =
  | ApplicationCreateContext
  | StageUpdateContext
  | InterviewSubmitContext;
