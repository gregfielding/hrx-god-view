/**
 * Pure hiring lifecycle patch builder for dual-write on application documents.
 * **Mirror of `shared/hiringLifecyclePatch.ts`** — CRA cannot import outside `src/`; only import path differs (`applicationStatus`).
 * Timestamps: use `applyHiringLifecycleTimestampMetadata` outside the decision core.
 */

import { normalizeApplicationStatus, type ApplicationStatus } from '../utils/applicationStatusNormalize';
import { mapInterviewSubmitToLifecycleCore } from './hiringLifecycleInterviewSubmitMap';
import type {
  ApplicationCreateContext,
  HiringLifecycle,
  HiringLifecycleCore,
  HiringLifecyclePatchContext,
  HiringLifecyclePatchResult,
  HiringLifecycleStage,
  InterviewSubmitContext,
  StageUpdateContext,
} from './hiringLifecycleTypes';

export type { HiringLifecyclePatchContext, HiringLifecyclePatchResult, HiringLifecycleCore, HiringLifecycle };

export { mapInterviewSubmitToLifecycleCore } from './hiringLifecycleInterviewSubmitMap';
export {
  AI_REASON_CODE_TO_BLOCKER,
  blockersFromAiReasonCodes,
  abandonedSubStatusFromInterviewSubmit,
} from './hiringLifecycleInterviewSubmitMap';

function isDraftOrInProgress(status: string): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s === 'draft' || s === 'in_progress';
}

function isSubmittedLike(status: string): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s === 'submitted' || s === 'pending' || s === 'new' || s === 'applied';
}

export function buildHiringLifecycleOnApplicationCreate(
  input: Omit<ApplicationCreateContext, 'kind'>,
): HiringLifecyclePatchResult {
  return buildHiringLifecyclePatch({ kind: 'application_create', ...input });
}

export function buildHiringLifecycleOnStageUpdate(
  input: Omit<StageUpdateContext, 'kind'>,
): HiringLifecyclePatchResult {
  return buildHiringLifecyclePatch({ kind: 'stage_update', ...input });
}

export function buildHiringLifecycleOnInterviewSubmit(
  input: Omit<InterviewSubmitContext, 'kind'>,
): HiringLifecyclePatchResult {
  return buildHiringLifecyclePatch({ kind: 'interview_submit', ...input });
}

function buildFromApplicationCreate(ctx: ApplicationCreateContext): HiringLifecycleCore {
  const { applicationStatus, aiPrescreenInterviewRequired, profileEligible, profileBlockerCodes } = ctx;

  if (isDraftOrInProgress(applicationStatus)) {
    return {
      stage: 'applied',
      subStatus: String(applicationStatus).trim().toLowerCase() === 'draft' ? 'draft' : 'wizard_in_progress',
      nextAction: 'none',
    };
  }

  if (!profileEligible) {
    const blockers = (profileBlockerCodes ?? []).filter(Boolean);
    return {
      stage: 'profile_incomplete',
      subStatus: 'profile_gates_incomplete',
      blockers: blockers.length ? [...blockers] : ['ELIGIBILITY_RESUME_MISSING'],
      nextAction: 'worker_complete_prescreen',
    };
  }

  const interviewDone = ctx.workerAiPrescreenInterviewCompletedAt != null;

  if (aiPrescreenInterviewRequired && !interviewDone && isSubmittedLike(applicationStatus)) {
    return {
      stage: 'interview_pending',
      subStatus: 'ai_prescreen_not_started',
      blockers: ['INTERVIEW_NOT_COMPLETED'],
      nextAction: 'worker_schedule_interview',
    };
  }

  return {
    stage: 'applied',
    subStatus: 'submitted',
    nextAction: 'none',
  };
}

const STAGE_UPDATE_BY_CANONICAL: Record<
  ApplicationStatus,
  { stage: HiringLifecycleCore['stage']; subStatus?: string; nextAction?: HiringLifecycleCore['nextAction'] }
> = {
  submitted: { stage: 'applied', subStatus: 'submitted', nextAction: 'none' },
  under_review: { stage: 'review', subStatus: 'manual_review_required', nextAction: 'recruiter_review' },
  interview: { stage: 'interview_pending', subStatus: 'legacy_status_interview', nextAction: 'worker_schedule_interview' },
  offer_pending: { stage: 'qualified', subStatus: 'offer_pending', nextAction: 'offer_follow_up' },
  accepted: { stage: 'hired', subStatus: 'assignment_accepted', nextAction: 'recruiter_confirm_hire' },
  rejected: { stage: 'abandoned', subStatus: 'rejected_by_recruiter', nextAction: 'none' },
  withdrawn: { stage: 'abandoned', subStatus: 'worker_withdrew', nextAction: 'none' },
  waitlisted: { stage: 'waitlisted', subStatus: 'manual_waitlist', nextAction: 'recruiter_decide_waitlist' },
};

function buildFromStageUpdate(ctx: StageUpdateContext): HiringLifecycleCore {
  const canonical = normalizeApplicationStatus(ctx.nextLegacyStatus);
  const intent = ctx.intent;

  if (intent === 'recruiter_reject') {
    return { stage: 'abandoned', subStatus: 'rejected_by_recruiter', nextAction: 'none' };
  }
  if (intent === 'worker_withdraw') {
    return { stage: 'abandoned', subStatus: 'worker_withdrew', nextAction: 'none' };
  }
  if (intent === 'manual_waitlist') {
    return { stage: 'waitlisted', subStatus: 'manual_waitlist', nextAction: 'recruiter_decide_waitlist' };
  }
  if (intent === 'manual_review') {
    return { stage: 'review', subStatus: 'manual_review_required', nextAction: 'recruiter_review' };
  }

  if (!canonical) {
    return { stage: 'applied', subStatus: 'legacy_unmapped_status', nextAction: 'none' };
  }

  const row = STAGE_UPDATE_BY_CANONICAL[canonical];
  return {
    stage: row.stage,
    subStatus: row.subStatus,
    nextAction: row.nextAction,
  };
}

export function buildHiringLifecyclePatch(ctx: HiringLifecyclePatchContext): HiringLifecyclePatchResult {
  if (ctx.kind === 'application_create') {
    return { hiringLifecycle: buildFromApplicationCreate(ctx) };
  }
  if (ctx.kind === 'stage_update') {
    return { hiringLifecycle: buildFromStageUpdate(ctx) };
  }
  return {
    hiringLifecycle: mapInterviewSubmitToLifecycleCore({
      hiringResult: ctx.hiringResult,
      phase6AutomationQueued: ctx.phase6AutomationQueued,
    }),
  };
}

export type ApplyHiringLifecycleTimestampMetadataArgs = {
  core: HiringLifecycleCore;
  previous?: HiringLifecycleCore | null;
  nowIso: string;
};

/**
 * Merges timestamp metadata for Firestore. Does not interpret business rules.
 * Call after the pure builder, before `set`/`updateDoc`.
 */
export function applyHiringLifecycleTimestampMetadata(args: ApplyHiringLifecycleTimestampMetadataArgs): HiringLifecycle {
  const { core, previous, nowIso } = args;
  const prevStage = previous?.stage;
  const nextStage = core.stage;

  const prevEntered = (previous as HiringLifecycle | undefined)?.stageEnteredAt ?? {};
  const stageEnteredAt: Partial<Record<HiringLifecycleStage, string>> = { ...prevEntered };
  if (prevStage !== nextStage) {
    stageEnteredAt[nextStage] = nowIso;
  }

  return {
    ...core,
    stageEnteredAt,
    updatedAt: nowIso,
  };
}
