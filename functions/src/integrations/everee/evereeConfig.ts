/**
 * Everee config: resolve entity → evereeTenantId + baseUrl (HRX Everee Master Plan §4.1).
 * Reads from Firestore entity doc; no API token here (evereeAuth handles secrets).
 */

import { getFirestore } from 'firebase-admin/firestore';

export type EvereeEnvironment = 'sandbox' | 'production';

export interface EvereeEntityConfig {
  evereeTenantId: string;
  evereeEnvironment: EvereeEnvironment;
  evereeApiBaseUrl?: string;
  evereeEnabled: boolean;
}

const DEFAULT_SANDBOX_BASE = 'https://api.sandbox.everee.com';
const DEFAULT_PROD_BASE = 'https://api.everee.com';

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
  return {
    evereeTenantId: evereeTenantId.trim(),
    evereeEnvironment: env,
    evereeApiBaseUrl: baseUrl,
    evereeEnabled: true,
  };
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
