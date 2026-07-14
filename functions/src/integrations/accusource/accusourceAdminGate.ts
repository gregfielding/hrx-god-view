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

/**
 * Cross-tenant guard for id-only `backgroundChecks` reads (P1 security fix,
 * 2026-07-13): the caller must belong to the doc's tenant — `activeTenantId`
 * match or a `tenantIds[tid]` entry. `hrx: true` staff operate across
 * tenants. Docs without a `tenantId` are allowed with a warning: every
 * writer stamps it, so a missing value means pre-integration data, and
 * failing closed would orphan those records.
 */
export async function assertCallerBelongsToTenant(
  uid: string,
  token: Record<string, unknown> | undefined,
  docTenantId: unknown,
  context: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const tid = String(docTenantId ?? '').trim();
  if (!tid) {
    accusourceLog('warn', 'policy', 'backgroundChecks doc missing tenantId — tenant check skipped', {
      uid,
      context,
    });
    return;
  }
  const snap = await db.collection('users').doc(uid).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const active = typeof data.activeTenantId === 'string' ? data.activeTenantId.trim() : '';
  const tenantIds = (data.tenantIds ?? {}) as Record<string, unknown>;
  if (active === tid || Object.prototype.hasOwnProperty.call(tenantIds, tid)) return;
  accusourceLog('warn', 'policy', 'Cross-tenant AccuSource access blocked', {
    uid,
    docTenantId: tid,
    context,
  });
  throw new HttpsError('permission-denied', 'This record belongs to a different tenant.');
}

/**
 * Compliance-reviewer gate (policy §6, P1 fix): setting FAILED — and any
 * override away from an effective FAILED — is reserved for `hrx: true`
 * staff or uids listed in `tenants/{tid}/integrations/accusource`
 * `.complianceReviewerUids`. Until that list is populated the standard
 * admin gate (already enforced by callers) applies, with a logged warning,
 * so deploying this cannot lock Compliance out before setup.
 */
export async function ensureAccusourceComplianceReviewer(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: unknown,
  action: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const tid = String(tenantId ?? '').trim();
  if (tid) {
    const cfgSnap = await db.doc(`tenants/${tid}/integrations/accusource`).get();
    const uids = cfgSnap.exists ? (cfgSnap.data()?.complianceReviewerUids as unknown) : undefined;
    if (Array.isArray(uids) && uids.length > 0) {
      if (uids.map(String).includes(uid)) return;
      accusourceLog('warn', 'policy', 'Compliance-reviewer action blocked', {
        uid,
        tenantId: tid,
        action,
      });
      throw new HttpsError(
        'permission-denied',
        'This adjudication requires a Compliance Reviewer. Ask an administrator to add you to complianceReviewerUids on the AccuSource integration settings.',
      );
    }
  }
  accusourceLog('warn', 'policy', 'complianceReviewerUids not configured — falling back to admin gate', {
    uid,
    tenantId: tid || null,
    action,
  });
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
