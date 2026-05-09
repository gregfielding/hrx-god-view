/**
 * AI hiring policy container (job order vs group) + tenant fallback.
 * @see docs/AI_HIRING_POLICY_CONTAINER_ARCHITECTURE.md
 *
 * Resolves Firestore-shaped config only — no automation side effects.
 */

import type * as admin from 'firebase-admin';
import type { AiHiringPolicyDecisionInput } from './evaluateAiHiringDecision';

/** Resolved `hiringConfig.interview` after tenant → posting → job order | group merge. */
export type ResolvedHiringInterviewPolicy = {
  interviewType: 'worker_ai_prescreen';
  /** When false, AI prescreen is optional: no outreach gating as “required”, stats treat submitted as unblocked. */
  workerAiPrescreenRequired: boolean;
};

export const DEFAULT_RESOLVED_HIRING_INTERVIEW: ResolvedHiringInterviewPolicy = {
  interviewType: 'worker_ai_prescreen',
  workerAiPrescreenRequired: true,
};

/** Normalized `aiHiring` after tenant + container merge (unset = not configured). */
export type ResolvedAiHiringPolicy = {
  autoAdvanceEnabled: boolean;
  minimumScoreToAdvance?: number;
  /** When true with `minimumJobScoreToAdvance`, compares to application job fit (`scores.fitScore`). */
  minimumJobScoreGateEnabled?: boolean;
  /** Job fit score threshold (0–100 style); only used when gate enabled and fit present. */
  minimumJobScoreToAdvance?: number;
  /** When job fit is below threshold (gate on). Default `review`. */
  jobFitFailAction?: 'review' | 'hold';
  /**
   * Upper bound on the no-show risk score (0–100) that still allows auto-advance. When set, the orchestrator's
   * `no_show_overlay` step compares **numeric** `aiAutomation.noShowRisk.score` (and assignment-level
   * `noShowRiskPredictionV1.score`) to this threshold and only downgrades to `review` when the candidate's score
   * is **strictly greater** than this value. When unset, legacy band behavior applies (block on
   * `high` or `critical` band, i.e. ≥ 50).
   *
   * Group preset defaults (when `hiringConfig.quality.maximumNoShowRiskToAdvance` is not explicitly set):
   * - `conservative` / `balanced`: `49` (legacy — block high/critical).
   * - `aggressive`: `100` (lift the overlay; preset signals "fill seats, accept higher operational risk").
   * - `hire_everyone`: `100`.
   */
  maximumNoShowRiskToAdvance?: number;
  /**
   * When true, the prescreen LLM's `recommendation === 'review'` is treated as `proceed` so the
   * remaining hiring gates (score floor, flags, dynamic answers, capacity, no-show overlay) do
   * the gating instead of the LLM's qualitative judgement.
   *
   * **User groups:** always `true` when `hiringConfig.quality` exists (`readGroupHiringConfigAsAiPartial`).
   * A legacy `userGroup.aiHiring.advanceOnReviewRecommendation: false` cannot disable this — see
   * `mergeGroupUserDocAiHiringPartial`.
   *
   * Job-order containers and tenant default: leave `undefined` (legacy: treat `review` as hold
   * until STEP 1b in `evaluateAiHiringDecision`).
   */
  advanceOnReviewRecommendation?: boolean;
  maximumAutoAdvances?: number;
  targetReadyCount?: number;
  targetOnboardingCount?: number;
  stopWhenTargetReached?: boolean;
  allowGigFallback?: boolean;
  topPercentToAdvance?: number;
  defaultCompany?: string;
  defaultWorksite?: {
    city?: string;
    state?: string;
    address?: string;
  };
};

export const DEFAULT_RESOLVED_AI_HIRING: ResolvedAiHiringPolicy = {
  autoAdvanceEnabled: false,
};

export type HiringContainerRef =
  | { kind: 'job_order'; jobOrderId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'none' };

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Preset defaults aligned with `GROUP_HIRING_QUALITY_PRESETS` in `src/types/userGroupHiringConfig.ts`.
 * Used when `hiringConfig.quality.preset` is set but explicit numeric overrides are absent.
 *
 * For group-scoped applications, `interview` is interpreted as the Master Recruiter Score floor
 * (the orchestrator substitutes Master for the prescreen overall via `gateScoreOverride`).
 */
const GROUP_HIRING_PRESET_SCORES: Record<string, { interview: number; jobFit: number }> = {
  conservative: { interview: 80, jobFit: 72 },
  balanced: { interview: 70, jobFit: 60 },
  aggressive: { interview: 60, jobFit: 50 },
  hire_everyone: { interview: 0, jobFit: 0 },
};

/**
 * Default `maximumNoShowRiskToAdvance` per preset when `hiringConfig.quality.maximumNoShowRiskToAdvance`
 * is not explicitly set on the user group.
 *
 * Aggressive / Hire-everyone "fill seats" presets implicitly lift the no-show overlay (orchestrator
 * step 2) the same way they implicitly lift the LLM `review` block (`advanceOnReviewRecommendation: true`).
 * Without this default, an aggressive preset still has every "high"/"critical" no-show-band candidate
 * downgraded to `review` regardless of the user's intent — which is what the “20 · Below score threshold
 * / orchestrator hold” diagnosis on `userGroups/DgpS7tIHXPcm65I8xR97` exposed.
 */
const GROUP_HIRING_PRESET_MAX_NS_RISK: Record<string, number> = {
  conservative: 49,
  balanced: 49,
  aggressive: 100,
  hire_everyone: 100,
};

/**
 * Maps Recruiter user-group `hiringConfig` (quality + automation + targets) into the same shape as `aiHiring`,
 * so `resolveAiHiringPolicyBundle` applies group D. Quality thresholds to the orchestrator — not only `userGroup.aiHiring`.
 * Explicit `userGroup.aiHiring` still wins per-field (merged after this partial).
 */
function readGroupHiringConfigAsAiPartial(groupDoc: Record<string, unknown>): Partial<ResolvedAiHiringPolicy> {
  const hc = groupDoc.hiringConfig;
  if (!hc || typeof hc !== 'object') return {};
  const h = hc as Record<string, unknown>;
  const out: Partial<ResolvedAiHiringPolicy> = {};

  const auto = h.automation;
  if (auto && typeof auto === 'object') {
    const a = auto as Record<string, unknown>;
    if (typeof a.autoAdvanceEnabled === 'boolean') out.autoAdvanceEnabled = a.autoAdvanceEnabled;
  }

  const targets = h.targets;
  if (targets && typeof targets === 'object') {
    const t = targets as Record<string, unknown>;
    const maxA = num(t.maximumAutoAdvances);
    const tgt = num(t.targetOnboardingCount);
    if (maxA !== undefined) out.maximumAutoAdvances = maxA;
    if (tgt !== undefined) out.targetOnboardingCount = tgt;
    if (typeof t.stopWhenTargetReached === 'boolean') out.stopWhenTargetReached = t.stopWhenTargetReached;
  }

  const q = h.quality;
  if (!q || typeof q !== 'object') return out;
  const qual = q as Record<string, unknown>;
  const presetKey = typeof qual.preset === 'string' ? String(qual.preset).toLowerCase() : '';
  const presetDefaults = GROUP_HIRING_PRESET_SCORES[presetKey];

  const iv = num(qual.interviewMinimumScoreToAdvance) ?? presetDefaults?.interview;
  const jf = num(qual.jobFitMinimumScoreToAdvance) ?? presetDefaults?.jobFit;
  if (iv !== undefined) out.minimumScoreToAdvance = iv;
  if (jf !== undefined) out.minimumJobScoreToAdvance = jf;
  if (typeof qual.minimumJobScoreGateEnabled === 'boolean') {
    out.minimumJobScoreGateEnabled = qual.minimumJobScoreGateEnabled;
  }
  if (qual.jobFitFailAction === 'hold' || qual.jobFitFailAction === 'review') {
    out.jobFitFailAction = qual.jobFitFailAction;
  }

  const explicitMaxNs = num(qual.maximumNoShowRiskToAdvance);
  if (explicitMaxNs !== undefined) {
    out.maximumNoShowRiskToAdvance = explicitMaxNs;
  } else if (presetKey && GROUP_HIRING_PRESET_MAX_NS_RISK[presetKey] !== undefined) {
    out.maximumNoShowRiskToAdvance = GROUP_HIRING_PRESET_MAX_NS_RISK[presetKey];
  }

  // User groups: never let the prescreen LLM's qualitative `review` verdict
  // block automation on its own — score floor, flags, dynamic answers, job-fit
  // gate, capacity, and hard `decline` still gate. Preset only changes numeric
  // floors (Conservative / Balanced / Aggressive / Custom / Hire everyone).
  out.advanceOnReviewRecommendation = true;
  return out;
}

/**
 * `readAiHiringPartial` used to return `{ field: undefined, ... }` for every
 * Firestore field that was absent. Spreading that object after
 * `readGroupHiringConfigAsAiPartial` (`{ ...fromHiringConfig, ...fromAiHiringDoc }`)
 * **clobbered** preset-derived values (e.g. `advanceOnReviewRecommendation: true`
 * for user groups, `minimumScoreToAdvance` from preset floors) with `undefined`.
 * Strip missing keys so partial merges behave as “only explicit overrides”.
 */
function omitUndefinedShallow<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

function readAiHiringPartial(raw: unknown): Partial<ResolvedAiHiringPolicy> {
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
  return omitUndefinedShallow({
    autoAdvanceEnabled: typeof o.autoAdvanceEnabled === 'boolean' ? o.autoAdvanceEnabled : undefined,
    minimumScoreToAdvance: num(o.minimumScoreToAdvance),
    minimumJobScoreGateEnabled: typeof o.minimumJobScoreGateEnabled === 'boolean' ? o.minimumJobScoreGateEnabled : undefined,
    minimumJobScoreToAdvance: num(o.minimumJobScoreToAdvance),
    jobFitFailAction:
      o.jobFitFailAction === 'review' || o.jobFitFailAction === 'hold' ? o.jobFitFailAction : undefined,
    maximumNoShowRiskToAdvance: num(o.maximumNoShowRiskToAdvance),
    advanceOnReviewRecommendation:
      typeof o.advanceOnReviewRecommendation === 'boolean' ? o.advanceOnReviewRecommendation : undefined,
    maximumAutoAdvances: num(o.maximumAutoAdvances),
    targetReadyCount: num(o.targetReadyCount),
    targetOnboardingCount: num(o.targetOnboardingCount),
    stopWhenTargetReached: typeof o.stopWhenTargetReached === 'boolean' ? o.stopWhenTargetReached : undefined,
    allowGigFallback: typeof o.allowGigFallback === 'boolean' ? o.allowGigFallback : undefined,
    topPercentToAdvance: num(o.topPercentToAdvance),
    defaultCompany: norm(o.defaultCompany) || undefined,
    defaultWorksite,
  });
}

/**
 * Merge `hiringConfig`-derived AI hiring partial with optional `userGroups/{id}.aiHiring`
 * overrides. Exported for unit tests (regression: sparse `aiHiring` must not clobber preset fields).
 */
export function mergeGroupUserDocAiHiringPartial(groupDoc: Record<string, unknown>): Partial<ResolvedAiHiringPolicy> {
  const fromHiringConfig = readGroupHiringConfigAsAiPartial(groupDoc);
  const fromAiHiringDoc = readAiHiringPartial(groupDoc.aiHiring);
  const merged = { ...fromHiringConfig, ...fromAiHiringDoc };
  // `hiringConfig.quality` always sets `advanceOnReviewRecommendation: true` for groups. A legacy
  // `userGroup.aiHiring.advanceOnReviewRecommendation: false` must not resurrect LLM-only review holds.
  if (fromHiringConfig.advanceOnReviewRecommendation === true) {
    merged.advanceOnReviewRecommendation = true;
  }
  return merged;
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

/**
 * Job order `hiringAutomationPaused: true` — pre-launch kill switch: no phase 6 queue, no auto-advance, no gig fallback
 * from policy (even if tenant defaults or stale `aiHiring` would enable them).
 */
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

/** Later layers override earlier: tenant → posting → job order | group. */
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

/**
 * Resolve interview policy for an application using the same tenant → posting → container merge as `resolveAiHiringPolicyBundle`.
 * Use from triggers/schedulers that only have the application document.
 */
export async function resolveHiringInterviewPolicyForApplication(
  db: admin.firestore.Firestore,
  tenantId: string,
  application: Record<string, unknown>,
): Promise<ResolvedHiringInterviewPolicy> {
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenantData = (tenantSnap.data() || {}) as Record<string, unknown>;
  const jobPostingId = String(application.jobId ?? application.job_id ?? '').trim();
  let posting: Record<string, unknown> = {};
  if (jobPostingId) {
    const pSnap = await db.doc(`tenants/${tenantId}/job_postings/${jobPostingId}`).get();
    if (pSnap.exists) posting = (pSnap.data() || {}) as Record<string, unknown>;
  }
  const bundle = await resolveAiHiringPolicyBundle(db, tenantId, tenantData, application, posting);
  return bundle.resolvedInterview;
}

/**
 * Step 1 — hiring container: job order from application/posting, else group when posting opts in.
 */
/** Maps resolved policy to the pure decision engine input (interview score gate, capacity, gig — not job-fit fields). */
export function toAiHiringPolicyDecisionInput(r: ResolvedAiHiringPolicy): AiHiringPolicyDecisionInput {
  return {
    autoAdvanceEnabled: r.autoAdvanceEnabled,
    minimumScoreToAdvance: r.minimumScoreToAdvance,
    maximumAutoAdvances: r.maximumAutoAdvances,
    targetReadyCount: r.targetReadyCount,
    targetOnboardingCount: r.targetOnboardingCount,
    stopWhenTargetReached: r.stopWhenTargetReached,
    allowGigFallback: r.allowGigFallback,
    topPercentToAdvance: r.topPercentToAdvance,
    advanceOnReviewRecommendation: r.advanceOnReviewRecommendation,
  };
}

export function resolveHiringContainer(
  application: Record<string, unknown>,
  posting: Record<string, unknown>,
): HiringContainerRef {
  const orderId = norm(application.jobOrderId) || norm(posting.jobOrderId);
  if (orderId) return { kind: 'job_order', jobOrderId: orderId };

  if (posting.autoAddToGroup === true) {
    const gid = norm(posting.groupId);
    if (gid) return { kind: 'group', groupId: gid };
  }

  return { kind: 'none' };
}

export type HiringPolicyBundle = {
  container: HiringContainerRef;
  resolvedAiHiring: ResolvedAiHiringPolicy;
  resolvedInterview: ResolvedHiringInterviewPolicy;
};

/**
 * Load tenant `aiHiring`, optional job_order / groups `aiHiring`, merge (container overrides tenant).
 */
export async function resolveAiHiringPolicyBundle(
  db: admin.firestore.Firestore,
  tenantId: string,
  tenantData: Record<string, unknown>,
  application: Record<string, unknown>,
  posting: Record<string, unknown>,
): Promise<HiringPolicyBundle> {
  const tenantPartial = readAiHiringPartial(tenantData.aiHiring);
  const tenantInterviewPartial = readHiringConfigInterviewPartial(tenantData);
  const postingInterviewPartial = readHiringConfigInterviewPartial(posting);
  const container = resolveHiringContainer(application, posting);

  if (container.kind === 'none') {
    return {
      container,
      resolvedAiHiring: mergeAiHiring(tenantPartial, {}),
      resolvedInterview: mergeHiringInterview(tenantInterviewPartial, postingInterviewPartial),
    };
  }

  if (container.kind === 'job_order') {
    const snap = await db.doc(`tenants/${tenantId}/job_orders/${container.jobOrderId}`).get();
    const job = (snap.data() || {}) as Record<string, unknown>;
    const jobPartial = readAiHiringPartial(job.aiHiring);
    const jobInterviewPartial = readHiringConfigInterviewPartial(job);
    let resolvedAiHiring = mergeAiHiring(tenantPartial, jobPartial);
    resolvedAiHiring = applyHiringAutomationPauseFromJobOrder(resolvedAiHiring, job);
    return {
      container,
      resolvedAiHiring,
      resolvedInterview: mergeHiringInterview(tenantInterviewPartial, postingInterviewPartial, jobInterviewPartial),
    };
  }

  const gSnap = await db.doc(`tenants/${tenantId}/userGroups/${container.groupId}`).get();
  const g = (gSnap.data() || {}) as Record<string, unknown>;
  const groupPartial = mergeGroupUserDocAiHiringPartial(g);
  const groupInterviewPartial = readHiringConfigInterviewPartial(g);
  return {
    container,
    resolvedAiHiring: mergeAiHiring(tenantPartial, groupPartial),
    resolvedInterview: mergeHiringInterview(tenantInterviewPartial, postingInterviewPartial, groupInterviewPartial),
  };
}

/**
 * Hire Passed / group hiring tool: always apply **`userGroups/{userGroupId}`** `hiringConfig` + `aiHiring`,
 * even when applications also carry a `jobOrderId` (otherwise `resolveAiHiringPolicyBundle` would use the job order).
 */
export async function resolveAiHiringPolicyBundleForUserGroupTool(
  db: admin.firestore.Firestore,
  tenantId: string,
  tenantData: Record<string, unknown>,
  postingData: Record<string, unknown>,
  userGroupId: string,
): Promise<HiringPolicyBundle> {
  const tenantPartial = readAiHiringPartial(tenantData.aiHiring);
  const tenantInterviewPartial = readHiringConfigInterviewPartial(tenantData);
  const postingInterviewPartial = readHiringConfigInterviewPartial(postingData);

  const gSnap = await db.doc(`tenants/${tenantId}/userGroups/${userGroupId}`).get();
  const g = (gSnap.exists ? gSnap.data() : {}) as Record<string, unknown>;
  const groupPartial = mergeGroupUserDocAiHiringPartial(g);
  const groupInterviewPartial = readHiringConfigInterviewPartial(g);

  return {
    container: { kind: 'group', groupId: userGroupId },
    resolvedAiHiring: mergeAiHiring(tenantPartial, groupPartial),
    resolvedInterview: mergeHiringInterview(tenantInterviewPartial, postingInterviewPartial, groupInterviewPartial),
  };
}
