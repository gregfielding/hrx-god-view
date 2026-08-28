/**
 * Which Everee tenant IDs may appear on `/c1/workers/payroll` — employers where
 * payroll onboarding has STARTED (an `everee_workers` linkage doc with a worker
 * id — provisioning is the start of onboarding), unless the worker's employment
 * for that entity has ENDED (terminal status / terminatedAt). A missing
 * `entity_employments` row is fine: workers are provisioned into Everee before
 * their employment row goes active, and they need the card to finish setup
 * (Greg 2026-08-28; previously required an ACTIVE employment row AND linkage,
 * which hid the card exactly when mid-onboarding workers needed it).
 *
 * Does not read `entities/*` (workers often lack Firestore read on entities).
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/** Loose match for Firestore string vs numeric everee tenant ids. */
export function evereeTenantIdsMatch(a: string, b: string): boolean {
  const na = String(a ?? '').trim();
  const nb = String(b ?? '').trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (/^\d+$/.test(na) && /^\d+$/.test(nb)) {
    return parseInt(na, 10) === parseInt(nb, 10);
  }
  return false;
}

function normalizeEvereeTenantIdForSet(raw: string | number | undefined | null): string | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  const s = String(raw).trim();
  return s || null;
}

const TERMINAL_EMPLOYMENT_STATUS = new Set(['terminated', 'separated', 'inactive']);

/**
 * Everee tenant ids (normalized strings) the payroll picker may show — see
 * module doc: onboarding started (linkage doc with a worker id), minus
 * entities whose employment has ended.
 */
export async function buildPayrollEligibleEvereeTenantIdSet(
  db: Firestore,
  tenantId: string,
  uid: string,
): Promise<Set<string>> {
  const allowed = new Set<string>();

  const [eeSnap, linkSnap] = await Promise.all([
    getDocs(
      query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', uid)),
    ),
    getDocs(
      query(collection(db, 'tenants', tenantId, 'everee_workers'), where('firebaseUid', '==', uid)),
    ),
  ]);

  const terminalEntityIds = new Set<string>();
  eeSnap.docs.forEach((d) => {
    const data = d.data() as {
      entityId?: string;
      terminatedAt?: unknown;
      status?: string;
    };
    const eid = typeof data.entityId === 'string' ? data.entityId.trim() : '';
    if (!eid) return;
    const st = String(data.status || '').toLowerCase();
    if (data.terminatedAt || TERMINAL_EMPLOYMENT_STATUS.has(st)) terminalEntityIds.add(eid);
  });

  linkSnap.docs.forEach((d) => {
    const data = d.data() as {
      entityId?: string;
      evereeTenantId?: string | number;
      evereeWorkerId?: string;
      externalWorkerId?: string;
    };
    const w = String(data.evereeWorkerId || data.externalWorkerId || '').trim();
    if (!w) return;
    const entityId =
      (typeof data.entityId === 'string' && data.entityId.trim()) || d.id.split('__')[0] || '';
    if (entityId && terminalEntityIds.has(entityId)) return;
    const tid = normalizeEvereeTenantIdForSet(data.evereeTenantId);
    if (tid) allowed.add(tid);
  });

  return allowed;
}

/** Keep only map entries whose Everee tenant id is allowed for active employment. */
export function filterEvereeWorkerMapByEligibleTenants(
  map: Record<string, string>,
  allowed: Set<string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!k || !String(v ?? '').trim()) continue;
    let ok = false;
    for (const a of allowed) {
      if (evereeTenantIdsMatch(a, k)) {
        ok = true;
        break;
      }
    }
    if (ok) next[k] = v;
  }
  return next;
}
