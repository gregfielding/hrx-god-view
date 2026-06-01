/**
 * IndexedDB-backed cache for the tenant worker directory.
 *
 * Stale-while-revalidate semantics:
 *   - `getCached(tenantId)` returns the last persisted snapshot synchronously
 *     (well, via a Promise that resolves from IndexedDB — usually <10 ms).
 *   - The caller is expected to render that immediately AND kick a fresh
 *     `callListTenantWorkerDirectory` in the background. When the fresh
 *     payload arrives, the caller writes it back via `setCached` and
 *     updates UI state.
 *
 * Why IndexedDB and not localStorage:
 *   - C1's tenant directory is ~1 MB and growing. localStorage caps at
 *     ~5 MB per origin total across all keys; IndexedDB is effectively
 *     unbounded (subject to user-agent quota).
 *   - IndexedDB writes are async + non-blocking; localStorage writes
 *     serialize off the main thread on every set.
 *
 * Schema versioning: the `DB_VERSION` constant bumps when the stored
 * payload shape changes (e.g., we add a new field workers need). The
 * `onupgradeneeded` handler drops the old store rather than migrating —
 * the cache is fully recoverable from the callable so a wipe is cheap.
 */

import type { TenantWorkerDirectoryEntry } from '../services/listTenantWorkerDirectoryCallable';

const DB_NAME = 'hrx_directory';
const DB_VERSION = 1;
const STORE_NAME = 'tenant_workers';

export interface CachedDirectory {
  tenantId: string;
  workers: TenantWorkerDirectoryEntry[];
  /** ISO 8601 — server-reported fetch time, used by the UI to render a
   *  "Last updated" hint if desired. */
  fetchedAt: string;
  /** Local Date.now() at write time — used for optional TTL gates. */
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Schema bumps wipe and recreate; the directory is server-backed
      // so there's no data to migrate.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'tenantId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
  return dbPromise;
}

export async function getCachedDirectory(
  tenantId: string,
): Promise<CachedDirectory | null> {
  try {
    const db = await openDb();
    return await new Promise<CachedDirectory | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(tenantId);
      req.onsuccess = () => resolve((req.result as CachedDirectory | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
  } catch (e) {
    // Private browsing mode or full quota → fail soft, force a server
    // fetch. The hook handles the null return gracefully.
    console.warn('[tenantWorkerDirectoryCache] read failed', e);
    return null;
  }
}

export async function setCachedDirectory(
  tenantId: string,
  payload: { workers: TenantWorkerDirectoryEntry[]; fetchedAt: string },
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: CachedDirectory = {
        tenantId,
        workers: payload.workers,
        fetchedAt: payload.fetchedAt,
        cachedAt: Date.now(),
      };
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
    });
  } catch (e) {
    // Cache write failures are non-fatal — the caller still has the
    // workers array in memory for the current session.
    console.warn('[tenantWorkerDirectoryCache] write failed', e);
  }
}

/** Wipe a tenant's cache. Useful when we know a write just happened and
 *  want the next mount to skip the stale read. Not wired into any
 *  write paths today (we accept staleness per the product decision),
 *  but exported for future "force refresh after Create-on-Behalf" use. */
export async function clearCachedDirectory(tenantId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(tenantId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
    });
  } catch (e) {
    console.warn('[tenantWorkerDirectoryCache] clear failed', e);
  }
}
