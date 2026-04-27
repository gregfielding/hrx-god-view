export type CallableKey = string;

interface CacheEntry<T> {
  value: T;
  at: number;
}

/**
 * Tiny client-side cache/deduper for Firebase httpsCallable requests.
 * - Caches by key for ttlMs
 * - Coalesces concurrent requests for the same key (inFlight map)
 */
export class CallableCache {
  private cache = new Map<CallableKey, CacheEntry<any>>();
  private inFlight = new Map<CallableKey, Promise<any>>();

  constructor(private ttlMs: number = 30 * 60 * 1000) {}

  async getOrFetch<T>(key: CallableKey, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Serve fresh cache
    const entry = this.cache.get(key);
    if (entry && now - entry.at < this.ttlMs) {
      return entry.value as T;
    }

    // Coalesce in-flight
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const p = (async () => {
      try {
        const value = await fetcher();
        this.cache.set(key, { value, at: Date.now() });
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
    return p as Promise<T>;
  }

  invalidate(key: CallableKey) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }
}
