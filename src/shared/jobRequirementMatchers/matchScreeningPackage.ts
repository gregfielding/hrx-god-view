/**
 * Screening package matcher — does the worker have an existing background /
 * drug screen record that satisfies the JO's required screening package?
 *
 * **Split-adapter pattern (Phase B.0 decision).** The actual evaluation lives
 * in `functions/src/compliance/screeningAutomationShared.ts` (which depends on
 * `firebase-admin` for its `Timestamp` handling) and its CRA mirror in
 * `src/pages/UserProfile/components/backgroundsComplianceModel.ts`. This
 * matcher is runtime-neutral and only owns the eval-result → readiness-status
 * mapping. Callers (the Phase B.5 trigger, plus any UI that wants to preview)
 * run the eval first and pass the result here.
 *
 * Cardinality: **single instance per assignment.** A JO declares one
 * `screeningPackageId`; matcher is called once.
 *
 * @see functions/src/compliance/screeningAutomationShared.ts (server eval)
 * @see src/pages/UserProfile/components/backgroundsComplianceModel.ts (client eval)
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.7
 */

import { matcherResult, type MatcherResult } from './types';

/**
 * Mirror of the `ScreeningSatisfiedEvaluation` shape from
 * `functions/src/compliance/screeningAutomationShared.ts`. Redeclared here
 * (instead of imported) so this file stays runtime-neutral / firebase-free.
 *
 * Keep these two shapes in sync. If the server eval gains fields the matcher
 * cares about, add them here AND in the client mirror file.
 */
export type ScreeningEvalResult = {
  satisfied: boolean;
  /** Equivalency key derived from the worker's record (id:xxx | name:yyy | unknown). */
  equivalencyKey: string;
  /** Validity-window expiration in ms; null when undeterminable. */
  expiresAtMs: number | null;
  /** Plain-language reason for operators / disputes. */
  decisionDetail: string;
};

export type MatchScreeningPackageInput = {
  /** JO's screening package id (e.g. `'CORT_PLUS'`). When absent → `not_applicable`. */
  requiredPackageId?: string | null;
  /**
   * Pre-computed eval result against the worker's most-recent valid record.
   * Caller obtains this by running `evaluateScreeningSatisfiedServer()` (or
   * the client equivalent) over the worker's existing `backgroundChecks` doc.
   *
   * `null` means the worker has NO existing record at all — distinct from
   * "record exists but doesn't satisfy".
   */
  evalResult: ScreeningEvalResult | null;
  /**
   * Today as ms since epoch. Caller injects for testability. Used to detect
   * an evaluation that's stale relative to its `expiresAtMs`.
   */
  nowMs: number;
};

export type MatchScreeningPackageDetails = {
  requiredPackageId: string | null;
  evalResult: ScreeningEvalResult | null;
  /** True when the eval said satisfied but `nowMs > expiresAtMs`. */
  expiredSinceEval: boolean;
};

/**
 * Map a `ScreeningEvalResult` onto a readiness status.
 *
 *   - JO has no `requiredPackageId` → `not_applicable`
 *   - Worker has no record at all (`evalResult === null`) → `incomplete`
 *   - Eval says satisfied AND not expired → `complete_pass`
 *   - Eval says satisfied BUT expired since → `complete_fail`
 *   - Eval says not satisfied (wrong package or incomplete order) → `complete_fail`
 *
 * Matcher does NOT emit `needs_review` — server-side adjudication (DISCREPANCY,
 * etc.) is owned by the AccuSource trigger from Phase A, which writes
 * `needs_review` directly onto `background_check` items. This matcher is about
 * the worker × JO **package match** question, distinct from per-service
 * verdict adjudication.
 */
export function matchScreeningPackage(
  input: MatchScreeningPackageInput,
): MatcherResult<MatchScreeningPackageDetails> {
  const requiredPackageId = (input.requiredPackageId ?? '').trim() || null;

  if (!requiredPackageId) {
    return matcherResult.notApplicable<MatchScreeningPackageDetails>('no_package_required', {
      requiredPackageId: null,
      evalResult: input.evalResult,
      expiredSinceEval: false,
    });
  }

  const eval_ = input.evalResult;

  if (eval_ == null) {
    return matcherResult.incomplete<MatchScreeningPackageDetails>('no_existing_record', {
      requiredPackageId,
      evalResult: null,
      expiredSinceEval: false,
    });
  }

  const expiredSinceEval =
    eval_.expiresAtMs != null && input.nowMs > eval_.expiresAtMs;

  const details: MatchScreeningPackageDetails = {
    requiredPackageId,
    evalResult: eval_,
    expiredSinceEval,
  };

  if (eval_.satisfied && !expiredSinceEval) {
    return matcherResult.pass<MatchScreeningPackageDetails>('eval_satisfied', details);
  }

  if (eval_.satisfied && expiredSinceEval) {
    return matcherResult.fail<MatchScreeningPackageDetails>('eval_satisfied_but_expired', details);
  }

  // Not satisfied — bubble up the reason from the eval result.
  return matcherResult.fail<MatchScreeningPackageDetails>('eval_not_satisfied', details);
}
