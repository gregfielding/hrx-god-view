/**
 * Entity-first employment readiness: blockers, lifecycle, and progress from live records.
 *
 * **Header UX:** `employmentHeaderState` (`EmploymentV2HeaderState`) is the only supported model for headers and
 * top-level employment chips. `lifecycleStatus` is a **deprecated derived alias** of `employmentHeaderState`.
 * `readinessChip` and `headerEmploymentStatus` remain legacy summary-card fields.
 */

import { everifyUiAppliesToEntityKey, workAuthUiModeFromEntityKey } from './c1EntityWorkAuthorizationUi';
import { pipelineStepsForProgressEntity, type PipelineStepLike } from './onboardingPipelineProgress';
import { getPayrollStatusLabel } from '../types/payroll';
import type {
  EmploymentAssignmentSummary,
  EmploymentBlockerGroupId,
  EmploymentBlockerItem,
  EmploymentDocumentsSummary,
  EmploymentEverifySummary,
  EmploymentEntityKey,
  EmploymentEntityOverview,
  EmploymentOnboardingRow,
  EmploymentPayrollSummary,
  EmploymentReadinessChip,
  EmploymentScreeningSummary,
  EntityEmploymentRecord,
  EntityTabSettingsSnapshot,
  OnboardingInstanceSnapshot,
  OnboardingPathGroup,
  PipelineStepRow,
  PipelineTaskRow,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import {
  filterEntityRelationshipOnboardingPathGroups,
  isOnboardingPathRowBlocker,
  isOnboardingPathRowDone,
} from './employmentOnboardingPath';
import {
  computeHasOpenOnboardingDemand,
  deriveDominantActionableForHeader,
  deriveEmploymentHeaderState,
  employmentBlockerItemFromPathRow,
  employmentHeaderStateExplanation,
  headerEmploymentStatusFromEmploymentHeaderState,
  lifecycleStatusFromEmploymentHeaderState,
  primaryAssignmentRowForHeader,
} from './deriveEmploymentHeaderState';
import {
  buildAssignmentRequirementsViewModel,
  pickPrimaryAssignmentForEmploymentIA,
} from './assignmentRequirementsViewModel';
import type { SignatureEnvelopeStatus } from '../types/phase1cOnboarding';
import { entityLabelForKey, defaultWorkerTypeForEntity } from './employmentEntityPresentation';
import type { WorkerPayrollAccount } from '../types/payroll';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { AssignmentReadinessV1Snapshot } from '../types/assignmentReadinessV1';
import { entityEmploymentLifecycleLower } from './entityEmploymentLifecycle';
import {
  documentsAndSignaturesLineFromReadiness,
  screeningLineFromReadiness,
} from './assignmentReadinessUi';
import type {
  EverifyCaseNarrativeBrief,
  OnboardingAutomationDispatchBrief,
} from './employmentOnboardingNarrative';
import { resolveEffectiveEmploymentWorkerType } from './employmentWorkerTypeResolution';
import type { ExternalOnboardingWorkerTypeNorm } from './externalOnboardingSteps';
import {
  buildEnrichedFullOnboardingPathFromEngineContext,
  computeEntityOnboardingEngineFromEnrichedFullPath,
} from './entityOnboardingEngineFromContext';
import type { EntityOnboardingEngineBuildContext } from './entityOnboardingEngineFromContext';

/** Drop redundant recruiter pipeline tasks; payroll milestones cover forms on the checklist. */
function omitInternalOnboardingFormsTasksFromChecklist(row: EmploymentOnboardingRow): boolean {
  if (row.groupId !== 'internal_readiness' || row.sourceType !== 'pipeline_task') return true;
  return String(row.sourceRef?.pipelineStepId || '') !== 'onboarding_forms';
}

function recomputeOnboardingPathGroupCounts(g: OnboardingPathGroup): OnboardingPathGroup {
  const rows = g.rows;
  return {
    ...g,
    doneCount: rows.filter((r) => isOnboardingPathRowDone(r.status)).length,
    totalCount: rows.length,
    blockerCount: rows.filter(isOnboardingPathRowBlocker).length,
  };
}

function filterChecklistPathGroups(groups: OnboardingPathGroup[]): OnboardingPathGroup[] {
  return groups
    .map((g) =>
      recomputeOnboardingPathGroupCounts({ ...g, rows: g.rows.filter(omitInternalOnboardingFormsTasksFromChecklist) })
    )
    .filter((g) => g.rows.length > 0);
}

export function stepIdToGroupId(stepId: string): EmploymentBlockerGroupId {
  const id = String(stepId || '').toLowerCase();
  if (id === 'i9' || id === 'e_verify') return 'work_authorization';
  if (id === 'onboarding_forms') return 'forms_and_policies';
  if (id === 'everee') return 'payroll';
  if (id === 'background_check' || id === 'drug_screen') return 'screenings';
  return 'internal_readiness';
}

/** Progress + blockers: pipeline filter, plus Events omits work-authorization steps. */
function applicableStepsForEmploymentEntity(
  steps: PipelineStepLike[],
  entityKey: EmploymentEntityKey
): PipelineStepLike[] {
  const base = pipelineStepsForProgressEntity(steps, entityKey);
  if (entityKey === 'events') {
    return base.filter((s) => stepIdToGroupId(String(s.id || '')) !== 'work_authorization');
  }
  return base;
}

function stepOwnerDefault(stepId: string): EmploymentBlockerItem['owner'] {
  const id = String(stepId || '').toLowerCase();
  if (id === 'e_verify') return 'system';
  if (id === 'background_check' || id === 'drug_screen') return 'vendor';
  return 'worker';
}

function ownerDisplay(o: EmploymentBlockerItem['owner']): string {
  const map: Record<EmploymentBlockerItem['owner'], string> = {
    worker: 'Worker',
    recruiter: 'Recruiter',
    system: 'System',
    vendor: 'Vendor',
  };
  return map[o] ?? o;
}

function stepIncomplete(s: PipelineStepLike): boolean {
  const st = String(s.status || '').toLowerCase();
  return st !== 'complete' && st !== 'skipped';
}

function blockerStatusForStep(s: PipelineStepLike): EmploymentBlockerItem['status'] {
  const st = String(s.status || '').toLowerCase();
  if (st === 'blocked' || st === 'failed') return 'blocked';
  if (st === 'in_progress') return 'action_needed';
  return 'pending';
}

export function buildBlockersFromPipeline(
  steps: PipelineStepRow[] | undefined,
  tasks: PipelineTaskRow[] | undefined,
  entityKey: EmploymentEntityKey
): EmploymentBlockerItem[] {
  const arr = Array.isArray(steps) ? steps : [];
  const applicable = applicableStepsForEmploymentEntity(arr as PipelineStepLike[], entityKey);
  const blockers: EmploymentBlockerItem[] = [];

  applicable.forEach((s) => {
    const id = String(s.id || '');
    if (!id || !stepIncomplete(s)) return;
    const title = (s as PipelineStepRow).title || id.replace(/_/g, ' ');
    const desc =
      String((s as PipelineStepRow).failureReason || '').trim() ||
      (String(s.status || '').toLowerCase() === 'blocked' ? 'This step is blocked.' : undefined);
    blockers.push({
      id: `step__${id}`,
      groupId: stepIdToGroupId(id),
      title,
      description: desc,
      owner: stepOwnerDefault(id),
      status: blockerStatusForStep(s),
      actionKind: id === 'e_verify' && everifyUiAppliesToEntityKey(entityKey) ? 'start_everify' : undefined,
      actionLabel:
        id === 'e_verify' && everifyUiAppliesToEntityKey(entityKey) ? 'Open E-Verify' : undefined,
    });
  });

  const taskRows = Array.isArray(tasks) ? tasks : [];
  taskRows
    .filter((t) => t.owner === 'recruiter' && t.status !== 'complete')
    .forEach((t) => {
      const sid = String(t.stepId || '');
      if (sid === 'e_verify' && !everifyUiAppliesToEntityKey(entityKey)) return;
      blockers.push({
        id: `task__${t.id || sid}`,
        groupId: sid ? stepIdToGroupId(sid) : 'internal_readiness',
        title: t.title || 'Recruiter task',
        owner: 'recruiter',
        status: t.status === 'in_progress' ? 'action_needed' : 'pending',
        actionKind: 'review',
        actionLabel: 'Review',
      });
    });

  return blockers;
}

function deriveReadinessChip(
  notStarted: boolean,
  hasAnyBlockers: boolean,
  completedCount: number,
  requiredCount: number,
  pathRowCount: number,
  pathDoneCount: number
): EmploymentReadinessChip {
  if (notStarted) return 'not_started';
  if (hasAnyBlockers) return 'blocked';
  const pathAllDone = pathRowCount === 0 || pathDoneCount === pathRowCount;
  const pipelineAllComplete = requiredCount === 0 || completedCount === requiredCount;
  if (pathAllDone && pipelineAllComplete) return 'ready';
  return 'in_progress';
}

function countResolvedRequirements(
  instance: OnboardingInstanceSnapshot | undefined,
  envelopes: Map<string, SignatureEnvelopeStatus> | undefined
): EmploymentAssignmentSummary['resolvedRequirementsSummary'] {
  if (!instance) {
    return { documentsRequired: 0, checksRequired: 0, signaturesPending: 0 };
  }
  const docs = instance.resolvedDocuments || [];
  const checks = instance.resolvedChecks || [];
  const documentsRequired = docs.filter((d) => d.required).length;
  const checksRequired = checks.filter((c) => c.required).length;

  let signaturesPending = 0;
  const env = envelopes || new Map<string, SignatureEnvelopeStatus>();
  docs.forEach((d) => {
    if (d.mode !== 'esign') return;
    const key = d.key || d.docKey || '';
    if (!key) return;
    const st = env.get(key);
    if (!st || (st !== 'signed' && st !== 'declined' && st !== 'canceled')) {
      signaturesPending += 1;
    }
  });

  return { documentsRequired, checksRequired, signaturesPending };
}

function openBackgroundCount(checks: BackgroundCheckRecord[]): number {
  const terminal = new Set(['completed', 'canceled', 'error']);
  return checks.filter((c) => !terminal.has(String(c.hrxStatus || '').toLowerCase())).length;
}

function headerWorkerTypeDisplayFromEffective(
  effective: ReturnType<typeof resolveEffectiveEmploymentWorkerType>,
  entityKey: EmploymentEntityKey
): string {
  if (!effective.rawEffective) {
    return defaultWorkerTypeForEntity(entityKey) === '1099' ? '1099' : 'W-2';
  }
  const w = effective.forSettingsCatalog.toUpperCase().replace(/-/g, '');
  if (w === 'BOTH') return 'W-2 / 1099';
  if (w === '1099') return '1099';
  return 'W-2';
}

function overviewWorkerTypeCoarse(
  normalizedExternal: ExternalOnboardingWorkerTypeNorm,
  entityKey: EmploymentEntityKey
): 'w2' | '1099' | null {
  if (normalizedExternal === '1099') return '1099';
  if (normalizedExternal === 'w2') return 'w2';
  return defaultWorkerTypeForEntity(entityKey);
}

export interface BuildOverviewContext {
  entityKey: EmploymentEntityKey;
  entityEmployment: EntityEmploymentRecord | null;
  workerOnboarding: WorkerOnboardingPipeline | null;
  entitySettings: EntityTabSettingsSnapshot | null;
  assignmentsRows: Array<{
    assignmentId: string;
    jobOrderId?: string | null;
    status?: string | null;
    startDate?: string | null;
    onboardingInstanceId?: string | null;
    onboardingStatus?: string | null;
    onboardingPercent?: number | null;
    jobTitle?: string | null;
    assignmentReadinessV1?: AssignmentReadinessV1Snapshot | null;
  }>;
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
  everifySummary: EmploymentEverifySummary | null;
  payrollAccount: (WorkerPayrollAccount & { id: string }) | null;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  /** All tenant background checks for this worker (artifact reuse heuristics). */
  allTenantWorkerBackgroundChecks: BackgroundCheckRecord[];
  /** E-Verify case timestamps for path narrative (Select). */
  everifyCaseBriefs?: EverifyCaseNarrativeBrief[];
  /** Filtered to this entity’s `hiringEntityId` (payroll automation audit lines). */
  automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
}

export function buildEmploymentEntityOverview(ctx: BuildOverviewContext): EmploymentEntityOverview {
  const { entityKey, entityEmployment: ee, workerOnboarding: pipeline } = ctx;
  const label = entityLabelForKey(entityKey);
  const steps = pipeline?.steps;
  const stepArr = Array.isArray(steps) ? (steps as PipelineStepLike[]) : [];
  const applicable = applicableStepsForEmploymentEntity(stepArr, entityKey);
  const completedCount = applicable.filter((s) => String(s.status || '').toLowerCase() === 'complete').length;
  const requiredCount = applicable.length;
  const percentComplete = requiredCount > 0 ? Math.round((completedCount / requiredCount) * 100) : 0;

  const blockers = buildBlockersFromPipeline(steps, pipeline?.tasks, entityKey);

  if (ctx.payrollAccount?.payrollStatus === 'blocked') {
    const exists = blockers.some((b) => b.id === 'payroll__account_blocked');
    if (!exists) {
      blockers.push({
        id: 'payroll__account_blocked',
        groupId: 'payroll',
        title: 'Payroll setup blocked',
        description: ctx.payrollAccount.notes || undefined,
        owner: 'worker',
        status: 'blocked',
        actionKind: 'open_system',
        actionLabel: 'Open payroll',
      });
    }
  }

  const pipelineBlockerCount = blockers.length;

  const notStarted = !ee && !pipeline;
  const effectiveWorkerType = resolveEffectiveEmploymentWorkerType({
    entityWorkerType: ctx.entitySettings?.workerType,
    employmentWorkerType: ee?.workerType ?? null,
  });
  const workerType = overviewWorkerTypeCoarse(effectiveWorkerType.normalizedExternal, entityKey);

  const { assignments, fullOnboardingPath } = buildEnrichedFullOnboardingPathFromEngineContext(
    ctx as EntityOnboardingEngineBuildContext
  );

  const assignmentRequirementsViewModel = buildAssignmentRequirementsViewModel({
    fullOnboardingPathGroups: fullOnboardingPath,
    assignments,
    onboardingByInstanceId: ctx.onboardingByInstanceId,
    envelopesByAssignmentId: ctx.envelopesByAssignmentId,
    backgroundChecksForEntity: ctx.backgroundChecksForEntity,
    entityKey,
    automationDispatchBriefs: ctx.automationDispatchBriefs,
  });

  const onboardingPath = filterEntityRelationshipOnboardingPathGroups(fullOnboardingPath);

  /** Assignment package rows stay out of the Onboarding checklist — they render only under Assignment. */
  const onboardingChecklistGroups = filterChecklistPathGroups(onboardingPath);

  const onboardingEngine = computeEntityOnboardingEngineFromEnrichedFullPath(fullOnboardingPath, pipeline);

  const allPathRows = onboardingPath.flatMap((g) => g.rows);
  const pathRowCount = allPathRows.length;
  const pathDoneCount = allPathRows.filter((r) => isOnboardingPathRowDone(r.status)).length;
  const pathBlockerCount = allPathRows.filter(isOnboardingPathRowBlocker).length;

  const liveAssignmentRow = primaryAssignmentRowForHeader(assignments);
  const hasOpenOnboardingDemand = computeHasOpenOnboardingDemand({
    assignments,
    entityEmploymentStatus: entityEmploymentLifecycleLower(ee),
    employmentEntryMode: ee?.employmentEntryMode ?? null,
  });
  const hasAnyBlockers =
    hasOpenOnboardingDemand && (pathBlockerCount > 0 || pipelineBlockerCount > 0);
  const readinessChip = deriveReadinessChip(
    notStarted,
    hasAnyBlockers,
    completedCount,
    requiredCount,
    pathRowCount,
    pathDoneCount
  );

  const entityOb = String(ctx.entitySettings?.payrollOnboardingUrl || '').trim() || null;
  const entityPo = String(ctx.entitySettings?.payrollPortalUrl || '').trim() || null;
  const payrollSummary: EmploymentPayrollSummary = {
    applicable: Boolean(ee || ctx.payrollAccount),
    statusDisplay: ctx.payrollAccount
      ? getPayrollStatusLabel(ctx.payrollAccount.payrollStatus)
      : 'No payroll account',
    portalUrl: ctx.payrollAccount?.payrollAccountLink ?? null,
    entityOnboardingUrl: entityOb,
    entityPortalUrl: entityPo,
    actionNeeded: Boolean(
      ctx.payrollAccount &&
        !['complete', 'inactive'].includes(String(ctx.payrollAccount.payrollStatus || ''))
    ),
  };

  const openScr = openBackgroundCount(ctx.backgroundChecksForEntity);
  const primaryForSystems = pickPrimaryAssignmentForEmploymentIA(assignments);
  const readinessSys = primaryForSystems?.assignmentReadinessV1 ?? null;
  const screeningCanonicalTop =
    readinessSys != null ? screeningLineFromReadiness(readinessSys) : null;
  const screeningSummary: EmploymentScreeningSummary = {
    applicable: Boolean(ee || openScr > 0 || readinessSys != null),
    statusDisplay: screeningCanonicalTop ?? (openScr > 0 ? `${openScr} open` : 'None open'),
    openOrderCount: openScr,
    actionNeeded: Boolean(
      openScr > 0 ||
        (readinessSys &&
          ['blocked', 'requirements_incomplete', 'pending_confirmation'].includes(
            readinessSys.assignmentReadinessState
          ))
    ),
    recordDetail:
      readinessSys != null && openScr > 0
        ? `${openScr} open screening order(s) in tenant records`
        : null,
  };

  let docSigned = 0;
  let docPending = 0;
  assignments.forEach((a) => {
    const inst = a.onboardingInstanceId
      ? ctx.onboardingByInstanceId.get(a.onboardingInstanceId)
      : undefined;
    const env = ctx.envelopesByAssignmentId.get(a.assignmentId);
    const docs = inst?.resolvedDocuments || [];
    docs.forEach((d) => {
      if (d.mode !== 'esign') return;
      const key = d.key || d.docKey || '';
      const st = env?.get(key);
      if (st === 'signed') docSigned += 1;
      else if (key) docPending += 1;
    });
  });

  const docsCanonicalLine =
    readinessSys != null ? documentsAndSignaturesLineFromReadiness(readinessSys) : null;
  const documentsSummary: EmploymentDocumentsSummary = {
    applicable: docSigned + docPending > 0 || Boolean(docsCanonicalLine),
    signedCount: docSigned,
    pendingCount: docPending,
    canonicalStatusLine: docsCanonicalLine,
  };

  const systems: EmploymentEntityOverview['systems'] = {
    payroll: payrollSummary,
    screenings: screeningSummary,
    documents: documentsSummary,
  };

  if (entityKey === 'select') {
    systems.everify =
      ctx.everifySummary ??
      ({ applicable: true, statusDisplay: '—', caseCount: 0, actionNeeded: false } as EmploymentEverifySummary);
  } else {
    systems.everify = { applicable: false, statusDisplay: 'N/A (Select only)', caseCount: 0 };
  }

  const headerEntityName = ctx.entitySettings?.entityName?.trim() || label;
  const headerWorkerTypeDisplay = headerWorkerTypeDisplayFromEffective(effectiveWorkerType, entityKey);

  const pathBlockingRows = allPathRows.filter(isOnboardingPathRowBlocker);
  const headerMergedBlockers = hasOpenOnboardingDemand
    ? [...blockers, ...pathBlockingRows.map(employmentBlockerItemFromPathRow)]
    : [];
  const headerActionable = hasOpenOnboardingDemand
    ? deriveDominantActionableForHeader(pathBlockingRows, blockers)
    : 'none';
  const primaryAssignmentRow = liveAssignmentRow;
  const employmentHeaderState = deriveEmploymentHeaderState({
    onboardingPhase: ee?.onboardingPhase ?? null,
    blockers: headerMergedBlockers,
    actionableBy: headerActionable,
    assignmentStatus: primaryAssignmentRow?.status ?? null,
    entityEmploymentStatus: entityEmploymentLifecycleLower(ee),
    hasOpenOnboardingDemand,
    employmentEntryMode: ee?.employmentEntryMode ?? null,
    hasNonTerminalAssignment: liveAssignmentRow != null,
  });
  const headerReadinessExplanation = employmentHeaderStateExplanation(
    employmentHeaderState,
    {
      pathBlockerCount: hasOpenOnboardingDemand ? pathBlockerCount : 0,
      pathRowCount,
      pathDoneCount,
      pipelineBlockerCount: hasOpenOnboardingDemand ? pipelineBlockerCount : 0,
    },
    {
      noOpenOnboardingDemand: !hasOpenOnboardingDemand,
      suppressBlockerCountsInCopy: false,
    }
  );

  const lifecycleStatus = lifecycleStatusFromEmploymentHeaderState(employmentHeaderState);
  const headerEmploymentStatus = headerEmploymentStatusFromEmploymentHeaderState(employmentHeaderState);

  return {
    entityKey,
    entityLabel: label,
    entityEmployment: ee,
    workerOnboarding: pipeline,
    entitySettings: ctx.entitySettings,
    lifecycleStatus,
    readinessChip,
    headerEntityName,
    headerEmploymentStatus,
    employmentHeaderState,
    hasOpenOnboardingDemand,
    headerReadinessExplanation,
    headerWorkerTypeDisplay,
    workerType,
    percentComplete,
    requiredCount,
    completedCount,
    blockerCount: hasOpenOnboardingDemand ? pathBlockerCount : 0,
    blockers,
    assignments,
    onboardingPath,
    onboardingChecklistGroups,
    onboardingEngine,
    onboardingComplete: onboardingEngine.onboardingComplete,
    onboardingCompletionPendingItems: onboardingEngine.pendingRequiredItems,
    assignmentRequirementsViewModel,
    systems,
    workerPayrollAccount: ctx.payrollAccount,
  };
}

export type ProgressGroupId =
  | 'work_authorization'
  | 'forms_and_policies'
  | 'payroll'
  | 'screenings'
  | 'internal_readiness';

function toProgressGroupId(g: EmploymentBlockerGroupId): ProgressGroupId {
  switch (g) {
    case 'work_authorization':
    case 'forms_and_policies':
    case 'payroll':
    case 'screenings':
    case 'internal_readiness':
      return g;
    default:
      return 'internal_readiness';
  }
}

const GROUP_ORDER: ProgressGroupId[] = [
  'work_authorization',
  'forms_and_policies',
  'payroll',
  'screenings',
  'internal_readiness',
];

const GROUP_TITLES: Record<ProgressGroupId, string> = {
  work_authorization: 'Work Authorization',
  forms_and_policies: 'Company Forms & Policies',
  payroll: 'Payroll Setup',
  screenings: 'Background Checks & Screenings',
  internal_readiness: 'Your tasks',
};

export interface ProgressGroupRow {
  stepId: string;
  label: string;
  status: string;
  owner: string;
  updatedAt?: unknown;
}

export interface ProgressGroupSection {
  groupId: ProgressGroupId;
  title: string;
  summaryStatus: string;
  rows: ProgressGroupRow[];
}

export function buildProgressGroupsForEntity(
  entityKey: EmploymentEntityKey,
  pipeline: WorkerOnboardingPipeline | null
): ProgressGroupSection[] {
  const mode = workAuthUiModeFromEntityKey(entityKey);
  const steps = Array.isArray(pipeline?.steps) ? pipeline!.steps! : [];
  const tasks = Array.isArray(pipeline?.tasks) ? pipeline!.tasks! : [];

  const applicableSteps = applicableStepsForEmploymentEntity(steps as PipelineStepLike[], entityKey);

  const byGroup = new Map<ProgressGroupId, ProgressGroupRow[]>();
  GROUP_ORDER.forEach((g) => byGroup.set(g, []));

  applicableSteps.forEach((s) => {
    const stepId = String(s.id || '');
    if (!stepId) return;
    if (mode === 'hidden' && stepIdToGroupId(stepId) === 'work_authorization') return;
    if (mode === 'workforce_i9_only' && stepId === 'e_verify') return;

    const gid = toProgressGroupId(stepIdToGroupId(stepId));
    if (mode === 'hidden' && gid === 'work_authorization') return;

    const list = byGroup.get(gid);
    if (!list) return;
    list.push({
      stepId,
      label: (s as PipelineStepRow).title || stepId,
      status: String(s.status || '—'),
      owner: ownerDisplay(stepOwnerDefault(stepId)),
      updatedAt: (s as PipelineStepRow).updatedAt,
    });
  });

  tasks.forEach((t) => {
    const sid = String(t.stepId || '');
    if (mode === 'hidden' && sid && stepIdToGroupId(sid) === 'work_authorization') return;
    if (mode === 'workforce_i9_only' && sid === 'e_verify') return;
    const gid = sid ? toProgressGroupId(stepIdToGroupId(sid)) : 'internal_readiness';
    if (mode === 'hidden' && gid === 'work_authorization') return;
    const list = byGroup.get(gid);
    if (!list) return;
    list.push({
      stepId: `task:${t.id || sid}`,
      label: t.title || 'Task',
      status: String(t.status || '—'),
      owner: t.owner === 'recruiter' ? 'Recruiter' : 'Worker',
      updatedAt: undefined,
    });
  });

  return GROUP_ORDER.filter((gid) => {
    if (mode === 'hidden' && gid === 'work_authorization') return false;
    return (byGroup.get(gid)?.length ?? 0) > 0;
  }).map((gid) => {
    const rows = byGroup.get(gid) || [];
    const complete = rows.filter((r) => String(r.status).toLowerCase() === 'complete').length;
    const summaryStatus =
      rows.length === 0 ? '—' : complete === rows.length ? 'Complete' : `${complete}/${rows.length} done`;
    return {
      groupId: gid,
      title: GROUP_TITLES[gid],
      summaryStatus,
      rows,
    };
  });
}
