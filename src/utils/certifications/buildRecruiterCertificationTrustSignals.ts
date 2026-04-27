import type { CertificationCatalogManifestV1 } from '../../shared/certifications/certificationCatalogManifest';
import type { RequirementEvaluationRow } from './evaluateCertificationsForRequirements';
import { certificationDisplayNameForCatalogId } from './certificationReadinessSurfaceLabels';
import { formatCertificationReadinessSurfaceLabel } from './certificationReadinessSurfaceLabels';

export type RecruiterCertificationTrustPack = {
  requiredApproved: number;
  requiredTotal: number;
  preferredMet: number;
  preferredTotal: number;
  blockingCertIssues: number;
  /** Plain-language lines for scoring / trust panels — deterministic order by requirementId. */
  explanationBullets: string[];
  /** Short risk-style lines (subset; avoid duplicating full action-item copy). */
  riskLines: string[];
};

function nameForRow(row: RequirementEvaluationRow, manifest: CertificationCatalogManifestV1): string {
  const legacy = row.requirement.legacySourceLabel?.trim();
  if (legacy) return legacy;
  return certificationDisplayNameForCatalogId(manifest, row.requirement.catalogEntryId);
}

/**
 * Summaries for recruiter trust surfaces (Phase 5B) — derived from engine rows, not heuristics on legacy strings.
 */
export function buildRecruiterCertificationTrustSignals(
  rows: RequirementEvaluationRow[],
  manifest: CertificationCatalogManifestV1,
): RecruiterCertificationTrustPack {
  let requiredApproved = 0;
  let requiredTotal = 0;
  let preferredMet = 0;
  let preferredTotal = 0;
  let blockingCertIssues = 0;

  const explanationBullets: string[] = [];
  const riskLines: string[] = [];

  const sorted = [...rows].sort((a, b) =>
    a.requirement.requirementId.localeCompare(b.requirement.requirementId),
  );

  for (const row of sorted) {
    const req = row.requirement;
    const res = row.result;

    if (req.scope === 'required') {
      requiredTotal += 1;
      if (res.status === 'approved') {
        requiredApproved += 1;
      }
    } else {
      preferredTotal += 1;
      if (res.status === 'approved' || res.status === 'expiring_soon') {
        preferredMet += 1;
      }
    }

    if (res.blocking && res.status !== 'approved') {
      blockingCertIssues += 1;
    }

    const display = nameForRow(row, manifest);
    if (res.status === 'approved') {
      explanationBullets.push(`${display} — approved`);
    } else {
      explanationBullets.push(formatCertificationReadinessSurfaceLabel(display, res.status));
    }

    if (
      res.status !== 'approved' &&
      res.status !== 'preferred_unmet' &&
      res.status !== 'waived' &&
      (req.scope === 'required' || res.blocking)
    ) {
      const rl = formatCertificationReadinessSurfaceLabel(display, res.status);
      if (!riskLines.includes(rl)) riskLines.push(rl);
    }
  }

  return {
    requiredApproved,
    requiredTotal,
    preferredMet,
    preferredTotal,
    blockingCertIssues,
    explanationBullets,
    riskLines,
  };
}

/** Compact counts for readiness-style UI (Phase 5C). */
export function certificationOperationalSummaryCounts(rows: RequirementEvaluationRow[]): {
  approved: number;
  pending: number;
  missingRequired: number;
  expiringSoon: number;
} {
  let approved = 0;
  let pending = 0;
  let missingRequired = 0;
  let expiringSoon = 0;
  for (const { requirement, result } of rows) {
    if (result.status === 'approved') approved += 1;
    if (result.status === 'pending_review') pending += 1;
    if (requirement.scope === 'required' && (result.status === 'missing' || result.status === 'invalid')) missingRequired += 1;
    if (result.status === 'expiring_soon') expiringSoon += 1;
  }
  return { approved, pending, missingRequired, expiringSoon };
}
