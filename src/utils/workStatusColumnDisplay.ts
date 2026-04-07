import { normalizeAssignmentStatus } from './assignmentStatusNormalize';

export type WorkStatusColumnChip = {
  label: string;
  color: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  sx?: Record<string, unknown>;
};

/** Assignment is “live” for Work Status column: confirmed or actively working (not proposed-only). */
export function assignmentStatusIsActiveForWorkStatusColumn(raw: string | null | undefined): boolean {
  const n = normalizeAssignmentStatus(raw);
  return n === 'confirmed' || n === 'in_progress';
}

type WorkStatusUserLike = {
  securityLevel?: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onboardingType?: string;
};

/**
 * Work Status column for recruiter user tables: show **Active Assignment** when the worker has a
 * confirmed / in-progress tenant assignment; otherwise onboarding state; else security-level lifecycle.
 */
export function getWorkStatusColumnDisplay(
  u: WorkStatusUserLike,
  options?: { hasActiveAssignment?: boolean },
): WorkStatusColumnChip {
  if (options?.hasActiveAssignment) {
    return {
      label: 'Active Assignment',
      color: 'success',
      sx: { fontWeight: 700 },
    };
  }

  const employeeInProgress = String(u.employeeOnboardStatus || '').toLowerCase() === 'in progress';
  const contractorInProgress = String(u.contractorOnboardStatus || '').toLowerCase() === 'in progress';
  if (employeeInProgress || contractorInProgress) {
    const typeLabel =
      String(u.onboardingType || '').toLowerCase() === 'contractor' || contractorInProgress
        ? 'Contractor'
        : 'Employee';
    return {
      label: `Onboarding (${typeLabel})`,
      color: 'warning',
      sx: { bgcolor: '#E4572E', color: '#FFFFFF' },
    };
  }

  const sec = String(u.securityLevel ?? '0');
  switch (sec) {
    case '4':
      return { label: 'Hired', color: 'success' };
    case '3':
      return { label: 'Candidate', color: 'primary' };
    case '2':
      return { label: 'Applicant', color: 'info' };
    case '1':
      return { label: 'Dismissed', color: 'default' };
    case '0':
      return { label: 'Suspended', color: 'error' };
    default:
      return { label: sec, color: 'default' };
  }
}
