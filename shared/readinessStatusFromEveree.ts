/**
 * Pure translator: Everee worker record → canonical
 * `EmployeeReadinessItemStatus` for both `everee_profile` and
 * `direct_deposit` readiness items.
 *
 * Phase E of the readiness execution roadmap. See
 * `docs/READINESS_EXECUTION_MATRIX.md` §5.3 for the spec this implements.
 *
 * Two readiness items consume Everee signals:
 *
 *   - `everee_profile` — overall payroll-onboarding state. Tracks whether
 *     the worker has finished setting up their Everee account at all.
 *
 *   - `direct_deposit` — bank-account-specific. A worker can finish the
 *     Everee onboarding flow without having attached a verified bank
 *     account yet (paper-check fallback or pending verification). The
 *     readiness item splits these so the CSA queue can call out the
 *     specific gap.
 *
 * Runtime-neutral. No firebase imports. Used by the Phase A reconciliation
 * trigger fired on `tenants/{tid}/everee_workers/{...}` writes.
 */

import type { EmployeeReadinessItemStatus } from './employeeReadinessItemV1';

/**
 * Everee onboarding state stamped on `everee_workers/{entityId}__{userId}.status`
 * by the webhook handler in `functions/src/integrations/everee/evereeWebhook.ts`.
 *
 * String union keeps this translator runtime-neutral.
 */
export type EvereeWorkerStatus =
  /** Worker invited but hasn't started onboarding. */
  | 'invited'
  /** Worker is mid-flow on the Everee onboarding form. */
  | 'in_progress'
  /** Onboarding completed end-to-end. */
  | 'onboarding_complete'
  /** Onboarding failed (USCIS / KYC verification didn't pass). */
  | 'failed'
  /** Worker explicitly rejected / declined onboarding. */
  | 'rejected';

export interface EvereeReadinessInput {
  /** `null`/`undefined` for tenants/workers that haven't been seeded into Everee yet. */
  status: EvereeWorkerStatus | null | undefined;
  /**
   * Whether a bank account has been added AND Everee has verified it
   * (e.g. via Plaid / micro-deposit confirmation). Only relevant when
   * `status === 'onboarding_complete'`.
   */
  bankAccountVerified?: boolean;
}

export interface EvereeReadinessResult {
  evereeProfile: EmployeeReadinessItemStatus;
  directDeposit: EmployeeReadinessItemStatus;
}

/**
 * Translate Everee worker state into both readiness items at once. Per
 * `docs/READINESS_EXECUTION_MATRIX.md` §5.3.
 *
 * Returns both statuses in one call because the inputs overlap and the
 * caller (Phase A trigger) writes both items in a single transaction —
 * no point making the caller call this function twice.
 */
export function evereeToReadinessStatus(input: EvereeReadinessInput): EvereeReadinessResult {
  const status = input.status ?? null;

  switch (status) {
    case null:
    case undefined:
      // Worker hasn't been seeded into Everee yet — neither item has
      // started.
      return { evereeProfile: 'incomplete', directDeposit: 'incomplete' };

    case 'invited':
    case 'in_progress':
      // Worker is in the middle of onboarding. Both items are in flight.
      return { evereeProfile: 'in_progress', directDeposit: 'in_progress' };

    case 'onboarding_complete': {
      // Profile is done. Direct deposit depends on whether a bank
      // account was attached + verified during the flow.
      const directDeposit: EmployeeReadinessItemStatus =
        input.bankAccountVerified === true ? 'complete_pass' : 'in_progress';
      return { evereeProfile: 'complete_pass', directDeposit };
    }

    case 'failed':
    case 'rejected':
      // Onboarding terminal-failed. Surface to the CSA for review (a
      // re-invite or alternative payment method may be needed). We
      // intentionally use `needs_review` rather than `complete_fail` —
      // this is recoverable; the CSA can re-trigger.
      return { evereeProfile: 'needs_review', directDeposit: 'needs_review' };

    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return { evereeProfile: 'needs_review', directDeposit: 'needs_review' };
    }
  }
}
