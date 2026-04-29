/**
 * Everee config: resolve entity → evereeTenantId + baseUrl (HRX Everee Master Plan §4.1).
 * Reads from Firestore entity doc; no API token here (evereeAuth handles secrets).
 */

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export type EvereeEnvironment = 'sandbox' | 'production';

export interface EvereeEntityConfig {
  evereeTenantId: string;
  evereeEnvironment: EvereeEnvironment;
  evereeApiBaseUrl?: string;
  evereeEnabled: boolean;
  /**
   * Everee **contractor** onboarding (`POST /api/v2/onboarding/contractor`) may
   * require routing into an approval group configured in the Everee tenant.
   * Optional on the entity doc — thread through when C1 Events (1099) auto-
   * provision ships (Stage 2).
   */
  evereeApprovalGroupId?: number;
}

// Everee uses a single API host for both environments; the sandbox-vs-prod
// split is enforced by the per-tenant API token (`EVEREE_API_TOKEN_<tid>`),
// not by hostname. Set `EVEREE_BASE_URL` in env to override globally for
// staging/dry-run; per-entity override still wins via `evereeApiBaseUrl` on
// the entity doc.
const DEFAULT_EVEREE_BASE = 'https://api.everee.com';
const DEFAULT_SANDBOX_BASE = process.env.EVEREE_BASE_URL || DEFAULT_EVEREE_BASE;
const DEFAULT_PROD_BASE = process.env.EVEREE_BASE_URL || DEFAULT_EVEREE_BASE;

/**
 * Resolve Everee config for an entity. Returns null if entity has no Everee or not enabled.
 */
export async function getEvereeConfigForEntity(
  tenantId: string,
  entityId: string
): Promise<EvereeEntityConfig | null> {
  const db = getFirestore();
  const entityRef = db.doc(`tenants/${tenantId}/entities/${entityId}`);
  const snap = await entityRef.get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown> | undefined;
  const provider = data?.payrollProvider as string | undefined;
  const enabled = data?.evereeEnabled === true && provider === 'everee';
  const evereeTenantId = data?.evereeTenantId as string | undefined;
  if (!enabled || !evereeTenantId?.trim()) return null;
  const env = (data?.evereeEnvironment as EvereeEnvironment) || 'sandbox';
  const baseUrl =
    (data?.evereeApiBaseUrl as string)?.trim() ||
    (env === 'production' ? DEFAULT_PROD_BASE : DEFAULT_SANDBOX_BASE);
  const rawApproval = data?.evereeApprovalGroupId ?? data?.approvalGroupId;
  let evereeApprovalGroupId: number | undefined;
  if (typeof rawApproval === 'number' && Number.isFinite(rawApproval)) {
    evereeApprovalGroupId = rawApproval;
  } else if (typeof rawApproval === 'string' && /^\d+$/.test(rawApproval.trim())) {
    evereeApprovalGroupId = parseInt(rawApproval.trim(), 10);
  }
  return {
    evereeTenantId: evereeTenantId.trim(),
    evereeEnvironment: env,
    evereeApiBaseUrl: baseUrl,
    evereeEnabled: true,
    ...(evereeApprovalGroupId !== undefined ? { evereeApprovalGroupId } : {}),
  };
}

/**
 * Callable gate helper — AND of env-var and per-entity flag.
 *
 * Used at the top of every Everee callable so rollout can be staged per entity
 * (e.g. turn on C1 Workforce before C1 Events) without flipping the env-wide
 * switch. The env-var `EVEREE_ENABLED=true` is required at the process level
 * (evereeGate.ts); this adds the second AND: the entity must opt in via its
 * `evereeEnabled=true` + `payrollProvider='everee'` settings.
 *
 * Throws HttpsError('failed-precondition') so the error surfaces uniformly on
 * the client regardless of which callable blocked. Returns the resolved config
 * so callers don't need a second round-trip.
 */
export async function requireEvereeEnabledEntity(
  tenantId: string,
  entityId: string,
): Promise<EvereeEntityConfig> {
  if (process.env.EVEREE_ENABLED !== 'true') {
    throw new HttpsError(
      'failed-precondition',
      'Everee is disabled at the process level (EVEREE_ENABLED !== "true").',
    );
  }
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) {
    throw new HttpsError(
      'failed-precondition',
      `Everee is not enabled for entity ${entityId}. Set entity.evereeEnabled=true and payrollProvider="everee".`,
    );
  }
  return config;
}

/** Path helpers for Everee collections (functions-side). */
export const evereePaths = {
  workers: (tid: string) => `tenants/${tid}/everee_workers`,
  worker: (tid: string, entityId: string, userId: string) =>
    `tenants/${tid}/everee_workers/${entityId}__${userId}`,
  embedSessions: (tid: string) => `tenants/${tid}/everee_embed_sessions`,
  webhookEvents: (tid: string) => `tenants/${tid}/everee_webhook_events`,
  payHistoryCache: (tid: string) => `tenants/${tid}/everee_pay_history_cache`,
};
