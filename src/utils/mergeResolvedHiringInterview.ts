/**
 * Client-side merge for `hiringConfig.interview` — keep in sync with
 * `functions/src/workerAiPrescreen/aiHiringPolicyResolution.ts` (`mergeHiringInterview` + reads).
 * Order: tenant document → optional container (job order or group). Posting overrides are server-only here.
 */

export type ResolvedHiringInterviewClient = {
  interviewType: 'worker_ai_prescreen';
  workerAiPrescreenRequired: boolean;
};

const DEFAULT: ResolvedHiringInterviewClient = {
  interviewType: 'worker_ai_prescreen',
  workerAiPrescreenRequired: true,
};

function readPartial(doc: Record<string, unknown> | null | undefined): Partial<ResolvedHiringInterviewClient> {
  if (!doc || typeof doc !== 'object') return {};
  const hc = doc.hiringConfig as Record<string, unknown> | undefined;
  if (!hc || typeof hc !== 'object') return {};
  const interview = hc.interview as Record<string, unknown> | undefined;
  if (!interview || typeof interview !== 'object') return {};
  const out: Partial<ResolvedHiringInterviewClient> = {};
  if (interview.interviewType === 'worker_ai_prescreen') {
    out.interviewType = 'worker_ai_prescreen';
  }
  if (typeof interview.workerAiPrescreenRequired === 'boolean') {
    out.workerAiPrescreenRequired = interview.workerAiPrescreenRequired;
  }
  return out;
}

/** Tenant first, then container (job order or group) overrides. */
export function mergeResolvedHiringInterview(
  tenant: Record<string, unknown>,
  container: Record<string, unknown> | null | undefined,
): ResolvedHiringInterviewClient {
  let interviewType = DEFAULT.interviewType;
  let workerAiPrescreenRequired = DEFAULT.workerAiPrescreenRequired;
  for (const p of [readPartial(tenant), readPartial(container ?? undefined)]) {
    if (p.interviewType === 'worker_ai_prescreen') interviewType = p.interviewType;
    if (typeof p.workerAiPrescreenRequired === 'boolean') workerAiPrescreenRequired = p.workerAiPrescreenRequired;
  }
  return { interviewType, workerAiPrescreenRequired };
}
