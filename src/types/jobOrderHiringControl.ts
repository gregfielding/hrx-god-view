import { JOB_ORDER_HIRING_AUTOMATION_ENABLED } from '../constants/jobOrderHiringAutomationLaunch';

/**
 * Job order–level `aiHiring` overrides (merged with tenant defaults in Cloud Functions).
 * @see functions/src/workerAiPrescreen/aiHiringPolicyResolution.ts
 */
export type JobOrderAiHiringForm = {
  autoAdvanceEnabled: boolean;
  minimumScoreToAdvance?: number;
  maximumAutoAdvances?: number;
  targetReadyCount?: number;
  targetOnboardingCount?: number;
  stopWhenTargetReached?: boolean;
  allowGigFallback?: boolean;
  topPercentToAdvance?: number;
  minimumJobScoreGateEnabled?: boolean;
  minimumJobScoreToAdvance?: number;
  jobFitFailAction?: 'review' | 'hold';
  defaultCompany?: string;
  defaultWorksiteCity?: string;
  defaultWorksiteState?: string;
};

export const DEFAULT_JOB_ORDER_AI_HIRING_FORM: JobOrderAiHiringForm = {
  autoAdvanceEnabled: false,
};

/** Quality preset keys for the slider (maps to threshold bundles). */
export type HiringQualityPresetId = 'strict' | 'balanced' | 'fast';

export type HiringQualityPreset = {
  id: HiringQualityPresetId;
  label: string;
  minimumScoreToAdvance: number;
  topPercentToAdvance: number;
  minimumJobScoreToAdvance: number;
};

export const HIRING_QUALITY_PRESETS: readonly HiringQualityPreset[] = [
  { id: 'strict', label: 'Strict', minimumScoreToAdvance: 88, topPercentToAdvance: 15, minimumJobScoreToAdvance: 72 },
  { id: 'balanced', label: 'Balanced', minimumScoreToAdvance: 75, topPercentToAdvance: 35, minimumJobScoreToAdvance: 60 },
  { id: 'fast', label: 'Fast track', minimumScoreToAdvance: 65, topPercentToAdvance: 55, minimumJobScoreToAdvance: 50 },
] as const;

export function parseJobOrderAiHiringFromFirestore(raw: unknown): JobOrderAiHiringForm {
  const base: JobOrderAiHiringForm = { ...DEFAULT_JOB_ORDER_AI_HIRING_FORM };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const ws = o.defaultWorksite && typeof o.defaultWorksite === 'object' ? (o.defaultWorksite as Record<string, unknown>) : undefined;
  return {
    ...base,
    autoAdvanceEnabled: typeof o.autoAdvanceEnabled === 'boolean' ? o.autoAdvanceEnabled : base.autoAdvanceEnabled,
    minimumScoreToAdvance: num(o.minimumScoreToAdvance),
    maximumAutoAdvances: num(o.maximumAutoAdvances),
    targetReadyCount: num(o.targetReadyCount),
    targetOnboardingCount: num(o.targetOnboardingCount),
    stopWhenTargetReached: typeof o.stopWhenTargetReached === 'boolean' ? o.stopWhenTargetReached : undefined,
    allowGigFallback: typeof o.allowGigFallback === 'boolean' ? o.allowGigFallback : undefined,
    topPercentToAdvance: num(o.topPercentToAdvance),
    minimumJobScoreGateEnabled: typeof o.minimumJobScoreGateEnabled === 'boolean' ? o.minimumJobScoreGateEnabled : undefined,
    minimumJobScoreToAdvance: num(o.minimumJobScoreToAdvance),
    jobFitFailAction:
      o.jobFitFailAction === 'review' || o.jobFitFailAction === 'hold' ? o.jobFitFailAction : undefined,
    defaultCompany: typeof o.defaultCompany === 'string' ? o.defaultCompany : undefined,
    defaultWorksiteCity: ws && typeof ws.city === 'string' ? ws.city : undefined,
    defaultWorksiteState: ws && typeof ws.state === 'string' ? ws.state : undefined,
  };
}

export function toFirestoreJobOrderAiHiring(form: JobOrderAiHiringForm): Record<string, unknown> {
  const automationActive = JOB_ORDER_HIRING_AUTOMATION_ENABLED;
  const o: Record<string, unknown> = {};
  if (automationActive) {
    o.autoAdvanceEnabled = form.autoAdvanceEnabled;
    if (form.allowGigFallback !== undefined) o.allowGigFallback = form.allowGigFallback;
  } else {
    o.autoAdvanceEnabled = false;
    o.allowGigFallback = false;
  }
  if (form.minimumScoreToAdvance !== undefined) o.minimumScoreToAdvance = form.minimumScoreToAdvance;
  if (form.maximumAutoAdvances !== undefined) o.maximumAutoAdvances = form.maximumAutoAdvances;
  if (form.targetReadyCount !== undefined) o.targetReadyCount = form.targetReadyCount;
  if (form.targetOnboardingCount !== undefined) o.targetOnboardingCount = form.targetOnboardingCount;
  if (form.stopWhenTargetReached !== undefined) o.stopWhenTargetReached = form.stopWhenTargetReached;
  if (form.topPercentToAdvance !== undefined) o.topPercentToAdvance = form.topPercentToAdvance;
  if (form.minimumJobScoreGateEnabled !== undefined) o.minimumJobScoreGateEnabled = form.minimumJobScoreGateEnabled;
  if (form.minimumJobScoreToAdvance !== undefined) o.minimumJobScoreToAdvance = form.minimumJobScoreToAdvance;
  if (form.jobFitFailAction !== undefined) o.jobFitFailAction = form.jobFitFailAction;
  if (form.defaultCompany !== undefined && form.defaultCompany !== '') o.defaultCompany = form.defaultCompany;
  if (form.defaultWorksiteCity !== undefined || form.defaultWorksiteState !== undefined) {
    o.defaultWorksite = {
      ...(form.defaultWorksiteCity !== undefined ? { city: form.defaultWorksiteCity } : {}),
      ...(form.defaultWorksiteState !== undefined ? { state: form.defaultWorksiteState } : {}),
    };
  }
  return o;
}

export function presetIndexFromThresholds(form: JobOrderAiHiringForm): number {
  const scores = HIRING_QUALITY_PRESETS.map((p) => p.minimumScoreToAdvance);
  const m = form.minimumScoreToAdvance;
  if (typeof m !== 'number' || !Number.isFinite(m)) return 1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < scores.length; i++) {
    const d = Math.abs(m - scores[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
