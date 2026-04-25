import type { EvaluationContext, Phase1CertificationRequirement } from '../../shared/certifications/certificationRequirement';
import type { CertificationEvaluationStatus } from '../../shared/certifications/certificationEnums';
import type { CanonicalRecordWithId } from './evaluateCertificationsForRequirements';
import { evaluateCertificationsForRequirements } from './evaluateCertificationsForRequirements';

export type CertificationPriorityIssueType =
  | 'missing'
  | 'pending_review'
  | 'expired'
  | 'rejected';

export type CertificationPriorityItem = {
  userId: string;
  catalogEntryId: string;
  issueType: CertificationPriorityIssueType;
  priorityScore: number;
  reason: string;
};

function issueTypeFromStatus(s: CertificationEvaluationStatus): CertificationPriorityIssueType | null {
  switch (s) {
    case 'missing':
    case 'invalid':
    case 'preferred_unmet':
      return 'missing';
    case 'pending_review':
    case 'attested_only':
      return 'pending_review';
    case 'expired':
      return 'expired';
    case 'rejected':
      return 'rejected';
    default:
      return null;
  }
}

/** Base score for priority ordering (deterministic; ties broken by catalog id + user id). */
export function computeCertificationPriorityBaseScore(
  issue: CertificationPriorityIssueType,
  requirement: Phase1CertificationRequirement,
): number {
  let score = 40;
  if (requirement.scope === 'required') score += 40;
  if (issue === 'missing') score += requirement.scope === 'required' ? 30 : 10;
  if (issue === 'expired') score += 25;
  if (issue === 'rejected') score += 22;
  if (issue === 'pending_review') score += 15;
  return score;
}

/**
 * Ordered backlog for recruiter follow-up (insight only — no automation).
 */
export function buildCertificationPriorityQueue(input: {
  workers: Array<{ id: string }>;
  recordsByUserId: Record<string, CanonicalRecordWithId[]>;
  requirements: Phase1CertificationRequirement[];
  context: EvaluationContext;
  todayISO: string;
}): CertificationPriorityItem[] {
  const { workers, recordsByUserId, requirements, context, todayISO } = input;
  const items: CertificationPriorityItem[] = [];

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
      const issue = issueTypeFromStatus(result.status);
      if (!issue) continue;

      items.push({
        userId: w.id,
        catalogEntryId: requirement.catalogEntryId,
        issueType: issue,
        priorityScore: computeCertificationPriorityBaseScore(issue, requirement),
        reason: result.reason || `${requirement.catalogEntryId}: ${result.status}`,
      });
    }
  }

  return items.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (a.catalogEntryId !== b.catalogEntryId) return a.catalogEntryId.localeCompare(b.catalogEntryId);
    return a.userId.localeCompare(b.userId);
  });
}
