import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';

const FIRESTORE_IN_MAX = 30;
const IDS_FINGERPRINT_SEP = '\u001e';

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function stableSortedIdsKey(userIds: readonly string[]): string {
  return [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))].sort().join(IDS_FINGERPRINT_SEP);
}

function toMillis(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Latest AccuSource `backgroundChecks` doc per user (by candidateId), for recruiter /users/all readiness.
 * When `tenantId` is set, ignores docs whose `tenantId` does not match (cross-tenant safety).
 */
export function useRecruiterUsersLatestBackgroundChecks(
  tenantId: string | undefined,
  userIds: readonly string[],
): { latestByUserId: Map<string, BackgroundCheckRecord>; loading: boolean } {
  const key = useMemo(() => stableSortedIdsKey(userIds), [userIds]);
  const ids = useMemo(() => (key ? key.split(IDS_FINGERPRINT_SEP).filter(Boolean) : []), [key]);

  const [latestByUserId, setLatestByUserId] = useState<Map<string, BackgroundCheckRecord>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setLatestByUserId(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const byUser = new Map<string, BackgroundCheckRecord>();

      try {
        const chunks = chunkIds(ids, FIRESTORE_IN_MAX);
        const coll = collection(db, 'backgroundChecks');

        for (const chunk of chunks) {
          const snap = await getDocs(query(coll, where('candidateId', 'in', [...chunk]), limit(500)));
          if (cancelled) return;

          const perCandidate: Record<string, BackgroundCheckRecord[]> = {};
          snap.docs.forEach((d) => {
            const data = d.data() as Record<string, unknown>;
            if (data.provider && data.provider !== 'accusource') return;
            const docTenant = data.tenantId != null ? String(data.tenantId).trim() : '';
            if (tenantId && docTenant && docTenant !== tenantId) return;
            const cid = String(data.candidateId || '').trim();
            if (!cid) return;
            const rec: BackgroundCheckRecord = { id: d.id, ...data } as BackgroundCheckRecord;
            if (!perCandidate[cid]) perCandidate[cid] = [];
            perCandidate[cid].push(rec);
          });

          for (const uid of chunk) {
            const list = perCandidate[uid];
            if (!list?.length) continue;
            list.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
            byUser.set(uid, list[0]!);
          }
        }
      } catch (e) {
        console.warn('useRecruiterUsersLatestBackgroundChecks: query failed', e);
      }

      if (!cancelled) {
        setLatestByUserId(byUser);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, tenantId]);

  return { latestByUserId, loading };
}
