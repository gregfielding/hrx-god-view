import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import { buildCatalogResolveIndex, resolveCatalogEntryId, type CatalogResolveIndex } from './resolveCatalogEntry';
import { normalizeCertificationNameForLookup } from './normalizeCertificationNameForLookup';
import { warnCertifications } from './certificationsLogging';

/**
 * Resolves `catalogEntryId` from a display name, or logs and returns null (caller skips canonical write).
 */
export function resolveCatalogEntryOrWarn(
  certificationDisplayName: string,
  manifest: CertificationCatalogManifestV1,
  uid: string,
  resolveIndex?: CatalogResolveIndex,
): string | null {
  const key = normalizeCertificationNameForLookup(certificationDisplayName);
  if (!key) {
    warnCertifications('unmapped_legacy_name', {
      userId: uid,
      detail: 'Empty certification name after normalization.',
    });
    return null;
  }
  const index = resolveIndex ?? buildCatalogResolveIndex(manifest);
  const id = resolveCatalogEntryId(key, index);
  if (id === null) {
    warnCertifications('unmapped_legacy_name', {
      userId: uid,
      detail: `No catalog entry for normalized name: "${key}".`,
    });
  }
  return id;
}
