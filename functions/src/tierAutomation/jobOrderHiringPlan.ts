/**
 * Job-order hiring plan — pure selection rules (Greg 2026-09-10, OnTrac).
 *
 * On the job order's Hiring tab the recruiter sets how many workers the
 * client needs, how many backups we want, and how deep a pool to build as a
 * multiple of that total ("the job wants 10, we want 5 backups… hire 2x that
 * total — keep hiring qualified applicants until we hit 30"). Hiring here is
 * on-call W-2 onboarding at the JO's hiring entity plus the JO's screening
 * package; no shift is assigned.
 *
 *   - Tier 1 applicants are always onboarded and screened unless that is
 *     already done. They count toward the max but are never held back by it.
 *   - Tier 2 applicants fill the slots left under the max, limited to the
 *     intensity share of the JO's Tier 2 applicants (selective 25%, moderate
 *     60%, aggressive 100%). Already-hired Tier 2 applicants take slots
 *     first, then the best tier scores (earliest applicant breaks ties).
 *   - Tier 3 applicants are never hired by the plan; the user-based
 *     promotion rule moves qualifying workers to Tier 2 first.
 *
 * No Firestore here — jobOrderHiringPlanSweep gathers inputs and executes.
 */

export type Tier2Intensity = 'none' | 'selective' | 'moderate' | 'aggressive';

export const TIER2_INTENSITY_SHARE: Record<Tier2Intensity, number> = {
  none: 0,
  selective: 0.25,
  moderate: 0.6,
  aggressive: 1,
};

export const DEFAULT_POOL_MULTIPLIER = 1;
export const MAX_POOL_MULTIPLIER = 10;

export interface HiringPlanConfig {
  enabled: boolean;
  workersNeeded: number;
  backupWorkers: number;
  poolMultiplier: number;
  tier2Intensity: Tier2Intensity;
}

const nonNegativeInt = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function normalizeHiringPlan(raw: unknown): HiringPlanConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const multiplier = Number(o.poolMultiplier);
  const intensity = String(o.tier2Intensity ?? '');
  return {
    enabled: o.enabled === true,
    workersNeeded: nonNegativeInt(o.workersNeeded),
    backupWorkers: nonNegativeInt(o.backupWorkers),
    poolMultiplier:
      Number.isFinite(multiplier) && multiplier >= 1
        ? Math.min(multiplier, MAX_POOL_MULTIPLIER)
        : DEFAULT_POOL_MULTIPLIER,
    tier2Intensity: Object.prototype.hasOwnProperty.call(TIER2_INTENSITY_SHARE, intensity)
      ? (intensity as Tier2Intensity)
      : 'none',
  };
}

export function computeHiringPlanTargets(plan: HiringPlanConfig): {
  poolTarget: number;
  maxHires: number;
} {
  const poolTarget = plan.workersNeeded + plan.backupWorkers;
  return { poolTarget, maxHires: Math.ceil(poolTarget * plan.poolMultiplier - 1e-9) };
}

export interface HiringPlanCandidate {
  userId: string;
  applicationId: string;
  /** Global worker tier; anything other than 1 or 2 is treated as Tier 3. */
  tier: number;
  /** Tier scorecard total — the Tier 2 ranking key. */
  score: number;
  appliedAtMs: number;
  /** Has a live (not terminated/inactive) employment row at the JO's hiring entity. */
  employed: boolean;
  /** Nothing to order: the JO needs no package, it is already satisfied, or an order is in flight. */
  screeningDone: boolean;
  /** Earlier attempts on this JO rule out trying again right now. */
  blocked: boolean;
}

export type HiringPlanActionKind = 'onboard_and_screen' | 'screen_only';

export interface HiringPlanAction {
  userId: string;
  applicationId: string;
  tier: 1 | 2;
  kind: HiringPlanActionKind;
}

export interface HiringPlanSelection {
  poolTarget: number;
  maxHires: number;
  tier1: number;
  tier2: number;
  tier3: number;
  /** Tier 2 applicants the intensity allows into the pool. */
  tier2Quota: number;
  /** Qualified (Tier 1/2) applicants already employed at the hiring entity. */
  alreadyHired: number;
  /** Plan members once this run's actions succeed. */
  projectedPool: number;
  /** Tier 1 first, then Tier 2 in rank order. */
  actions: HiringPlanAction[];
  blockedSkipped: number;
}

const byRank = (a: HiringPlanCandidate, b: HiringPlanCandidate): number =>
  b.score - a.score || a.appliedAtMs - b.appliedAtMs || a.userId.localeCompare(b.userId);

export function selectHiringPlanActions(
  plan: HiringPlanConfig,
  candidates: HiringPlanCandidate[],
): HiringPlanSelection {
  const { poolTarget, maxHires } = computeHiringPlanTargets(plan);
  const tier1 = candidates.filter((c) => c.tier === 1).sort(byRank);
  const tier2 = candidates.filter((c) => c.tier === 2).sort(byRank);
  const tier3 = candidates.length - tier1.length - tier2.length;
  const tier2Quota = Math.ceil(TIER2_INTENSITY_SHARE[plan.tier2Intensity] * tier2.length - 1e-9);
  const alreadyHired = [...tier1, ...tier2].filter((c) => c.employed).length;

  const selection: HiringPlanSelection = {
    poolTarget,
    maxHires,
    tier1: tier1.length,
    tier2: tier2.length,
    tier3,
    tier2Quota,
    alreadyHired,
    projectedPool: alreadyHired,
    actions: [],
    blockedSkipped: 0,
  };
  if (!plan.enabled) return selection;

  // Returns whether the candidate is a plan member after this run.
  const consider = (c: HiringPlanCandidate, tier: 1 | 2): boolean => {
    const needsWork = !c.employed || !c.screeningDone;
    if (needsWork) {
      if (c.blocked) {
        selection.blockedSkipped++;
      } else {
        selection.actions.push({
          userId: c.userId,
          applicationId: c.applicationId,
          tier,
          kind: c.employed ? 'screen_only' : 'onboard_and_screen',
        });
      }
    }
    return c.employed || !c.blocked;
  };

  let pool = 0;
  for (const c of tier1) {
    if (consider(c, 1)) pool++;
  }

  const slots = Math.min(tier2Quota, Math.max(0, maxHires - pool));
  const ordered = [...tier2.filter((c) => c.employed), ...tier2.filter((c) => !c.employed)];
  let taken = 0;
  for (const c of ordered) {
    if (taken >= slots) break;
    if (consider(c, 2)) {
      taken++;
      pool++;
    }
  }

  selection.projectedPool = pool;
  return selection;
}
