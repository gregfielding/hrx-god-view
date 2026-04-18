/**
 * Client-side view model for Employment V2 (entity-first readiness).
 * Aggregated from existing Firestore — no new collections.
 */

import type { ExternalOnboardingStepsState } from '../../../../types/externalOnboardingSteps';
import type { SignatureEnvelopeStatus } from '../../../../types/phase1cOnboarding';
import type { EmploymentStateV1 } from '../../../../types/workforceStateV1';
import type { AssignmentReadinessV1Snapshot } from '../../../../types/assignmentReadinessV1';
import type { WorkerPayrollAccount } from '../../../../types/payroll';

export type EmploymentEntityKey = 'select' | 'workforce' | 'events';

/**
 * Mirrors entity_employments fields used in UI (see EmploymentTab).
 * Keep relationship/summary fields here; do not store TempWorks/external onboarding rows
 * as primary columns — use `worker_onboarding.externalOnboardingSteps` (optional derived
 * mirrors only if a consumer cannot load the pipeline doc).
 */
export interface EntityEmploymentRecord {
  id: string;
  tenantId: string;
  userId: string;
  entityId: string | null;
  entityKey: string;
  entityName: string;
  workerType: string;
  status: string;
  /** v1 operating state — mirrors `status` for this migration; server-authoritative. */
  employmentState?: EmploymentStateV1 | string;
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
  /**
   * Denormalized from canonical onboarding completion (Tax/Identity excl. E-Verify, Handbook/Policies, Payroll).
   * Updated by Cloud Functions when `worker_onboarding` changes; may lag slightly behind the live path in UI.
   */
  onboardingComplete?: boolean;
  /**
   * Onboarding completion engine section snapshots (Firestore). `payrollStatus` here is the **Payroll section**
   * of the entity onboarding checklist — not `worker_payroll_accounts.payrollStatus`.
   */
  taxIdentityStatus?: EntityOnboardingSectionStatus | string | null;
  handbookStatus?: EntityOnboardingSectionStatus | string | null;
  payrollStatus?: EntityOnboardingSectionStatus | string | null;
  /** Gating recruiter follow-up slice of the onboarding engine (v1: always complete / unused). */
  recruiterFollowUpGatingStatus?: EntityOnboardingSectionStatus | string | null;
  /** Onboarding lifecycle phase on the employment record (not the same as `status`). */
  onboardingPhase?: string | null;
  /**
   * How this entity employment was opened. `on_call_pool` = pre-assignment / labor-pool hire (no assignment required).
   * Omitted or `assignment_based` = legacy / assignment-driven path.
   */
  employmentEntryMode?: 'assignment_based' | 'on_call_pool' | string | null;
  /** Admin note when starting on-call employment. */
  onCallNote?: string | null;
  onCallScreeningPackageId?: string | null;
  onCallScreeningPackageName?: string | null;
  onCallStartedAt?: { toDate: () => Date } | null;
  /**
   * When set, recruiter confirmed I-9 supporting docs are satisfied outside HRX uploads — hide worker upload UI; grey admin actions.
   */
  i9SupportingDocumentsManualCompleteAt?: { toDate: () => Date } | null;
  i9SupportingDocumentsManualCompleteBy?: string | null;
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
  /**
   * TempWorks / external HRIS milestones (one field object per business stepKey).
   * Canonical runtime store; parse with `parseExternalOnboardingSteps` before logic.
   */
  externalOnboardingSteps?: ExternalOnboardingStepsState | Record<string, unknown>;
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
  /** Persisted canonical readiness (`assignments.assignmentReadinessV1`) when present. */
  assignmentReadinessV1?: AssignmentReadinessV1Snapshot | null;
}

export interface EmploymentEverifySummary {
  applicable: boolean;
  statusDisplay: string;
  /** Normalized HRX status from latest case (`public.status` / `status`) for logic and chips. */
  latestHrxStatus?: string | null;
  caseCount: number;
  latestCaseId?: string | null;
  actionNeeded?: boolean;
}

export interface EmploymentPayrollSummary {
  applicable: boolean;
  statusDisplay: string;
  /** Worker-specific link from `worker_payroll_accounts.payrollAccountLink` when present. */
  portalUrl?: string | null;
  /** Entity `payrollSettings.onboardingUrl` — first-time TempWorks (etc.) setup. */
  entityOnboardingUrl?: string | null;
  /** Entity `payrollSettings.portalUrl` — login / pay history for workers already on payroll. */
  entityPortalUrl?: string | null;
  actionNeeded?: boolean;
}

export interface EmploymentScreeningSummary {
  applicable: boolean;
  statusDisplay: string;
  openOrderCount: number;
  actionNeeded?: boolean;
  /** Secondary line (e.g. legacy open-order counts) under canonical `statusDisplay`. */
  recordDetail?: string | null;
}

export interface EmploymentDocumentsSummary {
  applicable: boolean;
  signedCount: number;
  pendingCount: number;
  /** From `assignmentReadinessV1` sections when primary assignment has persisted readiness. */
  canonicalStatusLine?: string | null;
}

/**
 * Legacy header mapping from `EmploymentLifecycleStatus` (internal onboarding graph).
 * @deprecated For **header or top-level employment status chips**, use `EmploymentV2HeaderState` /
 * `overview.employmentHeaderState` only. Kept for `EmploymentEntitySummaryCard` / API compatibility until
 * convergence; do not reference in new UI (ESLint warns in pages/components/hooks).
 */
export type HeaderEmploymentStatus =
  | 'none'
  | 'onboarding'
  | 'ready'
  | 'active'
  | 'inactive'
  | 'terminated'
  | 'blocked';

/**
 * **Canonical UX model for Employment V2 primary header** (admin entity panel + worker My Employment).
 * Derived by `deriveEmploymentHeaderState` — not stored on Firestore. See module doc in
 * `deriveEmploymentHeaderState.ts` for legacy bridges (e.g. `entity_employments.status === 'active'` → `on_assignment`).
 */
export type EmploymentV2HeaderState =
  | 'not_started'
  | 'in_progress'
  | 'action_required'
  | 'waiting_on_company'
  | 'ready'
  | 'on_assignment'
  /** Terminal employment row states (from `entity_employments.status`). */
  | 'terminated'
  | 'inactive';

/** Snapshot of tenants/{tid}/entities/{id} fields used for Settings-driven path. */
export interface EntityTabSettingsSnapshot {
  entityFirestoreId: string;
  entityName: string;
  onboardingWorkflowSteps: Record<string, boolean>;
  workerType: string;
  /** From `entities.payrollSettings` when TempWorks (or similar) is configured. */
  payrollOnboardingUrl?: string | null;
  payrollPortalUrl?: string | null;
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

/**
 * Onboarding completion engine: one status per checklist section (Tax & Identity, Handbook & Policies, Payroll).
 * Derived from consolidated path rows + `externalOnboardingSteps` (TempWorks today; Everee can feed the same shape).
 */
export type EntityOnboardingSectionStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending_review'
  | 'complete';

export interface EntityOnboardingEngineResult {
  taxIdentityStatus: EntityOnboardingSectionStatus;
  handbookStatus: EntityOnboardingSectionStatus;
  payrollStatus: EntityOnboardingSectionStatus;
  /**
   * Recruiter follow-up rows marked `isGating` on the consolidated checklist (v1: none).
   * When `complete`, all gating follow-ups are satisfied.
   */
  recruiterFollowUpGatingStatus: EntityOnboardingSectionStatus;
  onboardingComplete: boolean;
  pendingRequiredItems: Array<{
    bucket: 'tax_and_identity' | 'handbook_and_policies' | 'payroll' | 'recruiter_followup';
    rowLabel: string;
    rowId: string;
    status: EmploymentOnboardingRowStatus;
  }>;
}

/** Subsystem that produced the satisfying artifact (reuse path). */
export type EmploymentOnboardingArtifactSourceType =
  | 'background_check'
  | 'everify'
  | 'payroll'
  | 'document';

/** How broadly the artifact applies (policy / data model). */
export type EmploymentOnboardingArtifactScope = 'worker_global' | 'entity_scoped' | 'assignment_scoped';

/** Who is accountable for completing / driving this milestone (normalized; use `recruiter` not legacy `admin`). */
export type EmploymentOnboardingPathRowOwner = 'worker' | 'recruiter' | 'system' | 'vendor';

/**
 * Who should see this row in a given UI surface.
 * - `both`: worker + admin paths (default for most Settings-driven milestones).
 * - `worker`: worker-only slice (rare; admin full path still may choose to show).
 * - `admin`: recruiter/admin-only (e.g. purely internal ops rows if modeled separately).
 * - `internal`: staff queue / ops visibility only — hide from worker onboarding path.
 */
export type EmploymentOnboardingRowAudience = 'worker' | 'admin' | 'both' | 'internal';

/**
 * Who can take the primary in-app next step for this row (CTAs, deep links, callables).
 * `either` = both parties have a meaningful action (e.g. assignment package).
 */
export type EmploymentOnboardingRowActionableBy = 'worker' | 'recruiter' | 'none' | 'either';

export type EmploymentOnboardingSourceType =
  | 'settings_only'
  | 'pipeline_step'
  | 'pipeline_task'
  | 'everify'
  | 'background_check'
  | 'payroll'
  | 'assignment_requirement'
  | 'derived'
  | 'external_onboarding';

/**
 * Who drove an activity line (normalized for copy + UI).
 * Legacy values `recruiter` / `vendor` may still appear from older clients; map in UI helpers.
 */
export type EmploymentOnboardingNarrativeActor =
  | 'worker'
  | 'hiring_team'
  | 'screening_partner'
  | 'verification_service'
  | 'system'
  | 'recruiter'
  | 'vendor';

export interface EmploymentOnboardingNarrativeEvent {
  message: string;
  timestamp?: Date;
  type?: EmploymentOnboardingNarrativeActor;
}

export interface EmploymentOnboardingNarrative {
  summary: string;
  events?: EmploymentOnboardingNarrativeEvent[];
}

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
    /** worker_onboarding.externalOnboardingSteps key when row is driven by TempWorks/HRIS state. */
    externalStepKey?: string;
    /**
     * Stable requirement id for CTAs after merge (e.g. `e_verify`, `background_check`, or same as `externalStepKey`
     * for TempWorks-mapped Settings steps). Path-builder only — not stored in Firestore.
     */
    requirementKey?: string;
    /** When this row is the result of merging siblings (e.g. E-Verify pair), their Settings `stepKey` values. */
    mergedFromStepKeys?: string[];
  };
  owner: EmploymentOnboardingPathRowOwner;
  audience: EmploymentOnboardingRowAudience;
  actionableBy: EmploymentOnboardingRowActionableBy;
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

  /**
   * Present after `enrichOnboardingPathGroupsWithNarratives` — `summary` is always non-empty.
   */
  narrative?: EmploymentOnboardingNarrative;

  /**
   * Worker My Employment: grouping key (same as collapse key — e.g. `pipe:i9` or `assign:<rowId>`).
   * Set when rows are built or grouped for the worker path.
   */
  workerGroupKey?: string;
  /** Worker UI: source rows collapsed into this line (omit when not merged); debug expandable only. */
  workerGroupDetailRows?: EmploymentOnboardingRow[];
  /**
   * Pre-merge path rows for this requirement (narrative + “View activity”). Set in path builder only.
   */
  requirementDetailRows?: EmploymentOnboardingRow[];
  /** Worker UI: coarse `sourceRef.pipelineStepId` when group is pipeline-based. */
  workerGroupPipelineStepId?: string | null;
}

/** Active Assignment Requirements + entity screening milestones (IA: job-specific vs relationship path). */
export type AssignmentRequirementVmCategory =
  | 'entity_screening_milestone'
  | 'check'
  | 'certification'
  | 'upload'
  | 'document'
  | 'admin_step'
  | 'screening_order';

export interface AssignmentRequirementItemVm {
  id: string;
  category: AssignmentRequirementVmCategory;
  title: string;
  statusLabel: string;
  blocking: boolean;
  /** Present for rows derived from the onboarding path (actions, narrative). */
  pathRow?: EmploymentOnboardingRow;
  /** Synthetic line (e.g. screening automation dispatch) when there is no path row narrative. */
  inlineExplainer?: string;
}

export interface AssignmentRequirementsViewModel {
  entityKey: EmploymentEntityKey;
  hasPrimaryAssignment: boolean;
  primaryAssignmentId: string | null;
  primaryJobTitle: string | null;
  primaryJobOrderId: string | null;
  primaryAssignmentStatus: string | null;
  onboardingInstanceId: string | null;
  onboardingPackageStatus: string | null;
  onboardingPercentComplete: number | null;
  /** Settings-driven screening milestones (relationship policy), moved out of entity path UI. */
  entityScreeningMilestones: AssignmentRequirementItemVm[];
  requiredChecks: AssignmentRequirementItemVm[];
  requiredCertifications: AssignmentRequirementItemVm[];
  requiredUploads: AssignmentRequirementItemVm[];
  assignmentDocuments: AssignmentRequirementItemVm[];
  adminSteps: AssignmentRequirementItemVm[];
  /** AccuSource / tenant screening orders tied to this entity’s job orders. */
  backgroundOrdersLinked: AssignmentRequirementItemVm[];
  openBlockerCount: number;
  /** Persisted readiness for primary assignment (subset of `EmploymentAssignmentSummary`). */
  primaryAssignmentReadinessV1?: AssignmentReadinessV1Snapshot | null;
  /** Top-line copy from canonical readiness (summary or state label). */
  primaryCanonicalReadinessHeadline?: string | null;
  primaryCanonicalScreeningLine?: string | null;
  primaryCanonicalPackageLine?: string | null;
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

  /**
   * @deprecated Derived only from `employmentHeaderState` (`lifecycleStatusFromEmploymentHeaderState`).
   * Do not use for headers or chips — use `employmentHeaderState` + `employmentHeaderStateLabel`.
   */
  lifecycleStatus: EmploymentLifecycleStatus;
  readinessChip: EmploymentReadinessChip;

  /** Header: prefer Settings entity name, else C1 label. */
  headerEntityName: string;
  headerEmploymentStatus: HeaderEmploymentStatus;
  /** Canonical header chip state (preferred over `headerEmploymentStatus` for header UX). */
  employmentHeaderState: EmploymentV2HeaderState;
  /**
   * True when there is a non-terminal assignment, employment `blocked`, on-call onboarding in progress
   * (`status === onboarding` + `employmentEntryMode === on_call_pool`), or legacy `active` that is not
   * “pool-ready only” (`active` + `on_call_pool` + no live assignment → false so the relationship path is not urgent).
   * When false, stale `worker_onboarding` / path rows are treated as historical for header and blocker UX.
   */
  hasOpenOnboardingDemand: boolean;
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

  /**
   * Relationship onboarding path only (work auth, forms, payroll, internal readiness).
   * Screenings + assignment package rows live in `assignmentRequirementsViewModel`.
   */
  onboardingPath: OnboardingPathGroup[];

  /**
   * Recruiter checklist source: relationship path plus assignment package rows when a live assignment exists.
   */
  onboardingChecklistGroups: OnboardingPathGroup[];

  /**
   * Deterministic onboarding completion engine (live path + external steps). Same rules as `entity_employments`
   * fields written by the worker_onboarding sync trigger.
   */
  onboardingEngine: EntityOnboardingEngineResult;
  /**
   * True when all three section statuses are `complete` (same as `onboardingEngine.onboardingComplete`).
   */
  onboardingComplete: boolean;
  /** @deprecated Use `onboardingEngine.pendingRequiredItems`. */
  onboardingCompletionPendingItems: EntityOnboardingEngineResult['pendingRequiredItems'];

  /** Primary assignment package + entity screening milestones + linked screening orders. */
  assignmentRequirementsViewModel: AssignmentRequirementsViewModel;

  systems: {
    everify?: EmploymentEverifySummary | null;
    payroll?: EmploymentPayrollSummary | null;
    screenings?: EmploymentScreeningSummary | null;
    documents?: EmploymentDocumentsSummary | null;
  };

  /** Worker payroll account doc for this entity tab (invite timestamps, status). */
  workerPayrollAccount: (WorkerPayrollAccount & { id: string }) | null;

  /**
   * Select-entity E-Verify cases (from `everify_cases`) for audit-style detail in onboarding UI.
   * Empty when not Select or when no cases match the resolved Select `entityId`.
   */
  everifyCaseBriefs: import('../../../../utils/employmentOnboardingNarrative').EverifyCaseNarrativeBrief[];
}

export type { SignatureEnvelopeStatus };
