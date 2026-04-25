import type { CertificationEvaluationStatus } from '../../shared/certifications/certificationEnums';
import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import type { Phase1CertificationRequirement } from '../../shared/certifications/certificationRequirement';
import { getCatalogEntryById } from './getCatalogEntryById';
import type { RequirementEvaluationRow } from './evaluateCertificationsForRequirements';

/** Display name for chip/blocker copy — prefers manifest `displayName`. */
export function certificationDisplayNameForCatalogId(
  manifest: CertificationCatalogManifestV1,
  catalogEntryId: string,
): string {
  return getCatalogEntryById(manifest, catalogEntryId)?.displayName ?? catalogEntryId;
}

/**
 * Human-readable single-line message for readiness surfaces (Phase 3).
 * Product copy — keep aligned with user-facing guidance docs.
 */
export function formatCertificationReadinessSurfaceLabel(displayName: string, status: CertificationEvaluationStatus): string {
  const d = displayName.trim() || 'Certification';
  switch (status) {
    case 'missing':
    case 'invalid':
      return `Missing: ${d}`;
    case 'pending_review':
      return `Pending review: ${d}`;
    case 'expired':
      return `Expired: ${d}`;
    case 'rejected':
      return `Rejected: ${d}`;
    case 'attested_only':
      return `Attested only: Upload proof for ${d}`;
    case 'expiring_soon':
      return `Expires soon: ${d}`;
    case 'approved':
      return d;
    case 'preferred_unmet':
      return `Preferred not met: ${d}`;
    case 'waived':
      return `Waived: ${d}`;
    default:
      return `${d} (${status})`;
  }
}

function displayNameForRow(
  requirement: Phase1CertificationRequirement,
  manifest: CertificationCatalogManifestV1,
): string {
  const legacy = requirement.legacySourceLabel?.trim();
  if (legacy) return legacy;
  return certificationDisplayNameForCatalogId(manifest, requirement.catalogEntryId);
}

/**
 * Labels to show when a requirement is **not** in a satisfied engine state (placement / missing-cert style UIs).
 */
export function readinessSurfaceLabelsForNonSatisfiedEngineRows(
  rows: RequirementEvaluationRow[],
  manifest: CertificationCatalogManifestV1,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const { requirement, result } of rows) {
    if (result.status === 'approved') continue;
    const displayName = displayNameForRow(requirement, manifest);
    const label = formatCertificationReadinessSurfaceLabel(displayName, result.status);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }

  return out;
}
