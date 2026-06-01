/**
 * useTenantWorkerDirectory — stale-while-revalidate hook for the tenant
 * worker directory.
 *
 * On mount:
 *   1. Read the last persisted snapshot from IndexedDB and expose it as
 *      `workers` so the UI renders immediately (even on cold reload).
 *   2. In parallel, call `listTenantWorkerDirectory` to refresh.
 *   3. When the fresh payload arrives, swap into state and persist back.
 *
 * Consumers that need instant local search (autocomplete, /users/all
 * text search) filter the returned `workers` array client-side. With a
 * ~1 MB directory and JS array.filter, that's sub-millisecond and
 * trivially debounce-free.
 */

import { useEffect, useState } from 'react';
import { functions } from '../firebase';
import {
  callListTenantWorkerDirectory,
  type TenantWorkerDirectoryEntry,
} from '../services/listTenantWorkerDirectoryCallable';
import {
  getCachedDirectory,
  setCachedDirectory,
} from '../utils/tenantWorkerDirectoryCache';

export interface UseTenantWorkerDirectoryResult {
  /** May be empty on first mount when cache is cold; refreshing flips true while the background fetch runs. */
  workers: TenantWorkerDirectoryEntry[];
  /** True when neither cache nor server has resolved yet. Use to gate UI states. */
  loading: boolean;
  /** True while the background revalidate is in flight. UI can render a subtle spinner. */
  refreshing: boolean;
  /** ISO 8601 fetchedAt from server — null until the first refresh completes. */
  fetchedAt: string | null;
  /** Last error if the refresh failed. The stale cache is still served. */
  error: string | null;
}

export function useTenantWorkerDirectory(
  tenantId: string | null | undefined,
): UseTenantWorkerDirectoryResult {
  const [workers, setWorkers] = useState<TenantWorkerDirectoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setWorkers([]);
      setLoading(false);
      setRefreshing(false);
      setFetchedAt(null);
      return;
    }
    let cancelled = false;

    // Reset loading=true on every tenantId activation. Without this, a
    // previous "closed dialog" pass would have left `loading` at false,
    // and the next open would show "No workers match" during the
    // 20-second cold-start fetch (the stale-while-revalidate window).
    setLoading(true);

    (async () => {
      // Stage 1 — synchronous (well, IndexedDB-async) read from cache.
      const cached = await getCachedDirectory(tenantId);
      if (cancelled) return;
      // Only treat as "loaded" when the cache has non-empty workers.
      // An empty cached array means a prior bad write or an interrupted
      // first fetch — keep loading=true until the server fills it in.
      if (cached && cached.workers.length > 0) {
        setWorkers(cached.workers);
        setFetchedAt(cached.fetchedAt);
        setLoading(false);
      }

      // Stage 2 — background revalidate. Fire even when cache hit; the
      // server may have newer data.
      setRefreshing(true);
      try {
        const { data } = await callListTenantWorkerDirectory(functions, { tenantId });
        if (cancelled) return;
        await setCachedDirectory(tenantId, {
          workers: data.workers,
          fetchedAt: data.fetchedAt,
        });
        if (cancelled) return;
        setWorkers(data.workers);
        setFetchedAt(data.fetchedAt);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.warn('[useTenantWorkerDirectory] refresh failed', e);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return { workers, loading, refreshing, fetchedAt, error };
}
