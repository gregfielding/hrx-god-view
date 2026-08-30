import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { WorkerAiPrescreenDynamicStep } from '../types/workerAiPrescreenDynamic';
import type { WorkerAiPrescreenAnswers } from '../utils/workerAiPrescreenScore';
import type { PrescreenSessionProfileEnhancements } from '../utils/workerAiPrescreenSubmitProfileSnapshot';

export type SubmitWorkerAiPrescreenInput = {
  answers: WorkerAiPrescreenAnswers;
  applicationId?: string | null;
  /** Optional; speeds up application lookup and avoids collection-group ambiguity. */
  tenantId?: string | null;
  /** Answers for deterministic dynamic modules, keyed by step id. */
  dynamicAnswers?: Record<string, 'yes' | 'no' | 'not_sure'>;
  /**
   * Latest profile fields from the client session (merged on the server with a fresh `users/{uid}` read)
   * so scoring and hiring automation use end-of-interview profile state.
   */
  sessionProfileEnhancements?: PrescreenSessionProfileEnhancements;
  /**
   * Prescreen URL `entry` query param (e.g. `dashboard_cta`, `sms_auto_new_user`, `recent_user_backfill`).
   * Stored on the interview document when present; omit if unknown.
   */
  entry?: string | null;
  /**
   * Cumulative-interview delta mode: ids of steps actually rendered this session. Steps not listed
   * were carried from the worker's answer bank (server tags stored rows `source: 'carried'` and
   * keeps their bank freshness). Omit for full interviews.
   */
  askedStepIds?: string[] | null;
};

export type SubmitWorkerAiPrescreenResult = {
  ok: boolean;
  interviewId?: string;
  overallScore: number;
  recommendation: string;
  assignmentReadiness?: { status: string; reasons: string[] };
  alternatePaths?: { gigEligible?: boolean };
  hiringDecision?: {
    decision: string;
    eligibleForAutoAdvance: boolean;
    reasonCodes: string[];
  };
};

export async function submitWorkerAiPrescreenInterview(
  input: SubmitWorkerAiPrescreenInput,
): Promise<SubmitWorkerAiPrescreenResult> {
  const fn = httpsCallable(functions, 'submitWorkerAiPrescreenInterview');
  const res = await fn({
    answers: input.answers,
    applicationId: input.applicationId ?? null,
    tenantId: input.tenantId ?? null,
    dynamicAnswers: input.dynamicAnswers ?? null,
    sessionProfileEnhancements: input.sessionProfileEnhancements ?? null,
    entry: input.entry ?? null,
    askedStepIds: input.askedStepIds ?? null,
  });
  return res.data as SubmitWorkerAiPrescreenResult;
}

/** Which steps the worker's answer bank satisfies for this application (cumulative interview). */
export type WorkerAiPrescreenPlanBankCoverage = {
  coveredCoreStepIds: string[];
  coveredDynamicStepIds: string[];
  neededCoreStepIds: string[];
  neededDynamicStepIds: string[];
  zeroDelta: boolean;
  /** Fresh carriable bank answers to seed wizard state (arrays for multi-select ids). */
  bankCoreAnswers: Record<string, string | string[]>;
  bankDynamicAnswers: Record<string, string>;
};

/** INT-2 save/resume: in-progress answers stored server-side (users/{uid}/prescreen/session). */
export type WorkerAiPrescreenSavedSession = {
  lastStepId: string;
  lastStepIndex: number;
  draftAnswers: Record<string, string>;
  draftMultiAnswers: Record<string, string[]>;
  savedAt: number | null;
};

export type WorkerAiPrescreenInterviewPlanResult = {
  interviewType: 'worker_ai_prescreen';
  /** Server: `application` when `applicationId` was sent; `profile_first` when only tenant-based plan. */
  interviewMode?: 'application' | 'profile_first';
  workerAiPrescreenRequired: boolean;
  dynamicSteps: WorkerAiPrescreenDynamicStep[];
  /** Null/absent when the worker has no usable bank (full interview). */
  bankCoverage?: WorkerAiPrescreenPlanBankCoverage | null;
  /** Resumable drafts from a prior abandoned session (INT-2). */
  savedSession?: WorkerAiPrescreenSavedSession | null;
};

export async function getWorkerAiPrescreenInterviewPlan(input: {
  applicationId?: string | null;
  tenantId?: string | null;
  /** Invite-channel attribution for the funnel's "started" stage. */
  entry?: string | null;
}): Promise<WorkerAiPrescreenInterviewPlanResult> {
  const fn = httpsCallable(functions, 'getWorkerAiPrescreenInterviewPlan');
  const res = await fn({
    applicationId: input.applicationId ?? null,
    tenantId: input.tenantId ?? null,
    entry: input.entry ?? null,
  });
  return res.data as WorkerAiPrescreenInterviewPlanResult;
}

/** INT-2: persist in-progress answers (debounced from the page) so a closed
 *  tab resumes where it left off. Rides the plan callable's saveProgress mode. */
export async function saveWorkerAiPrescreenProgress(input: {
  applicationId?: string | null;
  lastStepId: string;
  lastStepIndex: number;
  totalSteps: number;
  draftAnswers: Record<string, string>;
  draftMultiAnswers: Record<string, string[]>;
}): Promise<void> {
  const fn = httpsCallable(functions, 'getWorkerAiPrescreenInterviewPlan');
  await fn({
    mode: 'saveProgress',
    applicationId: input.applicationId ?? null,
    progress: {
      lastStepId: input.lastStepId,
      lastStepIndex: input.lastStepIndex,
      totalSteps: input.totalSteps,
      draftAnswers: input.draftAnswers,
      draftMultiAnswers: input.draftMultiAnswers,
    },
  });
}
