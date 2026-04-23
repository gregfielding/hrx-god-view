import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { JobOrder } from '../../types/recruiter/jobOrder';
import type { Phase1CertificationRequirement } from '../../types/certifications/certificationRequirement';
import { buildCertificationRequirementsFromLegacyStrings } from './buildCertificationRequirementsFromLegacyStrings';

export type BuildCertificationRequirementsFromJobOrderResult = {
  requirements: Phase1CertificationRequirement[];
  unmappedStrings: string[];
  sourceLabels: string[];
};

/**
 * Map `JobOrder.requiredCertifications` ∪ `requiredLicenses` into `Phase1CertificationRequirement[]`.
 * `requiredCertificationComplianceIds` is intentionally **not** expanded here (id → catalog mapping is a follow-up).
 */
export function buildCertificationRequirementsFromJobOrder(input: {
  jobOrder: JobOrder | null | undefined;
  manifest: CertificationCatalogManifestV1;
  /** For diagnostics only. */
  jobOrderId?: string | null;
}): BuildCertificationRequirementsFromJobOrderResult {
  const jo = input.jobOrder;
  if (!jo) {
    return { requirements: [], unmappedStrings: [], sourceLabels: [] };
  }

  const { requirements, unmappedStrings } = buildCertificationRequirementsFromLegacyStrings({
    requiredCertifications: jo.requiredCertifications,
    requiredLicenses: jo.requiredLicenses,
    manifest: input.manifest,
  });

  const sourceLabels = [
    ...(Array.isArray(jo.requiredCertifications) ? jo.requiredCertifications : []),
    ...(Array.isArray(jo.requiredLicenses) ? jo.requiredLicenses : []),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  return { requirements, unmappedStrings, sourceLabels };
}
