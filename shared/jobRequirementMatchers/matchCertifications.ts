/**
 * Certifications matcher — wraps the existing
 * `evaluateCertificationRequirement()` engine result and translates its
 * `CertificationEvaluationStatus` into a `MatchedReadinessStatus`.
 *
 * Like `matchScreeningPackage`, this is a **split-adapter pattern**: the real
 * evaluation lives in `src/utils/certifications/evaluateCertificationRequirement.ts`
 * (and is the canonical, well-tested cert engine — locked per its file header).
 * This matcher is runtime-neutral, accepting the eval result as input. The
 * caller (Phase B.5 trigger) runs the engine and passes the result here.
 *
 * Cardinality: **one matcher call per cert in `JobOrder.requiredCertifications`.**
 *
 * Status mapping (Phase B.0 decision, matrix §5.1 spirit):
 *
 *   `approved`        → `complete_pass`
 *   `expiring_soon`   → `complete_pass` (still valid; warning belongs in UI not status)
 *   `preferred_unmet` → `complete_pass` (preferred not blocking)
 *   `waived`          → `complete_pass` (admin-waived requirement)
 *   `expired`         → `complete_fail` (matchers don't emit `expired`; Phase C reconciler does)
 *   `rejected`        → `complete_fail`
 *   `invalid`         → `complete_fail`
 *   `pending_review`  → `needs_review`
 *   `attested_only`   → `needs_review` (worker claimed but no upload)
 *   `missing`         → `incomplete`
 *
 * @see src/utils/certifications/evaluateCertificationRequirement.ts (engine)
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.1
 */

import { matcherResult, type MatcherResult, type MatchedReadinessStatus } from './types';

/**
 * Mirror of `CertificationEvaluationStatus` from
 * `src/types/certifications/certificationEnums.ts`. Redeclared here (instead
 * of imported) so this file stays runtime-neutral / outside the certifications
 * module's import graph. Keep these in sync — the source enum is locked, so
 * additions are rare and would surface in type-check failures here.
 */
export type CertificationEvalStatus =
  | 'missing'
  | 'attested_only'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'expiring_soon'
  | 'invalid'
  | 'waived'
  | 'preferred_unmet';

export type MatchCertificationsInput = {
  /**
   * The requirement's catalog id (passed through to the result for trigger /
   * UI to identify which cert this matcher call concerned). Recommended for
   * use as the `customKey` on the seeded `cert_match` readiness item.
   */
  catalogEntryId: string;
  /**
   * Engine output — `CertificationEvaluationStatus`. Caller computes via
   * `evaluateCertificationRequirement({...})` and supplies the status.
   *
   * `null` is a special case: the catalog id wasn't recognized OR the engine
   * returned no input (e.g. requirement is misconfigured). We treat it as
   * `needs_review` so a CSA looks at it.
   */
  evalStatus: CertificationEvalStatus | null;
  /** Optional reason from the engine (e.g. `'past_expiration'`, `'awaiting_review'`) for audit. */
  evalReason?: string;
};

export type MatchCertificationsDetails = {
  catalogEntryId: string;
  evalStatus: CertificationEvalStatus | null;
  evalReason?: string;
};

const STATUS_MAP: Record<CertificationEvalStatus, MatchedReadinessStatus> = {
  approved: 'complete_pass',
  expiring_soon: 'complete_pass',
  preferred_unmet: 'complete_pass',
  waived: 'complete_pass',
  expired: 'complete_fail',
  rejected: 'complete_fail',
  invalid: 'complete_fail',
  pending_review: 'needs_review',
  attested_only: 'needs_review',
  missing: 'incomplete',
};

/**
 * Translate an engine eval status into a readiness item status.
 *
 *   - `evalStatus === null` (engine misconfig / unrecognized catalog id) → `needs_review`
 *   - Anything in `STATUS_MAP` → its mapped value
 *
 * The reason code passes through from the engine when available; otherwise
 * a stable code derived from the eval status.
 */
export function matchCertifications(
  input: MatchCertificationsInput,
): MatcherResult<MatchCertificationsDetails> {
  const details: MatchCertificationsDetails = {
    catalogEntryId: input.catalogEntryId,
    evalStatus: input.evalStatus,
    evalReason: input.evalReason,
  };

  if (input.evalStatus == null) {
    return matcherResult.needsReview<MatchCertificationsDetails>(
      'engine_returned_null',
      details,
    );
  }

  const status = STATUS_MAP[input.evalStatus];
  const reason = input.evalReason ?? `engine_status:${input.evalStatus}`;

  // Build the result manually so the helper picks the right branch.
  return { status, reason, details };
}
