/**
 * Builds grouped Employment V2 onboarding rows from Settings + runtime data.
 * Uses employmentOnboardingStepRuntimeMap for explicit step → source mapping.
 *
 * TempWorks / HRIS milestones: read parsed `worker_onboarding.externalOnboardingSteps`
 * (same pipeline doc as `steps` / `tasks`) and pass into `deriveWorkflowStepStatus`.
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
import type { ExternalOnboardingStepKey } from '../types/externalOnboardingSteps';
import { getExternalOnboardingStepDefinition } from '../types/externalOnboardingSteps';
import type { EverifyCaseNarrativeBrief } from './employmentOnboardingNarrative';
import { deriveWorkflowStepStatus, getWorkflowStepRuntimeDefinition } from './employmentOnboardingStepRuntimeMap';
import {
  externalStepAppliesToWorkerType,
  externalStepKeyForWorkflowStep,
  isExternalOnboardingStepVerifiedComplete,
  parseExternalOnboardingSteps,
} from './externalOnboardingSteps';
import { resolveEffectiveEmploymentWorkerType } from './employmentWorkerTypeResolution';
import {
  ONBOARDING_WORKFLOW_STEPS,
  WORKFLOW_UI_GROUP_ORDER,
  WORKFLOW_UI_GROUP_TITLES,
  catalogStepAppliesToEntityWorkerType,
  recruiterChecklistTitleForWorkflowStep,
  workflowStepVisibleForEntityTab,
} from './onboardingWorkflowStepCatalog';
import {
  mergeBackgroundOperationalPathRows,
  mergeEverifyOperationalPathRows,
} from './employmentOnboardingOperationalMerge';

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
/** Groups shown on the entity relationship onboarding path (excludes screenings + assignment package). */
const ENTITY_RELATIONSHIP_PATH_GROUP_IDS = new Set<OnboardingPathGroup['groupId']>([
  'work_authorization',
  'forms_and_policies',
  'payroll',
  'internal_readiness',
]);

export function filterEntityRelationshipOnboardingPathGroups(groups: OnboardingPathGroup[]): OnboardingPathGroup[] {
  return groups.filter((g) => ENTITY_RELATIONSHIP_PATH_GROUP_IDS.has(g.groupId));
}

export function isOnboardingPathRowBlocker(row: EmploymentOnboardingRow): boolean {
  if (isOnboardingPathRowDone(row.status)) return false;
  return Boolean(row.required && row.blocking);
}

/** Shown when payroll milestone data is not synced yet; also used in checklist tooltips. */
export const RECRUITER_PAYROLL_ROW_HINT =
  'Complete this step in your payroll system, then confirm it here.';
const PAYROLL_STEP_MISSING_WORKER =
  'Your hiring team will confirm this here once payroll progress is recorded.';

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
  return owner === 'recruiter' ? 'recruiter' : 'worker';
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
      helperText: string,
      rowOwner: EmploymentOnboardingRow['owner'],
      audience: EmploymentOnboardingRow['audience'],
      actionableBy: EmploymentOnboardingRow['actionableBy']
    ) => {
      rows.push({
        rowId: `assignment__${a.assignmentId}__${suffix}`,
        entityKey,
        groupId: 'assignment_requirements',
        stepKey: `assignment:${suffix}`,
        label: `${label}${a.title ? ` · ${a.title}` : ''}`,
        sourceType: 'assignment_requirement',
        sourceRef: { assignmentId: a.assignmentId },
        owner: rowOwner,
        audience,
        actionableBy,
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
          ? 'E-sign status updates as the worker signs.'
          : 'Upload or confirm when the worker submits this document.',
        'worker',
        'both',
        'either'
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
        'Complete or unblock this step in the assignment package.',
        'recruiter',
        'both',
        'recruiter'
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
        'Vendor or screening partner updates this; check the assignment for detail.',
        'vendor',
        'both',
        'none'
      );
    });
  });

  return rows;
}

/** Recruiter checklist: short task title for merged pipeline tasks. */
function internalPipelineTaskVerificationLabel(title: string, stepId: string): string {
  const raw = (title || '').trim();
  const combined = `${raw} ${stepId}`.toLowerCase();
  const sid = String(stepId || '').toLowerCase();

  if (/\bi-?9\b/.test(combined) || sid === 'i9') {
    return 'Verify I-9';
  }
  if (/\be-?verify\b/.test(combined) || combined.includes('everify') || sid === 'e_verify') {
    return 'Confirm E-Verify';
  }
  if (
    sid === 'background_check' ||
    (/\bbackground\b/.test(combined) && /(check|screen|review|status|order)/.test(combined))
  ) {
    return 'Review background check';
  }
  if (sid === 'drug_screen' || sid === 'drug_screening' || /\bdrug\b/.test(combined)) {
    return 'Review background check';
  }
  if (sid === 'everee' || /\bpayroll\b/.test(combined)) {
    return 'Confirm payroll setup';
  }
  if (combined.includes('onboarding') && combined.includes('form')) {
    return 'Confirm onboarding forms';
  }
  if (sid === 'onboarding_forms') {
    return 'Confirm onboarding forms';
  }
  if (!raw) {
    return 'Confirm completion';
  }
  const stripped = raw.replace(/^(complete|review)\s+/i, '').trim();
  if (stripped.length > 44 || /completed in /i.test(stripped)) {
    if (sid === 'background_check') return 'Review background check';
    return 'Confirm completion';
  }
  return stripped;
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
    const recruiterTask = t.owner === 'recruiter';
    const baseTitle = t.title || 'Confirm completion';
    rows.push({
      rowId: `task__${entityKey}__${String(t.id || sid || idx)}`,
      entityKey,
      groupId: 'internal_readiness',
      stepKey: `task:${t.id || sid}`,
      label: internalPipelineTaskVerificationLabel(baseTitle, sid),
      sourceType: 'pipeline_task',
      sourceRef: { pipelineStepId: sid || undefined, taskId: t.id ? String(t.id) : undefined },
      owner,
      audience: recruiterTask ? 'internal' : 'both',
      actionableBy: recruiterTask ? 'recruiter' : 'worker',
      required: true,
      blocking: (!done && recruiterTask) || status === 'error',
      status,
      statusLabel,
      helperText: 'Finish the work in your payroll system or task list, then mark done here.',
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
  /** Optional E-Verify case timestamps for activity narrative (Select entity). */
  everifyCaseBriefs?: EverifyCaseNarrativeBrief[];
  /**
   * Fallback after `entitySettings.workerType` for external-step gating (e.g. `entity_employments.workerType`
   * when entity string is empty). Precedence: entity → employment → `unknown` after normalize.
   */
  employmentRecordWorkerType?: string | null;
  /** Path row `statusLabel` for TempWorks-backed steps; machine status unchanged. Default `admin`. */
  pathLabelAudience?: 'admin' | 'worker';
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
    employmentRecordWorkerType,
    pathLabelAudience = 'admin',
  } = args;

  const entityLinkedJobOrderIds = entityAssignmentJobOrderIds(assignments);
  const pipelineSteps = getPipelineSteps(pipeline);
  const externalOnboardingSteps = parseExternalOnboardingSteps(pipeline?.externalOnboardingSteps);
  const effectiveWorkerType = resolveEffectiveEmploymentWorkerType({
    entityWorkerType: entitySettings?.workerType,
    employmentWorkerType: employmentRecordWorkerType,
  });
  const externalOnboardingWorkerType = effectiveWorkerType.normalizedExternal;
  const byGroup = new Map<(typeof WORKFLOW_UI_GROUP_ORDER)[number], EmploymentOnboardingRow[]>();
  WORKFLOW_UI_GROUP_ORDER.forEach((g) => byGroup.set(g, []));

  if (entitySettings) {
    const config = entitySettings.onboardingWorkflowSteps || {};
    for (const def of ONBOARDING_WORKFLOW_STEPS) {
      if (!config[def.id]) continue;
      if (!catalogStepAppliesToEntityWorkerType(def, effectiveWorkerType.forSettingsCatalog)) continue;
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
        externalOnboardingSteps,
        externalOnboardingWorkerType,
        labelAudience: pathLabelAudience,
      });

      const pipeId = runtimeDef.pipelineStepId;
      const pStep = pipeId ? pipelineSteps.find((s) => String(s.id || '') === pipeId) : undefined;
      const applicability = pStep ? String(pStep.applicability || '').toLowerCase() : '';
      // required: explicit from pipeline applicability when step exists; else catalog defaultRequired.
      const required = pStep ? applicability !== 'not_required' : runtimeDef.defaultRequired;
      // blocking: catalog heuristic defaultBlocking; any error state gates readiness (strict blocker rule).
      let blocking = runtimeDef.defaultBlocking || derived.status === 'error';
      const mappedWorkflowExternalKey = externalStepKeyForWorkflowStep(def.id);
      const extStepKey = (mappedWorkflowExternalKey ??
        (derived.sourceRef?.externalStepKey as ExternalOnboardingStepKey | undefined)) as
        | ExternalOnboardingStepKey
        | undefined;
      const extStepRec =
        extStepKey && externalOnboardingSteps ? externalOnboardingSteps[extStepKey] : undefined;
      const extStepDef = extStepKey ? getExternalOnboardingStepDefinition(extStepKey) : undefined;
      const externalAppliesToWorker =
        extStepKey != null && externalStepAppliesToWorkerType(extStepKey, externalOnboardingWorkerType);
      const missingTempWorksRow =
        Boolean(
          required &&
            extStepDef?.adminVerificationRequired &&
            extStepKey &&
            externalAppliesToWorker &&
            !extStepRec
        );
      if (
        required &&
        extStepDef?.adminVerificationRequired &&
        extStepRec?.externalSource === 'tempworks' &&
        !isExternalOnboardingStepVerifiedComplete(extStepRec)
      ) {
        blocking = true;
      }
      if (missingTempWorksRow) {
        blocking = true;
      }

      let rowStatus: EmploymentOnboardingRowStatus = derived.status;
      let rowStatusLabel = derived.statusLabel;
      let rowSourceType = derived.effectiveSourceType;
      let rowSourceRef: EmploymentOnboardingRow['sourceRef'] = {
        ...derived.sourceRef,
        ...(pipeId && !derived.sourceRef?.pipelineStepId ? { pipelineStepId: pipeId } : {}),
      };
      if (mappedWorkflowExternalKey) {
        rowSourceRef.externalStepKey = mappedWorkflowExternalKey;
        rowSourceRef.requirementKey = mappedWorkflowExternalKey;
      }
      let rowHelperText = derived.helperText;

      if (missingTempWorksRow && extStepKey) {
        rowSourceType = 'external_onboarding';
        rowSourceRef = {
          ...(pipeId ? { pipelineStepId: pipeId } : {}),
          externalStepKey: extStepKey,
        };
        if (isOnboardingPathRowDone(rowStatus)) {
          rowStatus = 'in_progress';
        }
        rowStatusLabel =
          pathLabelAudience === 'worker' ? PAYROLL_STEP_MISSING_WORKER : 'Waiting on payroll';
        rowHelperText = RECRUITER_PAYROLL_ROW_HINT;
      }

      let actionableBy = runtimeDef.actionableBy;
      if (mappedWorkflowExternalKey === 'payroll_onboarding') {
        actionableBy = 'either';
      }

      byGroup.get(groupId)!.push({
        rowId: `${entityKey}__${def.id}`,
        entityKey,
        groupId,
        stepKey: def.id,
        label:
          pathLabelAudience === 'admin'
            ? recruiterChecklistTitleForWorkflowStep(def.id, runtimeDef.label)
            : runtimeDef.label,
        sourceType: rowSourceType,
        sourceRef: rowSourceRef,
        owner: runtimeDef.owner,
        audience: runtimeDef.audience,
        actionableBy,
        required,
        blocking,
        status: rowStatus,
        statusLabel: rowStatusLabel,
        ...(missingTempWorksRow || !derived.satisfiedByArtifact
          ? {}
          : {
              satisfiedByArtifact: true,
              artifactSourceType: derived.artifactSourceType,
              artifactId: derived.artifactId ?? null,
              artifactCompletedAt: derived.artifactCompletedAt ?? null,
              artifactScope: derived.artifactScope ?? null,
            }),
        helperText: rowHelperText,
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

  const workAuth = byGroup.get('work_authorization');
  if (workAuth?.length) {
    byGroup.set('work_authorization', mergeEverifyOperationalPathRows(workAuth));
  }
  const screenings = byGroup.get('screenings');
  if (screenings?.length) {
    byGroup.set('screenings', mergeBackgroundOperationalPathRows(screenings));
  }

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

/** DOM id for scrolling to the Select E-Verify checklist row (`employmentScrollTo=e_verify` + `employmentEntityKey`). */
export function employmentOnboardingEverifyRowElementId(entityKey: string): string {
  return `employment-onboarding-e-verify-${entityKey}`;
}

/** DOM id for scrolling to a screening row on Backgrounds (`employmentScrollTo=background_check` + `employmentBackgroundCheckId`). */
export function backgroundComplianceScreeningRowElementId(backgroundCheckId: string): string {
  return `background-compliance-screening-${backgroundCheckId}`;
}

/** True when this row is the Select-entity E-Verify line (same scope as `isSelectEverifyPathRow` in blocker map). */
export function isEverifyOnboardingPathScrollRow(row: EmploymentOnboardingRow, entityKey: EmploymentEntityKey): boolean {
  if (entityKey !== 'select') return false;
  if (row.sourceRef?.requirementKey === 'e_verify') return true;
  if (row.stepKey.startsWith('everify_')) return true;
  return Boolean(row.sourceRef?.mergedFromStepKeys?.some((k) => k.startsWith('everify_')));
}
