import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export interface ScreeningAutomationEffectiveConfig {
  /** Master switch — default false until explicitly enabled in env. */
  enabled: boolean;
  /** When true, log + audit only; no AccuSource order. Default true for safe rollout. */
  dryRun: boolean;
}

/**
 * Env defaults: automation OFF and dry-run ON until operators set
 * SCREENING_AUTOMATION_ENABLED=true and SCREENING_AUTOMATION_DRY_RUN=false.
 */
export function getEnvScreeningAutomationConfig(): ScreeningAutomationEffectiveConfig {
  const enabled = process.env.SCREENING_AUTOMATION_ENABLED === 'true';
  const dryRun = process.env.SCREENING_AUTOMATION_DRY_RUN !== 'false';
  return { enabled, dryRun };
}

export async function getTenantScreeningAutomationConfig(
  tenantId: string
): Promise<Partial<ScreeningAutomationEffectiveConfig>> {
  try {
    const snap = await db.doc(`tenants/${tenantId}/config/screeningAutomation`).get();
    if (!snap.exists) return {};
    const d = snap.data() as Record<string, unknown>;
    const out: Partial<ScreeningAutomationEffectiveConfig> = {};
    if (typeof d.enabled === 'boolean') out.enabled = d.enabled;
    if (typeof d.dryRun === 'boolean') out.dryRun = d.dryRun;
    return out;
  } catch (e: unknown) {
    logger.warn('[screeningAutomation] tenant config read failed', {
      tenantId,
      message: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}

export async function resolveScreeningAutomationConfig(
  tenantId: string
): Promise<ScreeningAutomationEffectiveConfig> {
  const env = getEnvScreeningAutomationConfig();
  const tenant = await getTenantScreeningAutomationConfig(tenantId);
  return {
    enabled: tenant.enabled !== undefined ? tenant.enabled : env.enabled,
    dryRun: tenant.dryRun !== undefined ? tenant.dryRun : env.dryRun,
  };
}
