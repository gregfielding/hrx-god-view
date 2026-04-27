/**
 * **R.3** — admin gate for the generalized CSA readiness-item callables.
 *
 * Mirrors `ensureAccusourceAdmin` exactly (admin / super_admin / manager
 * role OR security level >= 5 in the active tenant). We deliberately reuse
 * the AccuSource role/securityLevel resolver so the per-tenant lookup
 * semantics (claims-vs-profile, `tenantIds[tid]` precedence, fallback to
 * top-level fields) stay identical.
 *
 * Why a separate function instead of importing `ensureAccusourceAdmin`
 * directly:
 *   - Readiness CSA actions aren't conceptually "AccuSource admin"; the gate
 *     just happens to use the same admin/L5 band. Coupling readiness/ to
 *     integrations/accusource/ in the import graph would imply a dependency
 *     that doesn't exist.
 *   - Any divergence (e.g. opening R.3 to L4 in the future) lives here, not
 *     in the AccuSource module.
 *
 * @see functions/src/integrations/accusource/accusourceAdminGate.ts
 */
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { resolveAccusourceRoleAndSecurityLevel } from '../../integrations/accusource/accusourceAdminGate';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Throws `permission-denied` unless the caller is an admin / super_admin /
 * manager OR has security level >= 5 in `tenantIdHint` (or their
 * `activeTenantId` if hint is omitted).
 */
export async function ensureReadinessCsaAdmin(
  uid: string,
  tenantIdHint?: string | null,
): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }
  const data = userSnap.data() || {};
  const { roleLower, securityLevel } = resolveAccusourceRoleAndSecurityLevel(
    data as Record<string, unknown>,
    tenantIdHint,
  );
  const isAdminRole =
    roleLower === 'admin' || roleLower === 'super_admin' || roleLower === 'manager';
  if (!isAdminRole && securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Admin privileges required.');
  }
}
