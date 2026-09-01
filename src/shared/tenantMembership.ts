/**
 * Canonical shape for a tenant membership entry written under
 * `users/{uid}.tenantIds.{tenantId}`.
 *
 * Every `users/{uid}` creation/membership-stamping path MUST write this
 * shape via `buildTenantMembershipEntry` and merge it at the dot-path key
 * `tenantIds.{tenantId}` (never overwrite the whole `tenantIds` field —
 * that clobbers other tenants' membership and, if written as an array
 * instead of a map, makes the user invisible everywhere).
 *
 * Both "All Users" admin search and the worker directory query
 * `tenantIds.{tenantId}.securityLevel IN ['0'..'4', 0..4]`
 * (src/constants/tenantWorkerSecurityLevels.ts). A missing map entry, a
 * label instead of a numeric string ('Worker' vs '4'), or an array shape
 * for `tenantIds` all make the user invisible to that query even though
 * the account otherwise works. See docs/claude/feedback_tenantids_map_creation_paths.md.
 */

export type TenantMembershipInput = {
  securityLevel?: string | number | null;
  role?: string | null;
  addedAt?: unknown;
  locationIds?: string[];
  department?: string | null;
  userGroupIds?: string[];
};

export type TenantMembershipEntry = {
  securityLevel: string;
  role: string;
  addedAt: unknown;
  locationIds?: string[];
  department?: string | null;
  userGroupIds?: string[];
};

const LEVEL_TO_ROLE: Record<string, string> = {
  '2': 'Applicant',
  '3': 'Flex',
  '4': 'Hired Staff',
};

/**
 * Normalizes a raw securityLevel value (numeric, numeric-string, or legacy
 * label like 'Worker'/'Applicant_Worker'/'Manager') to the numeric-string
 * form the admin queries actually match on. Defaults to '2' (applicant) —
 * the same default the one-time 2026-08-07 backfill used — when the input
 * is missing or unrecognized, since that's the least-privileged level.
 *
 * Order matters: an 'Applicant_Worker' label must resolve to '2', not '4',
 * so the 'applicant' check runs before the '*_worker' suffix check (matches
 * assignOrgToUser's existing intent: role==='Applicant' always wins over
 * the Customer_Worker/Agency_Worker type labels).
 */
export function normalizeTenantSecurityLevel(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '2';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  const trimmed = String(raw).trim();
  if (/^[0-9]+$/.test(trimmed)) return trimmed;
  const label = trimmed.toLowerCase();
  if (label.startsWith('applicant')) return '2';
  if (label === 'flex') return '3';
  if (label === 'worker' || label.endsWith('_worker')) return '4';
  if (label === 'staffer' || label === 'manager') return '5';
  if (label === 'admin') return '6';
  return '2';
}

function deriveRole(role: string | null | undefined, level: string): string {
  const trimmed = (role ?? '').trim();
  if (trimmed && trimmed !== 'Tenant') return trimmed;
  return LEVEL_TO_ROLE[level] ?? trimmed ?? 'Tenant';
}

/** Builds a well-formed `tenantIds.{tenantId}` map entry. */
export function buildTenantMembershipEntry(input: TenantMembershipInput): TenantMembershipEntry {
  const securityLevel = normalizeTenantSecurityLevel(input.securityLevel);
  const entry: TenantMembershipEntry = {
    securityLevel,
    role: deriveRole(input.role, securityLevel),
    addedAt: input.addedAt ?? null,
  };
  if (input.locationIds) entry.locationIds = input.locationIds;
  if (input.department !== undefined) entry.department = input.department;
  if (input.userGroupIds) entry.userGroupIds = input.userGroupIds;
  return entry;
}

/**
 * Returns a dot-path update payload — `{ 'tenantIds.{tenantId}': entry }`.
 *
 * ☠️ ONLY safe with `.update()` (Admin SDK) / `updateDoc()` (client SDK) —
 * those parse a dotted string key as a nested FieldPath. Spreading this into
 * `.set(data, {merge:true})`, `setDoc(..., {merge:true})`, or `addDoc()`
 * does NOT nest it — it silently writes a garbage top-level field literally
 * named `"tenantIds.{tenantId}"`, verified empirically 2026-08-27 (this is
 * exactly how the Charlie Howell backfill first went wrong). Use
 * `tenantMembershipMergePayload` for those call sites instead.
 */
export function tenantMembershipUpdatePayload(
  tenantId: string,
  input: TenantMembershipInput,
): Record<string, TenantMembershipEntry> {
  return { [`tenantIds.${tenantId}`]: buildTenantMembershipEntry(input) };
}

/**
 * Returns a properly NESTED payload — `{ tenantIds: { [tenantId]: entry } }`
 * — safe for `.set(data, {merge:true})`, `setDoc(..., {merge:true})`, and
 * `addDoc()`/plain `.set()` on a brand-new doc. Firestore's `merge:true`
 * deep-merges nested plain objects, so this only touches this one tenant's
 * entry and won't clobber sibling tenants already on the doc (verified
 * empirically 2026-08-27). Do NOT use a dotted string key with these call
 * sites — see `tenantMembershipUpdatePayload`.
 */
export function tenantMembershipMergePayload(
  tenantId: string,
  input: TenantMembershipInput,
): { tenantIds: Record<string, TenantMembershipEntry> } {
  return { tenantIds: { [tenantId]: buildTenantMembershipEntry(input) } };
}
