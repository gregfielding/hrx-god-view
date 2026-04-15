import {
  GROUP_HIRING_QUALITY_PRESETS,
  validateUserGroupHiringConfig,
  type UserGroupHiringConfigV1,
} from '../types/userGroupHiringConfig';
import { normalizeApplicationStatus } from './applicationStatusNormalize';
import { countsForApplicationDoc } from './jobOrderApplicationHiringStats';

/** Derived from automation + target + live counts (not validation). */
export type HiringPipelineHiringState =
  | 'inactive'
  | 'active'
  | 'target_queueing'
  | 'target_holding';

export type HiringUxChipColor = 'default' | 'success' | 'warning' | 'error';

/**
 * Final badge label for the pipeline header (validation + operational state).
 */
export function getUserGroupHiringUxDisplay(
  cfg: UserGroupHiringConfigV1,
  metrics: GroupHiringPipelineMetrics,
): { label: string; color: HiringUxChipColor } {
  const v = validateUserGroupHiringConfig(cfg);
  if (v.ok === false) {
    return { label: 'Configuration incomplete', color: 'error' };
  }

  const st = metrics.hiringState;
  if (st === 'inactive') return { label: 'Inactive', color: 'default' };
  if (st === 'target_queueing') return { label: 'Target reached — queueing', color: 'warning' };
  if (st === 'target_holding') return { label: 'Target reached — holding', color: 'warning' };
  return { label: 'Hiring active', color: 'success' };
}

export type GroupHiringPipelineMetrics = {
  /** Rows in the pipeline table: application docs, or one per worker when on-call dedupe is active. */
  totalApplications: number;
  /** Completed AI prescreen (or equivalent interviewed signal). */
  interviewed: number;
  /** Passes interview + optional job-fit + optional no-show thresholds (see `passesQualityGates`). */
  qualified: number;
  /** `aiAutomation.decision === 'advance'`. */
  autoAdvanced: number;
  /** Accepted hires (`status` canonical accepted). */
  onboardingAccepted: number;
  /** In interview / offer_pending stages (pipeline). */
  onboardingInFlow: number;
  /** Sum used for onboarding / target progress bar (accepted + in-flow onboarding stages). */
  currentOnboardingForTarget: number;
  /** `waitlisted` or capacity-style hold (approximate). */
  queued: number;
  hiringState: HiringPipelineHiringState;
};

const CAPACITY_REASON_HINTS = ['capacity_reached', 'capacity', 'target'];

function getAi(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const ai = data.aiAutomation;
  return ai && typeof ai === 'object' ? (ai as Record<string, unknown>) : undefined;
}

/**
 * Same rules as `extractOrchestratorDecision` in `userGroupHirePassedCandidates` (Cloud Functions).
 * Reads legacy `aiAutomation.decision` first, else `orchestratorV1.finalResult` / `policyEngineResult`.
 */
export function extractStoredOrchestratorDecision(data: Record<string, unknown>): string | null {
  const aa = data.aiAutomation as Record<string, unknown> | undefined;
  if (!aa || typeof aa !== 'object') return null;
  const legacy = aa.decision;
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim().toLowerCase();
  const v1 = aa.orchestratorV1 as Record<string, unknown> | undefined;
  if (!v1 || typeof v1 !== 'object') return null;
  const final = v1.finalResult as Record<string, unknown> | undefined;
  const policyEngine = v1.policyEngineResult as Record<string, unknown> | undefined;
  const fr =
    final && typeof final.decision === 'string'
      ? final
      : policyEngine && typeof policyEngine.decision === 'string'
        ? policyEngine
        : final ?? policyEngine;
  const decRaw = fr && typeof fr.decision === 'string' ? fr.decision : '';
  return decRaw ? decRaw.trim().toLowerCase() : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function docSortTimestamp(data: Record<string, unknown>): number {
  const u = data.updatedAt;
  if (u && typeof u === 'object' && u !== null && 'seconds' in u) {
    const s = (u as { seconds?: unknown }).seconds;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  if (
    u &&
    typeof u === 'object' &&
    u !== null &&
    'toMillis' in u &&
    typeof (u as { toMillis: () => number }).toMillis === 'function'
  ) {
    try {
      return (u as { toMillis: () => number }).toMillis() / 1000;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Mirrors orchestrator intent: interview score, optional job-fit gate, optional no-show ceiling.
 */
export function passesQualityGates(data: Record<string, unknown>, cfg: UserGroupHiringConfigV1): boolean {
  const qual = cfg.quality ?? {};
  const preset = qual.preset ?? 'balanced';
  const fallback = GROUP_HIRING_QUALITY_PRESETS[preset];
  const interviewMin = qual.interviewMinimumScoreToAdvance ?? fallback.interviewMinimumScoreToAdvance;
  const jobFitMin = qual.jobFitMinimumScoreToAdvance ?? fallback.jobFitMinimumScoreToAdvance;
  const gateOn = qual.minimumJobScoreGateEnabled === true;
  const maxNs = qual.maximumNoShowRiskToAdvance;

  const ai = getAi(data);
  const interviewScore = num(ai?.score);
  if (interviewScore == null) return false;
  if (interviewScore < interviewMin) return false;

  const scores = data.scores as Record<string, unknown> | undefined;
  const fit = scores && typeof scores.fitScore === 'number' && Number.isFinite(scores.fitScore) ? scores.fitScore : null;
  if (gateOn) {
    if (fit == null || fit < jobFitMin) return false;
  }

  const ns = ai?.noShowRisk as Record<string, unknown> | undefined;
  const nsScore = ns && typeof ns.score === 'number' && Number.isFinite(ns.score) ? ns.score : null;
  if (typeof maxNs === 'number' && Number.isFinite(maxNs)) {
    if (nsScore == null) return false;
    if (nsScore > maxNs) return false;
  }

  return true;
}

function reasonCodesCapacity(ai: Record<string, unknown> | undefined): boolean {
  const rc = ai?.reasonCodes;
  if (!Array.isArray(rc)) return false;
  return rc.some((c) => {
    const s = String(c).toLowerCase();
    return CAPACITY_REASON_HINTS.some((h) => s.includes(h));
  });
}

/**
 * Aggregate metrics for group-scoped applications: `groupId` match **or** applications for users in the group’s
 * `memberIds` (same union as `userGroupHirePassedCandidates`).
 * Definitions align with `jobOrderApplicationHiringStats` / `hiringContainerStats` where possible.
 */
export function aggregateGroupHiringPipeline(
  docs: Record<string, unknown>[],
  cfg: UserGroupHiringConfigV1,
): GroupHiringPipelineMetrics {
  const prescreenRequired = cfg.interview?.workerAiPrescreenRequired !== false;

  let interviewed = 0;
  let qualified = 0;
  let autoAdvanced = 0;
  let onboardingAccepted = 0;
  let onboardingInFlow = 0;
  let queued = 0;

  for (const data of docs) {
    const c = countsForApplicationDoc(data, prescreenRequired);
    if (c.interviewed) interviewed += 1;
    if (passesQualityGates(data, cfg)) qualified += 1;

    const ai = getAi(data);
    const orch = extractStoredOrchestratorDecision(data);
    if (orch === 'advance') autoAdvanced += 1;

    if (c.ready) onboardingAccepted += 1;
    if (c.onboarding) onboardingInFlow += 1;

    const statusLower = String(data.status ?? '')
      .trim()
      .toLowerCase();
    if (statusLower === 'waitlisted') queued += 1;
    else if (reasonCodesCapacity(ai)) queued += 1;
    else if (ai && ai.decision === 'hold' && ai.priorityBucket === 'hold_pool') queued += 1;
  }

  const currentOnboardingForTarget = onboardingAccepted + onboardingInFlow;

  const auto = cfg.automation ?? {};
  const tgt = cfg.targets ?? {};
  const target = tgt.targetOnboardingCount;
  const hiringActive = auto.hiringActive === true;
  const queueAfter = auto.queueAfterTargetReached === true;

  let hiringState: HiringPipelineHiringState = 'active';
  if (!hiringActive) {
    hiringState = 'inactive';
  } else if (
    typeof target === 'number' &&
    Number.isFinite(target) &&
    target >= 1 &&
    currentOnboardingForTarget >= target
  ) {
    hiringState = queueAfter ? 'target_queueing' : 'target_holding';
  }

  return {
    totalApplications: docs.length,
    interviewed,
    qualified,
    autoAdvanced,
    onboardingAccepted,
    onboardingInFlow,
    currentOnboardingForTarget,
    queued,
    hiringState,
  };
}

/**
 * On-call / labor-pool hiring: recruiters care about **people**, not every job-specific application row.
 * When this is true, pipeline metrics and policy-impact rows use {@link dedupeApplicationsForOnCallPool}.
 */
export function isOnCallMemberCentricPipeline(cfg: UserGroupHiringConfigV1): boolean {
  return cfg.employment?.employmentType === 'on_call';
}

function compareOnCallCanonicalDocs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  groupId: string,
): number {
  const gid = String(groupId || '').trim();
  const aGroup = gid && String(a.groupId || '').trim() === gid ? 1 : 0;
  const bGroup = gid && String(b.groupId || '').trim() === gid ? 1 : 0;
  if (aGroup !== bGroup) return bGroup - aGroup;

  const aScore = num(getAi(a)?.score);
  const bScore = num(getAi(b)?.score);
  const av = aScore ?? Number.NEGATIVE_INFINITY;
  const bv = bScore ?? Number.NEGATIVE_INFINITY;
  if (av !== bv) return av > bv ? -1 : 1;

  const ta = docSortTimestamp(a);
  const tb = docSortTimestamp(b);
  return tb - ta;
}

/**
 * Reduces the application union to **one document per worker** for on-call pool UX.
 * Preference: app with this `groupId` → highest AI interview score → most recently updated.
 * Rows with no `userId`/`candidateId` are kept as-is (one row each).
 */
export function dedupeApplicationsForOnCallPool(
  docs: Record<string, unknown>[],
  groupId: string,
): Record<string, unknown>[] {
  const gid = String(groupId || '').trim();
  const byUser = new Map<string, Record<string, unknown>[]>();
  const noUid: Record<string, unknown>[] = [];

  for (const d of docs) {
    const uidRaw = d.userId ?? d.candidateId;
    const uid = typeof uidRaw === 'string' && uidRaw.trim() ? uidRaw.trim() : null;
    if (!uid) {
      noUid.push(d);
      continue;
    }
    const list = byUser.get(uid) ?? [];
    list.push(d);
    byUser.set(uid, list);
  }

  const picked: Record<string, unknown>[] = [];
  for (const list of byUser.values()) {
    if (list.length === 1) {
      picked.push(list[0]);
      continue;
    }
    const sorted = [...list].sort((a, b) => compareOnCallCanonicalDocs(a, b, gid));
    picked.push(sorted[0]);
  }
  return [...picked, ...noUid];
}

export type HiringSimulationResult = {
  /** Pass interview + job-fit + no-show gates. */
  qualify: number;
  /** Would waitlist when onboarding target is already full (sequential slots). */
  queue: number;
  /** Failed interview score gate. */
  reject: number;
  /** Job-fit / no-show / or passed gates with auto-advance off. */
  hold: number;
};

/**
 * Lightweight preview using member AI scores as stand-ins for interview + job-fit.
 */
export type GroupQueuedCandidateRow = {
  id: string;
  label: string;
  score?: number;
  holdReason?: string;
};

function applicationLabel(data: Record<string, unknown>): string {
  const cand = data.candidate as Record<string, unknown> | undefined;
  const fromNested = [cand?.firstName, cand?.lastName]
    .filter((x) => typeof x === 'string' && x.trim())
    .join(' ');
  if (fromNested) return fromNested;

  const direct = String(data.applicantName || data.displayName || '').trim();
  if (direct) return direct;

  const fnRoot = String(data.firstName ?? '').trim();
  const lnRoot = String(data.lastName ?? '').trim();
  const fromRoot = [fnRoot, lnRoot].filter(Boolean).join(' ');
  if (fromRoot) return fromRoot;

  const uid = data.userId ?? data.candidateId;
  if (uid) return String(uid);
  return 'Candidate';
}

const STAGE_LABELS: Partial<Record<string, string>> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  interview: 'Interview',
  offer_pending: 'Offer pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  waitlisted: 'Waitlisted',
};

function formatApplicationStageLabel(data: Record<string, unknown>): string {
  const n = normalizeApplicationStatus(String(data.status ?? ''));
  if (n == null) return String(data.status ?? 'Unknown').trim() || 'Unknown';
  return STAGE_LABELS[n] ?? n;
}

/** Short, recruiter-facing policy reason (stable vocabulary). */
export type PolicyWhyLabel =
  | 'Below interview threshold'
  | 'Missing interview'
  | 'Missing interview score'
  | 'Job-fit below threshold'
  | 'Missing job-fit score'
  | 'No-show risk above max'
  | 'Missing no-show score'
  | 'Queued because target reached'
  | 'In hold pool'
  | 'Passed current policy'
  | 'Auto-advance disabled (policy)'
  | 'Waiting for manual review'
  | 'Pending automation'
  | 'Not in active pipeline'
  | 'Hire complete';

const GATE_FAILURE_WHYS: ReadonlySet<string> = new Set([
  'Below interview threshold',
  'Missing interview',
  'Missing interview score',
  'Job-fit below threshold',
  'Missing job-fit score',
  'No-show risk above max',
  'Missing no-show score',
]);

export type PolicyImpactCandidateRow = {
  /** Firestore application document id (`tenants/.../applications/{id}`). */
  id: string;
  /** Worker user id when present — used for recruiter profile deep links. */
  userId: string | null;
  candidateName: string;
  stage: string;
  interviewScore: number | null;
  /** Current automation / status outcome (recruiter-facing). */
  decision: string;
  /** Standardized policy reason. */
  why: PolicyWhyLabel | string;
  /** Suggested operational next step. */
  nextAction: string;
};

/** Recruiter-facing copy; internal `why` keys stay stable for logic. */
export function getPolicyWhyDisplayLabel(why: PolicyWhyLabel | string): string {
  const map: Record<string, string> = {
    'Missing interview score': 'Interview score not recorded yet',
    'Missing no-show score': 'No-show score not recorded yet',
    'Pending automation': 'Waiting for system to advance',
    'Not in active pipeline': 'Not in hiring review',
  };
  return map[String(why)] ?? String(why);
}

function formatPolicyDecisionState(data: Record<string, unknown>): string {
  const status = normalizeApplicationStatus(String(data.status ?? ''));
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected') return 'Rejected';
  if (status === 'withdrawn') return 'Withdrawn';
  if (status === 'waitlisted') return 'Waitlisted';
  const ai = getAi(data);
  const raw = typeof ai?.decision === 'string' ? ai.decision.trim().toLowerCase() : '';
  if (raw === 'advance') return 'Advanced';
  if (raw === 'hold') return 'On hold';
  if (typeof ai?.decision === 'string' && ai.decision.trim()) return ai.decision.trim();
  return 'Pending';
}

function derivePolicyNextAction(
  data: Record<string, unknown>,
  cfg: UserGroupHiringConfigV1,
  why: PolicyWhyLabel | string,
): string {
  const status = normalizeApplicationStatus(String(data.status ?? ''));
  if (status === 'accepted') return 'Start onboarding';
  if (status === 'rejected' || status === 'withdrawn') return 'None';

  const ai = getAi(data);
  const auto = cfg.automation ?? {};

  switch (why) {
    case 'Missing interview':
      return 'Interview needed';
    case 'Below interview threshold':
      return 'Manual review';
    case 'Job-fit below threshold':
    case 'Missing job-fit score':
      return 'Manual review';
    case 'No-show risk above max':
    case 'Missing no-show score':
      return 'Manual review';
    case 'Queued because target reached':
    case 'In hold pool':
      return 'Queued for later';
    case 'Auto-advance disabled (policy)':
      return 'Manual review';
    case 'Waiting for manual review':
      return 'Manual review';
    case 'Passed current policy':
      if (ai?.decision === 'advance') return 'Continue pipeline';
      if (auto.autoAdvanceEnabled === true) return 'Ready to advance';
      return 'Manual review';
    case 'Pending automation':
      return 'Ready to advance';
    case 'Not in active pipeline':
    case 'Hire complete':
      return 'None';
    case 'Missing interview score':
      return 'Manual review';
    default:
      return 'Manual review';
  }
}

/**
 * Decision = current outcome/state; Why = short standardized policy reason; Next action = operational hint.
 * Aligns with `passesQualityGates` + queue heuristics used in aggregates.
 */
export function derivePolicyImpactFields(
  data: Record<string, unknown>,
  cfg: UserGroupHiringConfigV1,
): { decision: string; why: PolicyWhyLabel | string; nextAction: string } {
  const qual = cfg.quality ?? {};
  const preset = qual.preset ?? 'balanced';
  const fb = GROUP_HIRING_QUALITY_PRESETS[preset];
  const interviewMin = qual.interviewMinimumScoreToAdvance ?? fb.interviewMinimumScoreToAdvance;
  const jobFitMin = qual.jobFitMinimumScoreToAdvance ?? fb.jobFitMinimumScoreToAdvance;
  const gateOn = qual.minimumJobScoreGateEnabled === true;
  const maxNs = qual.maximumNoShowRiskToAdvance;
  const prescreenRequired = cfg.interview?.workerAiPrescreenRequired !== false;
  const ai = getAi(data);
  const status = normalizeApplicationStatus(String(data.status ?? ''));

  if (status === 'accepted') {
    const o = {
      decision: 'Accepted',
      why: 'Hire complete' as const,
      nextAction: 'Start onboarding',
    };
    return o;
  }
  if (status === 'rejected' || status === 'withdrawn') {
    return {
      decision: status === 'rejected' ? 'Rejected' : 'Withdrawn',
      why: 'Not in active pipeline',
      nextAction: 'None',
    };
  }

  const score = num(ai?.score);
  const c = countsForApplicationDoc(data, prescreenRequired);

  let why: PolicyWhyLabel | string;

  if (score == null) {
    if (!c.interviewed) {
      why = 'Missing interview';
    } else {
      why = 'Missing interview score';
    }
  } else if (score < interviewMin) {
    why = 'Below interview threshold';
  } else {
    const scores = data.scores as Record<string, unknown> | undefined;
    const fit =
      scores && typeof scores.fitScore === 'number' && Number.isFinite(scores.fitScore) ? scores.fitScore : null;
    if (gateOn) {
      if (fit == null) {
        why = 'Missing job-fit score';
      } else if (fit < jobFitMin) {
        why = 'Job-fit below threshold';
      } else {
        const ns = ai?.noShowRisk as Record<string, unknown> | undefined;
        const nsScore = ns && typeof ns.score === 'number' && Number.isFinite(ns.score) ? ns.score : null;
        if (typeof maxNs === 'number' && Number.isFinite(maxNs)) {
          if (nsScore == null) {
            why = 'Missing no-show score';
          } else if (nsScore > maxNs) {
            why = 'No-show risk above max';
          } else {
            why = stepAfterGates(data, cfg, ai);
          }
        } else {
          why = stepAfterGates(data, cfg, ai);
        }
      }
    } else {
      const ns = ai?.noShowRisk as Record<string, unknown> | undefined;
      const nsScore = ns && typeof ns.score === 'number' && Number.isFinite(ns.score) ? ns.score : null;
      if (typeof maxNs === 'number' && Number.isFinite(maxNs)) {
        if (nsScore == null) {
          why = 'Missing no-show score';
        } else if (nsScore > maxNs) {
          why = 'No-show risk above max';
        } else {
          why = stepAfterGates(data, cfg, ai);
        }
      } else {
        why = stepAfterGates(data, cfg, ai);
      }
    }
  }

  const statusLower = String(data.status ?? '')
    .trim()
    .toLowerCase();
  if ((statusLower === 'waitlisted' || reasonCodesCapacity(ai)) && !GATE_FAILURE_WHYS.has(String(why))) {
    why = 'Queued because target reached';
  } else if (
    ai &&
    ai.decision === 'hold' &&
    ai.priorityBucket === 'hold_pool' &&
    !GATE_FAILURE_WHYS.has(String(why)) &&
    why !== 'Queued because target reached'
  ) {
    why = 'In hold pool';
  }

  const decision = formatPolicyDecisionState(data);
  const nextAction = derivePolicyNextAction(data, cfg, why);
  return { decision, why, nextAction };
}

/** After interview / job-fit / no-show numeric gates are passed (or gates off). */
function stepAfterGates(
  data: Record<string, unknown>,
  cfg: UserGroupHiringConfigV1,
  ai: Record<string, unknown> | undefined,
): PolicyWhyLabel {
  const statusLower = String(data.status ?? '')
    .trim()
    .toLowerCase();
  if (statusLower === 'waitlisted' || reasonCodesCapacity(ai)) {
    return 'Queued because target reached';
  }
  if (ai && ai.decision === 'hold' && ai.priorityBucket === 'hold_pool') {
    return 'In hold pool';
  }

  const auto = cfg.automation ?? {};
  if (passesQualityGates(data, cfg)) {
    if (ai?.decision === 'advance') return 'Passed current policy';
    if (!auto.autoAdvanceEnabled) return 'Auto-advance disabled (policy)';
    return 'Pending automation';
  }

  return 'Waiting for manual review';
}

/**
 * @deprecated Prefer `derivePolicyImpactFields`; kept for callers that only need the Why string.
 */
export function derivePolicyImpactWhy(data: Record<string, unknown>, cfg: UserGroupHiringConfigV1): string {
  return derivePolicyImpactFields(data, cfg).why;
}

export function buildPolicyImpactRows(
  docs: Record<string, unknown>[],
  cfg: UserGroupHiringConfigV1,
): PolicyImpactCandidateRow[] {
  const rows: PolicyImpactCandidateRow[] = docs.map((data) => {
    const ai = getAi(data);
    const fields = derivePolicyImpactFields(data, cfg);
    const appId = String(data.id ?? '');
    const uidRaw = data.userId ?? data.candidateId;
    const userId = typeof uidRaw === 'string' && uidRaw.trim() ? uidRaw.trim() : null;
    return {
      id: appId,
      userId,
      candidateName: applicationLabel(data),
      stage: formatApplicationStageLabel(data),
      interviewScore: num(ai?.score),
      decision: fields.decision,
      why: fields.why,
      nextAction: fields.nextAction,
    };
  });
  return rows.sort((a, b) => {
    const da = docs.find((d) => String(d.id) === a.id) ?? {};
    const db = docs.find((d) => String(d.id) === b.id) ?? {};
    return docSortTimestamp(db) - docSortTimestamp(da);
  });
}

/** Top rows for waitlist preview (best-effort). */
export function buildQueuedCandidatePreview(docs: Record<string, unknown>[]): GroupQueuedCandidateRow[] {
  const out: GroupQueuedCandidateRow[] = [];
  for (const data of docs) {
    const ai = getAi(data);
    const statusLower = String(data.status ?? '')
      .trim()
      .toLowerCase();
    const isQ =
      statusLower === 'waitlisted' ||
      reasonCodesCapacity(ai) ||
      (ai && ai.decision === 'hold' && ai.priorityBucket === 'hold_pool');
    if (!isQ) continue;
    const id = String(data.id ?? data.applicationId ?? out.length);
    const score = num(ai?.score) ?? undefined;
    let holdReason = 'Hold pool';
    if (statusLower === 'waitlisted') holdReason = 'Waitlisted';
    if (reasonCodesCapacity(ai)) holdReason = 'Target reached / capacity';
    out.push({ id, label: applicationLabel(data), score, holdReason });
  }
  return out.slice(0, 5);
}

export function simulateHiringFromMembers(
  members: Array<{ aiProfileScore?: number; aiJobFitScore?: number }>,
  cfg: UserGroupHiringConfigV1,
  options?: { currentOnboardingForTarget?: number },
): HiringSimulationResult {
  const qual = cfg.quality ?? {};
  const preset = qual.preset ?? 'balanced';
  const fallback = GROUP_HIRING_QUALITY_PRESETS[preset];
  const interviewMin = qual.interviewMinimumScoreToAdvance ?? fallback.interviewMinimumScoreToAdvance;
  const jobFitMin = qual.jobFitMinimumScoreToAdvance ?? fallback.jobFitMinimumScoreToAdvance;
  const gateOn = qual.minimumJobScoreGateEnabled === true;
  const maxNs = qual.maximumNoShowRiskToAdvance;
  const auto = cfg.automation ?? {};
  const tgt = cfg.targets?.targetOnboardingCount;
  const targetCap =
    typeof tgt === 'number' && Number.isFinite(tgt) && tgt >= 1 ? Math.floor(tgt) : null;

  let filled = options?.currentOnboardingForTarget ?? 0;
  let qualify = 0;
  let queue = 0;
  let reject = 0;
  let hold = 0;

  for (const m of members) {
    const iv = typeof m.aiProfileScore === 'number' && Number.isFinite(m.aiProfileScore) ? m.aiProfileScore : 55;
    const fit =
      typeof m.aiJobFitScore === 'number' && Number.isFinite(m.aiJobFitScore) ? m.aiJobFitScore : gateOn ? 55 : 72;
    const ns = 45;

    if (iv < interviewMin) {
      reject += 1;
      continue;
    }
    if (gateOn && fit < jobFitMin) {
      hold += 1;
      continue;
    }
    if (typeof maxNs === 'number' && ns > maxNs) {
      hold += 1;
      continue;
    }

    qualify += 1;
    if (!auto.autoAdvanceEnabled) {
      hold += 1;
      continue;
    }
    if (targetCap == null) {
      continue;
    }
    if (filled < targetCap) {
      filled += 1;
    } else {
      queue += 1;
    }
  }

  return { qualify, queue, reject, hold };
}

export type DecisionFlowStep = { text: string };

export function buildDecisionFlowSteps(cfg: UserGroupHiringConfigV1): DecisionFlowStep[] {
  const iv = cfg.interview ?? {};
  const auto = cfg.automation ?? {};
  const qual = cfg.quality ?? {};
  const tgt = cfg.targets ?? {};
  const preset = qual.preset ?? 'balanced';
  const fallback = GROUP_HIRING_QUALITY_PRESETS[preset];
  const interviewMin = qual.interviewMinimumScoreToAdvance ?? fallback.interviewMinimumScoreToAdvance;
  const jobFitMin = qual.jobFitMinimumScoreToAdvance ?? fallback.jobFitMinimumScoreToAdvance;
  const maxNs = qual.maximumNoShowRiskToAdvance;
  const gateOn = qual.minimumJobScoreGateEnabled === true;
  const failAct = qual.jobFitFailAction ?? 'review';
  const target = tgt.targetOnboardingCount;

  const steps: DecisionFlowStep[] = [
    { text: 'Apply → enters this group’s hiring pipeline.' },
    {
      text: `AI prescreen required → ${iv.workerAiPrescreenRequired === true ? 'Yes' : 'No'}.`,
    },
    {
      text: `Must score ≥ ${interviewMin} → else Review.`,
    },
  ];

  if (gateOn) {
    steps.push({
      text: `Job fit ≥ ${jobFitMin} → else ${failAct === 'hold' ? 'Hold' : 'Review'}.`,
    });
  } else {
    steps.push({
      text: 'Job fit gate → Off (job-fit score not required to advance).',
    });
  }

  if (typeof maxNs === 'number' && Number.isFinite(maxNs)) {
    steps.push({
      text: `No-show risk ≤ ${maxNs} → else ${failAct === 'hold' ? 'Hold' : 'Review'}.`,
    });
  } else {
    steps.push({
      text: 'No-show risk ceiling → Not set (orchestrator may still apply band overlay).',
    });
  }

  const targetLine =
    typeof target === 'number' && Number.isFinite(target) && target >= 1
      ? `If under target (${target}):`
      : 'If under onboarding target:';

  steps.push({
    text: `${targetLine} Auto-advance ${auto.autoAdvanceEnabled === true ? 'ON' : 'OFF'} → ${
      auto.autoAdvanceEnabled === true ? 'Auto-hire eligible' : 'Manual advance'
    }; Auto-onboard ${auto.autoOnboardEnabled === true ? 'ON' : 'OFF'} → ${
      auto.autoOnboardEnabled === true ? 'Start onboarding when execution runs' : 'Onboarding not auto-started'
    }.`,
  });

  steps.push({
    text: `If target reached: Queue ${auto.queueAfterTargetReached === true ? 'enabled' : 'disabled'} → ${
      auto.queueAfterTargetReached === true ? 'Add to waitlist / hold pool' : 'Hold (no waiting pool)'
    }.`,
  });

  if (tgt.stopWhenTargetReached === true) {
    steps.push({
      text: 'Stop when target reached → On (automatic hiring stops at cap when execution exists).',
    });
  }

  return steps;
}
