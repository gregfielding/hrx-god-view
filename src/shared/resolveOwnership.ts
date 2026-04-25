/**
 * **Mirror of `shared/resolveOwnership.ts`** — CRA client/jest copy. Keep in
 * sync byte-for-byte. Imports only its sibling `./actionItemOwnership` type
 * file (also mirrored), so no path differences between the two copies.
 *
 * Canonical ownership resolver for action items.
 *
 * Pure function — no I/O, no firebase imports. Callers pass in already-loaded
 * association data (job order, account, user groups, tenant defaults). The
 * function implements `recruiter-ownership-model.md §4`:
 *
 *   1. Derive `primaryRecruiterId` by walking the hierarchy most-specific →
 *      least-specific (job order → account → user group → tenant default).
 *      Stop at the first tier that has at least one candidate.
 *   2. Break ties at the matched tier:
 *        a. An `ActionItemOwnershipAssociation.isPrimary === true` flag wins.
 *        b. Else stable-hash the candidate uids against `tieBreakers.stableSeed`
 *           and pick the first. Deterministic, no flapping.
 *      (No `Lead Recruiter` role exists — §9 #2 decision.)
 *   3. Derive `visibleRecruiterIds` as the UNION across every tier that had
 *      candidates, plus the tenant's unassigned-pool L5+ recruiters when the
 *      hierarchy comes up empty and `unassignedPoolEnabled === true`. Caller
 *      supplies the unassigned-pool recruiter list via the `unassignedPool`
 *      input when needed — resolver itself never queries Firestore.
 *
 * Stickiness (§4d) is NOT handled here — that belongs to callers that know
 * the previous `primaryRecruiterId`. `resolveOwnership` always returns the
 * freshly-derived primary. Callers decide whether to honor stickiness.
 */

import type {
  ActionItemOwnershipAssociation,
  ActionItemOwnershipPrimarySource,
  ResolveOwnershipInput,
  ResolveOwnershipResult,
} from './actionItemOwnership';

export type ResolveOwnershipWithPoolInput = ResolveOwnershipInput & {
  /**
   * Optional: the L5+ recruiters who belong to the tenant's Unassigned pool.
   * Callers who want the pool fallback to run must supply this list. If the
   * list is omitted and the tenant has `unassignedPoolEnabled`, visibility
   * falls back to just the primary-set candidates (or empty when none).
   */
  unassignedPool?: string[];
};

/** Tier-by-tier candidate lookup. Exposed for tests. */
export type OwnershipTierCandidates = {
  tier: ActionItemOwnershipPrimarySource;
  candidates: string[];
  /** Per-candidate `isPrimary` flags from the association docs. */
  associations: ActionItemOwnershipAssociation[];
};

/**
 * Main entry point. Pure.
 */
export function resolveOwnership(input: ResolveOwnershipWithPoolInput): ResolveOwnershipResult {
  const tiers = gatherTierCandidates(input);

  // 1) Primary: walk most-specific → least-specific
  const primaryTier = tiers.find((t) => t.candidates.length > 0);
  let primaryRecruiterId: string | null = null;
  let primarySource: ActionItemOwnershipPrimarySource = 'unassigned';
  if (primaryTier) {
    primaryRecruiterId = pickPrimaryAtTier(primaryTier, input.tieBreakers?.stableSeed ?? input.workerUid);
    primarySource = primaryTier.tier;
  }

  // 2) Visibility: union across every tier that had candidates
  const visibility = new Set<string>();
  for (const t of tiers) for (const r of t.candidates) visibility.add(r);

  // Ensure primary is in visibility set when non-null
  if (primaryRecruiterId) visibility.add(primaryRecruiterId);

  // 3) Fallback to unassigned pool if nothing derived AND pool is enabled
  if (!primaryRecruiterId && input.tenantDefaults?.unassignedPoolEnabled && input.unassignedPool) {
    for (const r of input.unassignedPool) visibility.add(r);
    primarySource = 'unassigned';
  }

  return {
    primaryRecruiterId,
    visibleRecruiterIds: deterministicSortedList(visibility),
    primarySource,
  };
}

/** Expose for tests: build the tier list without picking a primary. */
export function gatherTierCandidates(input: ResolveOwnershipInput): OwnershipTierCandidates[] {
  const out: OwnershipTierCandidates[] = [];

  // Tier 1: job order
  if (input.jobOrder) {
    const candidates = uniqueNonEmpty(input.jobOrder.assignedRecruiters);
    out.push({
      tier: 'job_order',
      candidates,
      associations: input.jobOrder.recruiterAssociations ?? [],
    });
  }

  // Tier 2: account
  if (input.account) {
    const candidates = uniqueNonEmpty(input.account.recruiterIds);
    out.push({
      tier: 'account',
      candidates,
      associations: input.account.recruiterAssociations ?? [],
    });
  }

  // Tier 3: user groups (UNION across all groups the worker belongs to)
  if (input.userGroups && input.userGroups.length > 0) {
    const seen = new Set<string>();
    const allAssocs: ActionItemOwnershipAssociation[] = [];
    for (const g of input.userGroups) {
      // Prefer the new `roles.csaIds` field. Fall back to legacy
      // `groupManagerIds` for groups that haven't been migrated yet —
      // the UI now dual-writes both, so this fallback is only relevant
      // for stale groups until the backfill runs.
      const ids = (g.csaIds && g.csaIds.length > 0) ? g.csaIds : (g.groupManagerIds ?? []);
      for (const r of ids) {
        if (r) seen.add(r);
      }
      if (g.recruiterAssociations) allAssocs.push(...g.recruiterAssociations);
    }
    out.push({
      tier: 'user_group',
      candidates: deterministicSortedList(seen),
      associations: allAssocs,
    });
  }

  // Tier 4: tenant default
  const defaultRecruiterId = input.tenantDefaults?.defaultRecruiterId;
  if (defaultRecruiterId) {
    out.push({
      tier: 'tenant_default',
      candidates: [defaultRecruiterId],
      associations: [],
    });
  }

  return out;
}

/** Apply §4c tie-breaker within a single tier. */
export function pickPrimaryAtTier(tier: OwnershipTierCandidates, stableSeed: string): string | null {
  if (tier.candidates.length === 0) return null;
  if (tier.candidates.length === 1) return tier.candidates[0];

  // a) Explicit isPrimary flag wins
  const flagged = tier.associations
    .filter((a) => a.isPrimary === true && tier.candidates.includes(a.recruiterId))
    .map((a) => a.recruiterId);
  if (flagged.length === 1) return flagged[0];
  if (flagged.length > 1) {
    // Multiple isPrimary flags — fall through to stable hash among THOSE to stay deterministic.
    return stableHashPick(flagged, stableSeed);
  }

  // b) Stable hash across all candidates
  return stableHashPick(tier.candidates, stableSeed);
}

/**
 * Deterministic pick: hash `(seed + uid)` to a 32-bit int, pick the uid with
 * the smallest hash. Uses FNV-1a since it's tiny, non-crypto, and stable
 * across runtimes. Used for both tier ties and the visibility sort below.
 */
export function stableHashPick(uids: string[], seed: string): string {
  if (uids.length === 1) return uids[0];
  let bestHash = Number.POSITIVE_INFINITY;
  let bestUid = uids[0];
  for (const uid of uids) {
    const h = fnv1a(`${seed}::${uid}`);
    if (h < bestHash) {
      bestHash = h;
      bestUid = uid;
    }
  }
  return bestUid;
}

/**
 * Internal helpers
 */

function uniqueNonEmpty(list: string[] | undefined): string[] {
  if (!list || list.length === 0) return [];
  const seen = new Set<string>();
  for (const s of list) {
    if (typeof s === 'string' && s.trim().length > 0) seen.add(s);
  }
  return deterministicSortedList(seen);
}

function deterministicSortedList(set: Set<string>): string[] {
  return Array.from(set).sort();
}

/** FNV-1a 32-bit hash. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication via shifts to stay in int32 range
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}
