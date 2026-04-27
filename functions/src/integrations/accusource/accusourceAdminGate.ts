import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getAccusourceConfig, isAccusourceProductionValidationHrxOnly } from './config';
import { accusourceLog } from './accusourceLogger';

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

/** How `createBackgroundCheckInternal` was invoked — drives production validation guardrails. */
export type AccusourceOrderInvocation =
  | { type: 'callable'; auth: { token?: Record<string, unknown> } }
  | { type: 'automation' };

/** Same band as internal recruiter / group-manager eligibility — L5–7 for the active tenant. */
export const ACCUSOURCE_PRODUCTION_ORDER_SECURITY_LEVEL_MIN = 5;
export const ACCUSOURCE_PRODUCTION_ORDER_SECURITY_LEVEL_MAX = 7;

/**
 * During controlled production validation (`ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY` default true):
 * - Callable orders allowed if Firebase Auth claim `hrx: true` **or** effective security level 5–7 for
 *   `tenantId` on the order (see `resolveAccusourceRoleAndSecurityLevel`).
 * - Assignment automation orders are blocked so automation does not hit production during validation.
 */
export async function assertAccusourceProductionOrderPolicy(
  invocation: AccusourceOrderInvocation,
  callerUid: string,
  tenantIdHint?: string | null,
): Promise<void> {
  const cfg = getAccusourceConfig();
  if (cfg.environment !== 'production') {
    return;
  }
  if (!isAccusourceProductionValidationHrxOnly()) {
    return;
  }

  if (invocation.type === 'automation') {
    accusourceLog('warn', 'policy', 'Blocked automated AccuSource order during production validation (HRX-only mode).', {
      reason: 'automation_disabled_in_production_validation',
      callerUid,
    });
    throw new HttpsError(
      'failed-precondition',
      'AccuSource production validation: automated screening orders are disabled. Set ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=false after validation, or point ACCUSOURCE_ENVIRONMENT=sandbox for automation tests.',
    );
  }

  const hrx = invocation.auth.token?.hrx === true;
  if (hrx) {
    accusourceLog('info', 'policy', 'Production order allowed (HRX caller, validation mode).', {
      reason: 'hrx_callable',
      callerUid,
      hrxClaim: true,
    });
    return;
  }

  const userSnap = await db.collection('users').doc(callerUid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }
  const { securityLevel } = resolveAccusourceRoleAndSecurityLevel(
    userSnap.data() as Record<string, unknown>,
    tenantIdHint,
  );
  const allowedByLevel =
    securityLevel >= ACCUSOURCE_PRODUCTION_ORDER_SECURITY_LEVEL_MIN &&
    securityLevel <= ACCUSOURCE_PRODUCTION_ORDER_SECURITY_LEVEL_MAX;

  if (!allowedByLevel) {
    accusourceLog('warn', 'policy', 'Rejected AccuSource production order (not HRX and not L5–7 for tenant).', {
      reason: 'hrx_or_level_5_7_required',
      callerUid,
      hrxClaim: false,
      securityLevel,
      tenantIdHint: tenantIdHint ?? null,
    });
    throw new HttpsError(
      'permission-denied',
      'AccuSource production validation: background check orders require HRX staff or security level 5–7 for this tenant. You can still refresh the package catalog. After validation, set ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=false to use the standard admin gate only.',
    );
  }

  accusourceLog('info', 'policy', 'Production order allowed (L5–7, validation mode).', {
    reason: 'security_level_callable',
    callerUid,
    securityLevel,
  });
}
