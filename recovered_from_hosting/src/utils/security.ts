/**
 * Security Level Helpers
 * 
 * Provides functions to check user security levels and access permissions,
 * with support for per-tenant security levels.
 */

export type TenantMembershipSettings = {
  securityLevel?: string | number;
  role?: string;
  addedAt?: any;
  crm_sales?: boolean;
  department?: string;
  departmentId?: string;
  divisionId?: string;
  employmentType?: string;
  // extendable
};

export interface FrontendUser {
  uid: string;
  activeTenantId?: string;
  securityLevel?: string | number; // legacy global
  role?: string;
  tenantIds?: Record<string, TenantMembershipSettings>;
  // other fields...
  [key: string]: any;
}

export const MIN_SLACK_SECURITY_LEVEL = 5;

/**
 * Normalize security level to a number (1-7)
 */
export function normalizeSecurityLevel(level: string | number | undefined | null): number {
  if (level === undefined || level === null) return 1;
  if (typeof level === 'number') return level;
  const n = parseInt(String(level), 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), 7);
}

/**
 * Returns the effective security level for the user's active tenant.
 * 
 * Priority:
 *   1) tenantIds[activeTenantId].securityLevel
 *   2) legacy user.securityLevel
 *   3) default 1
 */
export function getSecurityLevelForActiveTenant(user?: FrontendUser | null): number {
  if (!user) return 1;
  const activeTenantId = user.activeTenantId;
  if (!activeTenantId) return normalizeSecurityLevel(user.securityLevel);

  const tenantSettings = user.tenantIds?.[activeTenantId];
  if (tenantSettings?.securityLevel !== undefined) {
    return normalizeSecurityLevel(tenantSettings.securityLevel);
  }
  return normalizeSecurityLevel(user.securityLevel);
}

/**
 * Returns true if the user is allowed to use Slack (DMs + channels)
 * for their current active tenant.
 */
export function canUserAccessSlack(user?: FrontendUser | null): boolean {
  return getSecurityLevelForActiveTenant(user) >= MIN_SLACK_SECURITY_LEVEL;
}


