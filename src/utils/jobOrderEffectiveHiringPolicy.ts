/**
 * Client-side effective hiring policy for a job order (tenant → job order merge),
 * aligned with `functions/src/workerAiPrescreen/aiHiringPolicyResolution.ts`.
 */

import { JOB_ORDER_HIRING_AUTOMATION_ENABLED } from '../constants/jobOrderHiringAutomationLaunch';

export type ResolvedHiringInterviewPolicy = {
  interviewType: 'worker_ai_prescreen';
  workerAiPrescreenRequired: boolean;
};

export const DEFAULT_RESOLVED_HIRING_INTERVIEW: ResolvedHiringInterviewPolicy = {
  interviewType: 'worker_ai_prescreen',
  workerAiPrescreenRequired: true,
};

export type ResolvedAiHiringPolicy = {
  autoAdvanceEnabled: boolean;
  minimumScoreToAdvance?: number;
  minimumJobScoreGateEnabled?: boolean;
  minimumJobScoreToAdvance?: number;
  jobFitFailAction?: 'review' | 'hold';
  /** See `ResolvedAiHiringPolicy.maximumNoShowRiskToAdvance` in `functions/src/workerAiPrescreen/aiHiringPolicyResolution.ts`. */
  maximumNoShowRiskToAdvance?: number;
  maximumAutoAdvances?: number;
  targetReadyCount?: number;
  targetOnboardingCount?: number;
  stopWhenTargetReached?: boolean;
  allowGigFallback?: boolean;
  topPercentToAdvance?: number;
  defaultCompany?: string;
  defaultWorksite?: { city?: string; state?: string; address?: string };
};

export const DEFAULT_RESOLVED_AI_HIRING: ResolvedAiHiringPolicy = {
  autoAdvanceEnabled: false,
};

export type JobOrderHiringPolicySourceKind = 'tenant_defaults' | 'partial_override' | 'full_custom';

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function readAiHiringPartial(raw: unknown): Partial<ResolvedAiHiringPolicy> {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const ws = o.defaultWorksite;
  let defaultWorksite: ResolvedAiHiringPolicy['defaultWorksite'];
  if (ws && typeof ws === 'object') {
    const w = ws as Record<string, unknown>;
    defaultWorksite = {
      city: norm(w.city) || undefined,
      state: norm(w.state) || undefined,
      address: norm(w.address) || undefined,
    };
  }
  return {
    autoAdvanceEnabled: typeof o.autoAdvanceEnabled === 'boolean' ? o.autoAdvanceEnabled : undefined,
    minimumScoreToAdvance: num(o.minimumScoreToAdvance),
    minimumJobScoreGateEnabled: typeof o.minimumJobScoreGateEnabled === 'boolean' ? o.minimumJobScoreGateEnabled : undefined,
    minimumJobScoreToAdvance: num(o.minimumJobScoreToAdvance),
    jobFitFailAction:
      o.jobFitFailAction === 'review' || o.jobFitFailAction === 'hold' ? o.jobFitFailAction : undefined,
    maximumNoShowRiskToAdvance: num(o.maximumNoShowRiskToAdvance),
    maximumAutoAdvances: num(o.maximumAutoAdvances),
    targetReadyCount: num(o.targetReadyCount),
    targetOnboardingCount: num(o.targetOnboardingCount),
    stopWhenTargetReached: typeof o.stopWhenTargetReached === 'boolean' ? o.stopWhenTargetReached : undefined,
    allowGigFallback: typeof o.allowGigFallback === 'boolean' ? o.allowGigFallback : undefined,
    topPercentToAdvance: num(o.topPercentToAdvance),
    defaultCompany: norm(o.defaultCompany) || undefined,
    defaultWorksite,
  };
}

function mergeAiHiring(
  tenantPartial: Partial<ResolvedAiHiringPolicy>,
  containerPartial: Partial<ResolvedAiHiringPolicy>,
): ResolvedAiHiringPolicy {
  const a = { ...DEFAULT_RESOLVED_AI_HIRING, ...tenantPartial, ...containerPartial };
  if (tenantPartial.defaultWorksite || containerPartial.defaultWorksite) {
    a.defaultWorksite = {
      ...tenantPartial.defaultWorksite,
      ...containerPartial.defaultWorksite,
    };
  }
  return a;
}

function readHiringConfigInterviewPartial(rawDoc: Record<string, unknown>): Partial<ResolvedHiringInterviewPolicy> {
  const hc = rawDoc.hiringConfig;
  if (!hc || typeof hc !== 'object') return {};
  const interview = (hc as Record<string, unknown>).interview;
  if (!interview || typeof interview !== 'object') return {};
  const iv = interview as Record<string, unknown>;
  const out: Partial<ResolvedHiringInterviewPolicy> = {};
  if (iv.interviewType === 'worker_ai_prescreen') {
    out.interviewType = 'worker_ai_prescreen';
  }
  if (typeof iv.workerAiPrescreenRequired === 'boolean') {
    out.workerAiPrescreenRequired = iv.workerAiPrescreenRequired;
  }
  return out;
}

function mergeHiringInterview(
  ...partials: Partial<ResolvedHiringInterviewPolicy>[]
): ResolvedHiringInterviewPolicy {
  let interviewType: ResolvedHiringInterviewPolicy['interviewType'] = DEFAULT_RESOLVED_HIRING_INTERVIEW.interviewType;
  let workerAiPrescreenRequired = DEFAULT_RESOLVED_HIRING_INTERVIEW.workerAiPrescreenRequired;
  for (const p of partials) {
    if (p.interviewType === 'worker_ai_prescreen') {
      interviewType = p.interviewType;
    }
    if (typeof p.workerAiPrescreenRequired === 'boolean') {
      workerAiPrescreenRequired = p.workerAiPrescreenRequired;
    }
  }
  return { interviewType, workerAiPrescreenRequired };
}

export function applyHiringAutomationPauseFromJobOrder(
  resolved: ResolvedAiHiringPolicy,
  job: Record<string, unknown>,
): ResolvedAiHiringPolicy {
  if (job.hiringAutomationPaused === true) {
    return {
      ...resolved,
      autoAdvanceEnabled: false,
      allowGigFallback: false,
    };
  }
  return resolved;
}

function applyGlobalAutomationLaunchGate(resolved: ResolvedAiHiringPolicy): ResolvedAiHiringPolicy {
  if (!JOB_ORDER_HIRING_AUTOMATION_ENABLED) {
    return {
      ...resolved,
      autoAdvanceEnabled: false,
      allowGigFallback: false,
    };
  }
  return resolved;
}

/** Count non-undefined keys in partial aiHiring read from Firestore. */
export function countExplicitAiHiringOverrideKeys(partial: Partial<ResolvedAiHiringPolicy>): number {
  let n = 0;
  (Object.keys(partial) as (keyof ResolvedAiHiringPolicy)[]).forEach((k) => {
    if (partial[k] !== undefined) n += 1;
  });
  return n;
}

/**
 * True when job order sets interview.prescreen required differently from tenant-only merge would yield,
 * or when any interview field is explicitly set on the job order doc.
 */
function jobOrderInterviewExplicitDelta(
  tenantData: Record<string, unknown>,
  jobOrderData: Record<string, unknown>,
): boolean {
  const tIv = readHiringConfigInterviewPartial(tenantData);
  const jIv = readHiringConfigInterviewPartial(jobOrderData);
  if (Object.keys(jIv).length === 0) return false;
  const tenantOnly = mergeHiringInterview(tIv);
  const withJob = mergeHiringInterview(tIv, jIv);
  return (
    withJob.workerAiPrescreenRequired !== tenantOnly.workerAiPrescreenRequired ||
    withJob.interviewType !== tenantOnly.interviewType
  );
}

export function classifyJobOrderPolicySource(
  tenantData: Record<string, unknown>,
  jobOrderData: Record<string, unknown>,
): JobOrderHiringPolicySourceKind {
  const jobPartial = readAiHiringPartial(jobOrderData.aiHiring);
  let score = countExplicitAiHiringOverrideKeys(jobPartial);
  if (jobOrderInterviewExplicitDelta(tenantData, jobOrderData)) score += 1;
  if (score === 0) return 'tenant_defaults';
  if (score >= 6) return 'full_custom';
  return 'partial_override';
}

export type EffectiveJobOrderHiringPolicy = {
  policySource: JobOrderHiringPolicySourceKind;
  resolvedAiHiring: ResolvedAiHiringPolicy;
  resolvedInterview: ResolvedHiringInterviewPolicy;
  /** Tenant `hiringConfig.quality.maximumNoShowRiskToAdvance` when present (job order type has no quality overlay in schema). */
  tenantMaxNoShowRiskToAdvance?: number;
};

export function resolveEffectiveJobOrderHiringPolicy(
  tenantData: Record<string, unknown>,
  jobOrderData: Record<string, unknown>,
): EffectiveJobOrderHiringPolicy {
  const tenantPartial = readAiHiringPartial(tenantData.aiHiring);
  const jobPartial = readAiHiringPartial(jobOrderData.aiHiring);
  let resolvedAiHiring = mergeAiHiring(tenantPartial, jobPartial);
  resolvedAiHiring = applyHiringAutomationPauseFromJobOrder(resolvedAiHiring, jobOrderData);
  resolvedAiHiring = applyGlobalAutomationLaunchGate(resolvedAiHiring);

  const tenantInterviewPartial = readHiringConfigInterviewPartial(tenantData);
  const jobInterviewPartial = readHiringConfigInterviewPartial(jobOrderData);
  const resolvedInterview = mergeHiringInterview(tenantInterviewPartial, jobInterviewPartial);

  const tHc = tenantData.hiringConfig as Record<string, unknown> | undefined;
  const tQuality = tHc?.quality as Record<string, unknown> | undefined;
  const maxNs = num(tQuality?.maximumNoShowRiskToAdvance);

  return {
    policySource: classifyJobOrderPolicySource(tenantData, jobOrderData),
    resolvedAiHiring,
    resolvedInterview,
    tenantMaxNoShowRiskToAdvance: maxNs,
  };
}
