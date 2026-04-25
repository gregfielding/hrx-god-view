/**
 * Pure translator: AccuSource background-check / drug-screen record →
 * canonical `EmployeeReadinessItemStatus`.
 *
 * Phase E of the readiness execution roadmap. See
 * `docs/READINESS_EXECUTION_MATRIX.md` §5.1 for the spec this implements.
 *
 * Two input signals from AccuSource land on `tenants/{tid}/backgroundChecks/{x}`:
 *   1. `hrxStatus` — vendor flow state (draft / submitted / completed / etc.)
 *   2. `providerServiceOrderStatus.{serviceId}.adjudication.autoVerdict` —
 *      per-service-line verdict (PASSED / FAILED / NEEDS_REVIEW / PENDING)
 *      computed by `classifyAutoVerdict()` in
 *      `functions/src/integrations/accusource/accusourceAdjudication.ts`.
 *
 * The verdict is the authoritative signal once the order completes;
 * `hrxStatus` carries us through the in-progress states.
 *
 * Verdict aggregation (priority-ordered) — for `hrxStatus === 'completed'`:
 *   - any FAILED  → `complete_fail`     (a hard fail blocks the worker)
 *   - any NEEDS_REVIEW → `needs_review` (CSA must adjudicate)
 *   - any PENDING → `in_progress`       (vendor not done with all lines)
 *   - else (all PASSED) → `complete_pass`
 *
 * Runtime-neutral. No firebase imports. Pure function — re-runnable on the
 * same input always returns the same output. Used by the Phase A
 * reconciliation trigger that bridges AccuSource webhook updates into
 * `employee_readiness_items.{...}.status`.
 */

import type { EmployeeReadinessItemStatus } from './employeeReadinessItemV1';

/**
 * AccuSource document-level flow state. Mirrors `HrxBackgroundCheckStatus`
 * in `functions/src/integrations/accusource/types.ts`.
 *
 * Kept as a string union here (rather than imported) so this translator
 * stays runtime-neutral and unit-testable in environments that don't have
 * the functions/ package available.
 */
export type AccuSourceHrxStatus =
  | 'draft'
  | 'submitted'
  | 'awaiting_applicant'
  | 'in_progress'
  | 'report_ready'
  | 'drug_report_ready'
  | 'completed'
  | 'canceled'
  | 'error';

/** Per-service-line verdict from `classifyAutoVerdict()`. */
export type AccuSourceLineVerdict = 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | 'PENDING';

/**
 * Minimal slice of the `backgroundChecks` doc the translator needs. Pass
 * exactly this — don't pass the full Firestore doc — so the function is
 * testable without fixturing the entire collection schema.
 */
export interface AccuSourceReadinessInput {
  hrxStatus: AccuSourceHrxStatus | null | undefined;
  /**
   * Adjudication verdict per service line. Order-independent.
   * Empty array is treated as "no verdicts yet" — safe regardless of
   * `hrxStatus`.
   */
  serviceVerdicts: AccuSourceLineVerdict[];
  /**
   * `markedCompleteOutsideHrx === true` short-circuits to `complete_pass`.
   * Set by `markAccusourceBackgroundCheckCompleteOutside()` when a CSA
   * indicates the worker has a current background from another tenant
   * (or other manual override). Vendor verdicts are pre-stamped as PASSED
   * by that callable, but we honor the override flag explicitly so the
   * translator's behavior matches the writer's contract regardless of
   * subsequent edits.
   */
  markedCompleteOutsideHrx?: boolean;
}

/**
 * Translate an AccuSource background / drug-screen record into the
 * canonical readiness status. See `docs/READINESS_EXECUTION_MATRIX.md`
 * §5.1 for the full mapping and rationale.
 */
export function accuSourceToReadinessStatus(
  input: AccuSourceReadinessInput,
): EmployeeReadinessItemStatus {
  // CSA-marked override wins over everything else.
  if (input.markedCompleteOutsideHrx === true) {
    return 'complete_pass';
  }

  const status = input.hrxStatus ?? null;

  switch (status) {
    case null:
    case undefined:
      // Doc exists but `hrxStatus` not yet stamped. Treat as not started.
      return 'incomplete';

    case 'draft':
    case 'submitted':
    case 'awaiting_applicant':
    case 'in_progress':
    case 'report_ready':
    case 'drug_report_ready':
      // Order placed but not fully complete. Some service lines may have
      // verdicts but at least one is still outstanding.
      return 'in_progress';

    case 'canceled':
      // Order canceled — readiness item doesn't apply for this attempt.
      // The Phase A trigger should treat this as "go back to incomplete"
      // for the readiness layer (a CSA needs to re-order). We surface
      // `not_applicable` here so the translator doesn't accidentally
      // claim the worker passed.
      return 'not_applicable';

    case 'error':
      // Vendor-side error — admin investigation needed. Don't fail the
      // worker silently.
      return 'needs_review';

    case 'completed':
      return aggregateVerdicts(input.serviceVerdicts);

    default: {
      // Exhaustiveness guard. If a new `hrxStatus` value gets added
      // without updating this translator, TypeScript will surface it at
      // compile time. Defensive runtime fallback: needs_review.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'needs_review';
    }
  }
}

/**
 * Combine per-service-line verdicts into a single readiness status.
 *
 * Priority is FAILED → NEEDS_REVIEW → PENDING → PASSED. The "any one"
 * semantic is deliberate: a worker who passes 4 services but fails the
 * 5th is `complete_fail`, not "mostly passed." The CSA waives explicitly
 * if the failed line shouldn't block placement.
 */
function aggregateVerdicts(verdicts: AccuSourceLineVerdict[]): EmployeeReadinessItemStatus {
  if (verdicts.length === 0) {
    // `hrxStatus === 'completed'` with no per-line verdicts shouldn't
    // happen in practice (the webhook handler stamps adjudication on
    // every line), but if it does, treat as in-progress so we don't
    // accidentally pass a worker on no data.
    return 'in_progress';
  }

  let hasFailed = false;
  let hasNeedsReview = false;
  let hasPending = false;

  for (const v of verdicts) {
    if (v === 'FAILED') hasFailed = true;
    else if (v === 'NEEDS_REVIEW') hasNeedsReview = true;
    else if (v === 'PENDING') hasPending = true;
    // PASSED contributes nothing to the priority ladder.
  }

  if (hasFailed) return 'complete_fail';
  if (hasNeedsReview) return 'needs_review';
  if (hasPending) return 'in_progress';
  return 'complete_pass';
}
