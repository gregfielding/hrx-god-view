/**
 * Tenant-aware job title options.
 *
 * The bundled `src/data/onetJobTitles.json` (~889 standardized O*NET titles)
 * is no longer the source of truth — it's the seed list. Live data lives at
 * `tenants/{tid}/modules/hrx-flex/jobTitles` (one doc per title, with
 * optional `description` and `uniform`). Tenants edit this list at
 * `/settings?tab=job-titles`.
 *
 * This hook returns the titles for the active tenant (or one passed in
 * explicitly), with the JSON as a fallback for un-seeded tenants and
 * during the very first render before the snapshot arrives. A module-level
 * cache plus a single `onSnapshot` per tenant keep render churn low even
 * when many components on a page each call the hook.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { useAuth } from '../contexts/AuthContext';
import bundledOnetJobTitles from '../data/onetJobTitles.json';

const JSON_FALLBACK: string[] = Array.isArray(bundledOnetJobTitles)
  ? (bundledOnetJobTitles as unknown as string[]).filter((t) => typeof t === 'string')
  : [];

export type JobTitleRow = {
  id: string;
  title: string;
  description?: string;
  uniform?: string;
};

type CacheEntry = {
  rows: JobTitleRow[];
  /** Sorted unique titles, populated from rows; falls back to JSON when rows is empty. */
  titles: string[];
  loading: boolean;
  error: string | null;
  unsubscribe: () => void;
  subscribers: Set<() => void>;
};

const cache = new Map<string, CacheEntry>();

function ensureEntry(tenantId: string): CacheEntry {
  const existing = cache.get(tenantId);
  if (existing) return existing;

  const entry: CacheEntry = {
    rows: [],
    titles: JSON_FALLBACK,
    loading: true,
    error: null,
    unsubscribe: () => {},
    subscribers: new Set(),
  };
  cache.set(tenantId, entry);

  try {
    entry.unsubscribe = onSnapshot(
      collection(db, p.flexJobTitles(tenantId)),
      (snap) => {
        const rows: JobTitleRow[] = [];
        snap.forEach((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const title = typeof data.title === 'string' ? data.title.trim() : '';
          if (!title) return;
          rows.push({
            id: doc.id,
            title,
            description:
              typeof data.description === 'string' && data.description.trim()
                ? data.description.trim()
                : undefined,
            uniform:
              typeof data.uniform === 'string' && data.uniform.trim()
                ? data.uniform.trim()
                : undefined,
          });
        });
        entry.rows = rows;
        entry.titles =
          rows.length > 0
            ? Array.from(new Set(rows.map((r) => r.title))).sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: 'base' }),
              )
            : JSON_FALLBACK;
        entry.loading = false;
        entry.error = null;
        entry.subscribers.forEach((cb) => cb());
      },
      (err) => {
        // Permission denied / network error — keep showing the bundled
        // JSON fallback so the form is still usable.
        entry.loading = false;
        entry.error = err instanceof Error ? err.message : String(err);
        entry.subscribers.forEach((cb) => cb());
      },
    );
  } catch (err) {
    entry.loading = false;
    entry.error = err instanceof Error ? err.message : String(err);
  }

  return entry;
}

function useEntry(tenantId: string | undefined | null): CacheEntry | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    const entry = ensureEntry(tenantId);
    const handler = () => force((n) => n + 1);
    entry.subscribers.add(handler);
    // Trigger initial render with whatever's currently cached.
    handler();
    return () => {
      entry.subscribers.delete(handler);
      // We deliberately do NOT tear down `entry.unsubscribe` when the last
      // subscriber leaves — keeps the cached snapshot warm for re-mounts
      // (cheap; one open listener per tenant). Page navigation is the
      // common case here.
    };
  }, [tenantId]);

  if (!tenantId) return null;
  return cache.get(tenantId) ?? null;
}

/**
 * Returns the tenant's editable job title list as a string[] suitable for
 * `<Autocomplete options={…}>`. Falls back to the bundled O*NET JSON when
 * the tenant hasn't seeded yet (or while the first snapshot is in flight).
 */
export function useTenantJobTitleOptions(tenantIdOverride?: string | null): string[] {
  const { activeTenant, tenantId: authTenantId } = useAuth();
  const resolvedTenantId =
    (typeof tenantIdOverride === 'string' && tenantIdOverride) || activeTenant?.id || authTenantId || null;
  const entry = useEntry(resolvedTenantId);
  return entry?.titles ?? JSON_FALLBACK;
}

/**
 * Same source as `useTenantJobTitleOptions` but exposes the full row
 * (description + uniform). Use this when you want to prefill a job order /
 * shift with the tenant's stored defaults for the chosen title.
 */
export function useTenantJobTitleRows(tenantIdOverride?: string | null): {
  rows: JobTitleRow[];
  titles: string[];
  loading: boolean;
  error: string | null;
} {
  const { activeTenant, tenantId: authTenantId } = useAuth();
  const resolvedTenantId =
    (typeof tenantIdOverride === 'string' && tenantIdOverride) || activeTenant?.id || authTenantId || null;
  const entry = useEntry(resolvedTenantId);
  return {
    rows: entry?.rows ?? [],
    titles: entry?.titles ?? JSON_FALLBACK,
    loading: entry?.loading ?? Boolean(resolvedTenantId),
    error: entry?.error ?? null,
  };
}
