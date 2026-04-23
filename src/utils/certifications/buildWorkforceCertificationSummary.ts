import type { EvaluationContext, Phase1CertificationRequirement } from '../../types/certifications/certificationRequirement';
import type { CertificationEvaluationStatus } from '../../types/certifications/certificationEnums';
import type { CanonicalRecordWithId } from './evaluateCertificationsForRequirements';
import { evaluateCertificationsForRequirements } from './evaluateCertificationsForRequirements';
import {
  CERT_GAP_PENDING_MIN_COUNT,
  CERT_GAP_PENDING_WORKFORCE_SHARE,
  CERT_HIGH_RISK_PERCENT,
  CERT_MIN_APPROVED_WORKERS,
} from './certificationIntelligenceConstants';

/** Minimal worker shape for workforce aggregation (id required). */
export type WorkforceWorker = { id: string };

export type WorkforceCertificationSummary = {
  totalWorkers: number;
  certificationCoverage: {
    [catalogEntryId: string]: {
      approved: number;
      pending: number;
      missing: number;
      expired: number;
    };
  };
  expiringSoon: {
    [catalogEntryId: string]: number;
  };
  /** Human-readable planning gaps (no automation). */
  highRiskGaps: string[];
};

function emptyCoverage() {
  return { approved: 0, pending: 0, missing: 0, expired: 0 };
}

function bumpCoverage(
  coverage: WorkforceCertificationSummary['certificationCoverage'],
  catalogEntryId: string,
  status: CertificationEvaluationStatus,
) {
  const cell = coverage[catalogEntryId] ?? emptyCoverage();
  switch (status) {
    case 'approved':
    case 'expiring_soon':
      cell.approved += 1;
      break;
    case 'pending_review':
    case 'attested_only':
      cell.pending += 1;
      break;
    case 'missing':
    case 'invalid':
    case 'preferred_unmet':
      cell.missing += 1;
      break;
    case 'expired':
    case 'rejected':
      cell.expired += 1;
      break;
    case 'waived':
      break;
    default:
      cell.missing += 1;
  }
  coverage[catalogEntryId] = cell;
}

/**
 * Workforce-level certification coverage and expiration counts.
 * Pure: caller supplies canonical records per user; optionally scopes to `requirements` catalog IDs.
 */
export function buildWorkforceCertificationSummary(input: {
  workers: WorkforceWorker[];
  /** Map user id → canonical certification_records docs */
  recordsByUserId: Record<string, CanonicalRecordWithId[]>;
  /** When set, only these catalogs are scored (typical: tenant/job requirement set). */
  requirements: Phase1CertificationRequirement[];
  context: EvaluationContext;
  todayISO: string;
}): WorkforceCertificationSummary {
  const { workers, recordsByUserId, requirements, context, todayISO } = input;
  const coverage: WorkforceCertificationSummary['certificationCoverage'] = {};
  const expiringSoon: WorkforceCertificationSummary['expiringSoon'] = {};

  for (const w of workers) {
    const records = recordsByUserId[w.id] ?? [];
    if (requirements.length === 0) continue;

    const rows = evaluateCertificationsForRequirements({
      requirements,
      records,
      context,
      todayISO,
    });

    for (const { requirement, result } of rows) {
      const cid = requirement.catalogEntryId;
      bumpCoverage(coverage, cid, result.status);
      if (result.status === 'expiring_soon') {
        expiringSoon[cid] = (expiringSoon[cid] ?? 0) + 1;
      }
    }
  }

  const highRiskGaps: string[] = [];
  const total = workers.length;
  for (const req of requirements) {
    if (req.scope !== 'required') continue;
    const cid = req.catalogEntryId;
    const c = coverage[cid] ?? emptyCoverage();
    const pool = c.approved + c.pending + c.missing + c.expired;
    if (pool === 0) continue;
    const soonRate = (expiringSoon[cid] ?? 0) / Math.max(1, c.approved + (expiringSoon[cid] ?? 0));
    if (c.approved < CERT_MIN_APPROVED_WORKERS) {
      highRiskGaps.push(
        `Required cert ${cid}: fewer than ${CERT_MIN_APPROVED_WORKERS} workers approved (${c.approved} approved).`,
      );
    }
    if (soonRate >= CERT_HIGH_RISK_PERCENT && (expiringSoon[cid] ?? 0) > 0) {
      highRiskGaps.push(`Required cert ${cid}: many approvals expiring soon (${expiringSoon[cid]} workers in renewal window).`);
    }
    if (c.pending > Math.max(CERT_GAP_PENDING_MIN_COUNT, Math.floor(total * CERT_GAP_PENDING_WORKFORCE_SHARE))) {
      highRiskGaps.push(`Required cert ${cid}: elevated pending / attested volume (${c.pending} workers).`);
    }
  }

  const uniq = new Set(highRiskGaps);
  return {
    totalWorkers: total,
    certificationCoverage: coverage,
    expiringSoon,
    highRiskGaps: Array.from(uniq),
  };
}
