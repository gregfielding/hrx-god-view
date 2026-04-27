/**
 * Shared types for the Phase B job-requirement matchers.
 *
 * Each matcher is a pure function that compares one JO requirement entry
 * against a worker's record and returns a `MatcherResult`. The result's
 * `status` is the 5-value subset of `EmployeeReadinessItemStatus` that
 * matchers are permitted to emit (per Phase B.0 decision):
 *
 *   - `complete_pass`   — requirement satisfied
 *   - `complete_fail`   — requirement NOT satisfied (worker missing it / expired / failed)
 *   - `needs_review`    — partial / ambiguous; recruiter adjudicates
 *   - `incomplete`      — worker hasn't supplied the data; default seed state
 *   - `not_applicable`  — requirement doesn't apply to this worker × JO combo
 *
 * Matchers do NOT emit `expired` directly — Phase C's daily reconciler owns
 * the `expired` distinction at the trigger level. An expired cert that still
 * satisfies the requirement at seed time returns `complete_pass`; a cert
 * that's expired and unusable returns `complete_fail`.
 *
 * Runtime-neutral. No firebase imports.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase B
 */

import type { AssignmentReadinessItemStatus } from '../assignmentReadinessItemV1';

/** Subset of `AssignmentReadinessItemStatus` that matchers may emit. */
export type MatchedReadinessStatus = Extract<
  AssignmentReadinessItemStatus,
  'complete_pass' | 'complete_fail' | 'needs_review' | 'incomplete' | 'not_applicable'
>;

/**
 * Universal matcher result.
 *
 * `status` is what the readiness item gets stamped with at seed time. `reason`
 * is a stable string code (snake_case) for audit / metrics — distinct from any
 * UI label. `details` is optional structured data callers may want to surface
 * (e.g. which endorsements were missing for a license check).
 */
export type MatcherResult<TDetails = unknown> = {
  status: MatchedReadinessStatus;
  /**
   * Stable, machine-readable reason code. Examples:
   *   `'no_record'`, `'expired'`, `'level_below_required'`, `'missing_endorsement'`.
   * Triggers may stamp this onto `EmployeeReadinessItem.source.ref` for audit.
   */
  reason: string;
  /** Optional matcher-specific structured detail (matcher decides shape). */
  details?: TDetails;
};

/** Helpers for constructing results — keeps individual matchers terser. */
export const matcherResult = {
  pass: <T>(reason: string, details?: T): MatcherResult<T> => ({
    status: 'complete_pass',
    reason,
    ...(details !== undefined ? { details } : {}),
  }),
  fail: <T>(reason: string, details?: T): MatcherResult<T> => ({
    status: 'complete_fail',
    reason,
    ...(details !== undefined ? { details } : {}),
  }),
  needsReview: <T>(reason: string, details?: T): MatcherResult<T> => ({
    status: 'needs_review',
    reason,
    ...(details !== undefined ? { details } : {}),
  }),
  incomplete: <T>(reason: string, details?: T): MatcherResult<T> => ({
    status: 'incomplete',
    reason,
    ...(details !== undefined ? { details } : {}),
  }),
  notApplicable: <T>(reason: string, details?: T): MatcherResult<T> => ({
    status: 'not_applicable',
    reason,
    ...(details !== undefined ? { details } : {}),
  }),
};
