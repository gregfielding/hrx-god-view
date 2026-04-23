import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { Phase1CertificationRequirement } from '../../types/certifications/certificationRequirement';
import { certificationDisplayNameForCatalogId } from './certificationReadinessSurfaceLabels';
import type { WorkforceCertificationSummary } from './buildWorkforceCertificationSummary';
import {
  CERT_GAP_PENDING_MIN_COUNT,
  CERT_HIGH_RISK_EXPIRED_COUNT_FLOOR,
  CERT_HIGH_RISK_PERCENT,
  CERT_MIN_APPROVED_WORKERS,
  CERT_RISK_HIGH_EXPIRED_WORKFORCE_SHARE,
  CERT_RISK_MEDIUM_EXPIRING_SHARE,
  CERT_RISK_MEDIUM_PENDING_SHARE,
} from './certificationIntelligenceConstants';

export type CertificationRiskSignal = {
  catalogEntryId: string;
  displayName: string;
  workersExpiringSoon: number;
  workersExpired: number;
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
};

/**
 * Workforce-level risk signals from aggregated summary (insight only — no gating).
 */
export function detectCertificationRisk(input: {
  summary: WorkforceCertificationSummary;
  manifest: CertificationCatalogManifestV1;
  requirements?: Phase1CertificationRequirement[];
}): CertificationRiskSignal[] {
  const { summary, manifest, requirements } = input;
  const total = Math.max(1, summary.totalWorkers);
  const reqByCatalog = new Map((requirements ?? []).map((r) => [r.catalogEntryId, r]));
  const catalogIds = new Set<string>([
    ...Object.keys(summary.certificationCoverage),
    ...Object.keys(summary.expiringSoon),
  ]);

  const out: CertificationRiskSignal[] = [];

  for (const catalogEntryId of catalogIds) {
    const cov = summary.certificationCoverage[catalogEntryId] ?? {
      approved: 0,
      pending: 0,
      missing: 0,
      expired: 0,
    };
    const workersExpiringSoon = summary.expiringSoon[catalogEntryId] ?? 0;
    const workersExpired = cov.expired;
    const denom = cov.approved + cov.pending + cov.missing + cov.expired;
    const soonShare = denom > 0 ? workersExpiringSoon / denom : 0;

    const displayName = certificationDisplayNameForCatalogId(manifest, catalogEntryId);
    const req = reqByCatalog.get(catalogEntryId);
    const isRequired = req?.scope === 'required';

    let riskLevel: CertificationRiskSignal['riskLevel'] = 'low';
    if (
      soonShare >= CERT_HIGH_RISK_PERCENT ||
      workersExpired >
        Math.max(CERT_HIGH_RISK_EXPIRED_COUNT_FLOOR, Math.floor(CERT_RISK_HIGH_EXPIRED_WORKFORCE_SHARE * total)) ||
      (isRequired && cov.approved < CERT_MIN_APPROVED_WORKERS)
    ) {
      riskLevel = 'high';
    } else if (
      soonShare >= CERT_RISK_MEDIUM_EXPIRING_SHARE ||
      cov.pending > Math.max(CERT_GAP_PENDING_MIN_COUNT, Math.floor(total * CERT_RISK_MEDIUM_PENDING_SHARE)) ||
      workersExpired > 0
    ) {
      riskLevel = 'medium';
    }

    let recommendation = 'Monitor certification status in Certifications / readiness views.';
    if (riskLevel === 'high') {
      if (isRequired && cov.approved < CERT_MIN_APPROVED_WORKERS) {
        recommendation = `Critical: fewer than two approved workers for required ${displayName}. Prioritize verification or hiring support.`;
      } else if (soonShare >= CERT_HIGH_RISK_PERCENT) {
        recommendation = `High renewal load (~${Math.round(soonShare * 100)}% in expiring window): plan renewals for ${displayName}.`;
      } else {
        recommendation = `Elevated expired volume for ${displayName}: review worker records and renewals.`;
      }
    } else if (riskLevel === 'medium') {
      recommendation = `Review pending items and expirations for ${displayName} before they affect scheduling.`;
    }

    out.push({
      catalogEntryId,
      displayName,
      workersExpiringSoon,
      workersExpired,
      riskLevel,
      recommendation,
    });
  }

  return out.sort((a, b) => {
    const rk = { high: 0, medium: 1, low: 2 };
    if (rk[a.riskLevel] !== rk[b.riskLevel]) return rk[a.riskLevel] - rk[b.riskLevel];
    return a.displayName.localeCompare(b.displayName);
  });
}
