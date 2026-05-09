/**
 * Role-aware tier resolver for the Recruiting Role Model.
 *
 * See `docs/RECRUITING_ROLE_MODEL.md` §3. One pure function per role is
 * overkill — this file exports a single `resolveRole(input)` that
 * branches on `input.role` and walks the appropriate tier chain. The
 * shape of `input` carries whatever the role needs (user groups for
 * Onboarding Specialist, account for Scheduler, tenant defaults for
 * the tenant-level roles).
 *
 * Runtime-neutral: no firebase imports, no Timestamp. Callers load the
 * tier data (user groups, account doc, tenant defaults) and pass it in;
 * this function picks the primary and the visibility list.
 *
 * Parallels the older `resolveOwnership` resolver (single "recruiter"
 * per worker). Old callers keep working; new code uses `resolveRole`.
 *
 * History: the role formerly known as "Candidate Success Agent (CSA)"
 * was renamed to **Onboarding Specialist** and narrowed to a
 * group-scoped specialty (welcome / onboarding calls). The tenant
 * fallback tier was dropped as part of that narrowing. The Recruiter
 * absorbed the durable per-worker relationship work that the broader
 * CSA had been sharing with it; that relationship is still resolved
 * through `resolveOwnership` and `users.{uid}.primaryRecruiterId`.
 */

/** Roles supported by the resolver. See doc §2 for the canonical list. */
export type RecruitingRole =
  | 'onboarding_specialist'
  | 'scheduler'
  | 'hrx_systems_operator'
  | 'payroll_coordinator';

/** Which tier produced the current `primaryUid`. Audit/debug. */
export type ResolveRoleSource =
  /** From a user group's `roles.onboardingSpecialistIds`. Onboarding Specialist only. */
  | 'user_group'
  /** From an account's `roles.schedulerIds`. Scheduler only. */
  | 'account'
  /** From `tenants/{tid}/settings/roleDefaults.*`. Any role. */
  | 'tenant_default'
  /** No tier produced a match. UI renders "Unassigned". */
  | 'unassigned';

/**
 * A user group feeding into Onboarding Specialist resolution.
 * Ordering is determined by `createdAtIso` ascending — earliest-created
 * group's specialists win when a worker is in multiple groups (doc §3.1).
 */
export type ResolveRoleUserGroup = {
  id: string;
  /** ISO-8601 group creation timestamp. Missing groups sort last. */
  createdAtIso?: string;
  /**
   * Onboarding Specialists assigned to this group. Empty array or
   * missing = skip this group. The defensive read pattern at every
   * call site is `roles.onboardingSpecialistIds ?? roles.csaIds ?? []`
   * — see the rename brief for the transition window. The resolver
   * input itself only carries the new field; callers normalize before
   * passing data in.
   */
  onboardingSpecialistIds?: string[];
};

/** Account input for Scheduler resolution. */
export type ResolveRoleAccount = {
  id: string;
  /** Schedulers assigned at the account level. */
  schedulerIds?: string[];
};

/** Tenant-level role defaults. Missing fields = tier walk falls through. */
export type ResolveRoleTenantDefaults = {
  hrxSystemsOperatorIds?: string[];
  payrollCoordinatorIds?: string[];
  /** Used by Scheduler tier walk as the last step before Unassigned. */
  schedulerFallbackIds?: string[];
};

export type ResolveRoleInput = {
  role: RecruitingRole;
  /** Required for `onboarding_specialist`. Ignored for other roles. */
  userGroups?: ResolveRoleUserGroup[];
  /** Required for `scheduler`. Ignored for other roles. */
  account?: ResolveRoleAccount;
  /** Used by all roles; per-role fallbacks live here. */
  tenantDefaults?: ResolveRoleTenantDefaults;
};

export type ResolveRoleResult = {
  /** Primary role-holder — the one who "owns" this scope. Null = Unassigned. */
  primaryUid: string | null;
  /**
   * Everyone eligible for this role in the relevant tier. For
   * Onboarding Specialist, that's every specialist across every
   * matching group; for Scheduler, every Scheduler on the account
   * (plus fallback). The `primaryUid` is always the first element
   * when non-null.
   */
  visibleUids: string[];
  source: ResolveRoleSource;
};

/**
 * Deduplicate while preserving order. Null/empty/whitespace-only ids
 * are filtered out so callers don't accidentally assign "" as primary.
 */
function dedupeIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function emptyResult(source: ResolveRoleSource = 'unassigned'): ResolveRoleResult {
  return { primaryUid: null, visibleUids: [], source };
}

function resultFrom(ids: string[], source: ResolveRoleSource): ResolveRoleResult {
  if (ids.length === 0) return emptyResult();
  return { primaryUid: ids[0], visibleUids: ids, source };
}

function sortGroupsByCreatedAt(
  groups: ResolveRoleUserGroup[],
): ResolveRoleUserGroup[] {
  // Earlier-created groups win (doc §3.1). Missing createdAt sorts last;
  // ties break on id so ordering is deterministic across resolver calls.
  return [...groups].sort((a, b) => {
    const aHas = typeof a.createdAtIso === 'string' && a.createdAtIso.length > 0;
    const bHas = typeof b.createdAtIso === 'string' && b.createdAtIso.length > 0;
    if (aHas && bHas) {
      const byDate = a.createdAtIso!.localeCompare(b.createdAtIso!);
      if (byDate !== 0) return byDate;
    } else if (aHas !== bHas) {
      return aHas ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Main entry. Returns `primaryUid` + `visibleUids` for the requested role
 * given the loaded tier data. Callers not providing required inputs
 * (e.g. Onboarding Specialist without `userGroups`) get an `unassigned`
 * result — not an error — so the resolver stays pure and explicitly
 * optional.
 */
export function resolveRole(input: ResolveRoleInput): ResolveRoleResult {
  const { role, userGroups, account, tenantDefaults } = input;

  if (role === 'onboarding_specialist') {
    // Walk groups in deterministic order. The FIRST group with any
    // non-empty `onboardingSpecialistIds` wins — its specialists become
    // the result. This gives stable "first group the worker joined is
    // authoritative" semantics even when a worker belongs to several
    // overlapping groups.
    //
    // Onboarding Specialist is intentionally a one-tier role: groups →
    // unassigned. There is no tenant-default fallback for this role
    // (per the rename brief). "Unassigned" is a legitimate state — the
    // recruiter still owns the worker relationship via
    // `resolveOwnership` / `primaryRecruiterId`.
    if (userGroups && userGroups.length > 0) {
      const ordered = sortGroupsByCreatedAt(userGroups);
      const visibleSet = new Set<string>();
      let primaryFromGroup: string | null = null;
      for (const g of ordered) {
        const ids = dedupeIds(g.onboardingSpecialistIds ?? []);
        if (ids.length === 0) continue;
        if (primaryFromGroup == null) primaryFromGroup = ids[0];
        for (const id of ids) visibleSet.add(id);
      }
      if (primaryFromGroup != null) {
        // Primary first, then everyone else (dedup-order preserved).
        const visible = [primaryFromGroup, ...Array.from(visibleSet).filter((id) => id !== primaryFromGroup)];
        return { primaryUid: primaryFromGroup, visibleUids: visible, source: 'user_group' };
      }
    }
    return emptyResult();
  }

  if (role === 'scheduler') {
    const accountIds = dedupeIds(account?.schedulerIds ?? []);
    if (accountIds.length > 0) return resultFrom(accountIds, 'account');
    const fallback = dedupeIds(tenantDefaults?.schedulerFallbackIds ?? []);
    return resultFrom(fallback, fallback.length > 0 ? 'tenant_default' : 'unassigned');
  }

  if (role === 'hrx_systems_operator') {
    const ids = dedupeIds(tenantDefaults?.hrxSystemsOperatorIds ?? []);
    return resultFrom(ids, ids.length > 0 ? 'tenant_default' : 'unassigned');
  }

  if (role === 'payroll_coordinator') {
    const ids = dedupeIds(tenantDefaults?.payrollCoordinatorIds ?? []);
    return resultFrom(ids, ids.length > 0 ? 'tenant_default' : 'unassigned');
  }

  // Exhaustiveness guard — TypeScript will flag new roles at compile time.
  const _exhaustive: never = role;
  void _exhaustive;
  return emptyResult();
}
