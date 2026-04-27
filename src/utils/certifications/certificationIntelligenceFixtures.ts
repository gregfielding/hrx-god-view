import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import { CERTIFICATION_CATALOG_SCHEMA_VERSION } from '../../shared/certifications/certificationCatalogManifest';
import type { Phase1CertificationRequirement } from '../../shared/certifications/certificationRequirement';
import type { CanonicalRecordWithId } from './evaluateCertificationsForRequirements';

/** Fixed “today” for reproducible expiration math (matches `EXPIRING_SOON_DAYS` window checks). */
export const FIXTURE_TODAY_ISO = '2026-04-20';

/** Far future — not expiring soon vs `FIXTURE_TODAY_ISO`. */
export const FAR_EXPIRATION_ISO = '2030-12-31';

/** Within the next 30 days after FIXTURE_TODAY_ISO. */
export const EXPIRING_SOON_DATE_ISO = '2026-05-10';

/** Past expiration. */
export const PAST_EXPIRATION_ISO = '2020-01-01';

/** Beyond 30-day expiring-soon window but still in the future. */
export const FAR_FUTURE_NOT_SOON_ISO = '2027-01-01';

export function reqRequiredTemplate(
  catalogEntryId: string,
  requirementId: string,
  overrides?: Partial<Phase1CertificationRequirement>,
): Phase1CertificationRequirement {
  return {
    requirementId,
    catalogEntryId,
    scope: 'required',
    evidencePolicy: 'either',
    reviewPolicy: 'must_be_approved',
    expirationPolicy: 'must_be_valid',
    ...overrides,
  };
}

export function recordRow(
  certificationRecordId: string,
  catalogEntryId: string,
  partial: Partial<CanonicalRecordWithId['record']> & Pick<CanonicalRecordWithId['record'], 'recordStatus' | 'review'>,
): CanonicalRecordWithId {
  return {
    certificationRecordId,
    record: {
      schemaVersion: 1,
      catalogEntryId,
      source: 'worker_upload',
      ...partial,
    },
  };
}

export function approvedActiveRecord(catalog: string, exp: string, rid: string): CanonicalRecordWithId {
  return recordRow(rid, catalog, {
    expirationDate: exp,
    review: { status: 'approved' },
    recordStatus: 'active',
  });
}

export function pendingReviewRecord(catalog: string, exp: string, rid: string): CanonicalRecordWithId {
  return recordRow(rid, catalog, {
    expirationDate: exp,
    review: { status: 'submitted' },
    recordStatus: 'pending_review',
  });
}

export function expiredRecord(catalog: string, rid: string): CanonicalRecordWithId {
  return recordRow(rid, catalog, {
    expirationDate: PAST_EXPIRATION_ISO,
    review: { status: 'approved' },
    recordStatus: 'active',
  });
}

export function rejectedRecord(catalog: string, exp: string, rid: string): CanonicalRecordWithId {
  return recordRow(rid, catalog, {
    expirationDate: exp,
    review: { status: 'rejected' },
    recordStatus: 'active',
  });
}

/** Minimal manifest: satisfies typing; tests use `as` for meta strict literals. */
export function buildTestManifest(known: { catalogEntryId: string; displayName: string }[]): CertificationCatalogManifestV1 {
  return {
    _meta: { generatedFrom: 'credentialsSeed.json', schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION, doNotEdit: true },
    schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
    generatedFrom: 'src/data/credentialsSeed.json',
    entries: known.map((k) => ({
      schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
      catalogEntryId: k.catalogEntryId,
      displayName: k.displayName,
      lookupKey: k.catalogEntryId,
      aliases: [],
      type: 'test',
      category: 'test',
      issuerHint: null,
      validityPeriodYears: 1,
      isActive: true,
      requiresDocumentUpload: false,
      allowsSelfAttestation: true,
      hasExpiration: true,
    })),
  };
}
