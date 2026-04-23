/**
 * Header-level aggregate of AccuSource service-line verdicts for a single worker.
 *
 * Returns a comma-separated summary (e.g. "Social Security Locator: Passed, CrimNet: Passed,
 * 4-Panel Urine: Waiting") plus an overall verdict so the UserProfileHeader can render the
 * right pill and copy Greg's desired format.
 *
 *   - `overallVerdict`: PASSED when every line is PASSED (unblocks per-job screening gate),
 *     FAILED when any line is FAILED, NEEDS_REVIEW when any line needs recruiter review,
 *     PENDING otherwise (including the no-records case).
 *   - `lines`: flattened per-service items across all active `backgroundChecks` rows for the user.
 *
 * Intentionally lightweight — one query per {tenantId, userId} pair, cached by the caller.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AccusourceLineVerdict,
  BackgroundCheckRecord,
} from '../types/backgroundCheck';
import {
  accusourceScreeningLineItems,
  type AccusourceScreeningLineItem,
} from '../utils/accusourceScreeningLineItems';

const PAGE_LIMIT = 50;

export interface AccusourceScreeningVerdictSummary {
  loading: boolean;
  /** Comma-separated "<service>: <verdict>" list, or '' when no lines known. */
  summaryText: string;
  /** Aggregate across all lines (see rules above). */
  overallVerdict: AccusourceLineVerdict | 'NONE';
  /** True when every line is PASSED — used to release the per-user screening blocker. */
  allPassed: boolean;
  /** True when any line is FAILED — recruiter must adjudicate for the per-job blocker. */
  anyFailed: boolean;
  /** True when any line needs recruiter review. */
  anyNeedsReview: boolean;
  /** Per-service items (one row per ordered screen across all active records). */
  lines: AccusourceScreeningLineItem[];
}

function verdictLabel(v: AccusourceLineVerdict): string {
  if (v === 'PASSED') return 'Passed';
  if (v === 'FAILED') return 'Failed';
  if (v === 'NEEDS_REVIEW') return 'Needs review';
  return 'Waiting';
}

function aggregate(lines: AccusourceScreeningLineItem[]): {
  overallVerdict: AccusourceLineVerdict | 'NONE';
  allPassed: boolean;
  anyFailed: boolean;
  anyNeedsReview: boolean;
} {
  if (lines.length === 0) {
    return { overallVerdict: 'NONE', allPassed: false, anyFailed: false, anyNeedsReview: false };
  }
  const anyFailed = lines.some((l) => l.verdict === 'FAILED');
  const anyNeedsReview = lines.some((l) => l.verdict === 'NEEDS_REVIEW');
  const allPassed = lines.every((l) => l.verdict === 'PASSED');
  let overallVerdict: AccusourceLineVerdict;
  if (anyFailed) overallVerdict = 'FAILED';
  else if (anyNeedsReview) overallVerdict = 'NEEDS_REVIEW';
  else if (allPassed) overallVerdict = 'PASSED';
  else overallVerdict = 'PENDING';
  return { overallVerdict, allPassed, anyFailed, anyNeedsReview };
}

export function useAccusourceScreeningVerdictSummary(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
): AccusourceScreeningVerdictSummary {
  const [records, setRecords] = useState<BackgroundCheckRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(tenantId && userId));

  useEffect(() => {
    if (!tenantId || !userId) {
      setRecords([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const q = query(
      collection(db, 'backgroundChecks'),
      where('candidateId', '==', userId),
      where('tenantId', '==', tenantId),
      limit(PAGE_LIMIT),
    );
    const unsub: Unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as BackgroundCheckRecord,
        );
        // Exclude canceled / error-only records — they shouldn't influence the header.
        const filtered = rows.filter((r) => {
          const s = String(r.hrxStatus || '').toLowerCase();
          return s !== 'canceled' && s !== 'cancelled';
        });
        setRecords(filtered);
        setLoading(false);
      },
      () => {
        // Never throw into the header — treat permission / index errors as "no data".
        setRecords([]);
        setLoading(false);
      },
    );
    return unsub;
  }, [tenantId, userId]);

  return useMemo(() => {
    const lines = records.flatMap((r) => accusourceScreeningLineItems(r));
    const agg = aggregate(lines);
    const summaryText = lines
      .map((l) => `${l.name}: ${verdictLabel(l.verdict)}`)
      .join(', ');
    return {
      loading,
      summaryText,
      overallVerdict: agg.overallVerdict,
      allPassed: agg.allPassed,
      anyFailed: agg.anyFailed,
      anyNeedsReview: agg.anyNeedsReview,
      lines,
    };
  }, [records, loading]);
}
