/**
 * Async access gate for Everee admin/management callables.
 *
 * **Why this lives here vs reading Firebase Auth custom claims:** the prior
 * gate (sync `canManageEveree` in `evereeCallables.ts`) read
 * `auth.token.roles[tenantId].role` from custom claims, but in production
 * the claim-sync pipeline (`functions/src/auth/setTenantRole.ts`) had not
 * been run for most tenant admins. Every C1 admin (`securityLevel: '7'`
 * in Firestore) carried `customClaims = {}`, so the gate denied all of
 * them — only HRX staff with the manually-set `hrx: true` claim could
 * use any Everee admin callable. See the diagnostic in
 * `.scratch/check-mark-everee-comparison.out.txt` for the data.
 *
 * This gate matches the AccuSource pattern (`accusourceAdminGate.ts`):
 * read the user's Firestore profile and prefer tenant-scoped fields
 * (`tenantIds[tid].role` / `securityLevel`) over top-level. Allow when
 * the caller is HRX, when their effective role is admin/manager/super_admin,
 * or when their effective security level is in the recruiter band (>= 5).
 *
 * **Why `>= 5` and not `>= 6`:** matches the recruiter UI band 5–7 used
 * by `accusourceAdminGate.ts`, `setAccountWorkforceStatus`,
 * `setAssignmentOutcome`, `groupMessaging`, and `userReviews` — keeping
 * Everee in the same tier as those payroll-adjacent surfaces.
 *
 * The custom-claims path (`auth.token.roles[tenantId].role` and
 * `auth.token.hrx`) is still honoured as a fast-path so users whose
 * claims DO get synced retain a no-Firestore-read perf profile.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Roles that grant Everee management regardless of `securityLevel`.
 * Lowercased — the resolver coerces all role strings to lowercase to
 * tolerate the `Admin`/`admin`/`ADMIN` inconsistency that exists
 * historically in user docs.
 */
const ADMIN_ROLES = new Set<string>(['admin', 'manager', 'super_admin']);

/**
 * Minimum effective security level that grants Everee management.
 * 5 = Worker (per `src/utils/AccessRoles.ts`); the legacy gate accepted
 * Recruiter / Manager / Admin which collectively map to 5–7.
 */
const MIN_SECURITY_LEVEL = 5;

/**
 * Custom-claim role values from the legacy gate. Kept as a fast-path so
 * users whose claims happen to be in sync don't pay for a Firestore read.
 */
const LEGACY_CLAIM_ALLOWED_ROLES = new Set<string>(['Recruiter', 'Manager', 'Admin']);

interface EvereeAuthLike {
  uid?: string;
  token?: {
    hrx?: boolean;
    roles?: Record<string, { role?: string }>;
  };
}

/**
 * Resolve the effective `role` (lowercased) and numeric `securityLevel`
 * for a caller against a specific tenant.
 *
 * Mirrors `accusourceAdminGate.resolveAccusourceRoleAndSecurityLevel` —
 * tenant-scoped membership wins, top-level fields fall back. Numeric
 * coercion swallows the historical mix of string/number `securityLevel`
 * values seen in production data.
 *
 * Exported for tests and for sibling Everee callables that need the same
 * resolution without the additional gate predicate.
 */
export function resolveEvereeRoleAndSecurityLevel(
  data: Record<string, unknown> | undefined,
  tenantId: string,
): { roleLower: string; securityLevel: number } {
  if (!data) return { roleLower: '', securityLevel: 0 };
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const nested = tenantIds && typeof tenantIds === 'object' ? tenantIds[tenantId] : undefined;

  const roleRaw =
    nested && nested.role != null && String(nested.role).trim() !== ''
      ? nested.role
      : data.role;
  const roleLower = String(roleRaw ?? '').trim().toLowerCase();

  const slRaw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const securityLevel = Number.parseInt(String(slRaw ?? '0'), 10) || 0;

  return { roleLower, securityLevel };
}

/**
 * True when the caller is allowed to manage Everee for `tenantId`.
 *
 * Resolution order (first match wins):
 *   1. Caller has `hrx: true` custom claim — global HRX staff bypass.
 *   2. Caller's custom claims include a role for this tenant in
 *      [Recruiter, Manager, Admin] — fast-path for users whose
 *      `setTenantRole` sync HAS run.
 *   3. Firestore `users/{uid}.tenantIds[tid].role` (or top-level `role`)
 *      resolves to admin/manager/super_admin (lowercased compare).
 *   4. Firestore `users/{uid}.tenantIds[tid].securityLevel` (or top-level)
 *      coerces to >= 5.
 *
 * Returns `false` for anonymous callers, missing user docs, and any other
 * "unsure" state — fail closed.
 */
export async function canManageEveree(
  auth: EvereeAuthLike | null | undefined,
  tenantId: string,
): Promise<boolean> {
  if (!auth?.uid) return false;
  if (auth.token?.hrx === true) return true;
  if (!tenantId) return false;

  const claimRole = auth.token?.roles?.[tenantId]?.role;
  if (claimRole && LEGACY_CLAIM_ALLOWED_ROLES.has(String(claimRole))) return true;

  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (!userSnap.exists) return false;

  const { roleLower, securityLevel } = resolveEvereeRoleAndSecurityLevel(
    userSnap.data() as Record<string, unknown> | undefined,
    tenantId,
  );

  if (ADMIN_ROLES.has(roleLower)) return true;
  if (securityLevel >= MIN_SECURITY_LEVEL) return true;
  return false;
}

/**
 * True when the caller can act on `targetUserId`'s Everee data — either
 * because the caller is the target (worker self-fetch / self-onboard) or
 * because the caller passes `canManageEveree` for the tenant.
 *
 * Self-bypass is intentional: workers must be able to fetch their own
 * pay history, open their own onboarding embed, etc. without any role
 * elevation. The tenant filter still applies (`canManageEveree` is the
 * fallback for non-self callers).
 */
export async function canSelfOrManageEveree(
  auth: EvereeAuthLike | null | undefined,
  tenantId: string,
  targetUserId: string,
): Promise<boolean> {
  if (!auth?.uid) return false;
  if (targetUserId && auth.uid === targetUserId) return true;
  return canManageEveree(auth, tenantId);
}
