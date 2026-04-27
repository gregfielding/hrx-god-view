import type {
  CatalogManifestEntryV1,
  CertificationCatalogManifestV1,
} from '../../shared/certifications/certificationCatalogManifest';

/**
 * Single lookup for catalog row by id — avoids ad hoc `.entries.find` at call sites (Phase 1B+).
 */
export function getCatalogEntryById(
  manifest: CertificationCatalogManifestV1,
  catalogEntryId: string,
): CatalogManifestEntryV1 | null {
  const found = manifest.entries.find((e) => e.catalogEntryId === catalogEntryId);
  return found ?? null;
}
