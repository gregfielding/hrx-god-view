/**
 * Builds grouped Employment V2 onboarding rows from Settings + runtime data.
 * Uses employmentOnboardingStepRuntimeMap for explicit step → source mapping.
 */

import type {
  EmploymentAssignmentSummary,
  EmploymentEntityKey,
  EmploymentEverifySummary,
  EmploymentOnboardingRow,
  EmploymentOnboardingRowStatus,
  EntityTabSettingsSnapshot,
  OnboardingInstanceSnapshot,
  OnboardingPathGroup,
  PipelineTaskRow,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { SignatureEnvelopeStatus } from '../types/phase1cOnboarding';
import type { WorkerPayrollAccount } from '../types/payroll';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import { deriveWorkflowStepStatus, getWorkflowStepRuntimeDefinition } from './employmentOnboardingStepRuntimeMap';
import {
  ONBOARDING_WORKFLOW_STEPS,
  WORKFLOW_UI_GROUP_ORDER,
  WORKFLOW_UI_GROUP_TITLES,
  catalogStepAppliesToEntityWorkerType,
  workflowStepVisibleForEntityTab,
} from './onboardingWorkflowStepCatalog';

function entityAssignmentJobOrderIds(rows: EmploymentAssignmentSummary[]): Set<string> {
  const s = new Set<string>();
  rows.forEach((r) => {
    if (r.jobOrderId) s.add(String(r.jobOrderId));
  });
  return s;
}

/**
 * Terminal “done” for path progress / blockers.
 * completed = finished in this flow; satisfied_by_existing_record = reuse; not_required = N/A.
 */
export function isOnboardingPathRowDone(status: EmploymentOnboardingRowStatus): boolean {
  return status === 'completed' || status === 'satisfied_by_existing_record' || status === 'not_required';
}

/**
 * Employment V2 path blocker rule (authoritative for path UI + entity readiness):
 * `required && blocking && !done` (see isOnboardingPathRowDone).
 * Rows in `error` set `blocking: true` when building assignment/settings rows so failures still gate readiness.
 */
export function isOnboardingPathRowBlocker(row: EmploymentOnboardingRow): boolean {
  if (isOnboardingPathRowDone(row.status)) return false;
  return Boolean(row.required && row.blocking);
}

function getPipelineSteps(pipeline: WorkerOnboardingPipeline | null) {
  return Array.isArray(pipeline?.steps) ? pipeline!.steps! : [];
}

function taskToRowStatus(status: string | undefined): { status: EmploymentOnboardingRowStatus; statusLabel: string } {
  const s = String(status || '').toLowerCase();
  if (s === 'complete' || s === 'completed') return { status: 'completed', statusLabel: 'Completed' };
  if (s === 'in_progress') return { status: 'in_progress', statusLabel: 'In progress' };
  return { status: 'in_progress', statusLabel: 'Pending' };
}

function taskOwner(owner: string | undefined): EmploymentOnboardingRow['owner'] {
  return owner === 'recruiter' ? 'admin' : 'worker';
}

function buildAssignmentRequirementRows(
  entityKey: EmploymentEntityKey,
  assignments: EmploymentAssignmentSummary[],
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>,
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>
): EmploymentOnboardingRow[] {
  const rows: EmploymentOnboardingRow[] = [];

  assignments.forEach((a) => {
    const instId = a.onboardingInstanceId;
    if (!instId) return;
    const inst = onboardingByInstanceId.get(instId);
    if (!inst) return;
    const env = envelopesByAssignmentId.get(a.assignmentId) || new Map();
    const instStatus = String(inst.status || '').toLowerCase();
    const instComplete = instStatus === 'completed';
    const instBlocked = instStatus === 'blocked';

    const pushRow = (
      suffix: string,
      label: string,
      required: boolean,
      blocking: boolean,
      status: EmploymentOnboardingRowStatus,
      statusLabel: string,
      helperText: string
    ) => {
      rows.push({
        rowId: `assignment__${a.assignmentId}__${suffix}`,
        entityKey,
        groupId: 'assignment_requirements',
        stepKey: `assignment:${suffix}`,
        label: `${label}${a.title ? ` · ${a.title}` : ''}`,
        sourceType: 'assignment_requirement',
        sourceRef: { assignmentId: a.assignmentId },
        owner: 'worker',
        required,
        blocking,
        status,
        statusLabel,
        helperText,
        lastUpdatedAt: null,
      });
    };

    inst.resolvedDocuments?.forEach((d, i) => {
      if (!d.required) return;
      const key = d.key || d.docKey || `doc_${i}`;
      const isEsign = d.mode === 'esign';
      const st = isEsign ? env.get(key) : undefined;
      let status: EmploymentOnboardingRowStatus = 'not_started';
      let statusLabel = 'Not started';
      if (st === 'signed' || (!isEsign && instComplete)) {
        status = 'completed';
        statusLabel = 'Completed';
      } else if (st === 'failed' || st === 'declined') {
        status = 'error';
        statusLabel = 'Signature failed or declined';
      } else if (st || instBlocked) {
        status = instBlocked ? 'error' : 'in_progress';
        statusLabel = instBlocked ? 'Blocked' : 'In progress';
      } else if (!isEsign) {
        status = instComplete ? 'completed' : 'in_progress';
        statusLabel = instComplete ? 'Completed' : 'In progress';
      }
      pushRow(
        `doc__${key}`,
        d.title || key || 'Document',
        true,
        Boolean(d.blocking) || status === 'error',
        status,
        statusLabel,
        isEsign
          ? 'Status from signature envelope for this assignment (e-sign).'
          : 'Required document from assignment onboarding package (non e-sign).'
      );
    });

    inst.resolvedSteps?.forEach((s, i) => {
      if (!s.required) return;
      const status: EmploymentOnboardingRowStatus = instComplete ? 'completed' : instBlocked ? 'error' : 'in_progress';
      const statusLabel = instComplete ? 'Completed' : instBlocked ? 'Blocked' : 'Waiting on admin';
      pushRow(
        `step__${s.key || i}`,
        s.title || s.key || 'Step',
        true,
        Boolean(s.blocking) || status === 'error',
        status,
        statusLabel,
        'From onboarding_instances.resolvedSteps for this assignment.'
      );
    });

    inst.resolvedChecks?.forEach((c, i) => {
      if (!c.required) return;
      const status: EmploymentOnboardingRowStatus = instComplete ? 'completed' : instBlocked ? 'error' : 'in_progress';
      const statusLabel = instComplete ? 'Completed' : instBlocked ? 'Blocked' : 'Waiting on vendor';
      pushRow(
        `check__${c.key || i}`,
        c.title || c.key || 'Check',
        true,
        Boolean(c.blocking) || status === 'error',
        status,
        statusLabel,
        'From onboarding_instances.resolvedChecks (screening / vendor).'
      );
    });
  });

  return rows;
}

function buildInternalTaskRows(
  entityKey: EmploymentEntityKey,
  pipeline: WorkerOnboardingPipeline | null
): EmploymentOnboardingRow[] {
  const tasks = Array.isArray(pipeline?.tasks) ? (pipeline!.tasks! as PipelineTaskRow[]) : [];
  const rows: EmploymentOnboardingRow[] = [];

  tasks.forEach((t, idx) => {
    const sid = String(t.stepId || '');
    if (entityKey === 'workforce' && sid === 'e_verify') return;
    if (entityKey === 'events' && (sid === 'i9' || sid === 'e_verify')) return;

    const { status, statusLabel } = taskToRowStatus(t.status);
    const done = isOnboardingPathRowDone(status);
    const owner = taskOwner(t.owner);
    rows.push({
      rowId: `task__${entityKey}__${String(t.id || sid || idx)}`,
      entityKey,
      groupId: 'internal_readiness',
      stepKey: `task:${t.id || sid}`,
      label: t.title || 'Recruiter / admin task',
      sourceType: 'pipeline_task',
      sourceRef: { pipelineStepId: sid || undefined, taskId: t.id ? String(t.id) : undefined },
      owner,
      required: true,
      blocking: (!done && t.owner === 'recruiter') || status === 'error',
      status,
      statusLabel,
      helperText:
        'From worker_onboarding.tasks (internal recruiter/admin queue). Not a Settings checkbox; shown for operational visibility.',
      lastUpdatedAt: null,
    });
  });

  return rows;
}

export interface BuildOnboardingPathArgs {
  entityKey: EmploymentEntityKey;
  entitySettings: EntityTabSettingsSnapshot | null;
  pipeline: WorkerOnboardingPipeline | null;
  assignments: EmploymentAssignmentSummary[];
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
  everifySummary: EmploymentEverifySummary | null;
  payrollAccount: (WorkerPayrollAccount & { id: string }) | null;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  /** All tenant background checks for this worker (reuse / artifact policy). */
  allTenantWorkerBackgroundChecks: BackgroundCheckRecord[];
}

export function buildOnboardingPathFromSettings(args: BuildOnboardingPathArgs): OnboardingPathGroup[] {
  const {
    entityKey,
    entitySettings,
    pipeline,
    assignments,
    onboardingByInstanceId,
    envelopesByAssignmentId,
    everifySummary,
    payrollAccount,
    backgroundChecksForEntity,
    allTenantWorkerBackgroundChecks,
  } = args;

  const entityLinkedJobOrderIds = entityAssignmentJobOrderIds(assignments);
  const pipelineSteps = getPipelineSteps(pipeline);
  const byGroup = new Map<(typeof WORKFLOW_UI_GROUP_ORDER)[number], EmploymentOnboardingRow[]>();
  WORKFLOW_UI_GROUP_ORDER.forEach((g) => byGroup.set(g, []));

  if (entitySettings) {
    const config = entitySettings.onboardingWorkflowSteps || {};
    for (const def of ONBOARDING_WORKFLOW_STEPS) {
      if (!config[def.id]) continue;
      if (!catalogStepAppliesToEntityWorkerType(def, entitySettings.workerType)) continue;
      if (!workflowStepVisibleForEntityTab(def.id, entityKey)) continue;

      const runtimeDef = getWorkflowStepRuntimeDefinition(def.id);
      if (!runtimeDef) continue;

      const groupId = runtimeDef.groupId;
      if (entityKey === 'events' && groupId === 'work_authorization') continue;

      const derived = deriveWorkflowStepStatus({
        entityKey,
        definition: runtimeDef,
        pipelineSteps,
        everifySummary: entityKey === 'select' ? everifySummary : null,
        payrollAccount,
        backgroundChecksForEntity,
        entityLinkedJobOrderIds,
        allTenantWorkerChecks: allTenantWorkerBackgroundChecks,
      });

      const pipeId = runtimeDef.pipelineStepId;
      const pStep = pipeId ? pipelineSteps.find((s) => String(s.id || '') === pipeId) : undefined;
      const applicability = pStep ? String(pStep.applicability || '').toLowerCase() : '';
      // required: explicit from pipeline applicability when step exists; else catalog defaultRequired.
      const required = pStep ? applicability !== 'not_required' : runtimeDef.defaultRequired;
      // blocking: catalog heuristic defaultBlocking; any error state gates readiness (strict blocker rule).
      const blocking = runtimeDef.defaultBlocking || derived.status === 'error';

      byGroup.get(groupId)!.push({
        rowId: `${entityKey}__${def.id}`,
        entityKey,
        groupId,
        stepKey: def.id,
        label: runtimeDef.label,
        sourceType: derived.effectiveSourceType,
        sourceRef: derived.sourceRef,
        owner: runtimeDef.owner,
        required,
        blocking,
        status: derived.status,
        statusLabel: derived.statusLabel,
        ...(derived.satisfiedByArtifact
          ? {
              satisfiedByArtifact: true,
              artifactSourceType: derived.artifactSourceType,
              artifactId: derived.artifactId ?? null,
              artifactCompletedAt: derived.artifactCompletedAt ?? null,
              artifactScope: derived.artifactScope ?? null,
            }
          : {}),
        helperText: derived.helperText,
        lastUpdatedAt: derived.lastUpdatedAt ?? null,
      });
    }
  }

  const assignRows = buildAssignmentRequirementRows(
    entityKey,
    assignments,
    onboardingByInstanceId,
    envelopesByAssignmentId
  );
  assignRows.forEach((r) => byGroup.get('assignment_requirements')!.push(r));

  buildInternalTaskRows(entityKey, pipeline).forEach((r) => byGroup.get('internal_readiness')!.push(r));

  return WORKFLOW_UI_GROUP_ORDER.map((groupId) => {
    const rows = byGroup.get(groupId) || [];
    const totalCount = rows.length;
    const doneCount = rows.filter((r) => isOnboardingPathRowDone(r.status)).length;
    const blockerCount = rows.filter(isOnboardingPathRowBlocker).length;
    return {
      groupId,
      title: WORKFLOW_UI_GROUP_TITLES[groupId],
      doneCount,
      totalCount,
      blockerCount,
      rows,
    };
  }).filter((g) => g.rows.length > 0);
}
