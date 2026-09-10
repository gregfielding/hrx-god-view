/**
 * Promise-style access to the tenant worker directory for search helpers that
 * aren't React components (mention search, recipient autocomplete).
 *
 * Shares the IndexedDB cache with `useTenantWorkerDirectory`, so a directory
 * loaded on /users/all or the timesheet dialog serves these searches with zero
 * Firestore reads. A cold or stale cache triggers ONE deduped
 * `listTenantWorkerDirectory` call (server-side, ~14k projected reads) rather
 * than a users-collection read per keystroke.
 */
import { functions } from '../firebase';
import {
  callListTenantWorkerDirectory,
  type TenantWorkerDirectoryEntry,
} from '../services/listTenantWorkerDirectoryCallable';
import { getCachedDirectory, setCachedDirectory } from './tenantWorkerDirectoryCache';

/** Background-refresh a cached directory older than this when searched. */
const SEARCH_MAX_AGE_MS = 60 * 60 * 1000;
/** Keep the parsed array in memory briefly so each keystroke skips the IndexedDB read. */
const MEMO_MS = 60 * 1000;

const memo = new Map<string, { at: number; workers: TenantWorkerDirectoryEntry[] }>();
const inflight = new Map<string, Promise<TenantWorkerDirectoryEntry[]>>();

function refreshDirectory(tenantId: string): Promise<TenantWorkerDirectoryEntry[]> {
  const existing = inflight.get(tenantId);
  if (existing) return existing;
  const promise = callListTenantWorkerDirectory(functions, { tenantId })
    .then(async ({ data }) => {
      await setCachedDirectory(tenantId, { workers: data.workers, fetchedAt: data.fetchedAt });
      memo.set(tenantId, { at: Date.now(), workers: data.workers });
      return data.workers;
    })
    .finally(() => {
      inflight.delete(tenantId);
    });
  inflight.set(tenantId, promise);
  return promise;
}

export async function getTenantWorkerDirectoryForSearch(
  tenantId: string,
): Promise<TenantWorkerDirectoryEntry[]> {
  if (!tenantId) return [];
  const hit = memo.get(tenantId);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.workers;

  const cached = await getCachedDirectory(tenantId);
  if (cached && cached.workers.length > 0) {
    memo.set(tenantId, { at: Date.now(), workers: cached.workers });
    if (Date.now() - cached.cachedAt > SEARCH_MAX_AGE_MS) {
      refreshDirectory(tenantId).catch((e) => {
        console.warn('[tenantWorkerDirectoryLoader] background refresh failed', e);
      });
    }
    return cached.workers;
  }
  return refreshDirectory(tenantId);
}
