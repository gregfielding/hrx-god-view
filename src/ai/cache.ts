import crypto from 'crypto';

export type CacheEntry<T = any> = { value: T; expiresAt: number };

export interface Cache {
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryCache implements Cache {
  private store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export function stableHash(input: any): string {
  try {
    const json = JSON.stringify(input, Object.keys(input).sort());
    return crypto.createHash('sha256').update(json).digest('hex');
  } catch {
    return crypto.createHash('sha256').update(String(input)).digest('hex');
  }
}

export function chooseTTL(temperature: number, allowCache = true): number {
  if (!allowCache) return 0;
  if (temperature <= 0.2) return 60 * 60 * 24; // 24h
  if (temperature <= 0.6) return 60 * 60; // 1h
  return 0;
}


