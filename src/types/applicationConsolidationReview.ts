/**
 * Sprint 4 PR1: tenant-scoped ambiguous merge review queue contract.
 * Path: tenants/{tenantId}/application_consolidation_review/{reviewId}
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

export const APPLICATION_CONSOLIDATION_REVIEW_COLLECTION = 'application_consolidation_review' as const;

/** Firestore document id — PR2 uses deterministic `clusterId` as the doc id for idempotent enqueue. */
export type ApplicationConsolidationReviewId = string;

export function applicationConsolidationReviewDocPath(tenantId: string, reviewId: string): string {
  return `tenants/${tenantId}/${APPLICATION_CONSOLIDATION_REVIEW_COLLECTION}/${reviewId}`;
}

/** Per-candidate snapshot for human review without opening each application doc. */
export type ApplicationConsolidationCandidateSummary = {
  docId: string;
  storage: 'tenant' | 'nested';
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  status?: string | null;
  createdAtMs?: number | null;
  createdAtIso?: string | null;
};

/**
 * Fields written when PR2+ enqueues reviews (PR1 defines contract only).
 * Summary fields support lightweight ops review.
 */
export type ApplicationConsolidationReviewDoc = {
  tenantId: string;
  jobOrderId: string;
  /** Stable id: same as Firestore doc id (hash of tenantId + jobOrderId + sorted `storage:docId` fingerprints). */
  clusterId: string;
  candidateDocIds: string[];
  candidates: ApplicationConsolidationCandidateSummary[];
  suggestedWinnerId: string | null;
  suggestedLoserIds: string[];
  /** e.g. userId_jobOrderId | email_jobOrderId | ambiguous | insufficient_signal */
  matchBasis: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'dismissed';
  createdAt: unknown;
  updatedAt?: unknown;
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
  dryRunBatchId?: string | null;
};
