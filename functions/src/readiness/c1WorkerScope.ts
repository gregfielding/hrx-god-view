/**
 * C1 worker population — same scope as home readiness snapshot automation.
 */

export const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

function normalizeSecurityLevel(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function isWorkerSecurityLevel(level: number | null): boolean {
  return level === null || level <= 4;
}

export function isC1WorkerScope(userDoc: Record<string, unknown>): boolean {
  const activeTenantId = String(userDoc.activeTenantId || '').trim();
  const tenantId = String(userDoc.tenantId || '').trim();
  const tenantIds = (userDoc.tenantIds as Record<string, unknown> | undefined) || {};
  const inC1 = activeTenantId === C1_TENANT_ID || tenantId === C1_TENANT_ID || tenantIds[C1_TENANT_ID] != null;
  if (!inC1) return false;

  const directSecurity = normalizeSecurityLevel(userDoc.securityLevel);
  const tenantSecurity = normalizeSecurityLevel(
    (tenantIds[C1_TENANT_ID] as Record<string, unknown> | undefined)?.securityLevel,
  );
  const resolved = tenantSecurity ?? directSecurity;
  return isWorkerSecurityLevel(resolved);
}
