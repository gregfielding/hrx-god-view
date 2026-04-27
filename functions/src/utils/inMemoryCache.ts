type CacheRecord = Record<string, any> & { updatedAt: InMemoryTimestamp };

const store = new Map<string, CacheRecord>();
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

class InMemoryTimestamp {
  private readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }

  toMillis(): number {
    return this.ms;
  }

  toDate(): Date {
    return new Date(this.ms);
  }

  valueOf(): number {
    return this.ms;
  }
}

function normalizeRecord(input: Record<string, any> | undefined): CacheRecord {
  const next: Record<string, any> = { ...(input || {}) };
  const now = Date.now();
  const updatedAt = next.updatedAt;
  if (updatedAt instanceof InMemoryTimestamp) {
    // already normalized
  } else if (updatedAt && typeof updatedAt.toMillis === 'function') {
    next.updatedAt = new InMemoryTimestamp(updatedAt.toMillis());
  } else if (typeof updatedAt === 'number') {
    next.updatedAt = new InMemoryTimestamp(updatedAt);
  } else {
    next.updatedAt = new InMemoryTimestamp(now);
  }
  return next as CacheRecord;
}

function isExpired(record: CacheRecord): boolean {
  return Date.now() - record.updatedAt.toMillis() > RETENTION_MS;
}

export function getAiCacheDoc(key: string) {
  return {
    async get(): Promise<{ exists: boolean; data: () => CacheRecord | undefined }> {
      const record = store.get(key);
      if (!record) {
        return { exists: false, data: () => undefined };
      }
      if (isExpired(record)) {
        store.delete(key);
        return { exists: false, data: () => undefined };
      }
      return {
        exists: true,
        data: () => ({ ...record }),
      };
    },
    async set(value: Record<string, any>, options?: { merge?: boolean }) {
      const existing = store.get(key);
      if (options?.merge && existing) {
        store.set(key, normalizeRecord({ ...existing, ...value }));
      } else {
        store.set(key, normalizeRecord(value));
      }
    },
    async delete() {
      store.delete(key);
    },
  };
}

export function clearAiCacheKey(key: string): void {
  store.delete(key);
}


