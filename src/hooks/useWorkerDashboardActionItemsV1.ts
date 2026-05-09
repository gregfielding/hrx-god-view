/**
 * Worker dashboard action items V1 — web hook.
 *
 * Subscribes to `users/{uid}` and returns the server-written snapshot at
 * `workerDashboardActionItemsV1.items`. The dashboard page applies
 * client-only personalization (SMS snooze filter + 3-cap) before rendering.
 *
 * Returns `null` for `items` when the snapshot isn't on the doc yet so the
 * page can fall back to the legacy V1 builder during phased rollout. Once
 * Flutter has shipped V2 too and we delete the legacy builder, the page
 * can treat `null` as "no action items".
 *
 * See `docs/WORKER_ACTION_ITEMS_V2_CURSOR_BRIEF.md` §3 for the rollout plan.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  WorkerDashboardActionItemV1,
  WorkerDashboardActionItemsSnapshotV1,
} from '../shared/workerDashboardActionItemsV1';
import { WORKER_DASHBOARD_ACTION_ITEMS_HOME_CAP } from '../shared/workerDashboardActionItemsV1';
import type {
  WorkerDashboardActionItem,
  WorkerDashboardActionId,
} from '../utils/workerDashboardActionItems';

export interface UseWorkerDashboardActionItemsV1Result {
  /** `null` while the snapshot is missing (worker hasn't been touched since rollout). */
  items: WorkerDashboardActionItemV1[] | null;
  loading: boolean;
  /** Server timestamp of the last snapshot write (for telemetry / debug). */
  updatedAt: Date | null;
  /** djb2 hash of the inputs the snapshot was computed from. */
  inputsHash: string | null;
}

const SMS_SNOOZE_KEY_PREFIX = 'worker_sms_warning_dismiss_until_';

export function useWorkerDashboardActionItemsV1(
  uid: string | null,
): UseWorkerDashboardActionItemsV1Result {
  const [state, setState] = useState<UseWorkerDashboardActionItemsV1Result>({
    items: null,
    loading: Boolean(uid),
    updatedAt: null,
    inputsHash: null,
  });

  useEffect(() => {
    if (!uid) {
      setState({ items: null, loading: false, updatedAt: null, inputsHash: null });
      return undefined;
    }
    setState((prev) => ({ ...prev, loading: true }));
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snap.data() as Record<string, unknown> | undefined;
        const raw = data?.workerDashboardActionItemsV1 as
          | WorkerDashboardActionItemsSnapshotV1
          | undefined;
        if (!raw || !Array.isArray(raw.items)) {
          setState({ items: null, loading: false, updatedAt: null, inputsHash: null });
          return;
        }
        const updatedAt =
          raw.updatedAt && typeof (raw.updatedAt as { toDate?: () => Date }).toDate === 'function'
            ? (raw.updatedAt as { toDate: () => Date }).toDate()
            : null;
        setState({
          items: raw.items,
          loading: false,
          updatedAt,
          inputsHash: typeof raw.inputsHash === 'string' ? raw.inputsHash : null,
        });
      },
      (err) => {
        console.warn('[WorkerDashboardActionItemsV1] snapshot listen failed', err);
        setState({ items: null, loading: false, updatedAt: null, inputsHash: null });
      },
    );
    return () => unsub();
  }, [uid]);

  return state;
}

// ---------------------------------------------------------------------------
// Personalization adapter — applies SMS snooze + 3-cap.
//
// Server emits the FULL contract list (sorted by priorityScore desc). The
// client filters `sms_opt_in` when its local snooze is active, then slices
// to the home cap.
// ---------------------------------------------------------------------------

export function applyClientOnlyWorkerDashboardActionItemPersonalization(
  rawItems: WorkerDashboardActionItemV1[],
  options: {
    uid: string;
    nowMs?: number;
    /**
     * Override the cap for "View all" surfaces. Default is the home cap (3).
     * Pass `Infinity` to render the full list.
     */
    cap?: number;
  },
): WorkerDashboardActionItemV1[] {
  const { uid, nowMs = Date.now(), cap = WORKER_DASHBOARD_ACTION_ITEMS_HOME_CAP } = options;
  const filtered = rawItems.filter((item) => {
    if (item.id !== 'sms_opt_in') return true;
    return !isSmsSnoozeActive(uid, nowMs);
  });
  return Number.isFinite(cap) ? filtered.slice(0, cap) : filtered;
}

function isSmsSnoozeActive(uid: string, nowMs: number): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(`${SMS_SNOOZE_KEY_PREFIX}${uid}`);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > nowMs;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Legacy-shape converter — bridges V1 snapshot items to the
// `WorkerDashboardActionItems` UI component which still expects the legacy
// `sortOrder` field. We keep the converter on the web side so the contract
// type stays clean and the legacy shape can be deleted alongside the legacy
// builder once both clients are on V2.
// ---------------------------------------------------------------------------

export function workerDashboardActionItemV1ToLegacy(
  item: WorkerDashboardActionItemV1,
): WorkerDashboardActionItem {
  return {
    id: item.id as WorkerDashboardActionId,
    category: item.category,
    titleKey: item.titleKey,
    descriptionKey: item.descriptionKey,
    // Higher score → smaller "sortOrder" so legacy components that still
    // sort by sortOrder ascending render the same order. The dashboard
    // component doesn't actually re-sort (it trusts caller order), so this
    // is mostly defensive.
    sortOrder: 1000 - item.priorityScore,
    primaryLabelKey: item.primaryLabelKey,
    primaryKind: item.primaryKind,
    href: item.href,
    secondaryLabelKey: item.secondaryLabelKey,
    secondaryKind: item.secondaryKind,
    sourceReason: item.sourceReason,
    qaEvaluatedFields: item.qaEvaluatedFields,
  };
}

export function workerDashboardActionItemsV1ToLegacy(
  items: WorkerDashboardActionItemV1[],
): WorkerDashboardActionItem[] {
  return items.map(workerDashboardActionItemV1ToLegacy);
}
