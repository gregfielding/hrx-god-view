/**
 * RD.1 — Section 3 hook: open onboarding-call tasks for the CSA to action.
 *
 * **Subscription shape:**
 *   - `tenants/{tid}/tasks` collection (canonical) — primary source.
 *   - In My Users mode we narrow with `where('assignedTo', '==', currentUid)`
 *     so the CSA only sees their own queue. In All Users mode we drop the
 *     assignment filter so HRX admins / leads see the whole tenant.
 *   - Status / category / type filtering happens IN MEMORY because
 *     - `assignedTo` may legacy-store as either a string OR an array (the
 *       `useMyTasks` hook handles this — we mirror its read pattern, which
 *       only catches the string variant on the server but is the only
 *       indexable shape in production today),
 *     - and the spec's "onboarding_call" predicate is a disjunction
 *       (`type === 'onboarding'` OR `category === 'onboarding'`), which
 *       Firestore can't express server-side without two separate listeners.
 *
 * **Why we don't merge `crm_tasks`:** the legacy `crm_tasks` collection
 * is CRM-specific (deal/company/contact tasks). Onboarding-call tasks for
 * workers are written to the canonical `tasks` collection. Skipping the
 * legacy mirror keeps the row count honest and avoids surfacing CRM tasks
 * that happen to be miscategorized as 'onboarding'.
 *
 * **Live updates:** when the CSA completes a task via TaskDetailsDialog,
 * the underlying doc's `status` flips to `'completed'`, the snapshot
 * fires, and `isPendingOnboardingCallTask` drops the row on the next
 * tick — no manual refresh needed.
 */
import {
  collection,
  onSnapshot,
  query,
  where,
  type QuerySnapshot,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { db } from '../firebase';
import type { Task } from '../types/Tasks';
import {
  isPendingOnboardingCallTask,
  resolveWorkerUidFromTask,
} from './internal/csaOnboardingCallTaskFilter';

/**
 * Stable row shape for `PendingOnboardingCallsSection`. We pass the
 * full underlying `task` object through so the row can hand it to
 * `TaskDetailsDialog` directly (the dialog wants a full task, not a
 * taskId — saving us a getDoc round-trip).
 */
export interface CsaPendingOnboardingCallRow {
  taskId: string;
  /** Worker uid the task is about — null when the task has no resolvable */
  /** worker association. Renderer falls back to "Unknown worker". */
  workerUid: string | null;
  /** Pre-coerced raw task data so the section can pass it to TaskDetailsDialog. */
  task: Task & { id: string };
  /** Title to display in the row (falls back to a humanized type). */
  title: string;
  /** Created-at ms-since-epoch — drives the "X ago" display column. */
  createdAtMs: number | null;
  /** The hiring entity name, surfaced from associations.companies[0] when */
  /** the task carries one; otherwise undefined and the column shows '—'. */
  hiringEntityName?: string;
}

export interface UseCsaPendingOnboardingCallTasksOptions {
  tenantId: string | null;
  currentUserUid: string | null;
  scope: 'mine' | 'all';
}

export interface UseCsaPendingOnboardingCallTasksResult {
  rows: CsaPendingOnboardingCallRow[];
  loading: boolean;
  error: string | null;
}

function asString(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function coerceCreatedAtMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (raw && typeof raw === 'object') {
    const ts = raw as { toDate?: () => Date; seconds?: number };
    if (typeof ts.toDate === 'function') {
      try {
        return ts.toDate().getTime();
      } catch {
        return null;
      }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  }
  return null;
}

const useCsaPendingOnboardingCallTasks = ({
  tenantId,
  currentUserUid,
  scope,
}: UseCsaPendingOnboardingCallTasksOptions): UseCsaPendingOnboardingCallTasksResult => {
  const [rawTasks, setRawTasks] = useState<Array<Task & { id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setRawTasks([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    if (scope === 'mine' && !currentUserUid) {
      // Defensive: can't filter "mine" without a uid. Empty result rather
      // than a noisy error — the parent's auth gate should prevent this.
      setRawTasks([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = collection(db, 'tenants', tenantId, 'tasks');
    // Server-side narrowing:
    //   - 'mine' → assignedTo == currentUid (cheap index hit).
    //   - 'all'  → no equality filter; pull every task in the tenant and
    //     let the in-memory predicate drop the irrelevant ones. Most
    //     tenants have task volumes well within the 10k-doc snapshot
    //     comfort zone; if that ever changes, we'd add a server-side
    //     `where('category', '==', 'onboarding')` and a parallel listener
    //     for `where('type', '==', 'onboarding')`.
    const q =
      scope === 'mine' && currentUserUid
        ? query(ref, where('assignedTo', '==', currentUserUid))
        : query(ref);

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot) => {
        const next: Array<Task & { id: string }> = [];
        for (const d of snap.docs) {
          next.push({ id: d.id, ...(d.data() as Task) });
        }
        setRawTasks(next);
        setLoading(false);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[useCsaPendingOnboardingCallTasks] snapshot error', err);
        setError(err.message || 'Failed to load onboarding-call tasks.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [tenantId, scope, currentUserUid]);

  const rows = useMemo<CsaPendingOnboardingCallRow[]>(() => {
    if (rawTasks.length === 0) return [];
    const out: CsaPendingOnboardingCallRow[] = [];
    for (const t of rawTasks) {
      // The disjunction predicate (open AND onboarding) is the heart of
      // the section. See `csaOnboardingCallTaskFilter.ts` for rationale.
      if (!isPendingOnboardingCallTask(t)) continue;

      const workerUid = resolveWorkerUidFromTask(t as unknown as Parameters<typeof resolveWorkerUidFromTask>[0]);
      const companies = (t.associations?.companies ?? []) as ReadonlyArray<string>;
      // Section column is "Hiring entity"; the task associations layer
      // doesn't carry an entity name, only a company id. Display falls
      // back to the company id and the consumer can swap in a name lookup
      // later. Better than rendering nothing.
      const hiringEntityName = companies[0] ? asString(companies[0]) : undefined;

      out.push({
        taskId: t.id,
        workerUid,
        task: t,
        title: t.title || 'Onboarding call',
        createdAtMs: coerceCreatedAtMs((t as unknown as { createdAt?: unknown }).createdAt),
        hiringEntityName,
      });
    }
    // Oldest-first: the longer it's been pending, the more it deserves
    // the CSA's attention. Tasks without a createdAt sink to the bottom.
    out.sort((a, b) => {
      const aMs = a.createdAtMs ?? Number.MAX_SAFE_INTEGER;
      const bMs = b.createdAtMs ?? Number.MAX_SAFE_INTEGER;
      return aMs - bMs;
    });
    return out;
  }, [rawTasks]);

  return { rows, loading, error };
};

export default useCsaPendingOnboardingCallTasks;
