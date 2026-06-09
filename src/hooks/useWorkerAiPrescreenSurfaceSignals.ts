import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { WorkerDashboardActionItem } from '../utils/workerDashboardActionItems';
import {
  buildWorkerAiPrescreenDashboardActions,
  interviewApplicationIdsFromUserInterviews,
  latestWorkerAiPrescreenInterviewAtMs,
} from '../utils/workerAiPrescreenDashboardActions';
import { mergeResolvedHiringInterview } from '../utils/mergeResolvedHiringInterview';

/**
 * Loads tenant flags + applications + interviews for AI pre-screen dashboard cards and nav visibility.
 */
export function useWorkerAiPrescreenSurfaceSignals(
  tenantId: string | null | undefined,
  uid: string | null | undefined,
): {
  workerAiPrescreenItems: WorkerDashboardActionItem[];
  showPrescreenNav: boolean;
  refreshPrescreenSignals: () => void;
} {
  const [workerAiPrescreenItems, setWorkerAiPrescreenItems] = useState<WorkerDashboardActionItem[]>([]);
  const [showPrescreenNav, setShowPrescreenNav] = useState(false);
  const [tick, setTick] = useState(0);

  const refreshPrescreenSignals = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!tenantId || !uid) {
      setWorkerAiPrescreenItems([]);
      setShowPrescreenNav(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tenantSnap = await getDoc(doc(db, 'tenants', tenantId));
        const tenantData = (tenantSnap.data() || {}) as Record<string, unknown>;
        const outreachOn = tenantData.workerAiPrescreenOutreachEnabled !== false;
        const navFlag = tenantData.workerAiPrescreenNavEnabled === true;
        const tenantInterview = mergeResolvedHiringInterview(tenantData, null);

        const appCol = collection(db, 'tenants', tenantId, 'applications');
        const [q1, q2] = await Promise.all([
          getDocs(query(appCol, where('userId', '==', uid), limit(40))),
          getDocs(query(appCol, where('candidateId', '==', uid), limit(40))),
        ]);
        const merged = new Map<string, { id: string; data: Record<string, unknown> }>();
        q1.docs.forEach((d) => merged.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> }));
        q2.docs.forEach((d) => merged.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> }));
        const applications = Array.from(merged.values());

        const jobOrderIds = new Set<string>();
        const groupIds = new Set<string>();
        for (const a of applications) {
          const jo = String(a.data.jobOrderId || '').trim();
          const gid = String(a.data.groupId || '').trim();
          if (jo) jobOrderIds.add(jo);
          if (gid) groupIds.add(gid);
        }
        const jobOrderDocs = new Map<string, Record<string, unknown>>();
        const groupDocs = new Map<string, Record<string, unknown>>();
        await Promise.all([
          ...[...jobOrderIds].map(async (id) => {
            const s = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', id));
            if (s.exists()) jobOrderDocs.set(id, s.data() as Record<string, unknown>);
          }),
          ...[...groupIds].map(async (id) => {
            const s = await getDoc(doc(db, 'tenants', tenantId, 'groups', id));
            if (s.exists()) groupDocs.set(id, s.data() as Record<string, unknown>);
          }),
        ]);

        const requiredForApplication = (app: { id: string; data: Record<string, unknown> }): boolean => {
          const jo = String(app.data.jobOrderId || '').trim();
          const gid = String(app.data.groupId || '').trim();
          const container = jo ? jobOrderDocs.get(jo) : gid ? groupDocs.get(gid) : null;
          return mergeResolvedHiringInterview(tenantData, container).workerAiPrescreenRequired;
        };

        const intSnap = await getDocs(query(collection(db, 'users', uid, 'interviews'), limit(60)));
        const intRows = intSnap.docs.map((d) => d.data() as Record<string, unknown>);
        const completedApplicationIds = interviewApplicationIdsFromUserInterviews(intRows);
        // 30-day system-interview suppression — see
        // `DEFAULT_PRESCREEN_FRESHNESS_WINDOW_MS` in
        // workerAiPrescreenDashboardActions.ts. Captures profile-first
        // interviews (no applicationId) so the dashboard doesn't nag the
        // worker to redo their interview per-application.
        const latestPrescreenAtMs = latestWorkerAiPrescreenInterviewAtMs(intRows);

        const rawItems = outreachOn
          ? buildWorkerAiPrescreenDashboardActions({
              applications,
              completedApplicationIds,
              latestPrescreenInterviewAtMs: latestPrescreenAtMs,
            })
          : [];
        const items = rawItems.filter((it) => {
          const aid = it.qaEvaluatedFields?.applicationId;
          if (typeof aid !== 'string' || !aid) return true;
          const row = merged.get(aid);
          return row ? requiredForApplication(row) : true;
        });

        // Nav-visibility rule:
        //   - If there's an OPEN prescreen action (`items.length > 0`)
        //     — e.g. the worker started a fresh prescreen tied to a new
        //     application, or a hiring-required interview is still
        //     pending — surface the nav so they can finish.
        //   - Otherwise, only show the standalone nav entry when the
        //     tenant has it explicitly enabled AND the worker hasn't
        //     completed any prescreen interview yet. Once they've
        //     completed one (`latestPrescreenAtMs` set), hide the nav.
        //     Re-running the prescreen after completion isn't a worker-
        //     initiated flow, and leaving "Pre-screen" in the sidebar
        //     reads as "you still have something to do" when in fact
        //     everything is done.
        const hasAnyCompletedInterview = Boolean(latestPrescreenAtMs);
        const showNav =
          items.length > 0 ||
          (navFlag &&
            tenantInterview.workerAiPrescreenRequired &&
            !hasAnyCompletedInterview);

        if (!cancelled) {
          setWorkerAiPrescreenItems(items);
          setShowPrescreenNav(showNav);
        }
      } catch (e) {
        console.warn('useWorkerAiPrescreenSurfaceSignals: load failed', e);
        if (!cancelled) {
          setWorkerAiPrescreenItems([]);
          setShowPrescreenNav(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, uid, tick]);

  return { workerAiPrescreenItems, showPrescreenNav, refreshPrescreenSignals };
}
