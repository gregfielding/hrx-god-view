/**
 * **useExternalShiftRequests** — live listener for the Indeed Flex
 * inbox feed shown on `/shifts/log`.
 *
 * Subscribes to `tenants/{tid}/external_shift_requests` ordered by
 * `createdAt desc`. New parsed events (Slice 2) and match results
 * (Slice 3) flow in real-time so the recruiter sees them within a
 * second of arrival.
 *
 * **Why a hook instead of fetch-on-mount.** The feed is the
 * recruiter's working surface — they leave it open while triaging.
 * `onSnapshot` keeps it current without manual refresh.
 *
 * **Permissions.** Firestore rules gate reads to tenant members
 * (Slice 4 rules — already covered by the existing rule block on
 * `tenants/{tid}/external_shift_requests` from Slice 2).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Query,
} from 'firebase/firestore';

import { db } from '../firebase';
import type { ExternalShiftRequest } from '../shared/indeedFlex/types';

interface Options {
  /** Cap the live listener. Default 200 — covers ~3-5 days of email
   *  ingest at typical volume. */
  pageSize?: number;
  /** Filter by status. Default 'all' shows everything; the page UI
   *  toggles between `needs_review` (default tab view) and `all`. */
  status?: ExternalShiftRequest['status'] | 'all';
}

interface State {
  rows: ExternalShiftRequest[];
  loading: boolean;
  error: Error | null;
}

const DEFAULT_PAGE_SIZE = 200;

export function useExternalShiftRequests(
  tenantId: string | null | undefined,
  options: Options = {},
): State {
  const { pageSize = DEFAULT_PAGE_SIZE, status = 'all' } = options;
  const [rows, setRows] = useState<ExternalShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Memoize the query so a re-render doesn't unsubscribe/resubscribe
  // unnecessarily. The dependency surface is just the inputs that
  // affect the query shape.
  const q = useMemo<Query | null>(() => {
    if (!tenantId) return null;
    const base = collection(db, 'tenants', tenantId, 'external_shift_requests');
    let assembled: Query = query(base, orderBy('createdAt', 'desc'), limit(pageSize));
    if (status !== 'all') {
      assembled = query(
        base,
        where('status', '==', status),
        orderBy('createdAt', 'desc'),
        limit(pageSize),
      );
    }
    return assembled;
  }, [tenantId, pageSize, status]);

  useEffect(() => {
    if (!q) {
      setRows([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: ExternalShiftRequest[] = [];
        snap.forEach((d) => {
          // Hydrate the doc into a typed row. Timestamps come back as
          // Firestore Timestamps but the type expects ISO strings —
          // coerce so the UI can format consistently.
          const data = d.data() as Record<string, unknown>;
          next.push({
            ...(data as unknown as ExternalShiftRequest),
            id: d.id,
            createdAt: coerceIso(data.createdAt),
            updatedAt: coerceIso(data.updatedAt),
          });
        });
        setRows(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        // Surface, don't throw. The page renders an inline error banner.
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [q]);

  return { rows, loading, error };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface TimestampLike {
  toDate(): Date;
}

function isTimestampLike(value: unknown): value is TimestampLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  );
}

function coerceIso(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (isTimestampLike(v)) return v.toDate().toISOString();
  return '';
}
