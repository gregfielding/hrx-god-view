/**
 * Lightweight staleness metadata for `users.{uid}.riskProfile` — compare signals vs compute time.
 */
import * as admin from 'firebase-admin';

export type RiskProfileStalenessFirestore = {
  /** Latest prescreen interview time observed when risk was computed */
  lastInterviewAt: admin.firestore.Timestamp | null;
  /** Mirrors `users.categoryScoresCurrentUpdatedAt` at compute time (may be null if unset) */
  lastCategoryScoresAt: admin.firestore.Timestamp | null;
  /** When compliance/user snapshot was taken for this profile */
  lastComplianceSnapshotAt: admin.firestore.Timestamp;
  /** Max of the meaningful input times (for quick “freshness” checks) */
  lastInputAt: admin.firestore.Timestamp;
};

function millis(ts: admin.firestore.Timestamp | undefined | null): number | null {
  if (!ts || typeof ts.toMillis !== 'function') return null;
  return ts.toMillis();
}

export function buildRiskProfileStalenessPayload(args: {
  interviewCreatedAt: admin.firestore.Timestamp | null | undefined;
  userDoc: Record<string, unknown>;
  /** Typically “now” at compute — compliance/user fields as-of this instant */
  complianceSnapshotAt: admin.firestore.Timestamp;
}): Record<string, unknown> {
  const { interviewCreatedAt, userDoc, complianceSnapshotAt } = args;
  const catRaw = userDoc.categoryScoresCurrentUpdatedAt as admin.firestore.Timestamp | undefined;
  const lastInterviewAt =
    interviewCreatedAt && typeof interviewCreatedAt.toMillis === 'function' ? interviewCreatedAt : null;

  const mInt = millis(lastInterviewAt);
  const mCat = millis(catRaw);
  const mComp = millis(complianceSnapshotAt);
  const candidates = [mInt, mCat, mComp].filter((x): x is number => x != null);
  const maxMs = candidates.length > 0 ? Math.max(...candidates) : mComp ?? Date.now();

  return {
    lastInterviewAt: lastInterviewAt,
    lastCategoryScoresAt: catRaw ?? null,
    lastComplianceSnapshotAt: complianceSnapshotAt,
    lastInputAt: admin.firestore.Timestamp.fromMillis(maxMs),
  };
}

export type RiskStalenessLabel = 'missing' | 'stale' | 'fresh';

/**
 * Operational staleness for scripts/QA (reads raw Firestore-shaped data).
 * - **stale** if category scores updated after we snapshotted them on the profile, or user updated after risk `lastUpdatedAt`.
 */
export function classifyRiskProfileStaleness(userDoc: Record<string, unknown>): RiskStalenessLabel {
  const rp = userDoc.riskProfile as
    | {
        staleness?: { lastCategoryScoresAt?: { toMillis?: () => number } };
        lastUpdatedAt?: { toMillis?: () => number };
      }
    | undefined;
  if (!rp) return 'missing';

  const catUp = userDoc.categoryScoresCurrentUpdatedAt as { toMillis?: () => number } | undefined;
  const snapCat = rp.staleness?.lastCategoryScoresAt;
  const cm = catUp?.toMillis?.();
  const sm = snapCat?.toMillis?.();
  if (cm != null && sm != null && cm > sm) return 'stale';

  const ru = userDoc.updatedAt as { toMillis?: () => number } | undefined;
  const rlm = rp.lastUpdatedAt?.toMillis?.();
  const um = ru?.toMillis?.();
  if (um != null && rlm != null && um > rlm + 1) {
    return 'stale';
  }
  return 'fresh';
}
