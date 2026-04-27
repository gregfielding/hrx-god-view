import certificationCatalogManifest from '../../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import type { EvaluationContext, Phase1CertificationRequirement } from '../../shared/certifications/certificationRequirement';
import { readinessSurfaceLabelsForNonSatisfiedEngineRows } from './certificationReadinessSurfaceLabels';
import { buildCertificationRequirementsFromLegacyStrings } from '../../shared/certifications/buildCertificationRequirementsFromLegacyStrings';
import {
  evaluateCertificationsForRequirements,
  type CanonicalRecordWithId,
  type RequirementEvaluationRow,
} from './evaluateCertificationsForRequirements';
import { getCanonicalCertificationRecordsWithIds } from './getCanonicalCertificationRecords';
import { normalizeDateToISODateString } from '../../shared/certifications/normalizeDateToISODateString';

export type LegacyCertificationEvaluationSummary = {
  missingRequiredCount: number;
  blockingCount: number;
  approvedCount: number;
  warnings: string[];
};

/**
 * Production-adjacent evaluator — deterministic, no string fuzzy matching inside the engine.
 * Callers supply canonical `certification_records` rows; legacy job arrays are converted via the bridge.
 */
export function evaluateCertificationsForLegacyRequirementStrings(input: {
  requiredCertifications?: string[] | null | undefined;
  requiredLicenses?: string[] | null | undefined;
  records: CanonicalRecordWithId[];
  context: EvaluationContext;
  todayISO: string;
  manifest: CertificationCatalogManifestV1;
}): {
  rows: RequirementEvaluationRow[];
  unmappedStrings: string[];
  summary: LegacyCertificationEvaluationSummary;
} {
  const { records, context, todayISO, manifest } = input;

  const { requirements, unmappedStrings } = buildCertificationRequirementsFromLegacyStrings({
    requiredCertifications: input.requiredCertifications,
    requiredLicenses: input.requiredLicenses,
    manifest,
  });

  const rows =
    requirements.length > 0
      ? evaluateCertificationsForRequirements({
          requirements,
          records,
          context,
          todayISO,
        })
      : [];

  const warnings = [...unmappedStrings.map((s) => `unmapped:${s}`)];

  let missingRequiredCount = 0;
  let blockingCount = 0;
  let approvedCount = 0;

  for (const { result } of rows) {
    if (result.status === 'missing') missingRequiredCount += 1;
    if (result.blocking) blockingCount += 1;
    if (result.status === 'approved' || result.status === 'expiring_soon') approvedCount += 1;
  }

  if (rows.length > 0 && unmappedStrings.length > 0) {
    warnings.push(`note:${unmappedStrings.length}_unmapped_strings_skipped`);
  }

  return {
    rows,
    unmappedStrings,
    summary: {
      missingRequiredCount,
      blockingCount,
      approvedCount,
      warnings,
    },
  };
}

const manifestStatic = certificationCatalogManifest as CertificationCatalogManifestV1;

/**
 * Loads canonical `certification_records` for the worker and evaluates pre-built Phase 1 requirements.
 * Prefer this after {@link buildCertificationRequirementsFromJobPosting} / job order adapters in Phase 6.
 */
export async function computeEngineGapForPhase1Requirements(input: {
  workerUid: string;
  requirements: Phase1CertificationRequirement[];
  context: EvaluationContext;
  todayISO?: string;
  manifest?: CertificationCatalogManifestV1;
}): Promise<{ labels: string[]; rows: RequirementEvaluationRow[] }> {
  const manifest = input.manifest ?? manifestStatic;
  const todayISO = input.todayISO ?? normalizeDateToISODateString(new Date()) ?? '1970-01-01';

  const records = await getCanonicalCertificationRecordsWithIds(input.workerUid);
  if (!input.requirements.length) {
    return { labels: [], rows: [] };
  }
  const rows = evaluateCertificationsForRequirements({
    requirements: input.requirements,
    records,
    context: input.context,
    todayISO,
  });
  const labels = readinessSurfaceLabelsForNonSatisfiedEngineRows(rows, manifest);
  return { labels, rows };
}

/**
 * Async helper — loads canonical records, runs bridge + engine, returns user-facing gap labels.
 * Used by `checkMissingCertificationsWithEngine` (apply flow). Phase B.4 removed
 * the legacy fuzzy `checkMissingCertifications` and the `REACT_APP_CERT_ENGINE_READINESS`
 * gate on this surface — engine is now always on for the apply flow.
 */
export async function computeEngineGapLabelsForLegacyJobStrings(input: {
  workerUid: string;
  /** Often `requiredCertifications ∪ requiredLicenses` as stored on postings. */
  licensesCertsCombined: string[] | undefined;
  context: EvaluationContext;
  /** Override clock (tests). */
  todayISO?: string;
  manifest?: CertificationCatalogManifestV1;
}): Promise<{ labels: string[]; unmappedStrings: string[]; rows: RequirementEvaluationRow[] }> {
  const manifest = input.manifest ?? manifestStatic;
  const todayISO = input.todayISO ?? normalizeDateToISODateString(new Date()) ?? '1970-01-01';

  const { requirements, unmappedStrings } = buildCertificationRequirementsFromLegacyStrings({
    requiredCertifications: input.licensesCertsCombined,
    requiredLicenses: [],
    manifest,
  });

  const { labels, rows } = await computeEngineGapForPhase1Requirements({
    workerUid: input.workerUid,
    requirements,
    context: input.context,
    todayISO,
    manifest,
  });
  return { labels, unmappedStrings, rows };
}
