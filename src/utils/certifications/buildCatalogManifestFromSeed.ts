import type {
  CatalogManifestEntryV1,
  CertificationCatalogManifestV1,
} from '../../types/certifications/certificationCatalogManifest';
import { CERTIFICATION_CATALOG_SCHEMA_VERSION } from '../../types/certifications/certificationCatalogManifest';
import { normalizeCertificationNameForLookup } from './normalizeCertificationNameForLookup';
import { stableJsonStringify } from './stableJsonStringify';

/** Raw seed row from `credentialsSeed.json` — only fields we read. */
export type CredentialsSeedRow = {
  id: string;
  name: string;
  type: string;
  category: string;
  issuer?: string;
  validity_period_years?: number | null;
  verification_method?: string;
  is_active?: boolean;
};

function deriveUploadFlags(verificationMethod: string | undefined): {
  requiresDocumentUpload: boolean;
  allowsSelfAttestation: boolean;
} {
  const m = (verificationMethod ?? '').toLowerCase().trim();
  if (m.includes('attest') && !m.includes('upload')) {
    return { requiresDocumentUpload: false, allowsSelfAttestation: true };
  }
  if (m.includes('either') || m.includes('upload or attest')) {
    return { requiresDocumentUpload: true, allowsSelfAttestation: true };
  }
  // Default seed today: "Upload proof"
  return { requiresDocumentUpload: true, allowsSelfAttestation: false };
}

/**
 * Pure: same seed input → same manifest + same JSON string (deterministic).
 */
export function buildCatalogManifestFromSeed(
  seedRows: readonly CredentialsSeedRow[],
): { manifest: CertificationCatalogManifestV1; jsonText: string } {
  const seenIds = new Set<string>();
  const entries: CatalogManifestEntryV1[] = [];

  for (const row of seedRows) {
    if (!row.id || !row.name) {
      throw new Error(`[certifications] Seed row missing id or name: ${JSON.stringify(row)}`);
    }
    if (seenIds.has(row.id)) {
      throw new Error(
        `[certifications] Duplicate catalogEntryId (seed id) "${row.id}" — manifest is invalid.`,
      );
    }
    seenIds.add(row.id);

    const lookupKey = normalizeCertificationNameForLookup(row.name);
    const { requiresDocumentUpload, allowsSelfAttestation } = deriveUploadFlags(row.verification_method);
    const validityYears = row.validity_period_years;
    const hasExpiration = typeof validityYears === 'number' && Number.isFinite(validityYears);

    entries.push({
      schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
      catalogEntryId: row.id,
      displayName: row.name,
      lookupKey,
      aliases: [],
      type: row.type,
      category: row.category,
      issuerHint: row.issuer ?? null,
      validityPeriodYears: validityYears == null ? null : validityYears,
      isActive: row.is_active !== false,
      requiresDocumentUpload,
      allowsSelfAttestation,
      hasExpiration,
    });
  }

  entries.sort((a, b) => (a.catalogEntryId < b.catalogEntryId ? -1 : a.catalogEntryId > b.catalogEntryId ? 1 : 0));

  const manifest: CertificationCatalogManifestV1 = {
    _meta: {
      generatedFrom: 'credentialsSeed.json',
      schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
      doNotEdit: true,
    },
    schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
    generatedFrom: 'src/data/credentialsSeed.json',
    entries,
  };

  return { manifest, jsonText: stableJsonStringify(manifest) };
}
