import type {
  EmploymentAssignmentSummary,
  EmploymentEntityKey,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { normalizeEntityKey } from './employmentEntityPresentation';
import {
  computeHasOpenOnboardingDemand,
  deriveEmploymentHeaderStateWorkerListFallback,
  primaryAssignmentRowForHeader,
} from './deriveEmploymentHeaderState';
import type { I9EmploymentDocsSubstatus } from './i9SupportingDocumentsViewModel';
import {
  i9SubstatusToWorkerHint,
  type WorkerEmploymentTranslateFn,
  workerEmploymentHubNextStepLine,
  workerEmploymentSurfaceStatusLabel,
} from './workerEmploymentWorkerSurface';

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

export interface EntityEmploymentRecord {
  id: string;
  userId: string;
  entityId?: string | null;
  entityKey: string;
  entityName: string;
  workerType: string;
  status: string;
  onboardingPipelineId: string;
  onboardingPhase?: string | null;
  onboardingCompletedAt?: { toDate: () => Date } | null;
  employmentEntryMode?: string | null;
  /** Recruiter marked I-9 supporting docs complete outside HRX uploads. */
  i9SupportingDocumentsManualCompleteAt?: { toDate: () => Date } | null;
}

export const MY_EMPLOYMENT_LIST_HEADER_COLOR: Record<
  string,
  'default' | 'warning' | 'success' | 'error' | 'info' | 'primary'
> = {
  not_started: 'default',
  in_progress: 'primary',
  action_required: 'warning',
  waiting_on_company: 'info',
  ready: 'success',
  on_assignment: 'success',
  terminated: 'error',
  inactive: 'default',
};

export interface WorkerMyEmploymentListRowModel {
  entityDisplayName: string;
  progressText: string | null;
  /** Worker-friendly one-liner for profile list (I-9 + onboarding). */
  nextStepLine: string | null;
  statusChipLabel: string;
  listHistoricalChip: boolean;
  listChipColor: 'default' | 'warning' | 'success' | 'error' | 'info' | 'primary';
  workerTypeLabel: 'W-2' | '1099' | null;
}

export function buildWorkerMyEmploymentListRowModel(
  rec: EntityEmploymentRecord,
  stepCounts: Record<string, { complete: number; total: number }>,
  assignmentsByEntityKey: Record<EmploymentEntityKey, EmploymentAssignmentSummary[]> | null,
  options?: {
    /** Scoped I-9 substatus for this entity when rows match `requestedForEntityId` (or single-employment fallback). */
    i9Substatus?: I9EmploymentDocsSubstatus | null;
    totalEmploymentRecords?: number;
    /** Payroll I-9 verified — supporting uploads are optional for list next-step copy. */
    i9EmployeeSectionComplete?: boolean;
    /** Worker UI language (`useT()`). */
    tr?: WorkerEmploymentTranslateFn;
  },
): WorkerMyEmploymentListRowModel {
  const tr = options?.tr;
  const counts = stepCounts[rec.onboardingPipelineId];
  const isComplete = rec.status === 'active' || rec.onboardingCompletedAt != null;
  const entityKey = normalizeEntityKey(rec.entityKey);
  const rowAssignments =
    assignmentsByEntityKey != null && entityKey ? assignmentsByEntityKey[entityKey] : undefined;
  const hasOpenOnboardingDemand = computeHasOpenOnboardingDemand({
    assignments: rowAssignments,
    entityEmploymentStatus: rec.status,
    employmentEntryMode: rec.employmentEntryMode ?? null,
  });
  const primaryAssign = primaryAssignmentRowForHeader(rowAssignments);
  const pipelineIncomplete = Boolean(counts && counts.total > 0 && counts.complete < counts.total);
  /** Bridge-pass: do not show step counts; status is on the chip. nextStepLine still uses I-9 / state hints. */
  const progressText: string | null = null;
  const headerState = deriveEmploymentHeaderStateWorkerListFallback({
    onboardingPhase: rec.onboardingPhase,
    entityEmploymentStatus: rec.status,
    pipelineIncomplete,
    hasOpenOnboardingDemand,
    employmentEntryMode: rec.employmentEntryMode ?? null,
    hasNonTerminalAssignment: primaryAssign != null,
  });
  const surfaceLabel = workerEmploymentSurfaceStatusLabel(headerState, tr);
  const terminalList = headerState === 'terminated' || headerState === 'inactive';
  const listHistoricalChip = !hasOpenOnboardingDemand && !terminalList;
  const listChipColor =
    listHistoricalChip &&
    (MY_EMPLOYMENT_LIST_HEADER_COLOR[headerState] === 'success' ||
      MY_EMPLOYMENT_LIST_HEADER_COLOR[headerState] === 'info')
      ? 'default'
      : MY_EMPLOYMENT_LIST_HEADER_COLOR[headerState] || 'default';

  const workerTypeLabel =
    rec.workerType === 'w2' ? 'W-2' : rec.workerType === '1099' ? '1099' : null;

  const i9Hint = options?.i9Substatus != null ? i9SubstatusToWorkerHint(options.i9Substatus) : 'none';
  const nextStepLine = workerEmploymentHubNextStepLine(
    {
      headerState,
      i9Hint,
      hasOpenOnboardingDemand,
      pipelineSummary: null,
      i9EmployeeSectionComplete: options?.i9EmployeeSectionComplete === true,
    },
    tr,
  );

  return {
    entityDisplayName: rec.entityName || rec.entityKey || 'Entity',
    progressText,
    nextStepLine,
    statusChipLabel: listHistoricalChip
      ? tx(tr, 'workerEmploymentHub.recordChip', 'Record · {label}', { label: surfaceLabel })
      : surfaceLabel,
    listHistoricalChip,
    listChipColor,
    workerTypeLabel,
  };
}
