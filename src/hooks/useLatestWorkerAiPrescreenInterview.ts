/**
 * Loads the latest Worker AI prescreen interview AI block from `users/{uid}/interviews`
 * (newest by createdAt among `interviewKind === 'worker_ai_prescreen'` with `ai` present).
 * Does not rely on parent action-item props — single source for scoring UI.
 */
import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import type { WorkerInterviewAiBlock } from '../types/workerAiPrescreenInterview';
import { parseWorkerInterviewAiBlock } from '../utils/scoring/parseWorkerInterviewAiBlock';

export function useLatestWorkerAiPrescreenInterview(uid: string | undefined) {
  const [latestPrescreenAi, setLatestPrescreenAi] = useState<WorkerInterviewAiBlock | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid?.trim()) {
      setLatestPrescreenAi(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const interviewsRef = collection(db, 'users', uid, 'interviews');
        let snap;
        try {
          snap = await getDocs(query(interviewsRef, orderBy('createdAt', 'desc'), limit(40)));
        } catch {
          snap = await getDocs(interviewsRef);
        }
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }))
          .filter((d) => d && (d as { isArchived?: boolean }).isArchived !== true);

        const toTime = (x: (typeof docs)[0]) => {
          const c = x?.createdAt as { toDate?: () => Date } | undefined;
          const t = x?.timestamp as { toDate?: () => Date } | undefined;
          return (c?.toDate?.() ?? t?.toDate?.() ?? new Date(0)).getTime();
        };
        docs.sort((a, b) => toTime(b) - toTime(a));

        for (const row of docs) {
          const kind = row.interviewKind;
          if (kind !== 'worker_ai_prescreen') continue;
          const rawAi = row.ai;
          if (rawAi == null) continue;
          const parsed = parseWorkerInterviewAiBlock(rawAi);
          if (parsed && !cancelled) {
            setLatestPrescreenAi(parsed);
            return;
          }
        }
        if (!cancelled) setLatestPrescreenAi(null);
      } catch {
        if (!cancelled) setLatestPrescreenAi(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  return { latestPrescreenAi, loading };
}
