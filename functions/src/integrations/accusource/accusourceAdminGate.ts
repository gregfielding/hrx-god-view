import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Role + security level for AccuSource admin checks.
 * Prefer `tenantIds[tenantId]` when present (System Access / recruiter tooling stores levels per tenant);
 * fall back to top-level `role` / `securityLevel`. Uses `activeTenantId` when `tenantIdHint` is omitted.
 */
export function resolveAccusourceRoleAndSecurityLevel(
  data: Record<string, unknown>,
  tenantIdHint?: string | null
): { roleLower: string; securityLevel: number } {
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const active =
    typeof data.activeTenantId === 'string' && data.activeTenantId.trim() !== ''
      ? data.activeTenantId.trim()
      : null;
  const tid =
    (typeof tenantIdHint === 'string' && tenantIdHint.trim() !== '' ? tenantIdHint.trim() : null) || active;
  const nested = tid && tenantIds?.[tid] ? tenantIds[tid] : undefined;

  const roleRaw =
    nested && nested.role != null && String(nested.role).trim() !== ''
      ? nested.role
      : data.role;
  const roleLower = String(roleRaw ?? '').toLowerCase();

  const slRaw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const securityLevel = Number.parseInt(String(slRaw ?? '0'), 10) || 0;

  return { roleLower, securityLevel };
}

/** Recruiter/internal tools: admin role or security level >= 5 (matches UI). */
export async function ensureAccusourceAdmin(uid: string, tenantIdHint?: string | null): Promise<void> {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }
  const data = userSnap.data() || {};
  const { roleLower, securityLevel } = resolveAccusourceRoleAndSecurityLevel(
    data as Record<string, unknown>,
    tenantIdHint
  );
  const isAdminRole =
    roleLower === 'admin' || roleLower === 'super_admin' || roleLower === 'manager';
  if (!isAdminRole && securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Admin privileges required.');
  }
}
