import type { CertificationCatalogManifestV1 } from './certificationCatalogManifest';
import { normalizeCertificationNameForLookup } from './normalizeCertificationNameForLookup';
import { warnCertifications } from './certificationsLogging';

export type CatalogResolveIndex = {
  /** Primary map: normalized lookup key → catalogEntryId */
  byLookupKey: ReadonlyMap<string, string>;
};

/**
 * Build lookup indexes once per manifest. Throws if duplicate `catalogEntryId` in entries.
 * If two different `catalogEntryId`s compete for the same lookup key: throw in development/test, warn in production.
 */
export function buildCatalogResolveIndex(
  manifest: CertificationCatalogManifestV1,
): CatalogResolveIndex {
  const seenEntryIds = new Set<string>();
  const byLookupKey = new Map<string, string>();

  for (const e of manifest.entries) {
    if (seenEntryIds.has(e.catalogEntryId)) {
      throw new Error(
        `[certifications] Duplicate catalogEntryId in manifest: "${e.catalogEntryId}"`,
      );
    }
    seenEntryIds.add(e.catalogEntryId);

    const keys = new Set<string>();
    keys.add(e.lookupKey);
    keys.add(normalizeCertificationNameForLookup(e.displayName));
    for (const a of e.aliases) {
      keys.add(normalizeCertificationNameForLookup(a));
    }

    for (const k of keys) {
      if (!k) continue;
      const existing = byLookupKey.get(k);
      if (existing !== undefined && existing !== e.catalogEntryId) {
        const detail = `Lookup key "${k}" maps to both "${existing}" and "${e.catalogEntryId}".`;
        if (process.env.NODE_ENV !== 'production') {
          throw new Error(`[certifications] ${detail}`);
        }
        warnCertifications('duplicate_detected', { detail });
        continue;
      }
      byLookupKey.set(k, e.catalogEntryId);
    }
  }

  return { byLookupKey };
}

/**
 * Resolve after legacy row strings are normalized (spec §5.4 order).
 * Returns `catalogEntryId` or null when unmapped — never fuzzy-guess.
 */
export function resolveCatalogEntryId(
  normalizedLookupKey: string,
  index: CatalogResolveIndex,
): string | null {
  if (!normalizedLookupKey) return null;
  return index.byLookupKey.get(normalizedLookupKey) ?? null;
}
