/**
 * Lightweight employment lifecycle chip + copy for the User profile Employment tab.
 * Checklist booleans align with `employmentMinimalChecklistModel` (no blocker lists).
 */

import type { ChipProps } from '@mui/material/Chip';
import type { EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import {
  buildDirectDepositItem,
  buildHandbookPoliciesItems,
  buildTaxIdentityChecklistItems,
  resolvePayrollInviteLastSentAt,
} from './employmentMinimalChecklistModel';

export type EmploymentState = 'onboarding' | 'ready' | 'active' | 'inactive' | 'terminated';

export type EmploymentChecklistCompletion = {
  payrollInviteSent?: boolean;
  i9Complete?: boolean;
  w4Complete?: boolean;
  policiesSigned?: boolean;
  directDepositComplete?: boolean;
};

export function buildEmploymentLifecycleChecklist(overview: EmploymentEntityOverview): EmploymentChecklistCompletion {
  const { i9, w4OrW9 } = buildTaxIdentityChecklistItems(overview);
  const { handbook, policies } = buildHandbookPoliciesItems(overview);
  const directDeposit = buildDirectDepositItem(overview);
  const showI9 = overview.workerType !== '1099';
  return {
    payrollInviteSent: resolvePayrollInviteLastSentAt(overview) != null,
    i9Complete: showI9 ? i9.completed : true,
    w4Complete: w4OrW9.completed,
    policiesSigned: handbook.completed && policies.completed,
    directDepositComplete: directDeposit.completed,
  };
}

/** Checklist-only: all required items done → ready, else onboarding. */
export function deriveEmploymentState(checklist: EmploymentChecklistCompletion): EmploymentState {
  const allComplete =
    Boolean(checklist.payrollInviteSent) &&
    Boolean(checklist.i9Complete) &&
    Boolean(checklist.w4Complete) &&
    Boolean(checklist.policiesSigned) &&
    Boolean(checklist.directDepositComplete);

  if (allComplete) return 'ready';
  return 'onboarding';
}

/**
 * Prefer Firestore/header lifecycle when present; otherwise fall back to checklist-derived onboarding vs ready.
 */
export function resolveEmploymentTabState(
  overview: EmploymentEntityOverview,
  checklist: EmploymentChecklistCompletion
): EmploymentState {
  const header = overview.employmentHeaderState;
  if (header === 'terminated') return 'terminated';
  if (header === 'inactive') return 'inactive';
  if (header === 'on_assignment') return 'active';
  if (header === 'ready') return 'ready';
  return deriveEmploymentState(checklist);
}

export type EmploymentStateUi = {
  label: string;
  color: ChipProps['color'];
  description: string;
};

export function getEmploymentStateUI(state: EmploymentState): EmploymentStateUi {
  switch (state) {
    case 'onboarding':
      return {
        label: 'Onboarding',
        color: 'default',
        description: 'Complete onboarding steps to start working',
      };
    case 'ready':
      return {
        label: 'Ready',
        color: 'success',
        description: 'Worker is cleared and ready for placement',
      };
    case 'active':
      return {
        label: 'Active',
        color: 'primary',
        description: 'Worker is currently assigned and working',
      };
    case 'inactive':
      return {
        label: 'Inactive',
        color: 'default',
        description: 'No active assignments',
      };
    case 'terminated':
      return {
        label: 'Terminated',
        color: 'error',
        description: 'Employment has ended',
      };
    default:
      return {
        label: 'Onboarding',
        color: 'default',
        description: '',
      };
  }
}

export function getEmploymentNextStep(
  checklist: EmploymentChecklistCompletion,
  opts?: { workerType: 'w2' | '1099' | null }
): string | null {
  if (!checklist.payrollInviteSent) return 'Send payroll invite';
  if (!checklist.i9Complete) return 'Complete I-9';
  if (!checklist.w4Complete) return opts?.workerType === '1099' ? 'Complete W-9' : 'Complete W-4';
  if (!checklist.policiesSigned) return 'Sign handbook and policies';
  if (!checklist.directDepositComplete) return 'Set up direct deposit';
  return null;
}
