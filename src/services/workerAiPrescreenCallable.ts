import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { WorkerAiPrescreenAnswers } from '../utils/workerAiPrescreenScore';

export type SubmitWorkerAiPrescreenInput = {
  answers: WorkerAiPrescreenAnswers;
  applicationId?: string | null;
};

export type SubmitWorkerAiPrescreenResult = {
  ok: boolean;
  overallScore: number;
  recommendation: string;
};

export async function submitWorkerAiPrescreenInterview(
  input: SubmitWorkerAiPrescreenInput,
): Promise<SubmitWorkerAiPrescreenResult> {
  const fn = httpsCallable(functions, 'submitWorkerAiPrescreenInterview');
  const res = await fn({
    answers: input.answers,
    applicationId: input.applicationId ?? null,
  });
  return res.data as SubmitWorkerAiPrescreenResult;
}
