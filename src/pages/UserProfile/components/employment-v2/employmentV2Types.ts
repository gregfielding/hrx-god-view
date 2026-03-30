/**
 * Client-side view model for Employment V2 (entity-first readiness).
 * Aggregated from existing Firestore — no new collections.
 */

import type { SignatureEnvelopeStatus } from '../../../../types/phase1cOnboarding';

export type EmploymentEntityKey = 'select' | 'workforce' | 'events';

/** Mirrors entity_employments fields used in UI (see EmploymentTab). */
export interface EntityEmploymentRecord {
  id: string;
  tenantId: string;
  userId: string;
  entityId: string | null;
  entityKey: string;
  entityName: string;
  workerType: string;
  status: string;
  onboardingPipelineId: string;
  onboardingStartedAt?: { toDate: () => Date } | null;
  onboardingCompletedAt?: { toDate: () => Date } | null;
  hiredAt?: { toDate: () => Date } | null;
  terminatedAt?: { toDate: () => Date } | null;
  terminationReason?: string | null;
  everifyRequired?: boolean;
  backgroundRequired?: boolean;
  drugScreenRequired?: boolean;
  everifyStatus?: string;
  backgroundStatus?: string;
  drugScreenStatus?: string;
  updatedAt?: { toDate: () => Date } | null;
}

export interface WorkerOnboardingPipeline {
  id: string;
  userId?: string;
  entityKey?: string;
  entityName?: string;
  status?: string;
  steps?: PipelineStepRow[];
  tasks?: PipelineTaskRow[];
  updatedAt?: unknown;
}

export interface PipelineStepRow {
  id?: string;
  title?: string;
  status?: string;
  applicability?: string;
  updatedAt?: unknown;
  workflowStatus?: string;
  failureReason?: string;
}

export interface PipelineTaskRow {
  id?: string;
  stepId?: string;
  owner?: 'worker' | 'recruiter';
  title?: string;
  status?: string;
}

export interface OnboardingInstanceSnapshot {
  status: string;
  percentComplete: number;
  resolvedDocuments: Array<{
    key?: string;
    docKey?: string;
    title?: string;
    required?: boolean;
    blocking?: boolean;
    mode?: string;
  }>;
  resolvedSteps: Array<{ key: string; title?: string; required?: boolean; blocking?: boolean }>;
  resolvedChecks: Array<{ key: string; title?: string; required?: boolean; blocking?: boolean }>;
  blockedReason?: string | null;
}

export type EmploymentLifecycleStatus =
  | 'not_started'
  | 'onboarding'
  | 'ready'
  | 'active'
  | 'inactive'
  | 'terminated'
  | 'blocked';

export type EmploymentReadinessChip = 'not_started' | 'in_progress' | 'ready' | 'blocked';

export type EmploymentBlockerGroupId =
  | 'work_authorization'
  | 'forms_and_policies'
  | 'payroll'
  | 'screenings'
  | 'assignment_requirements'
  | 'internal_readiness';

export interface EmploymentBlockerItem {
  id: string;
  groupId: EmploymentBlockerGroupId;
  title: string;
  description?: string;
  owner: 'worker' | 'recruiter' | 'system' | 'vendor';
  status: 'pending' | 'blocked' | 'action_needed' | 'error';
  actionLabel?: string;
  actionKind?:
    | 'send_reminder'
    | 'start_everify'
    | 'order_screening'
    | 'open_assignment'
    | 'open_system'
    | 'review';
}

export interface EmploymentAssignmentSummary {
  assignmentId: string;
  jobOrderId?: string | null;
  title?: string | null;
  status?: string | null;
  onboardingInstanceId?: string | null;
  onboardingStatus?: string | null;
  onboardingPercent?: number | null;
  startDate?: string | null;
  resolvedRequirementsSummary?: {
    documentsRequired: number;
    checksRequired: number;
    signaturesPending: number;
  };
}

export interface EmploymentEverifySummary {
  applicable: boolean;
  statusDisplay: string;
  caseCount: number;
  latestCaseId?: string | null;
  actionNeeded?: boolean;
}

export interface EmploymentPayrollSummary {
  applicable: boolean;
  statusDisplay: string;
  portalUrl?: string | null;
  actionNeeded?: boolean;
}

export interface EmploymentScreeningSummary {
  applicable: boolean;
  statusDisplay: string;
  openOrderCount: number;
  actionNeeded?: boolean;
}

export interface EmploymentDocumentsSummary {
  applicable: boolean;
  signedCount: number;
  pendingCount: number;
}

/** Shown in entity header (distinct from internal lifecycle for empty state). */
export type HeaderEmploymentStatus =
  | 'none'
  | 'onboarding'
  | 'ready'
  | 'active'
  | 'inactive'
  | 'terminated'
  | 'blocked';

/** Snapshot of tenants/{tid}/entities/{id} fields used for Settings-driven path. */
export interface EntityTabSettingsSnapshot {
  entityFirestoreId: string;
  entityName: string;
  onboardingWorkflowSteps: Record<string, boolean>;
  workerType: string;
}

/**
 * Row lifecycle for Employment V2 onboarding path (normalized).
 * - completed: finished inside the current entity / pipeline / assignment flow
 * - satisfied_by_existing_record: met by a reusable compliance artifact (valid + equivalent per future policy), not necessarily new work in this flow
 * Detailed “who waits on whom” is carried in statusLabel (often status stays in_progress).
 */
export type OnboardingPathUiStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'satisfied_by_existing_record'
  | 'not_required'
  | 'error';

/** Alias for canonical onboarding row status (same enum as OnboardingPathUiStatus). */
export type EmploymentOnboardingRowStatus = OnboardingPathUiStatus;

/** Subsystem that produced the satisfying artifact (reuse path). */
export type EmploymentOnboardingArtifactSourceType =
  | 'background_check'
  | 'everify'
  | 'payroll'
  | 'document';

/** How broadly the artifact applies (policy / data model). */
export type EmploymentOnboardingArtifactScope = 'worker_global' | 'entity_scoped' | 'assignment_scoped';

export type OnboardingPathOwnerDisplay = 'worker' | 'admin' | 'system' | 'vendor';

export type EmploymentOnboardingSourceType =
  | 'settings_only'
  | 'pipeline_step'
  | 'pipeline_task'
  | 'everify'
  | 'background_check'
  | 'payroll'
  | 'assignment_requirement'
  | 'derived';

export interface EmploymentOnboardingRow {
  rowId: string;
  entityKey: EmploymentEntityKey;
  groupId:
    | 'work_authorization'
    | 'forms_and_policies'
    | 'payroll'
    | 'screenings'
    | 'assignment_requirements'
    | 'internal_readiness';
  stepKey: string;
  label: string;
  sourceType: EmploymentOnboardingSourceType;
  sourceRef?: {
    pipelineStepId?: string;
    taskId?: string;
    caseId?: string;
    backgroundCheckId?: string;
    assignmentId?: string;
  };
  owner: OnboardingPathOwnerDisplay;
  required: boolean;
  blocking: boolean;
  status: EmploymentOnboardingRowStatus;
  statusLabel: string;
  /** True when completion is attributed to a portable compliance artifact (reuse). */
  satisfiedByArtifact?: boolean;
  artifactSourceType?: EmploymentOnboardingArtifactSourceType;
  artifactId?: string | null;
  artifactCompletedAt?: string | null;
  artifactScope?: EmploymentOnboardingArtifactScope | null;
  helperText?: string;
  lastUpdatedAt?: string | null;
}

export interface OnboardingPathGroup {
  groupId: EmploymentOnboardingRow['groupId'];
  title: string;
  doneCount: number;
  totalCount: number;
  /** Count of rows matching isOnboardingPathRowBlocker (required ∧ blocking ∧ ¬done). */
  blockerCount: number;
  rows: EmploymentOnboardingRow[];
}

export interface EmploymentEntityOverview {
  entityKey: EmploymentEntityKey;
  entityLabel: string;

  entityEmployment: EntityEmploymentRecord | null;
  workerOnboarding: WorkerOnboardingPipeline | null;

  /** Resolved entity doc for this tab (Settings), if any. */
  entitySettings: EntityTabSettingsSnapshot | null;

  lifecycleStatus: EmploymentLifecycleStatus;
  readinessChip: EmploymentReadinessChip;

  /** Header: prefer Settings entity name, else C1 label. */
  headerEntityName: string;
  headerEmploymentStatus: HeaderEmploymentStatus;
  /** One-line operational summary (blockers, progress, lifecycle). */
  headerReadinessExplanation: string;
  headerWorkerTypeDisplay: string;

  workerType: 'w2' | '1099' | null;

  percentComplete: number;
  requiredCount: number;
  completedCount: number;

  /**
   * Blockers on the Settings-driven onboarding path only (`required && blocking && !done`).
   * May differ from `blockers.length` (legacy pipeline/payroll list).
   */
  blockerCount: number;
  blockers: EmploymentBlockerItem[];

  assignments: EmploymentAssignmentSummary[];

  /** Settings-driven onboarding path (primary UI). */
  onboardingPath: OnboardingPathGroup[];

  systems: {
    everify?: EmploymentEverifySummary | null;
    payroll?: EmploymentPayrollSummary | null;
    screenings?: EmploymentScreeningSummary | null;
    documents?: EmploymentDocumentsSummary | null;
  };
}

export type { SignatureEnvelopeStatus };
