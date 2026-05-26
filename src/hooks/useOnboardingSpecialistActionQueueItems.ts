/**
 * **E.7** — `useOnboardingSpecialistActionQueueItems` — live data hook
 * for the unified /staff-onboarding "To-Do" tab.
 *
 * Subscribes to `tenants/{tid}/entity_employments` (the source of truth
 * for action signals: workerType, i9Section2CompletedAt, everifyStatus,
 * everifyRequired) and joins in three caches:
 *
 *   - `everee_workers/{entityId}__{userId}.readinessMirror.i9SignedAt`
 *     — answers "did the worker sign Section 1 via Everee?"
 *   - `entities` — display name + tenant-level `everifyRequired`
 *   - `users` — display name / email / phone / avatar
 *
 * The pure aggregation / decision logic lives in
 * `src/utils/onboardingSpecialistActionQueue/buildOnboardingSpecialistActionItems.ts`
 * so it stays unit-testable without Firestore mocking. This hook is a
 * thin live wrapper.
 *
 * **Live aspect.** Only the `entity_employments` query subscribes via
 * `onSnapshot` — that's where the action-state mutations land (Section
 * 2 stamp, E-Verify status change, TNC flip). The other three caches
 * are fetched reactively when the snapshot delta requires new lookups,
 * not subscribed. This keeps the listener cost bounded to one query
 * per tenant view.
 *
 * **Scope.** `'mine'` filters via `users.primaryRecruiterId === currentUid`
 * (RD.1's pattern via `useMyWorkerUids`). `'all'` skips the filter.
 *
 * **Limit.** Caps the entity_employments subscription at 2000 rows
 * sorted by `updatedAt desc`. Tenants under 2k active workers see every
 * actionable row; larger tenants effectively scope to recently-updated
 * rows (which is also where the actionable items naturally cluster).
 *
 * **Out of scope here:** search filtering (caller renders search) and
 * pagination (caller wraps StandardTablePagination around the returned
 * item list).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import {
  buildOnboardingSpecialistActionItems,
  type OnboardingSpecialistQueueEntityEmploymentLite,
  type OnboardingSpecialistQueueEntityLite,
  type OnboardingSpecialistQueueEvereeMirrorLite,
  type OnboardingSpecialistQueueUserLite,
} from '../utils/onboardingSpecialistActionQueue/buildOnboardingSpecialistActionItems';
import {
  compareOnboardingSpecialistActionItems,
  type OnboardingSpecialistActionItem,
} from '../types/onboardingSpecialistActionQueue';
import useMyWorkerUids from './useMyWorkerUids';

const ENTITY_EMPLOYMENT_QUERY_LIMIT = 2000;

export interface UseOnboardingSpecialistActionQueueItemsParams {
  tenantId: string | undefined;
  currentUserUid: string | null;
  scope: 'mine' | 'all';
}

export interface UseOnboardingSpecialistActionQueueItemsResult {
  items: OnboardingSpecialistActionItem[];
  loading: boolean;
  error: string | null;
}

function pickString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  return fallback;
}

function pickStringOrNull(value: unknown): string | null {
  const s = pickString(value);
  return s.length === 0 ? null : s;
}

function entityEmploymentLiteFromDoc(
  id: string,
  data: Record<string, unknown>,
): OnboardingSpecialistQueueEntityEmploymentLite {
  return {
    id,
    userId: pickString(data.userId),
    entityId: pickStringOrNull(data.entityId),
    entityKey: data.entityKey,
    workerType: data.workerType,
    active: data.active,
    hiredAt: data.hiredAt ?? null,
    i9Section2CompletedAt: data.i9Section2CompletedAt ?? null,
    everifyRequired: data.everifyRequired,
    everifyStatus: data.everifyStatus,
    everifyTncReceivedAt: data.everifyTncReceivedAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

function userLiteFromDoc(
  uid: string,
  data: Record<string, unknown>,
): OnboardingSpecialistQueueUserLite {
  const first = pickString(data.firstName);
  const last = pickString(data.lastName);
  const fallbackName = pickString(data.displayName) || pickString(data.fullName) || uid;
  const composedName = [first, last].filter(Boolean).join(' ').trim();
  return {
    uid,
    displayName: composedName.length > 0 ? composedName : fallbackName,
    email: pickStringOrNull(data.email),
    phone: pickStringOrNull(data.phone) ?? pickStringOrNull(data.phoneNumber),
    avatarUrl: pickStringOrNull(data.avatar) ?? pickStringOrNull(data.photoURL),
  };
}

function entityLiteFromDoc(
  id: string,
  data: Record<string, unknown>,
): OnboardingSpecialistQueueEntityLite {
  const everifyRequiredRaw = data.everifyRequired;
  return {
    id,
    name: pickString(data.name) || id,
    everifyRequired: typeof everifyRequiredRaw === 'boolean' ? everifyRequiredRaw : undefined,
  };
}

const useOnboardingSpecialistActionQueueItems = ({
  tenantId,
  currentUserUid,
  scope,
}: UseOnboardingSpecialistActionQueueItemsParams): UseOnboardingSpecialistActionQueueItemsResult => {
  const [employments, setEmployments] = useState<OnboardingSpecialistQueueEntityEmploymentLite[]>([]);
  const [employmentsLoaded, setEmploymentsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [evereeMirrorByKey, setEvereeMirrorByKey] = useState<
    Record<string, OnboardingSpecialistQueueEvereeMirrorLite | undefined>
  >({});
  const [userByUid, setUserByUid] = useState<
    Record<string, OnboardingSpecialistQueueUserLite | undefined>
  >({});
  const [entityById, setEntityById] = useState<
    Record<string, OnboardingSpecialistQueueEntityLite | undefined>
  >({});

  // Caches survive across snapshot ticks — refetching every entity / user
  // doc on every entity_employments delta would thrash the read budget.
  // The cache is keyed per-tenant (resets when tenantId changes).
  const userCacheRef = useRef<
    Record<string, OnboardingSpecialistQueueUserLite | undefined>
  >({});
  const entityCacheRef = useRef<
    Record<string, OnboardingSpecialistQueueEntityLite | undefined>
  >({});
  const mirrorCacheRef = useRef<
    Record<string, OnboardingSpecialistQueueEvereeMirrorLite | undefined>
  >({});
  const cacheTenantRef = useRef<string | undefined>(undefined);

  const { myWorkerUids } = useMyWorkerUids({ currentUserUid, scope });

  // Reset caches when tenantId changes — different tenants have
  // independent users / entities / mirror docs and we don't want stale
  // entries leaking across.
  useEffect(() => {
    if (cacheTenantRef.current !== tenantId) {
      userCacheRef.current = {};
      entityCacheRef.current = {};
      mirrorCacheRef.current = {};
      setUserByUid({});
      setEntityById({});
      setEvereeMirrorByKey({});
      cacheTenantRef.current = tenantId;
    }
  }, [tenantId]);

  // Live: subscribe to entity_employments. The subscription itself is
  // tenant-scoped (no per-uid scope filter — we filter the joined items
  // post-aggregation via `myWorkerUids`). Using a single tenant-wide
  // query keeps the index footprint minimal and lets us reuse the same
  // listener across My/All toggles without re-subscribing.
  useEffect(() => {
    if (!tenantId) {
      setEmployments([]);
      setEmploymentsLoaded(true);
      return undefined;
    }
    setEmploymentsLoaded(false);
    setError(null);
    const q = query(
      collection(db, p.entityEmployments(tenantId)),
      where('active', '==', true),
      orderBy('updatedAt', 'desc'),
      limit(ENTITY_EMPLOYMENT_QUERY_LIMIT),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) =>
          entityEmploymentLiteFromDoc(d.id, d.data() as Record<string, unknown>),
        );
        setEmployments(next);
        setEmploymentsLoaded(true);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error(
          '[useOnboardingSpecialistActionQueueItems] entity_employments listener failed',
          err,
        );
        setError(err.message || 'Failed to load action queue.');
        setEmployments([]);
        setEmploymentsLoaded(true);
      },
    );
    return unsub;
  }, [tenantId]);

  // Compute the keys we'd need for the caches. Memo'd so the lookup
  // effects below only re-run when the relevant slice changes.
  const lookupKeys = useMemo(() => {
    const userIds = new Set<string>();
    const entityIds = new Set<string>();
    const mirrorKeys = new Set<string>();
    for (const emp of employments) {
      if (!emp.userId || !emp.entityId) continue;
      if (emp.active === false) continue;
      userIds.add(emp.userId);
      entityIds.add(emp.entityId);
      // Mirror is only relevant for W-2 rows that aren't already past
      // both I-9 sections — but for cache simplicity, fetch for every
      // row. The miss case is cheap (single doc fetch) and the hit case
      // populates the cache for re-renders.
      mirrorKeys.add(`${emp.entityId}__${emp.userId}`);
    }
    return {
      userIds: Array.from(userIds).sort(),
      entityIds: Array.from(entityIds).sort(),
      mirrorKeys: Array.from(mirrorKeys).sort(),
    };
  }, [employments]);

  const userIdsKey = lookupKeys.userIds.join(',');
  const entityIdsKey = lookupKeys.entityIds.join(',');
  const mirrorKeysKey = lookupKeys.mirrorKeys.join(',');

  // Fetch missing user docs in parallel chunks. Caches what's already
  // loaded — only the diff fetches on subsequent ticks.
  useEffect(() => {
    if (!tenantId || lookupKeys.userIds.length === 0) return;
    const missing = lookupKeys.userIds.filter(
      (uid) => !Object.prototype.hasOwnProperty.call(userCacheRef.current, uid),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = { ...userCacheRef.current };
      await Promise.all(
        missing.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, 'users', uid));
            if (snap.exists()) {
              next[uid] = userLiteFromDoc(uid, snap.data() as Record<string, unknown>);
            } else {
              // Cache the miss to avoid retrying the same uid every render.
              next[uid] = undefined;
            }
          } catch {
            next[uid] = undefined;
          }
        }),
      );
      if (cancelled) return;
      userCacheRef.current = next;
      setUserByUid(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, userIdsKey, lookupKeys.userIds]);

  // Fetch missing entity docs (small set — cached aggressively).
  useEffect(() => {
    if (!tenantId || lookupKeys.entityIds.length === 0) return;
    const missing = lookupKeys.entityIds.filter(
      (eid) => !Object.prototype.hasOwnProperty.call(entityCacheRef.current, eid),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = { ...entityCacheRef.current };
      await Promise.all(
        missing.map(async (eid) => {
          try {
            const snap = await getDoc(doc(db, p.entity(tenantId, eid)));
            if (snap.exists()) {
              next[eid] = entityLiteFromDoc(eid, snap.data() as Record<string, unknown>);
            } else {
              next[eid] = undefined;
            }
          } catch {
            next[eid] = undefined;
          }
        }),
      );
      if (cancelled) return;
      entityCacheRef.current = next;
      setEntityById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, entityIdsKey, lookupKeys.entityIds]);

  // Fetch missing everee_workers mirrors (one doc per (entity × user)
  // pair). Doc ids are deterministic via `entityId__userId`.
  useEffect(() => {
    if (!tenantId || lookupKeys.mirrorKeys.length === 0) return;
    const missing = lookupKeys.mirrorKeys.filter(
      (k) => !Object.prototype.hasOwnProperty.call(mirrorCacheRef.current, k),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = { ...mirrorCacheRef.current };
      await Promise.all(
        missing.map(async (key) => {
          const [entityId, userId] = key.split('__', 2);
          if (!entityId || !userId) {
            next[key] = undefined;
            return;
          }
          try {
            const snap = await getDoc(doc(db, p.evereeWorker(tenantId, entityId, userId)));
            if (snap.exists()) {
              const data = snap.data() as
                | {
                    readinessMirror?: Record<string, unknown>;
                    evereeWorkerId?: unknown;
                    evereeTenantId?: unknown;
                  }
                | undefined;
              const mirror = data?.readinessMirror;
              // Always surface evereeWorkerId / evereeTenantId from the
              // linkage doc itself (sibling to readinessMirror) so row
              // actions can deep-link to Everee. Falls back to the legacy
              // top-level fields when the mirror is absent.
              const workerId =
                typeof data?.evereeWorkerId === 'string' ? data.evereeWorkerId : null;
              const tenantId2 =
                typeof data?.evereeTenantId === 'string' ? data.evereeTenantId : null;
              if (mirror) {
                next[key] = {
                  i9SignedAt: mirror.i9SignedAt ?? null,
                  w4SignedAt: mirror.w4SignedAt ?? null,
                  evereeWorkerId: workerId,
                  evereeTenantId: tenantId2,
                };
              } else if (workerId || tenantId2) {
                // No mirror yet but linkage exists — still surface ids so
                // the deep-link works even on freshly-provisioned workers.
                next[key] = {
                  i9SignedAt: null,
                  w4SignedAt: null,
                  evereeWorkerId: workerId,
                  evereeTenantId: tenantId2,
                };
              } else {
                next[key] = undefined;
              }
            } else {
              next[key] = undefined;
            }
          } catch {
            next[key] = undefined;
          }
        }),
      );
      if (cancelled) return;
      mirrorCacheRef.current = next;
      setEvereeMirrorByKey(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, mirrorKeysKey, lookupKeys.mirrorKeys]);

  // Final aggregation — pure, mostly cheap. Re-runs when any of the
  // four caches (or the My/All filter) changes.
  const items = useMemo(() => {
    if (!employmentsLoaded) return [];
    const built = buildOnboardingSpecialistActionItems({
      entityEmployments: employments,
      evereeMirrorByKey,
      entityById,
      userByUid,
      myWorkerUids,
    });
    built.sort(compareOnboardingSpecialistActionItems);
    return built;
  }, [
    employmentsLoaded,
    employments,
    evereeMirrorByKey,
    entityById,
    userByUid,
    myWorkerUids,
  ]);

  const loading = !tenantId ? false : !employmentsLoaded;

  return useMemo(
    () => ({ items, loading, error }),
    [items, loading, error],
  );
};

export default useOnboardingSpecialistActionQueueItems;

/** Re-exported for tests + consumers that need the action-item shape. */
export type { OnboardingSpecialistActionItem };
