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
  });
  return res.data as SubmitWorkerAiPrescreenResult;
}

export type WorkerAiPrescreenInterviewPlanResult = {
  interviewType: 'worker_ai_prescreen';
  workerAiPrescreenRequired: boolean;
  dynamicSteps: WorkerAiPrescreenDynamicStep[];
};

export async function getWorkerAiPrescreenInterviewPlan(input: {
  applicationId: string;
  tenantId?: string | null;
}): Promise<WorkerAiPrescreenInterviewPlanResult> {
  const fn = httpsCallable(functions, 'getWorkerAiPrescreenInterviewPlan');
  const res = await fn({
    applicationId: input.applicationId,
    tenantId: input.tenantId ?? null,
  });
  return res.data as WorkerAiPrescreenInterviewPlanResult;
}
