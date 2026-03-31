/**
 * Explicit mapping: Settings workflow step keys → runtime status sources for Employment V2.
 * Inspectable single source of truth. Optional field `worker_onboarding.externalOnboardingSteps`
 * is read when present (TempWorks / HRIS); coarse `steps[]` remains for legacy pipeline flow.
 *
 * Status priority (per row): subsystem signal → pipeline step → settings-only (not_started / not_required).
 */

import type {
  EmploymentEverifySummary,
  EmploymentEntityKey,
  EmploymentOnboardingArtifactScope,
  EmploymentOnboardingArtifactSourceType,
  EmploymentOnboardingRowActionableBy,
  EmploymentOnboardingRowAudience,
  EmploymentOnboardingPathRowOwner,
  EmploymentOnboardingRowStatus,
  EmploymentOnboardingSourceType,
  PipelineStepRow,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { ExternalOnboardingStepsState } from '../types/externalOnboardingSteps';
import type { WorkerPayrollAccount } from '../types/payroll';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { WorkflowUiGroupId } from './onboardingWorkflowStepCatalog';
import { ONBOARDING_WORKFLOW_STEPS } from './onboardingWorkflowStepCatalog';
import { evaluateSelectEverifyReuse, findPortableBackgroundArtifact } from './employmentOnboardingArtifactPolicy';
import {
  externalStepAppliesToWorkerType,
  externalStepKeyForWorkflowStep,
  externalStepLabel,
  lastUpdatedIsoForExternalStep,
  type ExternalOnboardingWorkerTypeNorm,
} from './externalOnboardingSteps';
import { labelsForExternalOnboardingRecord } from './employmentOnboardingPathAudienceLabels';

/** Whether this row’s status is row-specific or backed by a coarse/shared signal. */
export type StepStatusFidelity = 'dedicated' | 'shared_pipeline' | 'subsystem_preferred';

export interface WorkflowStepRuntimeDefinition {
  stepKey: string;
  groupId: WorkflowUiGroupId;
  label: string;
  owner: EmploymentOnboardingPathRowOwner;
  audience: EmploymentOnboardingRowAudience;
  actionableBy: EmploymentOnboardingRowActionableBy;
  /** When no pipeline step exists yet: treat row as required (catalog default). Overridden by pipeline `applicability === not_required`. */
  defaultRequired: boolean;
  /** Catalog heuristic (`isWorkflowStepBlocking`); overridden to true when derived row status is `error`. */
  defaultBlocking: boolean;
  /** Coarse `worker_onboarding.steps[].id` when present. */
  pipelineStepId: string | null;
  /** Primary “kind” of data shown to the user for this row. */
  primarySourceType: EmploymentOnboardingSourceType;
  fidelity: StepStatusFidelity;
  /** Always shown when fidelity is shared_pipeline, or appended when falling back from subsystem. */
  fidelityExplanation: string;
  /** Where we try to read status, in order. */
  resolutionChain: readonly ('pipeline' | 'everify' | 'payroll' | 'background')[];
}

const LABEL_BY_KEY = Object.fromEntries(ONBOARDING_WORKFLOW_STEPS.map((s) => [s.id, s.label])) as Record<
  string,
  string
>;

const SHARED_FORMS =
  'Several form milestones share one status until each has its own live update.';
const SHARED_I9 =
  'I-9 milestones share one status until sent and completed are tracked separately.';
const SHARED_EVEREE =
  'Payroll milestones may share one status until each step updates on its own.';
const SHARED_BG_PIPELINE =
  'Screening status is summarized here; the vendor order may show more detail.';

function def(
  stepKey: string,
  partial: Omit<WorkflowStepRuntimeDefinition, 'stepKey' | 'label'> & { label?: string }
): WorkflowStepRuntimeDefinition {
  return {
    stepKey,
    label: partial.label ?? LABEL_BY_KEY[stepKey] ?? stepKey,
    groupId: partial.groupId,
    owner: partial.owner,
    audience: partial.audience,
    actionableBy: partial.actionableBy,
    defaultRequired: partial.defaultRequired,
    defaultBlocking: partial.defaultBlocking,
    pipelineStepId: partial.pipelineStepId,
    primarySourceType: partial.primarySourceType,
    fidelity: partial.fidelity,
    fidelityExplanation: partial.fidelityExplanation,
    resolutionChain: partial.resolutionChain,
  };
}

/**
 * One explicit definition per supported `entities.onboardingWorkflowSteps` key.
 */
export const WORKFLOW_STEP_RUNTIME_MAP: Record<string, WorkflowStepRuntimeDefinition> = {
  ic_agreement_sent: def('ic_agreement_sent', {
    groupId: 'forms_and_policies',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  ic_agreement_signed: def('ic_agreement_signed', {
    groupId: 'forms_and_policies',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  '1099_sent': def('1099_sent', {
    groupId: 'forms_and_policies',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  '1099_completed': def('1099_completed', {
    groupId: 'forms_and_policies',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  payroll_invite_sent: def('payroll_invite_sent', {
    groupId: 'payroll',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'everee',
    primarySourceType: 'payroll',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'Prefers worker payroll account status when present; otherwise falls back to the everee pipeline step.',
    resolutionChain: ['payroll', 'pipeline'],
  }),
  payroll_setup_complete: def('payroll_setup_complete', {
    groupId: 'payroll',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'everee',
    primarySourceType: 'payroll',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'Prefers worker payroll account completion; otherwise falls back to the everee pipeline step.',
    resolutionChain: ['payroll', 'pipeline'],
  }),
  w9_received: def('w9_received', {
    groupId: 'forms_and_policies',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  direct_deposit_contractor: def('direct_deposit_contractor', {
    groupId: 'payroll',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'everee',
    primarySourceType: 'payroll',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'Uses payroll account direct-deposit / banking signals when available; otherwise everee pipeline step.',
    resolutionChain: ['payroll', 'pipeline'],
  }),
  handbook_sent: def('handbook_sent', {
    groupId: 'forms_and_policies',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  handbook_signed: def('handbook_signed', {
    groupId: 'forms_and_policies',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  i9_sent: def('i9_sent', {
    groupId: 'work_authorization',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'i9',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_I9,
    resolutionChain: ['pipeline'],
  }),
  i9_completed: def('i9_completed', {
    groupId: 'work_authorization',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'i9',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_I9,
    resolutionChain: ['pipeline'],
  }),
  everify_sent: def('everify_sent', {
    groupId: 'work_authorization',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'e_verify',
    primarySourceType: 'everify',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'On C1 Select, prefers latest E-Verify case status when cases exist; otherwise e_verify pipeline step.',
    resolutionChain: ['everify', 'pipeline'],
  }),
  everify_completed: def('everify_completed', {
    groupId: 'work_authorization',
    owner: 'system',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'e_verify',
    primarySourceType: 'everify',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'On C1 Select, prefers E-Verify case outcome when available; otherwise e_verify pipeline step.',
    resolutionChain: ['everify', 'pipeline'],
  }),
  w4_sent: def('w4_sent', {
    groupId: 'forms_and_policies',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  w4_completed: def('w4_completed', {
    groupId: 'forms_and_policies',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  direct_deposit_w2: def('direct_deposit_w2', {
    groupId: 'payroll',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'everee',
    primarySourceType: 'payroll',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'Uses payroll account direct-deposit signals when available; otherwise everee pipeline step.',
    resolutionChain: ['payroll', 'pipeline'],
  }),
  policy_acknowledgments: def('policy_acknowledgments', {
    groupId: 'forms_and_policies',
    owner: 'worker',
    audience: 'both',
    actionableBy: 'worker',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'onboarding_forms',
    primarySourceType: 'pipeline_step',
    fidelity: 'shared_pipeline',
    fidelityExplanation: SHARED_FORMS,
    resolutionChain: ['pipeline'],
  }),
  background_initiated: def('background_initiated', {
    groupId: 'screenings',
    owner: 'recruiter',
    audience: 'both',
    actionableBy: 'recruiter',
    defaultRequired: true,
    defaultBlocking: false,
    pipelineStepId: 'background_check',
    primarySourceType: 'background_check',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'Prefers AccuSource / backgroundChecks records for this entity’s assignments; falls back to background_check pipeline step.',
    resolutionChain: ['background', 'pipeline'],
  }),
  background_completed: def('background_completed', {
    groupId: 'screenings',
    owner: 'vendor',
    audience: 'both',
    actionableBy: 'none',
    defaultRequired: true,
    defaultBlocking: true,
    pipelineStepId: 'background_check',
    primarySourceType: 'background_check',
    fidelity: 'subsystem_preferred',
    fidelityExplanation:
      'Prefers background check records when present; falls back to background_check pipeline step.',
    resolutionChain: ['background', 'pipeline'],
  }),
};

export function getWorkflowStepRuntimeDefinition(stepKey: string): WorkflowStepRuntimeDefinition | undefined {
  return WORKFLOW_STEP_RUNTIME_MAP[stepKey];
}

function getPipelineStep(
  steps: PipelineStepRow[] | undefined,
  id: string | null
): PipelineStepRow | undefined {
  if (!id || !Array.isArray(steps)) return undefined;
  return steps.find((s) => String(s.id || '') === id);
}

export function mapPipelineStepToRowStatus(step: PipelineStepRow | undefined): {
  status: EmploymentOnboardingRowStatus;
  statusLabel: string;
} {
  if (!step) {
    return { status: 'not_started', statusLabel: 'Not started' };
  }
  const app = String(step.applicability || '').toLowerCase();
  if (app === 'not_required') {
    return { status: 'not_required', statusLabel: 'Not required' };
  }
  const st = String(step.status || '').toLowerCase();
  if (st === 'complete' || st === 'completed') {
    return { status: 'completed', statusLabel: 'Completed' };
  }
  if (st === 'blocked' || st === 'failed' || st === 'error') {
    return { status: 'error', statusLabel: step.failureReason ? String(step.failureReason) : 'Error' };
  }
  if (st === 'skipped') {
    return { status: 'not_required', statusLabel: 'Skipped (not required)' };
  }
  if (st === 'not_started') {
    return { status: 'not_started', statusLabel: 'Not started' };
  }

  const ws = String(step.workflowStatus || '').toLowerCase();
  if (ws.includes('awaiting_worker') || ws.includes('applicant') || ws.includes('awaiting_applicant')) {
    return {
      status: 'in_progress',
      statusLabel: step.workflowStatus ? String(step.workflowStatus) : 'Waiting on worker',
    };
  }
  if (
    ws.includes('awaiting_employer') ||
    ws.includes('pending_package') ||
    ws.includes('package_selected') ||
    ws.includes('ordered')
  ) {
    return {
      status: 'in_progress',
      statusLabel: step.workflowStatus ? String(step.workflowStatus) : 'Waiting on admin',
    };
  }
  if (ws.includes('vendor') || ws.includes('provider') || ws.includes('dhs')) {
    return {
      status: 'in_progress',
      statusLabel: step.workflowStatus ? String(step.workflowStatus) : 'Waiting on vendor',
    };
  }

  return {
    status: 'in_progress',
    statusLabel: step.workflowStatus || step.title || 'In progress',
  };
}

function timestampToIso(t: unknown): string | null {
  if (t == null) return null;
  if (typeof t === 'object' && t !== null && 'toDate' in t && typeof (t as { toDate: () => Date }).toDate === 'function') {
    const d = (t as { toDate: () => Date }).toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof t === 'object' && t !== null && 'seconds' in t) {
    const sec = (t as { seconds: number }).seconds;
    if (typeof sec === 'number') return new Date(sec * 1000).toISOString();
  }
  return null;
}

function statusFromEverifySummary(
  summary: EmploymentEverifySummary | null | undefined,
  stepKey: string
): { status: EmploymentOnboardingRowStatus; statusLabel: string; used: boolean } | null {
  if (!summary?.applicable || summary.caseCount <= 0) return null;
  const disp = String(summary.statusDisplay || '—');
  const lower = disp.toLowerCase();
  if (['closed', 'authorized', 'completed', 'final_nonconfirmation', 'closure_duplicate'].some((x) => lower.includes(x))) {
    return {
      status: 'completed',
      statusLabel: disp,
      used: true,
    };
  }
  if (lower.includes('error') || (lower.includes('tentative') && lower.includes('nonconfirmation'))) {
    return { status: 'error', statusLabel: disp, used: true };
  }
  if (stepKey === 'everify_sent') {
    return {
      status: 'in_progress',
      statusLabel: disp,
      used: true,
    };
  }
  // everify_completed
  return {
    status: summary.actionNeeded ? 'in_progress' : 'completed',
    statusLabel: disp,
    used: true,
  };
}

const TERMINAL_BG = new Set(['completed', 'canceled', 'error']);

function statusFromBackgroundRecords(
  checks: BackgroundCheckRecord[],
  stepKey: string,
  pipelineStep: PipelineStepRow | undefined
): { status: EmploymentOnboardingRowStatus; statusLabel: string; used: boolean; lastUpdatedAt: string | null } {
  if (checks.length === 0) {
    return { status: 'not_started', statusLabel: 'No background orders for this entity', used: false, lastUpdatedAt: null };
  }
  const latest = [...checks].sort((a, b) => {
    const ta = timestampToIso(a.updatedAt) || '';
    const tb = timestampToIso(b.updatedAt) || '';
    return tb.localeCompare(ta);
  })[0];
  const lastUpdatedAt = timestampToIso(latest.updatedAt);
  const statuses = checks.map((c) => String(c.hrxStatus || '').toLowerCase());
  const anyError = statuses.some((s) => s === 'error');
  if (anyError) {
    return {
      status: 'error',
      statusLabel: 'One or more checks reported an error',
      used: true,
      lastUpdatedAt,
    };
  }
  const allTerminal = checks.every((c) => TERMINAL_BG.has(String(c.hrxStatus || '').toLowerCase()));
  if (stepKey === 'background_completed') {
    const allCompleted = checks.every((c) => String(c.hrxStatus || '').toLowerCase() === 'completed');
    if (allCompleted) {
      return { status: 'completed', statusLabel: 'All checks completed', used: true, lastUpdatedAt };
    }
    if (allTerminal && !allCompleted) {
      return { status: 'error', statusLabel: 'Closed without completion', used: true, lastUpdatedAt };
    }
    return {
      status: 'in_progress',
      statusLabel: 'Report / vendor in progress',
      used: true,
      lastUpdatedAt,
    };
  }
  // background_initiated
  const anyOpen = checks.some((c) => !TERMINAL_BG.has(String(c.hrxStatus || '').toLowerCase()));
  if (anyOpen) {
    return {
      status: 'in_progress',
      statusLabel: `${checks.length} order(s) — in progress`,
      used: true,
      lastUpdatedAt,
    };
  }
  const pipe = mapPipelineStepToRowStatus(pipelineStep);
  return {
    status: pipe.status,
    statusLabel: pipe.statusLabel,
    used: false,
    lastUpdatedAt,
  };
}

function statusFromPayrollAccount(
  stepKey: string,
  acct: (WorkerPayrollAccount & { id: string }) | null | undefined,
  pipelineStep: PipelineStepRow | undefined
): { status: EmploymentOnboardingRowStatus; statusLabel: string; used: boolean; lastUpdatedAt: string | null } {
  const lastUpdatedAt = acct?.updatedAt ? timestampToIso(acct.updatedAt) : null;
  if (!acct) {
    return { status: 'not_started', statusLabel: 'No payroll account', used: false, lastUpdatedAt: null };
  }
  const ps = String(acct.payrollStatus || 'not_started').toLowerCase();
  if (ps === 'blocked') {
    return {
      status: 'error',
      statusLabel: acct.notes ? String(acct.notes) : 'Payroll blocked',
      used: true,
      lastUpdatedAt,
    };
  }
  if (ps === 'complete' || ps === 'inactive') {
    if (stepKey === 'payroll_invite_sent') {
      return { status: 'completed', statusLabel: 'Invite phase satisfied (account progressed)', used: true, lastUpdatedAt };
    }
    if (stepKey === 'payroll_setup_complete' || stepKey === 'direct_deposit_contractor' || stepKey === 'direct_deposit_w2') {
      return { status: 'completed', statusLabel: 'Complete', used: true, lastUpdatedAt };
    }
  }
  if (stepKey === 'payroll_invite_sent') {
    if (ps === 'not_started') {
      return { status: 'not_started', statusLabel: 'Invite not sent yet', used: true, lastUpdatedAt };
    }
    if (ps === 'invite_sent') {
      return { status: 'in_progress', statusLabel: 'Invite sent — worker action', used: true, lastUpdatedAt };
    }
    return { status: 'in_progress', statusLabel: 'Onboarding in progress', used: true, lastUpdatedAt };
  }
  if (stepKey === 'payroll_setup_complete') {
    if (ps === 'not_started' || ps === 'invite_sent') {
      return { status: 'in_progress', statusLabel: 'Setup not finished', used: true, lastUpdatedAt };
    }
    if (ps === 'in_progress' || ps === 'account_created') {
      return { status: 'in_progress', statusLabel: 'Payroll setup in progress', used: true, lastUpdatedAt };
    }
  }
  if (stepKey === 'direct_deposit_contractor' || stepKey === 'direct_deposit_w2') {
    const dd = String(acct.directDepositStatus || '').toLowerCase();
    if (dd.includes('complete') || dd === 'verified') {
      return { status: 'completed', statusLabel: 'Direct deposit captured', used: true, lastUpdatedAt };
    }
    if (dd && !dd.includes('pending')) {
      return { status: 'in_progress', statusLabel: acct.directDepositStatus || 'Direct deposit', used: true, lastUpdatedAt };
    }
    const pipe = mapPipelineStepToRowStatus(pipelineStep);
    if (pipe.status === 'completed') {
      return { status: 'completed', statusLabel: 'Completed (via payroll step)', used: true, lastUpdatedAt };
    }
    return {
      status: 'in_progress',
      statusLabel: 'Direct deposit pending',
      used: true,
      lastUpdatedAt,
    };
  }
  return { status: 'not_started', statusLabel: 'No payroll signal', used: false, lastUpdatedAt };
}

export interface DeriveWorkflowStepStatusArgs {
  entityKey: EmploymentEntityKey;
  definition: WorkflowStepRuntimeDefinition;
  pipelineSteps: PipelineStepRow[] | undefined;
  everifySummary: EmploymentEverifySummary | null | undefined;
  payrollAccount: (WorkerPayrollAccount & { id: string }) | null | undefined;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  /** Job order IDs linked to this entity’s assignments (for artifact scope). */
  entityLinkedJobOrderIds: Set<string>;
  /** All background checks for this worker in the tenant (for reuse heuristics). */
  allTenantWorkerChecks: BackgroundCheckRecord[];
  /**
   * Parsed `worker_onboarding.externalOnboardingSteps` (TempWorks / HRIS milestones).
   * When present for a mapped workflow step, pipeline resolution prefers this over coarse `steps[]`.
   */
  externalOnboardingSteps?: ExternalOnboardingStepsState;
  /**
   * Normalized worker type for TempWorks overlay only (`normalizeWorkerTypeForExternalSteps`:
   * entity worker type → employment fallback → `unknown`). Does not add path rows.
   */
  externalOnboardingWorkerType: ExternalOnboardingWorkerTypeNorm;
  /** Wording for TempWorks-backed rows; machine status is unchanged. Default `admin`. */
  labelAudience?: 'admin' | 'worker';
}

export interface DerivedWorkflowStepStatus {
  status: EmploymentOnboardingRowStatus;
  statusLabel: string;
  /** What we attribute the row to in the UI / sourceType field. */
  effectiveSourceType: EmploymentOnboardingSourceType;
  sourceRef: {
    pipelineStepId?: string;
    caseId?: string;
    backgroundCheckId?: string;
    externalStepKey?: string;
  };
  helperText: string;
  lastUpdatedAt: string | null;
  satisfiedByArtifact: boolean;
  artifactSourceType?: EmploymentOnboardingArtifactSourceType;
  artifactId?: string;
  artifactCompletedAt?: string | null;
  artifactScope?: EmploymentOnboardingArtifactScope;
}

/**
 * Resolve status for one Settings workflow row using definition.resolutionChain and subsystem data.
 */
export function deriveWorkflowStepStatus(args: DeriveWorkflowStepStatusArgs): DerivedWorkflowStepStatus {
  const {
    definition,
    pipelineSteps,
    everifySummary,
    payrollAccount,
    backgroundChecksForEntity,
    entityKey,
    entityLinkedJobOrderIds,
    allTenantWorkerChecks,
    externalOnboardingSteps,
    externalOnboardingWorkerType,
    labelAudience = 'admin',
  } = args;
  const pipeId = definition.pipelineStepId;
  const pStep = getPipelineStep(pipelineSteps, pipeId);
  const pipelineTs = timestampToIso(pStep?.updatedAt);

  const helperParts: string[] = [];
  const pushFidelity = () => {
    if (definition.fidelityExplanation) helperParts.push(definition.fidelityExplanation);
  };

  for (const source of definition.resolutionChain) {
    if (source === 'everify' && entityKey === 'select' && pipeId === 'e_verify') {
      const reuse = evaluateSelectEverifyReuse({
        entityKey,
        stepKey: definition.stepKey,
        everifySummary,
        pipelineEverifyStep: pStep,
      });
      if (reuse) {
        pushFidelity();
        const caseId = reuse.artifact.caseId ?? everifySummary?.latestCaseId ?? undefined;
        if (definition.stepKey === 'everify_completed' && !reuse.pipelineIncomplete) {
          return {
            status: 'completed',
            statusLabel: String(everifySummary?.statusDisplay || 'E-Verify complete'),
            effectiveSourceType: 'everify',
            sourceRef: { pipelineStepId: 'e_verify', caseId },
            helperText: `E-Verify case and pipeline both show complete. ${helperParts.join(' ')}`.trim(),
            lastUpdatedAt: pipelineTs,
            satisfiedByArtifact: false,
            artifactCompletedAt: null,
          };
        }
        if (definition.stepKey === 'everify_completed' && reuse.pipelineIncomplete) {
          return {
            status: 'satisfied_by_existing_record',
            statusLabel: 'Satisfied by existing E-Verify case',
            effectiveSourceType: 'everify',
            sourceRef: { pipelineStepId: 'e_verify', caseId },
            helperText: `${reuse.artifact.policyNote} Finish the pipeline step when you are ready. ${helperParts.join(' ')}`.trim(),
            lastUpdatedAt: pipelineTs,
            satisfiedByArtifact: true,
            artifactSourceType: 'everify',
            artifactId: caseId,
            artifactCompletedAt: reuse.artifact.completedAt,
            artifactScope: reuse.artifact.scope,
          };
        }
        if (definition.stepKey === 'everify_sent') {
          return {
            status: 'satisfied_by_existing_record',
            statusLabel: 'Covered by existing closed E-Verify case',
            effectiveSourceType: 'everify',
            sourceRef: { pipelineStepId: 'e_verify', caseId },
            helperText: `${reuse.artifact.policyNote} ${helperParts.join(' ')}`.trim(),
            lastUpdatedAt: pipelineTs,
            satisfiedByArtifact: true,
            artifactSourceType: 'everify',
            artifactId: caseId,
            artifactCompletedAt: reuse.artifact.completedAt,
            artifactScope: reuse.artifact.scope,
          };
        }
      }
      const ev = statusFromEverifySummary(everifySummary, definition.stepKey);
      if (ev?.used) {
        pushFidelity();
        return {
          status: ev.status,
          statusLabel: ev.statusLabel,
          effectiveSourceType: 'everify',
          sourceRef: {
            pipelineStepId: 'e_verify',
            caseId: everifySummary?.latestCaseId ?? undefined,
          },
          helperText: `Status from the latest E-Verify case. ${helperParts.join(' ')}`.trim(),
          lastUpdatedAt: pipelineTs,
          satisfiedByArtifact: false,
          artifactCompletedAt: null,
        };
      }
      helperParts.push('No E-Verify case on file — using pipeline status.');
    }
    if (source === 'payroll' && definition.groupId === 'payroll') {
      const pr = statusFromPayrollAccount(definition.stepKey, payrollAccount, pStep);
      if (pr.used) {
        pushFidelity();
        return {
          status: pr.status,
          statusLabel: pr.statusLabel,
          effectiveSourceType: 'payroll',
          sourceRef: { pipelineStepId: pipeId || undefined },
          helperText: `Payroll account: ${pr.statusLabel}. ${helperParts.join(' ')}`.trim(),
          lastUpdatedAt: pr.lastUpdatedAt ?? pipelineTs,
          satisfiedByArtifact: false,
          artifactCompletedAt: null,
        };
      }
    }
    if (source === 'background' && definition.groupId === 'screenings') {
      const bg = statusFromBackgroundRecords(backgroundChecksForEntity, definition.stepKey, pStep);
      if (bg.used) {
        pushFidelity();
        return {
          status: bg.status,
          statusLabel: bg.statusLabel,
          effectiveSourceType: 'background_check',
          sourceRef: {
            pipelineStepId: pipeId || undefined,
            backgroundCheckId: backgroundChecksForEntity[0]?.id,
          },
          helperText: `Background screening for this job (${backgroundChecksForEntity.length} order${
            backgroundChecksForEntity.length === 1 ? '' : 's'
          }). ${helperParts.join(' ')}`.trim(),
          lastUpdatedAt: bg.lastUpdatedAt ?? pipelineTs,
          satisfiedByArtifact: false,
          artifactCompletedAt: null,
        };
      }
      if (definition.stepKey === 'background_completed') {
        const portable = findPortableBackgroundArtifact({
          entityLinkedJobOrderIds,
          allTenantWorkerChecks,
        });
        if (portable) {
          const at = timestampToIso(portable.record.updatedAt);
          pushFidelity();
          return {
            status: 'satisfied_by_existing_record',
            statusLabel: 'Satisfied by existing background check',
            effectiveSourceType: 'background_check',
            sourceRef: {
              pipelineStepId: pipeId || undefined,
              backgroundCheckId: portable.record.id,
            },
            helperText: `${portable.policyNote} ${helperParts.join(' ')}`.trim(),
            lastUpdatedAt: at ?? pipelineTs,
            satisfiedByArtifact: true,
            artifactSourceType: 'background_check',
            artifactId: portable.record.id,
            artifactCompletedAt: at,
            artifactScope: portable.scope,
          };
        }
      }
      if (backgroundChecksForEntity.length === 0) {
        helperParts.push('No screening orders for this job yet — using pipeline if available.');
      }
    }
    if (source === 'pipeline') {
      const extKey = externalStepKeyForWorkflowStep(definition.stepKey);
      const extRow = extKey && externalOnboardingSteps?.[extKey];
      if (
        extKey &&
        extRow &&
        extRow.externalSource === 'tempworks' &&
        !externalStepAppliesToWorkerType(extKey, externalOnboardingWorkerType)
      ) {
        helperParts.push('This step does not apply to this worker type.');
      }
      if (
        extKey &&
        extRow &&
        extRow.externalSource === 'tempworks' &&
        externalStepAppliesToWorkerType(extKey, externalOnboardingWorkerType)
      ) {
        const mapped = labelsForExternalOnboardingRecord(extRow, labelAudience);
        pushFidelity();
        const extTs = lastUpdatedIsoForExternalStep(extRow);
        const isSettingsOnly = mapped.status === 'not_started' && !pStep;
        return {
          status: mapped.status,
          statusLabel: mapped.statusLabel,
          effectiveSourceType: isSettingsOnly ? 'settings_only' : 'external_onboarding',
          sourceRef: {
            ...(pipeId ? { pipelineStepId: pipeId } : {}),
            externalStepKey: extKey,
          },
          helperText: isSettingsOnly
            ? `No payroll activity recorded yet for ${externalStepLabel(extKey)}. ${definition.fidelityExplanation}`.trim()
            : `Payroll system — ${externalStepLabel(extKey)}. ${helperParts.join(' ')}`.trim(),
          lastUpdatedAt: extTs ?? pipelineTs,
          satisfiedByArtifact: false,
          artifactCompletedAt: null,
        };
      }

      const pipe = mapPipelineStepToRowStatus(pStep);
      pushFidelity();
      const isSettingsOnly = !pStep && pipe.status === 'not_started';
      return {
        status: pipe.status,
        statusLabel: pipe.statusLabel,
        effectiveSourceType: isSettingsOnly ? 'settings_only' : 'pipeline_step',
        sourceRef: pipeId ? { pipelineStepId: pipeId } : {},
        helperText: isSettingsOnly
          ? `Onboarding has not started for this step yet. ${definition.fidelityExplanation}`.trim()
          : `Status from the onboarding pipeline. ${helperParts.join(' ')}`.trim(),
        lastUpdatedAt: pipelineTs,
        satisfiedByArtifact: false,
        artifactCompletedAt: null,
      };
    }
  }

  pushFidelity();
  return {
    status: 'not_started',
    statusLabel: 'Not started',
    effectiveSourceType: 'settings_only',
    sourceRef: pipeId ? { pipelineStepId: pipeId } : {},
    helperText: helperParts.join(' ').trim() || 'No status update yet.',
    lastUpdatedAt: null,
    satisfiedByArtifact: false,
    artifactCompletedAt: null,
  };
}
