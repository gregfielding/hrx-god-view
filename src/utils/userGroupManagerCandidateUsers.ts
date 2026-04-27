import type { Firestore } from 'firebase/firestore';
import { collection, getDocs } from 'firebase/firestore';

/**
 * Tenant access — same idea as `SenderManagementPage` / internal team lists.
 */
function hasTenantAccess(user: Record<string, any>, tenantId: string): boolean {
  if (user.tenantId === tenantId || user.activeTenantId === tenantId) return true;
  const tid = user.tenantIds;
  if (!tid) return false;
  if (Array.isArray(tid)) return tid.includes(tenantId);
  return typeof tid === 'object' && tenantId in tid;
}

/**
 * Effective security level for this tenant (root `securityLevel` vs `tenantIds[tenantId].securityLevel`).
 */
function effectiveTenantSecurityLevel(user: Record<string, any>, tenantId: string): number {
  const root = parseInt(String(user.securityLevel ?? '0'), 10) || 0;
  const tenantSl = user.tenantIds?.[tenantId]?.securityLevel;
  if (tenantSl === undefined || tenantSl === null) return root;
  const n = typeof tenantSl === 'number' ? tenantSl : parseInt(String(tenantSl), 10);
  return Number.isNaN(n) ? root : n;
}

/**
 * Internal team recruiters eligible as group managers: **security level 5–7** for this tenant.
 * Uses tenant access + effective level (not `role === 'Agency'` alone — many internals only have
 * `tenantIds.{tid}.securityLevel` set).
 *
 * Kept in sync for `UserGroupsTab` and `UserGroupDetails` Group managers pickers.
 */
export async function fetchAgencyUserGroupManagerCandidates(
  db: Firestore,
  tenantId: string,
): Promise<any[]> {
  const snapshot = await getDocs(collection(db, 'users'));
  const rows = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((user: Record<string, any>) => {
      if (!hasTenantAccess(user, tenantId)) return false;
      const level = effectiveTenantSecurityLevel(user, tenantId);
      return level >= 5 && level <= 7;
    });
  rows.sort((a: any, b: any) => {
    const na = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email || a.id;
    const nb = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.email || b.id;
    return na.localeCompare(nb);
  });
  return rows;
}
