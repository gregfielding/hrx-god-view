/**
 * Recruiter Employment path — collapse duplicate lines (same requirement in Work Authorization +
 * Internal verification + owner buckets) into one row per requirement. Presentation only.
 *
 * Onboarding checklist: entity-driven steps only, bucketed as Tax and Identity / Handbook and Policies /
 * Payroll / Recruiter follow-up. Assignment package + screening pipeline tasks are excluded here
 * (they render under Assignment).
 */
import type {
  EmploymentOnboardingRow,
  OnboardingPathGroup,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowBlocker, isOnboardingPathRowDone } from './employmentOnboardingPath';

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
  const blocker = isOnboardingPathRowBlocker(r) ? 10 : 0;
  return base + blocker;
}

function pickRepresentativeRow(pool: EmploymentOnboardingRow[]): EmploymentOnboardingRow {
  const sorted = [...pool].sort((a, b) => rowStatusRank(b) - rowStatusRank(a));
  return sorted[0];
}

/**
 * Stable merge key: settings rows with same external key + internal pipeline tasks that mirror that requirement.
 */
export function recruiterPathRowConsolidationKey(row: EmploymentOnboardingRow): string {
  const ext = row.sourceRef?.externalStepKey?.trim();
  if (ext) return `ext:${ext}`;

  const pipe = row.sourceRef?.pipelineStepId?.trim() || '';

  if (pipe === 'i9') return 'ext:i9_employee_section';
  if (pipe === 'e_verify') return 'pipe:e_verify';
  if (pipe === 'everee') return 'ext:payroll_onboarding';

  if (row.sourceType === 'pipeline_task' && row.groupId === 'internal_readiness') {
    if (pipe === 'onboarding_forms') return `pipe:forms_task:${row.sourceRef?.taskId || row.rowId}`;
    if (pipe === 'background_check' || pipe === 'drug_screen' || pipe === 'drug_screening') {
      return 'pipe:background_check';
    }
  }

  if (pipe === 'background_check' || pipe === 'drug_screen' || pipe === 'drug_screening') {
    return 'pipe:background_check';
  }

  return `row:${row.rowId}`;
}

/** Rows that must not appear on the Onboarding checklist (Assignment / screenings surface instead). */
export function rowExcludedFromOnboardingChecklist(r: EmploymentOnboardingRow): boolean {
  if (r.groupId === 'screenings' || r.groupId === 'assignment_requirements') return true;
  if (r.sourceType === 'assignment_requirement') return true;
  if (r.groupId === 'internal_readiness' && r.sourceType === 'pipeline_task') {
    const p = String(r.sourceRef?.pipelineStepId || '').toLowerCase();
    if (p === 'background_check' || p === 'drug_screen' || p === 'drug_screening') return true;
  }
  return false;
}

/** Internal pipeline screening rows removed from onboarding — merge into Assignment > Background for ops clarity. */
export function internalPipelineScreeningRowsForAssignment(groups: OnboardingPathGroup[]): EmploymentOnboardingRow[] {
  const out: EmploymentOnboardingRow[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      if (
        r.groupId === 'internal_readiness' &&
        r.sourceType === 'pipeline_task'
      ) {
        const p = String(r.sourceRef?.pipelineStepId || '').toLowerCase();
        if (p === 'background_check' || p === 'drug_screen' || p === 'drug_screening') out.push(r);
      }
    }
  }
  return out;
}

function mapInternalOnlyRowToSection(row: EmploymentOnboardingRow): OnboardingPathGroup['groupId'] {
  const pipe = row.sourceRef?.pipelineStepId?.trim() || '';
  if (pipe === 'i9' || pipe === 'e_verify') return 'work_authorization';
  if (pipe === 'onboarding_forms') return 'forms_and_policies';
  if (pipe === 'everee') return 'payroll';
  if (pipe === 'background_check' || pipe === 'drug_screen' || pipe === 'drug_screening') return 'screenings';
  return 'forms_and_policies';
}

function synthesizeDisplayRow(bucket: EmploymentOnboardingRow[]): EmploymentOnboardingRow {
  const nonInternal = bucket.filter((r) => r.groupId !== 'internal_readiness');
  const basePool = nonInternal.length > 0 ? nonInternal : bucket;
  const base = pickRepresentativeRow(basePool);

  const anyError = bucket.some((r) => r.status === 'error');
  const allDone = bucket.every((r) => isOnboardingPathRowDone(r.status));
  const extRow = bucket.find((r) => r.sourceRef?.externalStepKey?.trim());

  let status = base.status;
  let statusLabel = base.statusLabel;
  if (anyError) {
    const err = bucket.find((r) => r.status === 'error');
    if (err) {
      status = err.status;
      statusLabel = err.statusLabel;
    }
  } else if (allDone) {
    const done =
      bucket.find((r) => r.status === 'completed') ||
      bucket.find((r) => r.status === 'satisfied_by_existing_record');
    if (done) {
      status = done.status;
      statusLabel = done.statusLabel;
    }
  }

  const satisfied = bucket.find((r) => r.satisfiedByArtifact);
  const artifactFields = satisfied
    ? {
        satisfiedByArtifact: satisfied.satisfiedByArtifact,
        artifactSourceType: satisfied.artifactSourceType,
        artifactId: satisfied.artifactId,
        artifactCompletedAt: satisfied.artifactCompletedAt,
        artifactScope: satisfied.artifactScope,
      }
    : {};

  const displayGroupId =
    nonInternal.length > 0 ? base.groupId : mapInternalOnlyRowToSection(bucket[0]);

  const anyBlocking = bucket.some((r) => isOnboardingPathRowBlocker(r));

  const canRecruiter = bucket.some(
    (r) => r.actionableBy === 'recruiter' || r.actionableBy === 'either' || r.owner === 'recruiter'
  );
  const canWorker = bucket.some((r) => r.actionableBy === 'worker' || r.actionableBy === 'either');
  let actionableBy = base.actionableBy;
  if (canRecruiter && canWorker) actionableBy = 'either';
  else if (canRecruiter && actionableBy === 'worker') actionableBy = 'either';
  else if (canRecruiter && actionableBy === 'none') actionableBy = 'recruiter';

  const mergedNarrativeSummaries = bucket
    .map((r) => r.narrative?.summary?.trim())
    .filter(Boolean) as string[];
  const primaryNarrative =
    base.narrative ||
    (mergedNarrativeSummaries.length
      ? { summary: mergedNarrativeSummaries[0], events: base.narrative?.events }
      : undefined);

  const onlyScreeningPipelineTasks =
    bucket.length > 0 &&
    bucket.every((r) => {
      if (r.sourceType !== 'pipeline_task') return false;
      const p = String(r.sourceRef?.pipelineStepId || '');
      return p === 'background_check' || p === 'drug_screen' || p === 'drug_screening';
    });

  const row: EmploymentOnboardingRow = {
    ...base,
    groupId: displayGroupId,
    status,
    statusLabel,
    actionableBy,
    required: bucket.some((r) => r.required),
    blocking: anyBlocking,
    sourceRef: {
      ...base.sourceRef,
      externalStepKey: extRow?.sourceRef?.externalStepKey ?? base.sourceRef?.externalStepKey,
      requirementKey: extRow?.sourceRef?.requirementKey ?? base.sourceRef?.requirementKey,
      pipelineStepId:
        base.sourceRef?.pipelineStepId ??
        bucket.find((b) => b.sourceRef?.pipelineStepId)?.sourceRef?.pipelineStepId,
    },
    narrative: primaryNarrative,
    ...artifactFields,
  };

  if (displayGroupId === 'screenings' && onlyScreeningPipelineTasks) {
    return { ...row, label: 'Review background check' };
  }

  return row;
}

export type RecruiterOnboardingDisplayBucketId =
  | 'tax_and_identity'
  | 'handbook_and_policies'
  | 'payroll'
  | 'recruiter_followup';

const DISPLAY_BUCKET_ORDER: RecruiterOnboardingDisplayBucketId[] = [
  'tax_and_identity',
  'handbook_and_policies',
  'payroll',
  'recruiter_followup',
];

const DISPLAY_BUCKET_TITLE: Record<RecruiterOnboardingDisplayBucketId, string> = {
  tax_and_identity: 'Tax and Identity',
  handbook_and_policies: 'Handbook and Policies',
  payroll: 'Payroll',
  recruiter_followup: 'Recruiter follow-up',
};

export interface RecruiterConsolidatedPathItem {
  row: EmploymentOnboardingRow;
  mergedSources: EmploymentOnboardingRow[];
  /** Recruiter pipeline task merged into this line (TempWorks task checkbox). */
  internalTaskRow?: EmploymentOnboardingRow;
  /**
   * When true, this row may gate `onboardingComplete` even under Recruiter follow-up (v1: always false).
   * Set via `recruiterFollowUpIsGatingForConsolidatedItem` when product policy requires it.
   */
  isGating: boolean;
}

/**
 * Future hook: return true for recruiter follow-up checklist rows that must gate entity onboarding completion.
 * v1: always false (non-gating). Wire to feature flags / tenant policy when follow-ups should block completion.
 */
export function recruiterFollowUpIsGatingForConsolidatedItem(_item: RecruiterConsolidatedPathItem): boolean {
  return false;
}

/** Map one consolidated checklist item to an Onboarding sub-section (entity-driven IA). */
export function recruiterOnboardingSubsectionForItem(item: RecruiterConsolidatedPathItem): RecruiterOnboardingDisplayBucketId {
  const sources = [item.row, ...item.mergedSources];
  for (const r of sources) {
    if (r.groupId !== 'internal_readiness') continue;
    const pipe = String(r.sourceRef?.pipelineStepId || '').toLowerCase();
    if (pipe === 'everee') return 'payroll';
    if (pipe === 'i9' || pipe === 'e_verify' || pipe === 'onboarding_forms') return 'tax_and_identity';
  }

  const r = item.row;
  if (r.groupId === 'work_authorization') return 'tax_and_identity';
  if (r.groupId === 'payroll') return 'payroll';

  if (r.groupId === 'forms_and_policies') {
    const blob = `${r.sourceRef?.externalStepKey || ''} ${r.label || ''} ${r.stepKey || ''}`.toLowerCase();
    if (
      /\b(w-4|w4|w-9|w9|1099|withhold|withholding|tax|i-9|i9|ein|w2|w-2)\b/.test(blob) &&
      !/\bhandbook\b/.test(blob)
    ) {
      return 'tax_and_identity';
    }
    return 'handbook_and_policies';
  }

  if (r.groupId === 'internal_readiness') {
    const pipe = String(r.sourceRef?.pipelineStepId || '').toLowerCase();
    if (pipe === 'everee') return 'payroll';
    if (pipe === 'i9' || pipe === 'e_verify' || pipe === 'onboarding_forms') return 'tax_and_identity';
    return 'recruiter_followup';
  }

  return 'recruiter_followup';
}

const ONBOARDING_CHECKLIST_SOURCE_ORDER: OnboardingPathGroup['groupId'][] = [
  'work_authorization',
  'forms_and_policies',
  'payroll',
  'internal_readiness',
];

export interface RecruiterConsolidatedPathGroup {
  groupId: RecruiterOnboardingDisplayBucketId;
  title: string;
  doneCount: number;
  totalCount: number;
  blockerCount: number;
  items: RecruiterConsolidatedPathItem[];
}

/** @deprecated Legacy section titles — use DISPLAY_BUCKET_TITLE / recruiter buckets. */
export const RECRUITER_PATH_SECTION_TITLE: Record<OnboardingPathGroup['groupId'], string> = {
  work_authorization: 'Work Authorization',
  forms_and_policies: 'Company Forms & Policies',
  payroll: 'Payroll Setup',
  screenings: 'Background Checks & Screenings',
  assignment_requirements: 'Assignment Requirements',
  internal_readiness: 'Your tasks',
};

/**
 * Flatten relationship-path groups, merge duplicate rows, bucket into Onboarding sub-sections.
 * Excludes assignment package rows and screening pipeline tasks (see rowExcludedFromOnboardingChecklist).
 */
export function consolidateRecruiterOnboardingPathGroups(groups: OnboardingPathGroup[]): RecruiterConsolidatedPathGroup[] {
  const groupMap = new Map(groups.map((g) => [g.groupId, g]));
  const flat: EmploymentOnboardingRow[] = [];
  for (const gid of ONBOARDING_CHECKLIST_SOURCE_ORDER) {
    const g = groupMap.get(gid);
    if (!g?.rows.length) continue;
    for (const r of g.rows) {
      if (!rowExcludedFromOnboardingChecklist(r)) flat.push(r);
    }
  }

  const keyToRows = new Map<string, EmploymentOnboardingRow[]>();
  const keyOrder: string[] = [];
  for (const r of flat) {
    const k = recruiterPathRowConsolidationKey(r);
    if (!keyToRows.has(k)) {
      keyToRows.set(k, []);
      keyOrder.push(k);
    }
    keyToRows.get(k)!.push(r);
  }

  const items: RecruiterConsolidatedPathItem[] = keyOrder.map((k) => {
    const bucket = keyToRows.get(k)!;
    const row = synthesizeDisplayRow(bucket);
    const internalTaskRow = bucket.find(
      (r) =>
        r.groupId === 'internal_readiness' &&
        r.sourceType === 'pipeline_task' &&
        (r.actionableBy === 'recruiter' || r.owner === 'recruiter')
    );
    const draft: RecruiterConsolidatedPathItem = {
      row,
      mergedSources: bucket,
      internalTaskRow,
      isGating: false,
    };
    const subsection = recruiterOnboardingSubsectionForItem(draft);
    draft.isGating =
      subsection === 'recruiter_followup' && recruiterFollowUpIsGatingForConsolidatedItem(draft);
    return draft;
  });

  const byBucket = new Map<RecruiterOnboardingDisplayBucketId, RecruiterConsolidatedPathItem[]>();
  for (const item of items) {
    const b = recruiterOnboardingSubsectionForItem(item);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b)!.push(item);
  }

  const result: RecruiterConsolidatedPathGroup[] = [];
  for (const bid of DISPLAY_BUCKET_ORDER) {
    const list = byBucket.get(bid);
    if (!list?.length) continue;
    const doneCount = list.filter((it) => isOnboardingPathRowDone(it.row.status)).length;
    const totalCount = list.length;
    const blockerCount = list.filter((it) => isOnboardingPathRowBlocker(it.row)).length;
    result.push({
      groupId: bid,
      title: DISPLAY_BUCKET_TITLE[bid],
      doneCount,
      totalCount,
      blockerCount,
      items: list,
    });
  }

  return result;
}
