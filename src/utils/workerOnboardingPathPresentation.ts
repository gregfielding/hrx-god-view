/**
 * Worker My Employment: dedupe coarse pipeline rows, partition into buckets, friendly copy.
 * Uses the same `EmploymentOnboardingRow` model as admin after `filterOnboardingPathGroupsForWorkerUi`
 * (worker labels come from `pathLabelAudience: 'worker'` on the path build).
 */

import type {
  EmploymentOnboardingRow,
  EmploymentOnboardingRowStatus,
  OnboardingPathGroup,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { WorkerEmploymentTranslateFn } from './workerEmploymentWorkerSurface';
import { isOnboardingPathRowBlocker, isOnboardingPathRowDone } from './employmentOnboardingPath';

function tx(
  tr: WorkerEmploymentTranslateFn | undefined,
  key: string,
  en: string,
  params?: Record<string, string | number>,
): string {
  if (!tr) {
    if (!params) return en;
    return en.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    );
  }
  const v = tr(key, params);
  if (v !== key) return v;
  if (!params) return en;
  return en.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

/** Known merged bundle titles from `bundleTitleForPipelineStep` / group fallbacks — translate for worker locale. */
const WORKER_BUNDLE_LABEL_EN_TO_I18N: Record<string, string> = {
  'Forms and tax documents': 'workerEmploymentDetail.bundleFormsTax',
  'Payroll setup': 'workerEmploymentDetail.bundlePayrollSetup',
  'Work authorization': 'workerEmploymentDetail.bundleWorkAuth',
  'Employment verification': 'workerEmploymentDetail.bundleEmploymentVerification',
  'Background check': 'workerEmploymentDetail.bundleBackgroundCheck',
  Screening: 'workerEmploymentDetail.bundleScreening',
  Screenings: 'workerEmploymentDetail.bundleScreenings',
  Payroll: 'workerEmploymentDetail.bundlePayroll',
} as const satisfies Record<string, string>;

export function translateWorkerOnboardingBundleLabel(
  label: string,
  tr?: WorkerEmploymentTranslateFn,
): string {
  if (!tr) return label;
  const key = WORKER_BUNDLE_LABEL_EN_TO_I18N[label];
  if (!key) return label;
  const v = tr(key);
  return v !== key ? v : label;
}

export type WorkerOnboardingBucketId = 'your_tasks' | 'waiting_team' | 'behind_scenes' | 'completed';

function statusRank(s: EmploymentOnboardingRowStatus): number {
  switch (s) {
    case 'error':
      return 0;
    case 'not_started':
      return 1;
    case 'in_progress':
      return 2;
    case 'completed':
      return 3;
    case 'satisfied_by_existing_record':
      return 4;
    case 'not_required':
      return 5;
    default:
      return 2;
  }
}

/** Assignment rows stay separate; Settings rows with same pipeline step merge for worker clarity. */
export function workerOnboardingDedupeKey(row: EmploymentOnboardingRow): string {
  if (row.groupId === 'assignment_requirements' || row.sourceType === 'assignment_requirement') {
    return `assign:${row.rowId}`;
  }
  const pid = row.sourceRef?.pipelineStepId;
  if (pid) return `pipe:${pid}`;
  return `row:${row.rowId}`;
}

/** Public alias: worker-facing group id (collapse key). */
export function deriveWorkerGroupKey(row: EmploymentOnboardingRow): string {
  return workerOnboardingDedupeKey(row);
}

function mergeActionableForGroup(members: EmploymentOnboardingRow[]): EmploymentOnboardingRow['actionableBy'] {
  const active = members.filter((m) => !isOnboardingPathRowDone(m.status));
  if (active.length === 0) {
    return members[0]!.actionableBy;
  }
  const order: EmploymentOnboardingRow['actionableBy'][] = ['worker', 'either', 'recruiter', 'none'];
  for (const p of order) {
    if (active.some((m) => m.actionableBy === p)) return p;
  }
  return active[0]!.actionableBy;
}

function bundleTitleForPipelineStep(
  pipelineStepId: string | undefined,
  groupId: EmploymentOnboardingRow['groupId']
): string | null {
  switch (pipelineStepId) {
    case 'onboarding_forms':
      return 'Forms and tax documents';
    case 'everee':
      return 'Payroll setup';
    case 'i9':
      return 'Work authorization';
    case 'e_verify':
      return 'Employment verification';
    case 'background_check':
      return 'Background check';
    case 'drug_screen':
      return 'Screening';
    default:
      break;
  }
  if (groupId === 'payroll') return 'Payroll setup';
  if (groupId === 'screenings') return 'Screenings';
  if (groupId === 'work_authorization') return 'Work authorization';
  if (groupId === 'forms_and_policies') return 'Forms and tax documents';
  return null;
}

function mergeRowGroup(group: EmploymentOnboardingRow[]): EmploymentOnboardingRow {
  const sorted = [...group].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  const worst = sorted[0]!;
  const bundle =
    bundleTitleForPipelineStep(worst.sourceRef?.pipelineStepId, worst.groupId) ?? worst.label;
  const anyBlocker = sorted.some((m) => isOnboardingPathRowBlocker(m));
  const pipelineStepId = worst.sourceRef?.pipelineStepId ?? null;
  return {
    ...worst,
    rowId: `${worst.rowId}__worker_bundle`,
    label: bundle,
    workerGroupKey: deriveWorkerGroupKey(worst),
    workerGroupPipelineStepId: pipelineStepId,
    workerGroupDetailRows: sorted.map((r) => ({ ...r })),
    blocking: anyBlocker,
    required: sorted.some((m) => m.required),
    actionableBy: mergeActionableForGroup(sorted),
  };
}

/**
 * Collapse rows that share the same worker group key (same `pipelineStepId` for settings rows;
 * assignment rows stay one per `rowId`). Worst status wins; blocking/actionable aggregated across members.
 * Sets `workerGroupKey` on every output row; `workerGroupDetailRows` when more than one source row.
 */
export function dedupeWorkerOnboardingRows(rows: EmploymentOnboardingRow[]): EmploymentOnboardingRow[] {
  const byKey = new Map<string, EmploymentOnboardingRow[]>();
  for (const row of rows) {
    const k = workerOnboardingDedupeKey(row);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(row);
  }
  const out: EmploymentOnboardingRow[] = [];
  for (const [, group] of byKey) {
    if (group.length === 1) {
      const only = group[0]!;
      out.push({
        ...only,
        workerGroupKey: deriveWorkerGroupKey(only),
        workerGroupPipelineStepId: only.sourceRef?.pipelineStepId ?? null,
      });
    } else {
      out.push(mergeRowGroup(group));
    }
  }
  return out;
}

export function flattenFilteredWorkerGroups(groups: OnboardingPathGroup[]): EmploymentOnboardingRow[] {
  return groups.flatMap((g) => g.rows);
}

export function bucketForWorkerRow(row: EmploymentOnboardingRow): WorkerOnboardingBucketId {
  if (isOnboardingPathRowDone(row.status)) return 'completed';
  if (row.actionableBy === 'worker' || row.actionableBy === 'either') return 'your_tasks';
  if (row.actionableBy === 'recruiter') return 'waiting_team';
  if (row.actionableBy === 'none' && (row.owner === 'system' || row.owner === 'vendor')) return 'behind_scenes';
  return 'waiting_team';
}

export function partitionWorkerOnboardingRows(rows: EmploymentOnboardingRow[]): Record<
  WorkerOnboardingBucketId,
  EmploymentOnboardingRow[]
> {
  const buckets: Record<WorkerOnboardingBucketId, EmploymentOnboardingRow[]> = {
    your_tasks: [],
    waiting_team: [],
    behind_scenes: [],
    completed: [],
  };
  for (const row of rows) {
    buckets[bucketForWorkerRow(row)].push(row);
  }
  return buckets;
}

/**
 * Worker-facing requirement line (no “blocking” wording). Omitted when the step is already done.
 */
export function workerOnboardingRequirementLabel(
  row: EmploymentOnboardingRow,
  tr?: WorkerEmploymentTranslateFn,
): string | null {
  if (isOnboardingPathRowDone(row.status)) return null;
  if (row.blocking) return tx(tr, 'workerEmploymentDetail.reqBeforeStart', 'Required before you start');
  if (row.required) return tx(tr, 'workerEmploymentDetail.reqForOnboarding', 'Required for onboarding');
  return tx(tr, 'workerEmploymentDetail.optional', 'Optional');
}

/** Primary line under title — no internal jargon. */
export function workerOnboardingSubtitle(row: EmploymentOnboardingRow, tr?: WorkerEmploymentTranslateFn): string {
  if (row.status === 'satisfied_by_existing_record') {
    return tx(tr, 'workerEmploymentDetail.subtitleAlreadyOnFile', 'Already on file');
  }
  if (row.status === 'error') {
    return tx(tr, 'workerEmploymentDetail.subtitleError', 'Something went wrong. Your hiring team can help.');
  }
  if (row.status === 'completed') {
    return tx(tr, 'workerEmploymentDetail.subtitleDone', 'Done');
  }
  if (row.actionableBy === 'recruiter') {
    return tx(tr, 'workerEmploymentDetail.subtitleWaitingTeam', 'Waiting on your hiring team');
  }
  if (row.actionableBy === 'none' && row.owner === 'vendor') {
    return tx(tr, 'workerEmploymentDetail.subtitleVendorProgress', 'In progress with our screening partner');
  }
  if (row.actionableBy === 'none' && row.owner === 'system') {
    return tx(tr, 'workerEmploymentDetail.subtitleSystemProgress', 'In progress with our verification partner');
  }
  if ((row.actionableBy === 'worker' || row.actionableBy === 'either') && row.required) {
    if (isOnboardingPathRowBlocker(row)) {
      return '';
    }
    return tx(tr, 'workerEmploymentDetail.subtitleActionNeeded', 'Action needed');
  }
  if (row.status === 'in_progress') {
    return tx(tr, 'workerEmploymentDetail.subtitleInProgress', 'In progress');
  }
  if (row.status === 'not_started') {
    return tx(tr, 'workerEmploymentDetail.subtitleNotStartedYet', 'Not started yet');
  }
  return '';
}

/** Optional status chip for worker — short, friendly. */
export function workerOnboardingStatusChip(row: EmploymentOnboardingRow, tr?: WorkerEmploymentTranslateFn): string {
  if (row.status === 'satisfied_by_existing_record')
    return tx(tr, 'workerEmploymentDetail.chipOnFile', 'On file');
  if (row.status === 'error') return tx(tr, 'workerEmploymentDetail.chipNeedsAttention', 'Needs attention');
  if (row.status === 'completed') return tx(tr, 'workerEmploymentDetail.chipDone', 'Done');
  if (isOnboardingPathRowDone(row.status)) return tx(tr, 'workerEmploymentDetail.chipDone', 'Done');
  if (row.status === 'in_progress') return tx(tr, 'workerEmploymentDetail.chipInProgress', 'In progress');
  if (row.status === 'not_started') return tx(tr, 'workerEmploymentDetail.chipWaiting', 'Waiting');
  return tx(tr, 'workerEmploymentDetail.chipInProgress', 'In progress');
}

export function workerPathCoversPayrollRow(rows: EmploymentOnboardingRow[]): boolean {
  return rows.some((r) => r.sourceRef?.pipelineStepId === 'everee' || r.groupId === 'payroll');
}

export function workerPathCoversWorkAuthRows(rows: EmploymentOnboardingRow[]): boolean {
  return rows.some((r) => r.groupId === 'work_authorization');
}
