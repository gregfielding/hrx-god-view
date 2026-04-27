import { normalizeApplicationStatus } from './applicationStatusNormalize';

function isTruthyCompletedInterview(data: Record<string, unknown>): boolean {
  return data.workerAiPrescreenInterviewCompletedAt != null;
}

/**
 * Mirrors `functions/src/workerAiPrescreen/hiringContainerStats.ts` countsForApplicationDoc
 * so the Hiring control panel matches orchestrator stats definitions.
 */
export function countsForApplicationDoc(
  data: Record<string, unknown>,
  workerAiPrescreenRequired: boolean,
): {
  ready: boolean;
  onboarding: boolean;
  applicant: boolean;
  interviewed: boolean;
} {
  const status = normalizeApplicationStatus(String(data.status ?? ''));
  const ready = status === 'accepted';
  const onboarding = status === 'interview' || status === 'offer_pending';
  const applicant = status !== 'withdrawn';
  const prescreenCountsAsInterview =
    workerAiPrescreenRequired === false
      ? status === 'submitted' || isTruthyCompletedInterview(data)
      : isTruthyCompletedInterview(data);
  const interviewed =
    status === 'interview' ||
    status === 'offer_pending' ||
    status === 'accepted' ||
    prescreenCountsAsInterview;
  return { ready, onboarding, applicant, interviewed };
}

export function aggregatePeerApplicationStats(
  rows: Array<{ data: () => Record<string, unknown> }>,
  workerAiPrescreenRequired: boolean,
): {
  totalApplicants: number;
  interviewed: number;
  ready: number;
  onboardingPipeline: number;
} {
  let totalApplicants = 0;
  let interviewed = 0;
  let ready = 0;
  let onboardingPipeline = 0;
  for (const row of rows) {
    const data = row.data();
    const c = countsForApplicationDoc(data, workerAiPrescreenRequired);
    if (c.ready) ready += 1;
    if (c.onboarding) onboardingPipeline += 1;
    if (c.applicant) totalApplicants += 1;
    if (c.interviewed) interviewed += 1;
  }
  return { totalApplicants, interviewed, ready, onboardingPipeline };
}
