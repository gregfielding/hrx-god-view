import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import type { Phase1CertificationRequirement } from '../../shared/certifications/certificationRequirement';
import { buildCertificationRequirementsFromLegacyStrings } from '../../shared/certifications/buildCertificationRequirementsFromLegacyStrings';

/**
 * Job-board / public posting shape (loose — mirrors `JobsBoardPost`, `JobPostingDetail` custom data).
 */
export type JobPostingLike = {
  id?: string;
  /** Primary Phase 6 source — same field used by `getRequirementsWithStatus` → `licensesCerts`. */
  licensesCerts?: string[] | null;
  /** When false, posting does not expose cert requirements in apply UI; adapter returns empty (conservative). */
  showLicensesCerts?: boolean;
};

export type BuildCertificationRequirementsFromJobPostingResult = {
  requirements: Phase1CertificationRequirement[];
  unmappedStrings: string[];
  /** Raw strings extracted from the posting (before catalog bridge). */
  sourceLabels: string[];
};

/**
 * Map a public job posting’s license/cert labels into canonical engine requirements.
 * Delegates to {@link buildCertificationRequirementsFromLegacyStrings} — no extra fuzzy matching.
 */
export function buildCertificationRequirementsFromJobPosting(input: {
  posting: JobPostingLike;
  manifest: CertificationCatalogManifestV1;
}): BuildCertificationRequirementsFromJobPostingResult {
  const show = input.posting.showLicensesCerts === true;
  const raw = Array.isArray(input.posting.licensesCerts) ? input.posting.licensesCerts : [];
  const sourceLabels = raw.map((s) => String(s || '').trim()).filter(Boolean);

  if (!show || sourceLabels.length === 0) {
    return { requirements: [], unmappedStrings: [], sourceLabels: [] };
  }

  const { requirements, unmappedStrings } = buildCertificationRequirementsFromLegacyStrings({
    requiredCertifications: sourceLabels,
    requiredLicenses: [],
    manifest: input.manifest,
  });
  // Per-string unmapped warnings emit inside `buildCertificationRequirementsFromLegacyStrings`.

  return { requirements, unmappedStrings, sourceLabels };
}
