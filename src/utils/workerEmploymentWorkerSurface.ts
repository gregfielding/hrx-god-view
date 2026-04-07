/**
 * Worker-facing employment hub + entity page: simple status labels and hints
 * (maps from canonical EmploymentV2HeaderState / I-9 view model — no backend changes).
 */
import type { EmploymentV2HeaderState } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { I9EmploymentDocsSubstatus } from './i9SupportingDocumentsViewModel';

export interface EntityEmploymentRecordLike {
  entityId?: string | null;
}

/** Profile list + entity summary chip — plain language, no internal jargon. */
export function workerEmploymentSurfaceStatusLabel(state: EmploymentV2HeaderState): string {
  switch (state) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return 'Under review';
    case 'action_required':
      return 'Action needed';
    case 'waiting_on_company':
      return 'Waiting on employer';
    case 'ready':
    case 'on_assignment':
      return 'Complete';
    case 'terminated':
      return 'Ended';
    case 'inactive':
      return 'Inactive';
    default:
      return 'Under review';
  }
}

export type WorkerI9AttentionHint = 'none' | 'upload' | 'under_review' | 'rejected' | 'complete' | 'action_needed';

export function i9SubstatusToWorkerHint(sub: I9EmploymentDocsSubstatus): WorkerI9AttentionHint {
  switch (sub) {
    case 'not_requested':
      return 'none';
    case 'upload_requested':
      return 'upload';
    case 'under_review':
      return 'under_review';
    case 'rejected':
      return 'rejected';
    case 'action_needed':
      return 'action_needed';
    case 'complete':
      return 'complete';
    default:
      return 'none';
  }
}

/** One-line next step on profile employment row when I-9 is scoped to this entity. */
export function workerEmploymentHubNextStepLine(args: {
  headerState: EmploymentV2HeaderState;
  i9Hint: WorkerI9AttentionHint;
  hasOpenOnboardingDemand: boolean;
  pipelineSummary: string | null;
}): string | null {
  const { headerState, i9Hint, hasOpenOnboardingDemand, pipelineSummary } = args;

  if (i9Hint === 'upload' || i9Hint === 'action_needed') {
    return 'Upload I-9 documents';
  }
  if (i9Hint === 'rejected') {
    return 'Replace a rejected I-9 document';
  }
  if (i9Hint === 'under_review') {
    return 'I-9 documents under review';
  }

  if (headerState === 'waiting_on_company') {
    return 'Waiting for your employer';
  }
  if (headerState === 'action_required' && hasOpenOnboardingDemand) {
    return 'Finish tasks on this employment page';
  }
  if (headerState === 'in_progress' && hasOpenOnboardingDemand) {
    return pipelineSummary || 'Continue onboarding';
  }
  if (headerState === 'not_started' && hasOpenOnboardingDemand) {
    return 'Get started on this employment page';
  }
  return null;
}

/** Onboarding path rows: hide payroll checklist items — payroll is a single card with Open payroll setup. */
export function omitWorkerPayrollChecklistRows<T extends { sourceRef?: { pipelineStepId?: string | null } | null; groupId?: string }>(
  rows: T[],
): T[] {
  return rows.filter((r) => {
    const step = r.sourceRef?.pipelineStepId;
    if (step === 'everee') return false;
    if (r.groupId === 'payroll') return false;
    return true;
  });
}

/** Worker-visible payroll step status (no “invite sent” wording). */
export function workerPayrollSetupStatusLabel(payrollAccountStatus: string | undefined | null): 'Not started' | 'In progress' | 'Complete' {
  const s = String(payrollAccountStatus || '').toLowerCase();
  if (s === 'complete') return 'Complete';
  if (
    s === 'invite_sent' ||
    s === 'account_created' ||
    s === 'in_progress' ||
    s === 'pending' ||
    s === 'not_started'
  ) {
    return s === 'not_started' ? 'Not started' : 'In progress';
  }
  if (!s) return 'Not started';
  return 'In progress';
}

export function workerMyEmploymentDetailPath(employmentRecordId: string): string {
  return `/c1/workers/my-employment/${encodeURIComponent(employmentRecordId)}`;
}

export function workerMyEmploymentAbsoluteUrl(origin: string, employmentRecordId: string): string {
  const path = workerMyEmploymentDetailPath(employmentRecordId);
  return `${origin.replace(/\/$/, '')}${path}`;
}

/** Scope tenant I-9 rows to an entity when `requestedForEntityId` matches; single-employment fallback = all rows. */
export function filterI9RowsForEntityEmployment<T extends { data: Record<string, unknown> }>(
  rows: T[],
  rec: EntityEmploymentRecordLike,
  totalEmployments: number,
): T[] {
  const eid = String(rec.entityId || '').trim();
  if (eid) {
    const matched = rows.filter((r) => String(r.data.requestedForEntityId || '').trim() === eid);
    if (matched.length) return matched;
  }
  if (totalEmployments <= 1) return rows;
  return [];
}

export function workerEmploymentEntityPageHeadline(
  state: EmploymentV2HeaderState,
  pathHistorical: boolean,
): string {
  if (pathHistorical) {
    return 'Past onboarding on file';
  }
  switch (state) {
    case 'not_started':
      return 'Onboarding';
    case 'action_required':
      return 'Your action is needed';
    case 'in_progress':
      return 'Onboarding in progress';
    case 'waiting_on_company':
      return 'Waiting on your employer';
    case 'ready':
    case 'on_assignment':
      return 'You’re in good shape';
    case 'terminated':
      return 'Employment ended';
    case 'inactive':
      return 'Inactive';
    default:
      return 'Onboarding';
  }
}
