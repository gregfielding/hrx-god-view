/**
 * Role-aware tier resolver for the Recruiting Role Model.
 *
 * See `docs/RECRUITING_ROLE_MODEL.md` §3. One pure function per role is
 * overkill — this file exports a single `resolveRole(input)` that
 * branches on `input.role` and walks the appropriate tier chain. The
 * shape of `input` carries whatever the role needs (user groups for
 * CSA, account for Scheduler, tenant defaults for all four).
 *
 * Runtime-neutral: no firebase imports, no Timestamp. Callers load the
 * tier data (user groups, account doc, tenant defaults) and pass it in;
 * this function picks the primary and the visibility list.
 *
 * Parallels the older `resolveOwnership` resolver (single "recruiter"
 * per worker). Old callers keep working; new code uses `resolveRole`.
 */

/** Four roles from the Recruiting Role Structure brief (§2 of the doc). */
export type RecruitingRole =
  | 'candidate_success_agent'
  | 'scheduler'
  | 'hrx_systems_operator'
  | 'payroll_coordinator';

/** Which tier produced the current `primaryUid`. Audit/debug. */
export type ResolveRoleSource =
  /** From a user group's `roles.csaIds`. CSA only. */
  | 'user_group'
  /** From an account's `roles.schedulerIds`. Scheduler only. */
  | 'account'
  /** From `tenants/{tid}/settings/roleDefaults.*`. Any role. */
  | 'tenant_default'
  /** No tier produced a match. UI renders "Unassigned". */
  | 'unassigned';

/**
 * A user group feeding into CSA resolution.
 * Ordering is determined by `createdAtIso` ascending — earliest-created
 * group's CSAs win when a worker is in multiple groups (doc §3.1).
 */
export type ResolveRoleUserGroup = {
  id: string;
  /** ISO-8601 group creation timestamp. Missing groups sort last. */
  createdAtIso?: string;
  /** CSAs assigned to this group. Empty array or missing = skip this group. */
  csaIds?: string[];
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
  /** Used by CSA tier walk as the last step before Unassigned. */
  csaFallbackIds?: string[];
  /** Used by Scheduler tier walk as the last step before Unassigned. */
  schedulerFallbackIds?: string[];
};

export type ResolveRoleInput = {
  role: RecruitingRole;
  /** Required for `candidate_success_agent`. Ignored for other roles. */
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
   * Everyone eligible for this role in the relevant tier. For CSA, that's
   * every CSA across every matching group (plus fallback); for Scheduler,
   * every Scheduler on the account (plus fallback). The `primaryUid` is
   * always the first element when non-null.
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
 * (e.g. CSA without `userGroups`) get an `unassigned` result — not an
 * error — so the resolver stays pure and explicitly optional.
 */
export function resolveRole(input: ResolveRoleInput): ResolveRoleResult {
  const { role, userGroups, account, tenantDefaults } = input;

  if (role === 'candidate_success_agent') {
    // Walk groups in deterministic order. The FIRST group with any non-empty
    // `csaIds` wins — its CSAs become the result. This gives stable "first
    // group the worker joined is authoritative" semantics even when a worker
    // belongs to several overlapping groups.
    if (userGroups && userGroups.length > 0) {
      const ordered = sortGroupsByCreatedAt(userGroups);
      const visibleSet = new Set<string>();
      let primaryFromGroup: string | null = null;
      for (const g of ordered) {
        const ids = dedupeIds(g.csaIds ?? []);
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
    // Fallback to tenant-default CSA list.
    const fallback = dedupeIds(tenantDefaults?.csaFallbackIds ?? []);
    return resultFrom(fallback, fallback.length > 0 ? 'tenant_default' : 'unassigned');
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
