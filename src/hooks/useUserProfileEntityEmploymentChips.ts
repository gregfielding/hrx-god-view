import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { EmploymentAssignmentSummary, EmploymentEntityKey } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { UserListEntityOnboardingItem } from '../utils/userListEntityEmploymentStatus';
import { chipItemsFromDedupeMap, mergeEntityEmploymentDocIntoChipMap } from '../utils/userListEntityEmploymentStatus';
import { loadWorkerAssignmentsByEntityKey } from '../utils/loadWorkerAssignmentsByEntityKey';

function assignmentsForEntityEmploymentDoc(
  byKey: Record<EmploymentEntityKey, EmploymentAssignmentSummary[]>,
  entityKeyRaw: string
): EmploymentAssignmentSummary[] | undefined {
  const k = entityKeyRaw.trim().toLowerCase();
  if (k === 'select' || k === 'workforce' || k === 'events') return byKey[k];
  return undefined;
}

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
        const [snap, assignmentsByKey] = await Promise.all([
          getDocs(q),
          loadWorkerAssignmentsByEntityKey(tenantId, userId),
        ]);
        const map = new Map<string, UserListEntityOnboardingItem>();
        snap.docs.forEach((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          const entityKeyRaw = String(d.entityKey || '').trim();
          mergeEntityEmploymentDocIntoChipMap(map, docSnap, {
            assignmentsForEntity: assignmentsForEntityEmploymentDoc(assignmentsByKey, entityKeyRaw),
          });
        });
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
