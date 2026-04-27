/**
 * Legacy `users.certifications[]` row normalization (spec §5.4).
 * Order: strings → dates → catalog resolution (caller passes `catalogEntryId` from resolve after step 1–2).
 *
 * Unified adapter principle (discipline §8): this helper does not mutate Firestore; canonical wins later at read time.
 */
import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import {
  buildCatalogResolveIndex,
  resolveCatalogEntryId,
  type CatalogResolveIndex,
} from '../../shared/certifications/resolveCatalogEntry';
import { normalizeCertificationNameForLookup } from '../../shared/certifications/normalizeCertificationNameForLookup';
import { normalizeDateToISODateString } from '../../shared/certifications/normalizeDateToISODateString';

export type LegacyCertificationRowInput = {
  name?: unknown;
  issuer?: unknown;
  expirationDate?: unknown;
};

export type NormalizedLegacyCertificationRow = {
  name: string;
  issuer: string | null;
  expirationDate: string | null;
  catalogEntryId: string | null;
  /** True when `catalogEntryId` could not be mapped — explicit for adapters; do not infer from null alone. */
  isUnmapped: boolean;
};

function normalizeOptionalString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Full pipeline: normalize fields, then resolve catalog id against manifest (no raw resolution).
 * Pass `resolveIndex` when normalizing many rows to avoid rebuilding indexes.
 */
export function normalizeLegacyCertificationRow(
  raw: LegacyCertificationRowInput,
  manifest: CertificationCatalogManifestV1,
  resolveIndex?: CatalogResolveIndex,
): NormalizedLegacyCertificationRow {
  const nameRaw = normalizeOptionalString(raw.name) ?? '';
  const name = normalizeCertificationNameForLookup(nameRaw);

  const issuer = normalizeOptionalString(raw.issuer);
  const expirationDate = normalizeDateToISODateString(raw.expirationDate);

  const index = resolveIndex ?? buildCatalogResolveIndex(manifest);
  const catalogEntryId = name ? resolveCatalogEntryId(name, index) : null;
  const isUnmapped = catalogEntryId === null;

  return {
    name,
    issuer,
    expirationDate,
    catalogEntryId,
    isUnmapped,
  };
}
