import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { EmploymentAssignmentSummary, EmploymentEntityKey } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { UserListEntityOnboardingItem } from '../utils/userListEntityEmploymentStatus';
import { chipItemsFromDedupeMap, mergeEntityEmploymentDocIntoChipMap } from '../utils/userListEntityEmploymentStatus';
import { loadWorkerAssignmentsByEntityKey } from '../utils/loadWorkerAssignmentsByEntityKey';
import {
  buildEntityEmploymentActionSignals,
  type EntityEmploymentActionSignal,
} from '../utils/userActionItems/entitySignalsFromEmploymentDocs';

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
 *
 * Subscribes via `onSnapshot` so server-side mirrors (e.g. the Everee
 * onboarding-complete writer in `evereeAdminGetWorker`) flip the header
 * chip from `Onboarding` → `Active` without a manual refresh. Assignments
 * are still loaded one-shot — they don't change in response to the chip
 * data and a live subscription would multiply the read cost.
 */
export function useUserProfileEntityEmploymentChips(
  tenantId: string | undefined,
  userId: string | undefined,
  enabled: boolean
): { items: UserListEntityOnboardingItem[]; loading: boolean; entitySignals: EntityEmploymentActionSignal[] } {
  const [items, setItems] = useState<UserListEntityOnboardingItem[]>([]);
  const [entitySignals, setEntitySignals] = useState<EntityEmploymentActionSignal[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !tenantId || !userId) {
      setItems([]);
      setEntitySignals([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let assignmentsByKey: Record<EmploymentEntityKey, EmploymentAssignmentSummary[]> = {
      select: [],
      workforce: [],
      events: [],
    };
    setLoading(true);

    const q = query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', userId));

    const recompute = (
      docs: { id: string; data: () => Record<string, unknown> }[],
    ) => {
      const map = new Map<string, UserListEntityOnboardingItem>();
      for (const docSnap of docs) {
        const d = docSnap.data() as Record<string, unknown>;
        const entityKeyRaw = String(d.entityKey || '').trim();
        mergeEntityEmploymentDocIntoChipMap(map, docSnap, {
          assignmentsForEntity: assignmentsForEntityEmploymentDoc(assignmentsByKey, entityKeyRaw),
        });
      }
      const nextItems = chipItemsFromDedupeMap(map);
      const signals = buildEntityEmploymentActionSignals(docs, assignmentsByKey);
      if (!cancelled) {
        setItems(nextItems);
        setEntitySignals(signals);
      }
    };

    let lastDocs: { id: string; data: () => Record<string, unknown> }[] = [];

    // Kick off assignments load (one-shot) and recompute when it lands so the
    // first paint doesn't have to wait on it.
    void (async () => {
      try {
        const result = await loadWorkerAssignmentsByEntityKey(tenantId, userId);
        if (cancelled) return;
        assignmentsByKey = result;
        if (lastDocs.length) recompute(lastDocs);
      } catch (e) {
        console.error('useUserProfileEntityEmploymentChips: assignments fetch failed', e);
      }
    })();

    const unsub = onSnapshot(
      q,
      (snap) => {
        lastDocs = snap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
        recompute(lastDocs);
        if (!cancelled) setLoading(false);
      },
      (err) => {
        console.error('useUserProfileEntityEmploymentChips: snapshot failed', err);
        if (!cancelled) {
          setItems([]);
          setEntitySignals([]);
          setLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [tenantId, userId, enabled]);

  return { items, loading, entitySignals };
}
