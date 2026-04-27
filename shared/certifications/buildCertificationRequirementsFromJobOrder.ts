import type { CertificationCatalogManifestV1 } from './certificationCatalogManifest';
import type { Phase1CertificationRequirement } from './certificationRequirement';
import { buildCertificationRequirementsFromLegacyStrings } from './buildCertificationRequirementsFromLegacyStrings';

/**
 * Structural input — only the JO fields this function reads.
 *
 * Originally typed as `JobOrder` (a CRA-only type from
 * `src/types/recruiter/jobOrder.ts`), but this file lives in `shared/` now so
 * it must stay runtime-neutral. CRA callers still satisfy this shape via
 * structural typing; functions callers (Phase B.5.1 trigger) can pass a
 * narrowed projection of `Record<string, unknown>`.
 *
 * Keep this in sync with `JobOrder` if either field shape changes.
 */
export type JobOrderForCertificationRequirements = {
  requiredCertifications?: string[] | null;
  requiredLicenses?: string[] | null;
};

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
  jobOrder: JobOrderForCertificationRequirements | null | undefined;
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
