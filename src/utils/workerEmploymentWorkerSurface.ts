/**
 * Worker-facing employment hub + entity page: simple status labels and hints
 * (maps from canonical EmploymentV2HeaderState / I-9 view model — no backend changes).
 */
import type { EmploymentV2HeaderState } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { I9EmploymentDocsSubstatus } from './i9SupportingDocumentsViewModel';

/** Optional `t` from `useT()` / `src/i18n` for worker-facing pages. */
export type WorkerEmploymentTranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

function tx(
  tr: WorkerEmploymentTranslateFn | undefined,
  key: string,
  en: string,
  params?: Record<string, string | number>,
): string {
  if (!tr) {
    if (!params) return en;
    return en.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    );
  }
  const v = tr(key, params);
  if (v !== key) return v;
  if (!params) return en;
  return en.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

export interface EntityEmploymentRecordLike {
  entityId?: string | null;
  /** When set, used to suppress worker I-9 supporting-doc UX for C1 Events (`events`). */
  entityKey?: string | null;
}

/**
 * C1 Events LLC (`entityKey` `events`) does not use the worker I-9 supporting-document upload flow.
 * C1 Select / C1 Workforce (`select` / `workforce`) do.
 */
export function workerEmploymentEntityKeySkipsWorkerI9SupportingDocuments(
  entityKey: string | null | undefined,
): boolean {
  return String(entityKey || '').trim().toLowerCase() === 'events';
}

/** Profile list + entity summary chip — plain language, no internal jargon. */
export function workerEmploymentSurfaceStatusLabel(
  state: EmploymentV2HeaderState,
  tr?: WorkerEmploymentTranslateFn,
): string {
  switch (state) {
    case 'not_started':
      return tx(tr, 'workerEmploymentHub.statusNotStarted', 'Not started');
    case 'in_progress':
      return tx(tr, 'workerEmploymentHub.statusUnderReview', 'Under review');
    case 'action_required':
      return tx(tr, 'workerEmploymentHub.statusActionNeeded', 'Action needed');
    case 'waiting_on_company':
      return tx(tr, 'workerEmploymentHub.statusWaitingOnEmployer', 'Waiting on employer');
    case 'ready':
    case 'on_assignment':
      return tx(tr, 'workerEmploymentHub.statusComplete', 'Complete');
    case 'terminated':
      return tx(tr, 'workerEmploymentHub.statusEnded', 'Ended');
    case 'inactive':
      return tx(tr, 'workerEmploymentHub.statusInactive', 'Inactive');
    default:
      return tx(tr, 'workerEmploymentHub.statusUnderReview', 'Under review');
  }
}

export type WorkerI9AttentionHint = 'none' | 'upload' | 'under_review' | 'rejected' | 'complete' | 'action_needed';

export function i9SubstatusToWorkerHint(sub: I9EmploymentDocsSubstatus): WorkerI9AttentionHint {
  switch (sub) {
    case 'not_started':
      return 'upload';
    case 'under_review':
      return 'under_review';
    case 'action_needed':
      return 'action_needed';
    case 'complete':
      return 'complete';
    default:
      return 'none';
  }
}

/** One-line next step on profile employment row when I-9 is scoped to this entity. */
export function workerEmploymentHubNextStepLine(
  args: {
    headerState: EmploymentV2HeaderState;
    i9Hint: WorkerI9AttentionHint;
    hasOpenOnboardingDemand: boolean;
    pipelineSummary: string | null;
    /** When payroll I-9 is verified, supporting-document slots are optional — do not nudge upload here. */
    i9EmployeeSectionComplete?: boolean;
  },
  tr?: WorkerEmploymentTranslateFn,
): string | null {
  const { headerState, i9Hint, hasOpenOnboardingDemand, pipelineSummary, i9EmployeeSectionComplete } = args;

  if (i9Hint === 'upload' && i9EmployeeSectionComplete !== true) {
    return tx(tr, 'workerEmploymentHub.nextUploadI9', 'Upload I-9 documents');
  }
  if (i9Hint === 'action_needed') {
    return tx(tr, 'workerEmploymentHub.nextFinishReplaceI9', 'Finish or replace I-9 documents');
  }
  if (i9Hint === 'rejected') {
    return tx(tr, 'workerEmploymentHub.nextReplaceRejectedI9', 'Replace a rejected I-9 document');
  }
  if (i9Hint === 'under_review') {
    return tx(tr, 'workerEmploymentHub.nextI9UnderReview', 'I-9 documents under review');
  }

  if (headerState === 'waiting_on_company') {
    return tx(tr, 'workerEmploymentHub.nextWaitingForEmployer', 'Waiting for your employer');
  }
  if (headerState === 'action_required' && hasOpenOnboardingDemand) {
    return tx(tr, 'workerEmploymentHub.nextFinishTasks', 'Finish tasks on this employment page');
  }
  if (headerState === 'in_progress' && hasOpenOnboardingDemand) {
    return pipelineSummary || tx(tr, 'workerEmploymentHub.nextContinueOnboarding', 'Continue onboarding');
  }
  if (headerState === 'not_started' && hasOpenOnboardingDemand) {
    return tx(tr, 'workerEmploymentHub.nextGetStarted', 'Get started on this employment page');
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

export function workerPayrollAccountPhase(
  payrollAccountStatus: string | undefined | null,
): 'not_started' | 'in_progress' | 'complete' {
  const s = String(payrollAccountStatus || '').toLowerCase();
  if (s === 'complete') return 'complete';
  if (
    s === 'invite_sent' ||
    s === 'account_created' ||
    s === 'in_progress' ||
    s === 'pending' ||
    s === 'not_started'
  ) {
    return s === 'not_started' ? 'not_started' : 'in_progress';
  }
  if (!s) return 'not_started';
  return 'in_progress';
}

/** Worker-visible payroll step status (no “invite sent” wording). */
export function workerPayrollSetupStatusLabel(
  payrollAccountStatus: string | undefined | null,
  tr?: WorkerEmploymentTranslateFn,
): string {
  const phase = workerPayrollAccountPhase(payrollAccountStatus);
  if (phase === 'complete') return tx(tr, 'workerEmploymentHub.payrollComplete', 'Complete');
  if (phase === 'not_started') return tx(tr, 'workerEmploymentHub.payrollNotStarted', 'Not started');
  return tx(tr, 'workerEmploymentHub.payrollInProgress', 'In progress');
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
  if (workerEmploymentEntityKeySkipsWorkerI9SupportingDocuments(rec.entityKey)) {
    return [];
  }
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
  tr?: WorkerEmploymentTranslateFn,
): string {
  if (pathHistorical) {
    return tx(tr, 'workerEmploymentHub.headlinePastOnFile', 'Past onboarding on file');
  }
  switch (state) {
    case 'not_started':
      return tx(tr, 'workerEmploymentHub.headlineOnboarding', 'Onboarding');
    case 'action_required':
      return tx(tr, 'workerEmploymentHub.headlineActionNeeded', 'Your action is needed');
    case 'in_progress':
      return tx(tr, 'workerEmploymentHub.headlineInProgress', 'Onboarding in progress');
    case 'waiting_on_company':
      return tx(tr, 'workerEmploymentHub.headlineWaitingEmployer', 'Waiting on your employer');
    case 'ready':
    case 'on_assignment':
      return tx(tr, 'workerEmploymentHub.headlineGoodShape', 'You’re in good shape');
    case 'terminated':
      return tx(tr, 'workerEmploymentHub.headlineEmploymentEnded', 'Employment ended');
    case 'inactive':
      return tx(tr, 'workerEmploymentHub.headlineInactive', 'Inactive');
    default:
      return tx(tr, 'workerEmploymentHub.headlineOnboarding', 'Onboarding');
  }
}
