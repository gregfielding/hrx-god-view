/**
 * Repo-delivered catalog manifest (generated from credentialsSeed.json).
 * Types only — no runtime logic.
 */

/** Bump only when migrating manifest shape; consumers compare against generated `_meta.schemaVersion`. */
export const CERTIFICATION_CATALOG_SCHEMA_VERSION = 1 as const;

/** One row in `certificationCatalogManifest.v1.json`. */
export type CatalogManifestEntryV1 = {
  /** Must match `CERTIFICATION_CATALOG_SCHEMA_VERSION` for migration detection. */
  schemaVersion: typeof CERTIFICATION_CATALOG_SCHEMA_VERSION;
  /** Immutable id — equals seed `id` (v1.3). */
  catalogEntryId: string;
  /** Seed `name` at generation time. */
  displayName: string;
  /** Lowercase collapsed name for exact lookup after normalizer. */
  lookupKey: string;
  /** Alternate display strings (previous names, synonyms). */
  aliases: string[];
  type: string;
  category: string;
  issuerHint: string | null;
  validityPeriodYears: number | null;
  isActive: boolean;
  /** Derived from seed `verification_method` for Phase 1 engine defaults. */
  requiresDocumentUpload: boolean;
  allowsSelfAttestation: boolean;
  /** Whether the catalog expects an expiration date (seed validity period may be unknown). */
  hasExpiration: boolean;
};

/** Machine-readable header (first key in sorted JSON output via stable stringify). */
export type CertificationCatalogManifestMetaV1 = {
  generatedFrom: 'credentialsSeed.json';
  schemaVersion: typeof CERTIFICATION_CATALOG_SCHEMA_VERSION;
  doNotEdit: true;
};

export type CertificationCatalogManifestV1 = {
  _meta: CertificationCatalogManifestMetaV1;
  schemaVersion: typeof CERTIFICATION_CATALOG_SCHEMA_VERSION;
  /** Source file fingerprint — path only; no timestamps in output. */
  generatedFrom: 'src/data/credentialsSeed.json';
  entries: CatalogManifestEntryV1[];
};
