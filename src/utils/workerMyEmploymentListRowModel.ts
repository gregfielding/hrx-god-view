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
  workerEmploymentHubNextStepLine,
  workerEmploymentSurfaceStatusLabel,
} from './workerEmploymentWorkerSurface';

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
  },
): WorkerMyEmploymentListRowModel {
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
  const progressText = (() => {
    if (isComplete) return 'Onboarding complete';
    if (!hasOpenOnboardingDemand) {
      if (counts && counts.total > 0) {
        return `Prior relationship path on file (${counts.complete} of ${counts.total} steps)`;
      }
      return 'No current assignment onboarding';
    }
    if (counts && counts.total > 0) return `${counts.complete} of ${counts.total} steps complete`;
    return null;
  })();
  const headerState = deriveEmploymentHeaderStateWorkerListFallback({
    onboardingPhase: rec.onboardingPhase,
    entityEmploymentStatus: rec.status,
    pipelineIncomplete,
    hasOpenOnboardingDemand,
    employmentEntryMode: rec.employmentEntryMode ?? null,
    hasNonTerminalAssignment: primaryAssign != null,
  });
  const surfaceLabel = workerEmploymentSurfaceStatusLabel(headerState);
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
  const nextStepLine = workerEmploymentHubNextStepLine({
    headerState,
    i9Hint,
    hasOpenOnboardingDemand,
    pipelineSummary: progressText,
    i9EmployeeSectionComplete: options?.i9EmployeeSectionComplete === true,
  });

  return {
    entityDisplayName: rec.entityName || rec.entityKey || 'Entity',
    progressText,
    nextStepLine,
    statusChipLabel: listHistoricalChip ? `Record · ${surfaceLabel}` : surfaceLabel,
    listHistoricalChip,
    listChipColor,
    workerTypeLabel,
  };
}
