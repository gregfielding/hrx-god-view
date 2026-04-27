/**
 * Pure translator: E-Verify case → canonical `EmployeeReadinessItemStatus`.
 *
 * Phase E of the readiness execution roadmap. See
 * `docs/READINESS_EXECUTION_MATRIX.md` §5.2 for the spec this implements.
 *
 * USCIS case state is mapped to `everify_cases.hrxStatus` upstream by
 * `mapProviderStatusToHrx()` in
 * `functions/src/integrations/everify/everifyAdapter.ts`. This translator
 * takes the resulting `hrxStatus` and produces the canonical readiness
 * status.
 *
 * Runtime-neutral. No firebase imports. Used by the Phase A reconciliation
 * trigger that bridges E-Verify case updates into
 * `employee_readiness_items.{...}.e_verify.status`.
 */

import type { EmployeeReadinessItemStatus } from './employeeReadinessItemV1';

/**
 * E-Verify HRX flow state. Mirrors `EverifyHrxStatus` in the functions/
 * package. String union here keeps this translator runtime-neutral and
 * testable without the functions/ package available.
 *
 * Don't widen this without updating the spec in §5.2 of the matrix.
 */
export type EverifyHrxStatus =
  | 'draft'
  | 'ready'
  | 'submitted'
  | 'pending'
  | 'employment_authorized'
  | 'tnc'
  | 'dhs_verification_in_process'
  | 'further_action_required'
  | 'final_nonconfirmation'
  | 'closed'
  | 'closure_duplicate'
  | 'error';

export interface EverifyReadinessInput {
  hrxStatus: EverifyHrxStatus | null | undefined;
}

/**
 * Translate an E-Verify case status into the canonical readiness status.
 * See `docs/READINESS_EXECUTION_MATRIX.md` §5.2.
 */
export function everifyToReadinessStatus(
  input: EverifyReadinessInput,
): EmployeeReadinessItemStatus {
  const status = input.hrxStatus ?? null;

  switch (status) {
    case null:
    case undefined:
      return 'incomplete';

    case 'draft':
    case 'ready':
      // Case skeleton exists but hasn't been submitted to USCIS yet.
      // Treated as "not started" from the worker × entity readiness POV
      // — the case being a draft means we haven't yet gated the worker.
      return 'incomplete';

    case 'submitted':
    case 'pending':
    case 'dhs_verification_in_process':
      // In flight with USCIS. Worker can't be paid yet; CSA monitors.
      return 'in_progress';

    case 'tnc':
    case 'further_action_required':
      // Tentative Non-Confirmation or DHS asked for more info. CSA must
      // act — surface in `needs_review` so the action queue routes to
      // them with a specific TNC handling task.
      return 'needs_review';

    case 'employment_authorized':
      // USCIS confirmed work authorization. The happy path.
      return 'complete_pass';

    case 'final_nonconfirmation':
      // FNC — terminal negative. Blocks employment under this entity.
      return 'complete_fail';

    case 'closed':
      // Case closed without authorization (e.g. worker withdrawn,
      // employer closed early). Treat as fail unless an authorized
      // result was already recorded — in practice the upstream mapper
      // returns `employment_authorized` for the happy path so any
      // `closed` here means non-confirmed.
      return 'complete_fail';

    case 'closure_duplicate':
      // Case dedup'd into another active case for the same worker ×
      // entity. The OTHER case carries the real status; this one is
      // not the source of truth.
      return 'not_applicable';

    case 'error':
      // Adapter / poller error. Admin investigation needed.
      return 'needs_review';

    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'needs_review';
    }
  }
}
