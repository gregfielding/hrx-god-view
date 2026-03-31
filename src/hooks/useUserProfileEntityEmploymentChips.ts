import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserListEntityOnboardingItem } from '../utils/userListEntityEmploymentStatus';
import { chipItemsFromDedupeMap, mergeEntityEmploymentDocIntoChipMap } from '../utils/userListEntityEmploymentStatus';

/**
 * Loads `entity_employments` for one user (profile header).
 */
export function useUserProfileEntityEmploymentChips(
  tenantId: string | undefined,
  userId: string | undefined,
  enabled: boolean
): { items: UserListEntityOnboardingItem[]; loading: boolean } {
  const [items, setItems] = useState<UserListEntityOnboardingItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !tenantId || !userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', userId));
        const snap = await getDocs(q);
        const map = new Map<string, UserListEntityOnboardingItem>();
        snap.docs.forEach((docSnap) => mergeEntityEmploymentDocIntoChipMap(map, docSnap));
        const next = chipItemsFromDedupeMap(map);
        if (!cancelled) setItems(next);
      } catch (e) {
        console.error('useUserProfileEntityEmploymentChips: fetch failed', e);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, userId, enabled]);

  return { items, loading };
}
