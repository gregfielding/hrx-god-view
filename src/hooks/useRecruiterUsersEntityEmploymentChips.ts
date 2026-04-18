import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { UserListEntityOnboardingItem } from '../utils/userListEntityEmploymentStatus';
import { chipItemsFromDedupeMap, mergeEntityEmploymentDocIntoChipMap } from '../utils/userListEntityEmploymentStatus';
import { getWorkerPayrollAccount } from '../utils/workerPayrollAccount';
import type { WorkerOnboardingPipeline } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { RecruiterUserEmploymentBreakdownContext } from '../types/recruiterEmploymentBreakdownContext';
import type { WorkerPayrollAccount } from '../types/payroll';
import {
  entityEmploymentRecordFromRaw,
  findWorkerOnboardingForEntityEmployment,
  normalizeEntityKeyForPayroll,
  pickPrimaryEntityEmploymentDoc,
} from '../utils/recruiterEmploymentBreakdownPick';

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

export type { RecruiterUserEmploymentBreakdownContext } from '../types/recruiterEmploymentBreakdownContext';

/**
 * Batch-loads `entity_employments` for the given user IDs (recruiter list page).
 * Returns a map of userId → chip items (deduped per entity, sorted for display).
 * Also returns employment breakdown context (pipeline + payroll) for the primary entity row per user.
 */
export function useRecruiterUsersEntityEmploymentChips(
  tenantId: string | undefined,
  userIds: readonly string[],
): {
  itemsByUserId: Map<string, UserListEntityOnboardingItem[]>;
  employmentBreakdownByUserId: Map<string, RecruiterUserEmploymentBreakdownContext | null>;
  loading: boolean;
} {
  const sortedIdsKey = [...new Set(userIds.filter(Boolean))].sort().join(IDS_FINGERPRINT_SEP);

  const [itemsByUserId, setItemsByUserId] = useState<Map<string, UserListEntityOnboardingItem[]>>(new Map());
  const [employmentBreakdownByUserId, setEmploymentBreakdownByUserId] = useState<
    Map<string, RecruiterUserEmploymentBreakdownContext | null>
  >(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId || sortedIdsKey.length === 0) {
      setItemsByUserId(new Map());
      setEmploymentBreakdownByUserId(new Map());
      setLoading(false);
      return;
    }

    const ids = sortedIdsKey.split(IDS_FINGERPRINT_SEP).filter(Boolean);
    let cancelled = false;

    (async () => {
      setLoading(true);
      const byUser = new Map<string, Map<string, UserListEntityOnboardingItem>>();
      const rawByUser = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();

      try {
        const chunks = chunkIds(ids, FIRESTORE_IN_MAX);
        const coll = collection(db, p.entityEmployments(tenantId));

        for (const chunk of chunks) {
          const q = query(coll, where('userId', 'in', [...chunk]));
          const snap = await getDocs(q);
          snap.docs.forEach((docSnap) => {
            const uid = String((docSnap.data() as Record<string, unknown>).userId || '').trim();
            if (!uid) return;
            if (!byUser.has(uid)) byUser.set(uid, new Map());
            mergeEntityEmploymentDocIntoChipMap(byUser.get(uid)!, docSnap);
            if (!rawByUser.has(uid)) rawByUser.set(uid, []);
            rawByUser.get(uid)!.push({ id: docSnap.id, data: docSnap.data() as Record<string, unknown> });
          });
        }

        const woByUser = new Map<string, WorkerOnboardingPipeline[]>();
        for (const chunk of chunks) {
          const woSnap = await getDocs(
            query(collection(db, p.workerOnboarding(tenantId)), where('userId', 'in', [...chunk])),
          );
          woSnap.docs.forEach((d) => {
            const uid = String((d.data() as Record<string, unknown>).userId || '').trim();
            if (!uid) return;
            const pipe = { id: d.id, ...(d.data() as object) } as WorkerOnboardingPipeline;
            if (!woByUser.has(uid)) woByUser.set(uid, []);
            woByUser.get(uid)!.push(pipe);
          });
        }

        const breakdownOut = new Map<string, RecruiterUserEmploymentBreakdownContext | null>();

        await Promise.all(
          ids.map(async (uid) => {
            const docs = rawByUser.get(uid) || [];
            const primary = pickPrimaryEntityEmploymentDoc(docs);
            if (!primary) {
              breakdownOut.set(uid, null);
              return;
            }
            const ee = entityEmploymentRecordFromRaw(primary.id, primary.data);
            const pipes = woByUser.get(uid) || [];
            const wo = findWorkerOnboardingForEntityEmployment(uid, primary.data, pipes);
            const ek = normalizeEntityKeyForPayroll(String(ee.entityKey || ''));
            let payroll: (WorkerPayrollAccount & { id: string }) | null = null;
            try {
              payroll = await getWorkerPayrollAccount(tenantId, uid, ek);
            } catch {
              payroll = null;
            }
            breakdownOut.set(uid, { entityEmployment: ee, workerOnboarding: wo, workerPayrollAccount: payroll });
          }),
        );

        if (cancelled) return;

        const out = new Map<string, UserListEntityOnboardingItem[]>();
        byUser.forEach((inner, uid) => {
          out.set(uid, chipItemsFromDedupeMap(inner));
        });
        setItemsByUserId(out);
        setEmploymentBreakdownByUserId(breakdownOut);
      } catch (e) {
        console.error('useRecruiterUsersEntityEmploymentChips: fetch failed', e);
        if (!cancelled) {
          setItemsByUserId(new Map());
          setEmploymentBreakdownByUserId(new Map());
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, sortedIdsKey]);

  return { itemsByUserId, employmentBreakdownByUserId, loading };
}
