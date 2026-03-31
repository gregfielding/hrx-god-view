import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserListEntityOnboardingItem } from '../utils/userListEntityEmploymentStatus';
import { chipItemsFromDedupeMap, mergeEntityEmploymentDocIntoChipMap } from '../utils/userListEntityEmploymentStatus';

const FIRESTORE_IN_MAX = 30;
/** Separator for fingerprinting user id lists (Firestore UIDs do not contain this char). */
const IDS_FINGERPRINT_SEP = '\u001e';

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Batch-loads `entity_employments` for the given user IDs (recruiter list page).
 * Returns a map of userId → chip items (deduped per entity, sorted for display).
 */
export function useRecruiterUsersEntityEmploymentChips(
  tenantId: string | undefined,
  userIds: readonly string[]
): { itemsByUserId: Map<string, UserListEntityOnboardingItem[]>; loading: boolean } {
  const sortedIdsKey = [...new Set(userIds.filter(Boolean))].sort().join(IDS_FINGERPRINT_SEP);

  const [itemsByUserId, setItemsByUserId] = useState<Map<string, UserListEntityOnboardingItem[]>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId || sortedIdsKey.length === 0) {
      setItemsByUserId(new Map());
      setLoading(false);
      return;
    }

    const ids = sortedIdsKey.split(IDS_FINGERPRINT_SEP).filter(Boolean);
    let cancelled = false;

    (async () => {
      setLoading(true);
      const byUser = new Map<string, Map<string, UserListEntityOnboardingItem>>();

      try {
        const chunks = chunkIds(ids, FIRESTORE_IN_MAX);
        const coll = collection(db, 'tenants', tenantId, 'entity_employments');

        for (const chunk of chunks) {
          const q = query(coll, where('userId', 'in', [...chunk]));
          const snap = await getDocs(q);
          snap.docs.forEach((docSnap) => {
            const uid = String((docSnap.data() as Record<string, unknown>).userId || '').trim();
            if (!uid) return;
            if (!byUser.has(uid)) byUser.set(uid, new Map());
            mergeEntityEmploymentDocIntoChipMap(byUser.get(uid)!, docSnap);
          });
        }
      } catch (e) {
        console.error('useRecruiterUsersEntityEmploymentChips: fetch failed', e);
      }

      if (cancelled) return;

      const out = new Map<string, UserListEntityOnboardingItem[]>();
      byUser.forEach((inner, uid) => {
        out.set(uid, chipItemsFromDedupeMap(inner));
      });
      setItemsByUserId(out);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, sortedIdsKey]);

  return { itemsByUserId, loading };
}
