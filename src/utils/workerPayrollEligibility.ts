/**
 * Which Everee tenant IDs may appear on `/c1/workers/payroll` — only employers where
 * the worker has a **current** `entity_employments` row and a matching
 * `tenants/{tid}/everee_workers/{entityId}__{userId}` doc (Everee actually linked for that hire).
 *
 * Does not read `entities/*` (workers often lack Firestore read on entities).
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
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
 * Everee tenant ids (normalized strings) for which the worker may use payroll: active employment
 * for `entityId` **and** an `everee_workers` linkage doc for `entityId__uid`.
 */
export async function buildPayrollEligibleEvereeTenantIdSet(
  db: Firestore,
  tenantId: string,
  uid: string,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  const eeSnap = await getDocs(
    query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', uid)),
  );

  const activeEntityIds = new Set<string>();
  eeSnap.docs.forEach((d) => {
    const data = d.data() as {
      entityId?: string;
      terminatedAt?: unknown;
      status?: string;
    };
    if (data.terminatedAt) return;
    const st = String(data.status || '').toLowerCase();
    if (TERMINAL_EMPLOYMENT_STATUS.has(st)) return;
    const eid = typeof data.entityId === 'string' ? data.entityId.trim() : '';
    if (eid) activeEntityIds.add(eid);
  });

  if (activeEntityIds.size === 0) return allowed;

  await Promise.all(
    [...activeEntityIds].map(async (entityId) => {
      try {
        const linkId = `${entityId}__${uid}`;
        const linkSnap = await getDoc(doc(db, 'tenants', tenantId, 'everee_workers', linkId));
        if (!linkSnap.exists()) return;
        const data = linkSnap.data() as {
          evereeTenantId?: string | number;
          evereeWorkerId?: string;
          externalWorkerId?: string;
        };
        const w = String(data.evereeWorkerId || data.externalWorkerId || '').trim();
        if (!w) return;
        const tid = normalizeEvereeTenantIdForSet(data.evereeTenantId);
        if (tid) allowed.add(tid);
      } catch {
        /* ignore */
      }
    }),
  );

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
