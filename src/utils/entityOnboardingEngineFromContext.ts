/**
 * Single pipeline for onboarding path + engine: same inputs and steps as User Profile Employment overview.
 * Cloud Functions bundle this module so worker_onboarding triggers match UI evaluation (not a minimal path-args shortcut).
 */

import type {
  EmploymentAssignmentSummary,
  EmploymentEverifySummary,
  EmploymentEntityKey,
  EntityEmploymentRecord,
  EntityOnboardingEngineResult,
  EntityTabSettingsSnapshot,
  EmploymentOnboardingRow,
  OnboardingInstanceSnapshot,
  OnboardingPathGroup,
  SignatureEnvelopeStatus,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { OnboardingAutomationDispatchBrief, EverifyCaseNarrativeBrief } from './employmentOnboardingNarrative';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { WorkerPayrollAccount } from '../types/payroll';
import type { AssignmentReadinessV1Snapshot } from '../types/assignmentReadinessV1';
import {
  buildOnboardingPathFromSettings,
  filterEntityRelationshipOnboardingPathGroups,
  isOnboardingPathRowBlocker,
  isOnboardingPathRowDone,
} from './employmentOnboardingPath';
import { enrichOnboardingPathWithNarrativesFromOverviewDeps } from './employmentOnboardingNarrative';
import { evaluateEntityOnboardingEngineFromOnboardingChecklistGroups } from './entityOnboardingCompletion';

/** Mirrors `BuildOverviewContext` fields required to build path + run engine (subset of employmentReadiness). */
export interface EntityOnboardingEngineBuildContext {
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
  allTenantWorkerBackgroundChecks: BackgroundCheckRecord[];
  everifyCaseBriefs?: EverifyCaseNarrativeBrief[];
  automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
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

/** Same filter as `employmentReadiness` checklist (entity relationship path only). */
export function filterEntityOnboardingChecklistPathGroups(groups: OnboardingPathGroup[]): OnboardingPathGroup[] {
  return groups
    .map((g) =>
      recomputeOnboardingPathGroupCounts({
        ...g,
        rows: g.rows.filter(omitInternalOnboardingFormsTasksFromChecklist),
      })
    )
    .filter((g) => g.rows.length > 0);
}

export function buildAssignmentsSummaryFromEngineContext(
  ctx: EntityOnboardingEngineBuildContext
): EmploymentAssignmentSummary[] {
  return ctx.assignmentsRows.map((row) => {
    const inst = row.onboardingInstanceId
      ? ctx.onboardingByInstanceId.get(row.onboardingInstanceId)
      : undefined;
    const env = ctx.envelopesByAssignmentId.get(row.assignmentId);
    return {
      assignmentId: row.assignmentId,
      jobOrderId: row.jobOrderId ?? null,
      title: row.jobTitle ?? null,
      status: row.status ?? null,
      onboardingInstanceId: row.onboardingInstanceId ?? null,
      onboardingStatus: row.onboardingStatus ?? inst?.status ?? null,
      onboardingPercent: row.onboardingPercent ?? inst?.percentComplete ?? null,
      startDate: row.startDate ?? null,
      resolvedRequirementsSummary: countResolvedRequirements(inst, env),
      assignmentReadinessV1: row.assignmentReadinessV1 ?? null,
    };
  });
}

/**
 * Full onboarding path after narrative enrichment — same as Employment tab before relationship/assignment split.
 */
export function buildEnrichedFullOnboardingPathFromEngineContext(
  ctx: EntityOnboardingEngineBuildContext
): { assignments: EmploymentAssignmentSummary[]; fullOnboardingPath: OnboardingPathGroup[] } {
  const { entityKey, entityEmployment: ee, workerOnboarding: pipeline } = ctx;
  const assignments = buildAssignmentsSummaryFromEngineContext(ctx);
  const noAssignmentsForEntity = ctx.assignmentsRows.length === 0;
  const allTenantChecksForPath = noAssignmentsForEntity ? [] : ctx.allTenantWorkerBackgroundChecks;

  let fullOnboardingPath = buildOnboardingPathFromSettings({
    entityKey,
    entitySettings: ctx.entitySettings,
    pipeline,
    assignments,
    onboardingByInstanceId: ctx.onboardingByInstanceId,
    envelopesByAssignmentId: ctx.envelopesByAssignmentId,
    everifySummary: entityKey === 'select' ? ctx.everifySummary : null,
    payrollAccount: ctx.payrollAccount,
    backgroundChecksForEntity: ctx.backgroundChecksForEntity,
    allTenantWorkerBackgroundChecks: allTenantChecksForPath,
    everifyCaseBriefs: entityKey === 'select' ? ctx.everifyCaseBriefs : undefined,
    employmentRecordWorkerType: ee?.workerType ?? null,
  });

  fullOnboardingPath = enrichOnboardingPathWithNarrativesFromOverviewDeps(fullOnboardingPath, {
    workerOnboarding: pipeline,
    payrollAccount: ctx.payrollAccount,
    backgroundChecksForEntity: ctx.backgroundChecksForEntity,
    allTenantWorkerBackgroundChecks: allTenantChecksForPath,
    envelopesByAssignmentId: ctx.envelopesByAssignmentId,
    onboardingByInstanceId: ctx.onboardingByInstanceId,
    assignments,
    everifyCaseBriefs: entityKey === 'select' ? ctx.everifyCaseBriefs : undefined,
    narrativeAudience: 'admin',
    automationDispatchBriefs: ctx.automationDispatchBriefs,
  });

  return { assignments, fullOnboardingPath };
}

export function computeEntityOnboardingEngineFromEnrichedFullPath(
  fullOnboardingPath: OnboardingPathGroup[],
  pipeline: WorkerOnboardingPipeline | null
): EntityOnboardingEngineResult {
  const onboardingPath = filterEntityRelationshipOnboardingPathGroups(fullOnboardingPath);
  const onboardingChecklistGroups = filterEntityOnboardingChecklistPathGroups(onboardingPath);
  return evaluateEntityOnboardingEngineFromOnboardingChecklistGroups(onboardingChecklistGroups, pipeline);
}

/** Use this from UI and Cloud Functions so evaluation matches. */
export function computeEntityOnboardingEngineFromBuildContext(
  ctx: EntityOnboardingEngineBuildContext
): EntityOnboardingEngineResult {
  const { fullOnboardingPath } = buildEnrichedFullOnboardingPathFromEngineContext(ctx);
  return computeEntityOnboardingEngineFromEnrichedFullPath(fullOnboardingPath, ctx.workerOnboarding);
}
