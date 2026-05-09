/**
 * Tenant-level role defaults — the roles a recruiting tenant can pin to
 * specific users at the tenant scope. These power both
 * `resolveRole(...)`'s tenant-default tier and the Workforce admin UI's
 * inline role chips.
 *
 * Stored at `tenants/{tid}/settings/roleDefaults` as parallel
 * `string[]` arrays — one per role. A user can hold zero or multiple of
 * these; a role can have zero or multiple holders.
 *
 * Runtime-neutral: no firebase imports, ISO-8601 strings for timestamps.
 * Mirrored byte-for-byte to `shared/tenantRoleDefaults.ts` (legacy
 * import path) so CRA's ModuleScopePlugin lets the client import it.
 *
 * History: the `csa_fallback` default was dropped when the CSA role was
 * renamed to "Onboarding Specialist" and narrowed to a group-scoped
 * specialty (no tenant-level fallback). Existing
 * `roleDefaults.csaFallbackIds` data on disk is ignored by the resolver
 * after the rename; a separate cleanup script removes the field.
 */

/**
 * The roles that can be pinned at tenant scope.
 *
 * - `hrx_systems_operator` — Receives platform-level escalations and is
 *   the "owner" target when something needs HRX support attention. Maps
 *   to `roleDefaults.hrxSystemsOperatorIds[]`.
 * - `payroll_coordinator` — Reviews timesheets and processes payroll for
 *   the tenant. Maps to `roleDefaults.payrollCoordinatorIds[]`.
 * - `scheduler_fallback` — Last-resort Scheduler when the worker's
 *   account has no `roles.schedulerIds` assignment. Maps to
 *   `roleDefaults.schedulerFallbackIds[]`.
 */
export type TenantRoleDefault =
  | 'hrx_systems_operator'
  | 'payroll_coordinator'
  | 'scheduler_fallback';

/** All values, in the order we render them in the UI. Importable so
 *  the client doesn't have to repeat the literal array. */
export const TENANT_ROLE_DEFAULTS: readonly TenantRoleDefault[] = [
  'hrx_systems_operator',
  'payroll_coordinator',
  'scheduler_fallback',
] as const;

/** Human-readable labels — used by the UI chips and the audit log. */
export const TENANT_ROLE_DEFAULT_LABELS: Record<TenantRoleDefault, string> = {
  hrx_systems_operator: 'HRX Systems Operator',
  payroll_coordinator: 'Payroll Coordinator',
  scheduler_fallback: 'Scheduler fallback',
};

/** One-line descriptions — used by chip tooltips. */
export const TENANT_ROLE_DEFAULT_DESCRIPTIONS: Record<TenantRoleDefault, string> = {
  hrx_systems_operator:
    'Receives platform-level escalations and is the owner target for HRX support tickets.',
  payroll_coordinator: 'Reviews timesheets and processes payroll for the tenant.',
  scheduler_fallback: 'Used when no account has a Scheduler assigned for the worker.',
};

/**
 * Maps a `TenantRoleDefault` to the array field name on
 * `tenants/{tid}/settings/roleDefaults`. Single source of truth so the
 * callable, the resolver, and the UI all agree on field names.
 */
export const TENANT_ROLE_DEFAULT_FIELD: Record<TenantRoleDefault, string> = {
  hrx_systems_operator: 'hrxSystemsOperatorIds',
  payroll_coordinator: 'payrollCoordinatorIds',
  scheduler_fallback: 'schedulerFallbackIds',
};

/**
 * Read shape of the `tenants/{tid}/settings/roleDefaults` doc. All
 * arrays are optional — the doc may not exist for new tenants. The
 * legacy `csaFallbackIds` field is intentionally NOT modeled here:
 * existing data on disk is ignored, and the resolver no longer reads it
 * (Onboarding Specialist is group-scoped only).
 */
export interface TenantRoleDefaultsDoc {
  hrxSystemsOperatorIds?: string[];
  payrollCoordinatorIds?: string[];
  schedulerFallbackIds?: string[];
  /** ISO-8601. */
  updatedAt?: string;
  /** Last user to modify the doc. */
  updatedByUid?: string;
}

/** Per-user view derived from the doc — used by the UI to populate the
 *  role chips on each row of the Workforce table. */
export interface TenantRoleDefaultMembership {
  hrx_systems_operator: boolean;
  payroll_coordinator: boolean;
  scheduler_fallback: boolean;
}

/** Helper — given the doc and a target uid, compute which roles the user
 *  holds. Pure; safe to call client- and server-side. */
export function tenantRoleDefaultMembershipForUser(
  doc: TenantRoleDefaultsDoc | null | undefined,
  uid: string,
): TenantRoleDefaultMembership {
  const safe = doc ?? {};
  return {
    hrx_systems_operator: (safe.hrxSystemsOperatorIds ?? []).includes(uid),
    payroll_coordinator: (safe.payrollCoordinatorIds ?? []).includes(uid),
    scheduler_fallback: (safe.schedulerFallbackIds ?? []).includes(uid),
  };
}

// ---------------------------------------------------------------------
// Callable: setTenantRoleDefaultMembership
// ---------------------------------------------------------------------

/**
 * Add or remove a single user from a single tenant-role-default array.
 * Atomic — uses a transaction so two admins flipping toggles in the
 * same second don't lose each other's writes.
 */
export interface SetTenantRoleDefaultMembershipInput {
  tenantId: string;
  /** The user being added or removed. */
  uid: string;
  /** Which array to touch. */
  role: TenantRoleDefault;
  /** `true` to add the uid (idempotent — no-op if already present),
   *  `false` to remove (idempotent — no-op if already absent). */
  isMember: boolean;
}

export interface SetTenantRoleDefaultMembershipResult {
  ok: true;
  /** The full membership for this user *after* the write — useful so the
   *  client can confirm its optimistic update matches the server. */
  membership: TenantRoleDefaultMembership;
  /** `true` when the array actually changed; `false` for a no-op
   *  (e.g. removing a uid that wasn't in the array). */
  changed: boolean;
}
