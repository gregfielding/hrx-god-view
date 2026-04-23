/**
 * View models for `/staff-onboarding` operational queues (recruiter).
 * Queue-first rows — not raw Firestore shapes.
 */

export type OnboardingQueueOwnerLabel = 'You' | 'Worker' | 'System' | 'Vendor';

/** Tab 1 — Tax & payroll / external milestones + Everee step */
export interface OnboardingTaxPayrollQueueRow {
  rowId: string;
  userId: string;
  workerDisplayName: string;
  workerEmail?: string;
  workerPhone?: string;
  workerAvatarUrl?: string;
  pipelineId: string;
  entityKey: string;
  entityLabel: string;
  workerTypeLabel: string;
  employmentModeLabel: string;
  /** TempWorks `i9_employee_section` — same gate as User → Employment → I-9 completed. */
  i9CompleteLabel: string;
  directDepositLabel: string;
  taxFormsLabel: string;
  /** Single bottleneck aligned with sort priority (see `buildTaxPayrollQueueRows`). */
  whyQueuedLabel: string;
  lastActivityLabel: string;
  lastActivityMs: number;
  ownerLabel: OnboardingQueueOwnerLabel;
  /** Lower = more urgent for default sort */
  sortPriority: number;
  profilePath: string;
  /** Set when assignment resolves with a start date (non-cancelled / non-completed). */
  assignmentJobOrderName?: string;
  assignmentJobTitle?: string;
  assignmentStartDateLabel?: string;
  /** C1 Select only — E-Verify status for this row. */
  everifyStatusLabel?: string;
}

/** Tab 2 — E-Verify (Select; assignment optional) */
export interface OnboardingEverifyQueueRow {
  rowId: string;
  userId: string;
  workerDisplayName: string;
  workerEmail?: string;
  workerPhone?: string;
  workerAvatarUrl?: string;
  /** Present when the row is backed by an E-Verify public case; pipeline-only onboarding rows omit this. */
  caseId?: string;
  entityLabel: string;
  employmentContextLabel: string;
  statusLabel: string;
  currentStepLabel: string;
  lastUpdateLabel: string;
  lastUpdateMs: number;
  ownerLabel: OnboardingQueueOwnerLabel;
  sortPriority: number;
  profilePath: string;
  userEmploymentId: string | null;
}

/** Tab 3 — Background screening */
export interface OnboardingBackgroundQueueRow {
  rowId: string;
  userId: string;
  workerDisplayName: string;
  workerEmail?: string;
  workerPhone?: string;
  workerAvatarUrl?: string;
  backgroundCheckId: string;
  entityLabel: string;
  employmentModeLabel: string;
  packageLabel: string;
  statusLabel: string;
  /** Latest webhook: event type and/or provider/service status line; "—" if none recorded. */
  lastWebhookActivityLabel: string;
  /** Formatted `lastWebhookAt`, or `updatedAt` when no webhook yet. */
  lastUpdateTimeLabel: string;
  lastUpdateMs: number;
  ownerLabel: OnboardingQueueOwnerLabel;
  sortPriority: number;
  profilePath: string;
}

export interface OnboardingQueuePaginationState {
  page: number;
  pageSize: number;
  totalCount: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}

/** Optional parent-controlled pagination for `/staff-onboarding` (session-persisted tab + tables). */
export type OnboardingQueuePagination = {
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
};
