/**
 * High-ROI operational row merge: E-Verify and background Settings pairs only.
 * Does not touch Firestore, assignment rows, or internal pipeline tasks.
 */

import type { EmploymentOnboardingRow } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { ONBOARDING_WORKFLOW_STEPS } from './onboardingWorkflowStepCatalog';

const EVERIFY_STEP_KEYS = new Set(['everify_sent', 'everify_completed']);
const BACKGROUND_STEP_KEYS = new Set(['background_initiated', 'background_completed']);

const WORKFLOW_STEP_ORDER = new Map(ONBOARDING_WORKFLOW_STEPS.map((d, i) => [d.id, i]));

function isRowDoneStatus(status: EmploymentOnboardingRow['status']): boolean {
  return status === 'completed' || status === 'satisfied_by_existing_record' || status === 'not_required';
}

function isRowBlocker(row: EmploymentOnboardingRow): boolean {
  if (isRowDoneStatus(row.status)) return false;
  return Boolean(row.required && row.blocking);
}

const STATUS_RANK: Record<string, number> = {
  error: 5,
  not_started: 2,
  in_progress: 3,
  completed: 1,
  satisfied_by_existing_record: 1,
  not_required: 0,
};

function rowStatusRank(r: EmploymentOnboardingRow): number {
  const base = STATUS_RANK[r.status] ?? 0;
  const blocker = isRowBlocker(r) ? 10 : 0;
  return base + blocker;
}

function pickRepresentativeRow(group: EmploymentOnboardingRow[]): EmploymentOnboardingRow {
  return [...group].sort((a, b) => rowStatusRank(b) - rowStatusRank(a))[0];
}

function pickPrimaryMilestoneRow(group: EmploymentOnboardingRow[], mergedDone: boolean): EmploymentOnboardingRow {
  const sorted = [...group].sort(
    (a, b) => (WORKFLOW_STEP_ORDER.get(a.stepKey) ?? 999) - (WORKFLOW_STEP_ORDER.get(b.stepKey) ?? 999)
  );
  if (mergedDone) {
    return sorted[sorted.length - 1] ?? group[0];
  }
  const incomplete = sorted.filter((r) => !isRowDoneStatus(r.status));
  return incomplete[0] ?? sorted[sorted.length - 1] ?? group[0];
}

function mergeAggregatedStatus(group: EmploymentOnboardingRow[]): {
  status: EmploymentOnboardingRow['status'];
  statusLabel: string;
} {
  const anyError = group.some((r) => r.status === 'error');
  if (anyError) {
    const err = group.find((r) => r.status === 'error')!;
    return { status: 'error', statusLabel: err.statusLabel };
  }

  const allDone = group.every((r) => isRowDoneStatus(r.status));
  if (allDone) {
    const done =
      group.find((r) => r.status === 'completed') ||
      group.find((r) => r.status === 'satisfied_by_existing_record') ||
      group.find((r) => r.status === 'not_required') ||
      group[0];
    return { status: done.status, statusLabel: done.statusLabel };
  }

  const anyInProgress = group.some((r) => r.status === 'in_progress');
  const anyDonePartial = group.some((r) => isRowDoneStatus(r.status));
  if (anyInProgress || anyDonePartial) {
    const ip = group.find((r) => r.status === 'in_progress');
    if (ip) {
      return { status: 'in_progress', statusLabel: ip.statusLabel };
    }
    return {
      status: 'in_progress',
      statusLabel: 'In progress — some milestones done',
    };
  }

  const ns = group.find((r) => r.status === 'not_started');
  return {
    status: 'not_started',
    statusLabel: ns?.statusLabel || 'Not started',
  };
}

function pickPreferredSourceType(group: EmploymentOnboardingRow[]): EmploymentOnboardingRow['sourceType'] {
  const order: EmploymentOnboardingRow['sourceType'][] = [
    'external_onboarding',
    'everify',
    'background_check',
    'payroll',
    'pipeline_step',
    'settings_only',
    'derived',
    'assignment_requirement',
    'pipeline_task',
  ];
  for (const t of order) {
    if (group.some((r) => r.sourceType === t)) return t;
  }
  return group[0].sourceType;
}

function mergePairInGroup(
  rows: EmploymentOnboardingRow[],
  stepKeySet: Set<string>,
  label: string,
  mergeSuffix: string
): EmploymentOnboardingRow[] {
  const members = rows.filter((r) => stepKeySet.has(r.stepKey));
  if (members.length < 2) {
    return rows;
  }

  const rest = rows.filter((r) => !stepKeySet.has(r.stepKey));
  const rep = pickRepresentativeRow(members);
  const { status, statusLabel } = mergeAggregatedStatus(members);
  const required = members.some((r) => r.required);
  const mergedDone = isRowDoneStatus(status);
  const blocking =
    !mergedDone && required && (members.some((r) => r.blocking) || status === 'error');
  const primary = pickPrimaryMilestoneRow(members, mergedDone);

  const satisfied = members.find((r) => r.satisfiedByArtifact);
  const artifactFields = satisfied
    ? {
        satisfiedByArtifact: satisfied.satisfiedByArtifact,
        artifactSourceType: satisfied.artifactSourceType,
        artifactId: satisfied.artifactId,
        artifactCompletedAt: satisfied.artifactCompletedAt,
        artifactScope: satisfied.artifactScope,
      }
    : {};

  const extFromGroup =
    members.map((r) => r.sourceRef?.externalStepKey).find((x) => x != null && x !== '') ??
    rep.sourceRef?.externalStepKey;

  const detailSnapshots = members.map((r) => ({ ...r }));

  const mergedActionableBy: EmploymentOnboardingRow['actionableBy'] =
    mergeSuffix === 'background_check' || mergeSuffix === 'e_verify' ? 'either' : primary.actionableBy;

  const merged: EmploymentOnboardingRow = {
    ...rep,
    rowId: `merged_op__${rep.entityKey}__${mergeSuffix}`,
    stepKey: primary.stepKey,
    label,
    owner: primary.owner,
    actionableBy: mergedActionableBy,
    audience: primary.audience,
    sourceType: pickPreferredSourceType(members),
    sourceRef: {
      ...rep.sourceRef,
      ...primary.sourceRef,
      mergedFromStepKeys: members.map((r) => r.stepKey),
      requirementKey: mergeSuffix === 'e_verify' ? 'e_verify' : 'background_check',
      ...(extFromGroup ? { externalStepKey: extFromGroup } : {}),
      pipelineStepId: primary.sourceRef?.pipelineStepId ?? rep.sourceRef?.pipelineStepId,
    },
    required,
    blocking,
    status,
    statusLabel,
    ...artifactFields,
    helperText: rep.helperText,
    narrative: undefined,
    lastUpdatedAt: members.reduce<string | null>((best, r) => {
      if (!r.lastUpdatedAt) return best;
      if (!best) return r.lastUpdatedAt;
      return r.lastUpdatedAt > best ? r.lastUpdatedAt : best;
    }, null),
    requirementDetailRows: detailSnapshots,
  };

  const order = new Map(rows.map((r, i) => [r.rowId, i]));
  const sortKey = (r: EmploymentOnboardingRow): number => {
    if (r.requirementDetailRows?.length) {
      return Math.min(...r.requirementDetailRows.map((x) => order.get(x.rowId) ?? 9999));
    }
    return order.get(r.rowId) ?? 9999;
  };
  const out = [...rest, merged];
  out.sort((a, b) => sortKey(a) - sortKey(b));
  return out;
}

/** `work_authorization` group: collapse everify_sent + everify_completed when both enabled. */
export function mergeEverifyOperationalPathRows(rows: EmploymentOnboardingRow[]): EmploymentOnboardingRow[] {
  return mergePairInGroup(rows, EVERIFY_STEP_KEYS, 'E-Verify', 'e_verify');
}

/** `screenings` group: collapse background_initiated + background_completed when both enabled. */
export function mergeBackgroundOperationalPathRows(rows: EmploymentOnboardingRow[]): EmploymentOnboardingRow[] {
  return mergePairInGroup(rows, BACKGROUND_STEP_KEYS, 'Background check', 'background_check');
}
