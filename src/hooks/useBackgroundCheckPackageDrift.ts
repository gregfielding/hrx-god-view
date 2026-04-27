/**
 * **R.11** — Tenant-wide hook for the screening-package drift banner.
 *
 * Owns a single Firestore query against `backgroundChecks` filtered by
 * `tenantId` and `hasPendingPackageDrift == true`. Composite index lives
 * at `(tenantId ASC, hasPendingPackageDrift ASC)` — see
 * `firestore.indexes.json`.
 *
 * Returns a small, focused contract for the matrix banner UI:
 *   - `count` — total in-flight drift cases (un-acknowledged) for the
 *     active tenant.
 *   - `cases` — the same docs, lightly normalized for the dialog list.
 *   - `loading`, `error`, `refresh` — standard data-hook surface.
 *
 * **Why a one-shot query (not a snapshot listener):**
 *
 *   - Drift banner is informational; near-real-time is not required.
 *   - A snapshot listener on a tenant-wide query would burn a connection
 *     per matrix mount even when there's no drift.
 *   - The R.11.1 acknowledge callable triggers a refresh via the drawer's
 *     `onActionApplied` chain, so the count converges to reality on the
 *     CSA action that matters.
 *
 * @see docs/READINESS_R11_HANDOFF.md L1.R11
 * @see functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';

import { db } from '../firebase';

/** Hard cap on the per-fetch result set so a runaway tenant doesn't pull thousands of docs into memory. */
const DRIFT_CASE_FETCH_LIMIT = 500;

export interface PackageDriftCaseSummary {
  /** `backgroundChecks/{id}` doc id — pass to BackgroundCheckCaseDrawer. */
  checkId: string;
  /** Tenant the check belongs to. */
  tenantId: string;
  /** Worker uid the check is tied to. */
  candidateId: string | null;
  /** Worker display name from the BG check doc, when stamped. */
  candidateName: string | null;
  /** JO id the check is tied to (and that triggered the drift). */
  jobOrderId: string | null;
  /** Old package the check was ordered with. */
  requestedPackageName: string | null;
  /** New package the JO has now (drift target). */
  expectedPackageName: string | null;
  /** Drift classification — `'more_strict'` or `'incomparable'`. */
  driftKind: 'more_strict' | 'incomparable' | 'unknown';
  /** When the trigger first stamped this drift. Null if Firestore hasn't materialized the timestamp yet. */
  detectedAt: Date | null;
}

export interface UseBackgroundCheckPackageDriftResult {
  count: number;
  cases: ReadonlyArray<PackageDriftCaseSummary>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface UseBackgroundCheckPackageDriftArgs {
  /** Active tenant id. When null, the hook is inert (no query, count=0). */
  tenantId: string | null;
}

export default function useBackgroundCheckPackageDrift(
  args: UseBackgroundCheckPackageDriftArgs,
): UseBackgroundCheckPackageDriftResult {
  const { tenantId } = args;

  const [cases, setCases] = useState<ReadonlyArray<PackageDriftCaseSummary>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  /** Race guard: ignore stale fetches when tenant or refresh tick advances mid-flight. */
  const requestSeqRef = useRef(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setCases([]);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Composite index: (tenantId ASC, hasPendingPackageDrift ASC).
        // Order by detectedAt is best-effort — Firestore doesn't allow
        // mixing equality-on-boolean with orderBy on another field
        // without a composite that matches; if it errors we fall back to
        // an unordered query and sort client-side.
        const baseQ = query(
          collection(db, 'backgroundChecks'),
          where('tenantId', '==', tenantId),
          where('hasPendingPackageDrift', '==', true),
          limit(DRIFT_CASE_FETCH_LIMIT),
        );

        let snap;
        try {
          snap = await getDocs(
            query(
              collection(db, 'backgroundChecks'),
              where('tenantId', '==', tenantId),
              where('hasPendingPackageDrift', '==', true),
              orderBy('packageDrift.detectedAt', 'desc'),
              limit(DRIFT_CASE_FETCH_LIMIT),
            ),
          );
        } catch {
          // Falls back if the orderBy variant lacks a matching index —
          // V1 can ship without that variant; we sort client-side below.
          snap = await getDocs(baseQ);
        }

        if (requestSeqRef.current !== seq) return;

        const next: PackageDriftCaseSummary[] = snap.docs.map((d) =>
          summarizeDriftCase(d.id, d.data() as Record<string, unknown>),
        );

        // Newest first regardless of which path we took.
        next.sort((a, b) => {
          const ams = a.detectedAt?.getTime() ?? 0;
          const bms = b.detectedAt?.getTime() ?? 0;
          return bms - ams;
        });

        setCases(next);
        setLoading(false);
      } catch (err) {
        if (requestSeqRef.current !== seq) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to load background check package drift cases.';
        setError(msg);
        setLoading(false);
      }
    })();
  }, [tenantId, refreshTick]);

  return useMemo(
    () => ({
      count: cases.length,
      cases,
      loading,
      error,
      refresh,
    }),
    [cases, loading, error, refresh],
  );
}

function summarizeDriftCase(
  id: string,
  data: Record<string, unknown>,
): PackageDriftCaseSummary {
  const drift = (data.packageDrift ?? null) as Record<string, unknown> | null;
  const detectedAtRaw = drift?.detectedAt;
  let detectedAt: Date | null = null;
  if (detectedAtRaw instanceof Timestamp) {
    detectedAt = detectedAtRaw.toDate();
  } else if (typeof detectedAtRaw === 'object' && detectedAtRaw !== null) {
    const t = detectedAtRaw as { toDate?: () => Date };
    if (typeof t.toDate === 'function') {
      try {
        detectedAt = t.toDate();
      } catch {
        detectedAt = null;
      }
    }
  }

  const driftKindRaw = drift?.driftKind;
  const driftKind: PackageDriftCaseSummary['driftKind'] =
    driftKindRaw === 'more_strict' || driftKindRaw === 'incomparable'
      ? driftKindRaw
      : 'unknown';

  return {
    checkId: id,
    tenantId: typeof data.tenantId === 'string' ? data.tenantId : '',
    candidateId: typeof data.candidateId === 'string' ? data.candidateId : null,
    candidateName: typeof data.candidateName === 'string' ? data.candidateName : null,
    jobOrderId:
      typeof drift?.jobOrderId === 'string'
        ? drift.jobOrderId
        : typeof data.jobOrderId === 'string'
          ? data.jobOrderId
          : null,
    requestedPackageName:
      typeof data.requestedPackageName === 'string' ? data.requestedPackageName : null,
    expectedPackageName:
      typeof drift?.expectedPackageName === 'string' ? drift.expectedPackageName : null,
    driftKind,
    detectedAt,
  };
}
