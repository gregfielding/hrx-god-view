import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Same resolution as Layout: JWT claims → tenant 5–7 → global `users.securityLevel`.
 */
export function useEffectiveSecurityLevel(): string {
  const { securityLevel, currentClaimsSecurityLevel, tenantIds, activeTenant } = useAuth() as {
    securityLevel: string;
    currentClaimsSecurityLevel?: string;
    tenantIds?: Record<string, unknown> | unknown[];
    activeTenant?: { id?: string } | null;
  };

  return useMemo(() => {
    if (currentClaimsSecurityLevel && ['5', '6', '7'].includes(currentClaimsSecurityLevel)) {
      return currentClaimsSecurityLevel;
    }
    if (activeTenant?.id && tenantIds && typeof tenantIds === 'object' && !Array.isArray(tenantIds)) {
      const tenantRole = tenantIds[activeTenant.id] as { securityLevel?: unknown } | undefined;
      if (tenantRole && typeof tenantRole === 'object' && tenantRole.securityLevel != null) {
        const tenantSecLevel = String(tenantRole.securityLevel);
        if (['5', '6', '7'].includes(tenantSecLevel)) {
          return tenantSecLevel;
        }
      }
    }
    return String(securityLevel ?? '');
  }, [currentClaimsSecurityLevel, activeTenant?.id, tenantIds, securityLevel]);
}

/** Internal team shell (dark nav): levels 5–7 — same as Layout `hasAdminLevel`. */
export function useIsAdminShell(): boolean {
  const level = useEffectiveSecurityLevel();
  return useMemo(() => ['5', '6', '7'].includes(level), [level]);
}
