import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { assignmentStatusIsActiveForWorkStatusColumn } from '../utils/workStatusColumnDisplay';

const FIRESTORE_IN_MAX = 30;
const IDS_FINGERPRINT_SEP = '\u001e';

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * User IDs in the tenant that have at least one assignment with status confirmed / active / in_progress
 * (see `assignmentStatusIsActiveForWorkStatusColumn`). Queries `tenants/{tenantId}/assignments`.
 */
export function useActiveAssignmentUserIds(
  tenantId: string | undefined,
  userIds: readonly string[],
): Set<string> {
  const sortedKey = [...new Set(userIds.filter(Boolean))].sort().join(IDS_FINGERPRINT_SEP);
  const [out, setOut] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!tenantId || sortedKey.length === 0) {
      setOut(new Set());
      return;
    }

    const ids = sortedKey.split(IDS_FINGERPRINT_SEP).filter(Boolean);
    let cancelled = false;

    (async () => {
      const next = new Set<string>();
      const coll = collection(db, 'tenants', tenantId, 'assignments');
      const chunks = chunkIds(ids, FIRESTORE_IN_MAX);

      try {
        for (const chunk of chunks) {
          if (cancelled) return;
          const [snapUser, snapCand] = await Promise.all([
            getDocs(query(coll, where('userId', 'in', [...chunk]))),
            getDocs(query(coll, where('candidateId', 'in', [...chunk]))),
          ]);
          const seenDoc = new Set<string>();
          for (const d of [...snapUser.docs, ...snapCand.docs]) {
            if (seenDoc.has(d.id)) continue;
            seenDoc.add(d.id);
            const data = d.data() as Record<string, unknown>;
            const st = data?.status;
            if (!assignmentStatusIsActiveForWorkStatusColumn(typeof st === 'string' ? st : String(st ?? ''))) {
              continue;
            }
            const uid = String(data?.userId || data?.candidateId || '').trim();
            if (uid) next.add(uid);
          }
        }
      } catch (e) {
        console.warn('useActiveAssignmentUserIds: fetch failed', e);
      }

      if (!cancelled) setOut(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, sortedKey]);

  return out;
}
