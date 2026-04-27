/**
 * Entity onboarding completion engine (hiring relationship, per entity).
 *
 * Drives section statuses + `onboardingComplete` from the same consolidated checklist rows as the
 * recruiter Onboarding IA. Excludes E-Verify, assignment package, and screenings.
 *
 * **Adapter boundary:** Section/item classification reads `worker_onboarding.externalOnboardingSteps`
 * (TempWorks today) plus normalized path row status. Everee (or other HRIS) can later supply the
 * same `ExternalOnboardingStepsState` shape or a thin mapper into these rows — without changing
 * aggregation rules below.
 */

import type {
  ExternalOnboardingStepKey,
  ExternalOnboardingStepRecord,
  ExternalOnboardingStepsState,
} from '../types/externalOnboardingSteps';
import type {
  EmploymentOnboardingRow,
  EntityOnboardingEngineResult,
  EntityOnboardingSectionStatus,
  OnboardingPathGroup,
  WorkerOnboardingPipeline,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isExternalOnboardingStepVerifiedComplete, parseExternalOnboardingSteps } from './externalOnboardingSteps';
import {
  buildOnboardingPathFromSettings,
  filterEntityRelationshipOnboardingPathGroups,
  isOnboardingPathRowBlocker,
  isOnboardingPathRowDone,
  type BuildOnboardingPathArgs,
} from './employmentOnboardingPath';
import {
  consolidateRecruiterOnboardingPathGroups,
  recruiterPathRowConsolidationKey,
  type RecruiterConsolidatedPathItem,
  type RecruiterConsolidatedPathGroup,
} from './employmentOnboardingPathRecruiterConsolidation';

/** When TempWorks I-9 is recruiter-verified, path rows merged on this key must not block entity completion. */
const I9_EMPLOYEE_SECTION_CONSOLIDATION_KEY = 'ext:i9_employee_section';

function itemSatisfiedByVerifiedI9EmployeeSection(
  item: RecruiterConsolidatedPathItem,
  ext: ExternalOnboardingStepsState | undefined
): boolean {
  const rec = ext?.i9_employee_section;
  if (!rec || !isExternalOnboardingStepVerifiedComplete(rec)) return false;
  const pool = [item.row, ...item.mergedSources];
  return pool.some((r) => recruiterPathRowConsolidationKey(r) === I9_EMPLOYEE_SECTION_CONSOLIDATION_KEY);
}

/** Sub-sections that participate in the engine (matches recruiter checklist buckets). */
export const ENTITY_ONBOARDING_COMPLETION_BUCKETS = [
  'tax_and_identity',
  'handbook_and_policies',
  'payroll',
] as const;

export type EntityOnboardingCompletionBucketId = (typeof ENTITY_ONBOARDING_COMPLETION_BUCKETS)[number];

export type EntityOnboardingCompletionPendingItem = EntityOnboardingEngineResult['pendingRequiredItems'][number];

type RowPhase = EntityOnboardingSectionStatus;

function isCompletionBucket(gid: RecruiterConsolidatedPathGroup['groupId']): gid is EntityOnboardingCompletionBucketId {
  return (ENTITY_ONBOARDING_COMPLETION_BUCKETS as readonly string[]).includes(gid);
}

/** Drop redundant recruiter pipeline tasks; payroll milestones cover forms on the checklist. Mirrors `employmentReadiness`. */
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

/** Same rows as recruiter Onboarding checklist (entity relationship, no assignment package). */
export function buildCanonicalOnboardingChecklistGroups(
  args: BuildOnboardingPathArgs
): OnboardingPathGroup[] {
  const full = buildOnboardingPathFromSettings(args);
  const relationship = filterEntityRelationshipOnboardingPathGroups(full);
  return relationship
    .map((g) =>
      recomputeOnboardingPathGroupCounts({
        ...g,
        rows: g.rows.filter(omitInternalOnboardingFormsTasksFromChecklist),
      })
    )
    .filter((g) => g.rows.length > 0);
}

export function isEverifyExcludedFromEntityOnboardingCompletion(row: EmploymentOnboardingRow): boolean {
  const pipe = String(row.sourceRef?.pipelineStepId || '').toLowerCase();
  if (pipe === 'e_verify') return true;
  if (row.sourceType === 'everify') return true;
  const sk = String(row.stepKey || '').toLowerCase();
  if (sk === 'everify_sent' || sk === 'everify_completed') return true;
  return false;
}

export function consolidatedChecklistItemIsEverifyOnlyForCompletion(item: RecruiterConsolidatedPathItem): boolean {
  if (recruiterPathRowConsolidationKey(item.row) === 'pipe:e_verify') return true;
  const sources = [item.row, ...item.mergedSources];
  if (sources.length === 0) return false;
  return sources.every(isEverifyExcludedFromEntityOnboardingCompletion);
}

function externalRecordImpliesWorkerWaiting(record: ExternalOnboardingStepRecord): boolean {
  return record.status === 'invite_sent';
}

function externalRecordImpliesPendingReview(record: ExternalOnboardingStepRecord): boolean {
  if (record.status === 'worker_completed_external' || record.status === 'pending_admin_verification') {
    return true;
  }
  if (record.status === 'completed' && !isExternalOnboardingStepVerifiedComplete(record)) {
    return true;
  }
  return false;
}

function scanExternalSignalsForItem(
  item: RecruiterConsolidatedPathItem,
  ext: ExternalOnboardingStepsState | undefined
): { pendingReview: boolean; workerWaiting: boolean } {
  if (!ext) return { pendingReview: false, workerWaiting: false };
  let pendingReview = false;
  let workerWaiting = false;
  const sources = [item.row, ...item.mergedSources];
  for (const s of sources) {
    const rawKey = s.sourceRef?.externalStepKey;
    if (!rawKey) continue;
    const rec = ext[rawKey as ExternalOnboardingStepKey];
    if (!rec) continue;
    if (externalRecordImpliesPendingReview(rec)) pendingReview = true;
    if (externalRecordImpliesWorkerWaiting(rec)) workerWaiting = true;
  }
  return { pendingReview, workerWaiting };
}

/**
 * Classify one consolidated checklist line into a coarse phase for section aggregation.
 * Uses external step records when present; otherwise path row status + recruiter task heuristics.
 */
export function classifyOnboardingItemPhase(
  item: RecruiterConsolidatedPathItem,
  ext: ExternalOnboardingStepsState | undefined
): RowPhase {
  const row = item.row;
  if (consolidatedChecklistItemIsEverifyOnlyForCompletion(item)) return 'complete';

  const { pendingReview: extPending, workerWaiting } = scanExternalSignalsForItem(item, ext);

  if (isOnboardingPathRowDone(row.status)) return 'complete';

  if (extPending) return 'pending_review';

  const sl = String(row.statusLabel || '').toLowerCase();
  if (sl.includes('needs review') || sl.includes('marked for review')) return 'pending_review';

  if (row.status === 'error') return 'pending_review';

  if (
    row.status === 'in_progress' &&
    row.sourceType === 'pipeline_task' &&
    (row.actionableBy === 'recruiter' || row.actionableBy === 'either' || row.owner === 'recruiter') &&
    !workerWaiting
  ) {
    return 'pending_review';
  }

  if (row.status === 'not_started' && !workerWaiting) return 'not_started';

  if (row.status === 'in_progress' || workerWaiting) return 'in_progress';

  if (row.status === 'not_started') return 'not_started';

  return 'in_progress';
}

/**
 * Roll up row phases for one section. Empty required set → complete (nothing to do for that section).
 */
export function aggregateSectionStatusFromRowPhases(phases: RowPhase[]): EntityOnboardingSectionStatus {
  if (phases.length === 0) return 'complete';
  if (phases.every((p) => p === 'complete')) return 'complete';
  if (phases.some((p) => p === 'pending_review')) return 'pending_review';
  if (phases.every((p) => p === 'not_started')) return 'not_started';
  return 'in_progress';
}

export function evaluateEntityOnboardingEngineFromConsolidatedGroups(
  groups: RecruiterConsolidatedPathGroup[],
  pipeline: WorkerOnboardingPipeline | null | undefined
): EntityOnboardingEngineResult {
  const ext = parseExternalOnboardingSteps(pipeline?.externalOnboardingSteps);
  const pendingRequiredItems: EntityOnboardingCompletionPendingItem[] = [];

  const sectionPhases: Record<EntityOnboardingCompletionBucketId, RowPhase[]> = {
    tax_and_identity: [],
    handbook_and_policies: [],
    payroll: [],
  };

  for (const g of groups) {
    if (!isCompletionBucket(g.groupId)) continue;
    for (const item of g.items) {
      if (consolidatedChecklistItemIsEverifyOnlyForCompletion(item)) continue;
      const r = item.row;
      if (!r.required) continue;

      const i9ExternallySatisfied = itemSatisfiedByVerifiedI9EmployeeSection(item, ext);

      if (!i9ExternallySatisfied && !isOnboardingPathRowDone(r.status)) {
        pendingRequiredItems.push({
          bucket: g.groupId,
          rowLabel: r.label,
          rowId: r.rowId,
          status: r.status,
        });
      }

      sectionPhases[g.groupId].push(
        i9ExternallySatisfied ? 'complete' : classifyOnboardingItemPhase(item, ext)
      );
    }
  }

  const taxIdentityStatus = aggregateSectionStatusFromRowPhases(sectionPhases.tax_and_identity);
  const handbookStatus = aggregateSectionStatusFromRowPhases(sectionPhases.handbook_and_policies);
  const payrollStatus = aggregateSectionStatusFromRowPhases(sectionPhases.payroll);

  const gatingPhases: RowPhase[] = [];
  for (const g of groups) {
    if (g.groupId !== 'recruiter_followup') continue;
    for (const item of g.items) {
      if (!item.isGating) continue;
      if (consolidatedChecklistItemIsEverifyOnlyForCompletion(item)) continue;
      const r = item.row;
      if (!r.required) continue;

      if (!isOnboardingPathRowDone(r.status)) {
        pendingRequiredItems.push({
          bucket: 'recruiter_followup',
          rowLabel: r.label,
          rowId: r.rowId,
          status: r.status,
        });
      }

      gatingPhases.push(classifyOnboardingItemPhase(item, ext));
    }
  }
  const recruiterFollowUpGatingStatus = aggregateSectionStatusFromRowPhases(gatingPhases);

  const onboardingComplete =
    taxIdentityStatus === 'complete' &&
    handbookStatus === 'complete' &&
    payrollStatus === 'complete' &&
    recruiterFollowUpGatingStatus === 'complete';

  return {
    taxIdentityStatus,
    handbookStatus,
    payrollStatus,
    recruiterFollowUpGatingStatus,
    onboardingComplete,
    pendingRequiredItems,
  };
}

/** @deprecated Prefer `evaluateEntityOnboardingEngineFromConsolidatedGroups`; kept for narrow imports. */
export function evaluateEntityOnboardingCompleteFromConsolidatedGroups(
  groups: RecruiterConsolidatedPathGroup[],
  pipeline?: WorkerOnboardingPipeline | null
): Pick<EntityOnboardingEngineResult, 'onboardingComplete' | 'pendingRequiredItems'> {
  const e = evaluateEntityOnboardingEngineFromConsolidatedGroups(groups, pipeline ?? null);
  return { onboardingComplete: e.onboardingComplete, pendingRequiredItems: e.pendingRequiredItems };
}

export function evaluateEntityOnboardingEngineFromOnboardingChecklistGroups(
  onboardingChecklistGroups: OnboardingPathGroup[],
  pipeline: WorkerOnboardingPipeline | null | undefined
): EntityOnboardingEngineResult {
  const consolidated = consolidateRecruiterOnboardingPathGroups(onboardingChecklistGroups);
  return evaluateEntityOnboardingEngineFromConsolidatedGroups(consolidated, pipeline);
}

export function evaluateEntityOnboardingEngineFromPathArgs(args: BuildOnboardingPathArgs): EntityOnboardingEngineResult {
  const checklist = buildCanonicalOnboardingChecklistGroups(args);
  return evaluateEntityOnboardingEngineFromOnboardingChecklistGroups(checklist, args.pipeline);
}

/** When checklist groups are already built (e.g. overview). */
export function evaluateEntityOnboardingCompleteFromOnboardingChecklistGroups(
  onboardingChecklistGroups: OnboardingPathGroup[],
  pipeline?: WorkerOnboardingPipeline | null
): Pick<EntityOnboardingEngineResult, 'onboardingComplete' | 'pendingRequiredItems'> {
  const e = evaluateEntityOnboardingEngineFromOnboardingChecklistGroups(onboardingChecklistGroups, pipeline);
  return { onboardingComplete: e.onboardingComplete, pendingRequiredItems: e.pendingRequiredItems };
}

/** Single entry for Cloud Functions bundle: path args → engine result. */
export function evaluateEntityOnboardingCompletionFromPathArgs(
  args: BuildOnboardingPathArgs
): EntityOnboardingEngineResult {
  return evaluateEntityOnboardingEngineFromPathArgs(args);
}

export type { EntityOnboardingEngineResult, EntityOnboardingSectionStatus } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
