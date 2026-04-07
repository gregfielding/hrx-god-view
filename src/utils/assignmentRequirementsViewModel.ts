/**
 * Job-specific onboarding package + entity screening milestones for Employment V2 IA:
 * entity path = relationship; assignment requirements = job obligations.
 */

import type {
  AssignmentRequirementItemVm,
  AssignmentRequirementsViewModel,
  EmploymentAssignmentSummary,
  EmploymentOnboardingRow,
  EmploymentEntityKey,
  OnboardingInstanceSnapshot,
  OnboardingPathGroup,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { normalizeAssignmentStatus } from './assignmentStatusNormalize';
import {
  assignmentReadinessStateDisplay,
  isAssignmentSummaryTerminal,
  packageSectionsSummaryFromReadiness,
  screeningLineFromReadiness,
} from './assignmentReadinessUi';
import type { SignatureEnvelopeStatus } from '../types/phase1cOnboarding';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { OnboardingAutomationDispatchBrief } from './employmentOnboardingNarrative';
import {
  filterScreeningAutomationDispatchBriefs,
  isScreeningPackageCheckKey,
  screeningAutomationSyntheticRowContent,
  screeningOrderRequirementStatusLabel,
} from './employmentOnboardingNarrative';
import { internalPipelineScreeningRowsForAssignment } from './employmentOnboardingPathRecruiterConsolidation';

const CERT_LIKE = /cert|license|credential|clearance|osi/i;

function parseAssignmentRowSuffix(row: EmploymentOnboardingRow): { kind: 'doc' | 'step' | 'check' | 'other'; key: string } | null {
  const m = /^assignment__.+?__(doc|step|check)__(.+)$/.exec(row.rowId);
  if (!m) return null;
  return { kind: m[1] as 'doc' | 'step' | 'check', key: m[2] };
}

function isCertLikeCheck(key: string, title: string | undefined): boolean {
  return CERT_LIKE.test(`${key} ${title || ''}`);
}

function screeningStatusLabel(r: BackgroundCheckRecord): string {
  const st = String(r.hrxStatus || 'unknown');
  const map: Record<string, string> = {
    completed: 'Completed',
    report_ready: 'Report ready',
    drug_report_ready: 'Drug report ready',
    in_progress: 'In progress',
    awaiting_applicant: 'Awaiting applicant',
    submitted: 'Submitted',
    queued: 'Queued',
    draft: 'Draft',
    canceled: 'Canceled',
    error: 'Error',
  };
  return map[st] || st.replace(/_/g, ' ');
}

/**
 * Prefer active assignment (non-terminal status); then latest start date; then stable order.
 */
export function pickPrimaryAssignmentForEmploymentIA(
  assignments: EmploymentAssignmentSummary[]
): EmploymentAssignmentSummary | null {
  if (!assignments.length) return null;
  const assignmentRowIsTerminal = (row: EmploymentAssignmentSummary) => {
    if (isAssignmentSummaryTerminal(row)) return true;
    const s = String(row.status || '').toLowerCase();
    return ['closed', 'terminated'].some((t) => s.includes(t));
  };
  const decorated = assignments.map((a, order) => ({
    a,
    order,
    isTerm: assignmentRowIsTerminal(a),
    start: a.startDate ? Date.parse(a.startDate) : NaN,
  }));
  decorated.sort((x, y) => {
    if (x.isTerm !== y.isTerm) return x.isTerm ? 1 : -1;
    const xs = Number.isFinite(x.start) ? x.start : -Infinity;
    const ys = Number.isFinite(y.start) ? y.start : -Infinity;
    if (xs !== ys) return ys - xs;
    return x.order - y.order;
  });
  const chosen = decorated[0]?.a ?? null;
  if (!chosen) return null;
  /** No live assignment — do not treat a terminal row as “primary” for current package requirements. */
  if (assignmentRowIsTerminal(chosen)) return null;
  return chosen;
}

export function findOnboardingPathGroup(
  groups: OnboardingPathGroup[],
  groupId: OnboardingPathGroup['groupId']
): OnboardingPathGroup | undefined {
  return groups.find((g) => g.groupId === groupId);
}

function itemFromScreeningRow(row: EmploymentOnboardingRow): AssignmentRequirementItemVm {
  return {
    id: row.rowId,
    category: 'entity_screening_milestone',
    title: row.label,
    statusLabel: row.statusLabel,
    blocking: row.blocking,
    pathRow: row,
  };
}

function itemFromAssignmentRow(row: EmploymentOnboardingRow, category: AssignmentRequirementItemVm['category']): AssignmentRequirementItemVm {
  return {
    id: row.rowId,
    category,
    title: row.label,
    statusLabel: row.statusLabel,
    blocking: row.blocking,
    pathRow: row,
  };
}

function itemFromBackgroundRecord(r: BackgroundCheckRecord): AssignmentRequirementItemVm {
  const title =
    [r.requestedPackageName, r.candidateName].filter(Boolean).join(' · ') || `Screening order ${r.id.slice(0, 8)}…`;
  return {
    id: `bg__${r.id}`,
    category: 'screening_order',
    title,
    statusLabel: screeningStatusLabel(r),
    blocking: false,
  };
}

export interface BuildAssignmentRequirementsViewModelArgs {
  fullOnboardingPathGroups: OnboardingPathGroup[];
  assignments: EmploymentAssignmentSummary[];
  onboardingByInstanceId: Map<string, OnboardingInstanceSnapshot>;
  envelopesByAssignmentId: Map<string, Map<string, SignatureEnvelopeStatus>>;
  backgroundChecksForEntity: BackgroundCheckRecord[];
  entityKey: EmploymentEntityKey;
  /** Same entity-filtered list as employment overview narrative (includes screening_auto_* rows). */
  automationDispatchBriefs?: OnboardingAutomationDispatchBrief[];
}

function emptyAssignmentRequirementsViewModel(entityKey: EmploymentEntityKey): AssignmentRequirementsViewModel {
  return {
    entityKey,
    hasPrimaryAssignment: false,
    primaryAssignmentId: null,
    primaryJobTitle: null,
    primaryJobOrderId: null,
    primaryAssignmentStatus: null,
    onboardingInstanceId: null,
    onboardingPackageStatus: null,
    onboardingPercentComplete: null,
    entityScreeningMilestones: [],
    requiredChecks: [],
    requiredCertifications: [],
    requiredUploads: [],
    assignmentDocuments: [],
    adminSteps: [],
    backgroundOrdersLinked: [],
    openBlockerCount: 0,
    primaryAssignmentReadinessV1: null,
    primaryCanonicalReadinessHeadline: null,
    primaryCanonicalScreeningLine: null,
    primaryCanonicalPackageLine: null,
  };
}

export function buildAssignmentRequirementsViewModel(args: BuildAssignmentRequirementsViewModelArgs): AssignmentRequirementsViewModel {
  const {
    fullOnboardingPathGroups,
    assignments,
    onboardingByInstanceId,
    envelopesByAssignmentId,
    backgroundChecksForEntity,
    entityKey,
    automationDispatchBriefs,
  } = args;

  if (!assignments.length) {
    return emptyAssignmentRequirementsViewModel(entityKey);
  }

  const screeningsGroup = findOnboardingPathGroup(fullOnboardingPathGroups, 'screenings');
  const assignmentGroup = findOnboardingPathGroup(fullOnboardingPathGroups, 'assignment_requirements');

  const entityScreeningMilestones = (screeningsGroup?.rows ?? []).map(itemFromScreeningRow);

  const primary = pickPrimaryAssignmentForEmploymentIA(assignments);
  const primaryId = primary?.assignmentId ?? null;
  const assignRows =
    primaryId && assignmentGroup
      ? assignmentGroup.rows.filter((r) => r.sourceRef?.assignmentId === primaryId)
      : [];

  const inst = primary?.onboardingInstanceId ? onboardingByInstanceId.get(primary.onboardingInstanceId) : undefined;
  const env = primaryId ? envelopesByAssignmentId.get(primaryId) : undefined;

  const checkRows: EmploymentOnboardingRow[] = [];
  const certRows: EmploymentOnboardingRow[] = [];
  const uploadRows: EmploymentOnboardingRow[] = [];
  const docRows: EmploymentOnboardingRow[] = [];
  const adminRows: EmploymentOnboardingRow[] = [];

  const checksByKey = new Map((inst?.resolvedChecks ?? []).map((c) => [c.key, c]));

  const internalScreeningRows = internalPipelineScreeningRowsForAssignment(fullOnboardingPathGroups);

  assignRows.forEach((row) => {
    const parsed = parseAssignmentRowSuffix(row);
    if (!parsed) return;
    if (parsed.kind === 'step') {
      adminRows.push(row);
      return;
    }
    if (parsed.kind === 'check') {
      const def = checksByKey.get(parsed.key);
      if (isCertLikeCheck(parsed.key, def?.title)) {
        certRows.push(row);
      } else {
        checkRows.push(row);
      }
      return;
    }
    if (parsed.kind === 'doc') {
      const docDef = (inst?.resolvedDocuments ?? []).find((d) => (d.key || d.docKey) === parsed.key);
      const mode = String(docDef?.mode || '').toLowerCase();
      if (mode === 'esign') {
        docRows.push(row);
      } else {
        uploadRows.push(row);
      }
    }
  });

  const screeningBriefs = filterScreeningAutomationDispatchBriefs(automationDispatchBriefs, primaryId);
  const hasScreeningPackageCheckRow = checkRows.some((row) => {
    const parsed = parseAssignmentRowSuffix(row);
    return parsed?.kind === 'check' && isScreeningPackageCheckKey(parsed.key);
  });

  let requiredChecks = checkRows.map((r) => itemFromAssignmentRow(r, 'check'));
  const packagedCheckRowIds = new Set(checkRows.map((r) => r.rowId));
  for (const r of internalScreeningRows) {
    if (packagedCheckRowIds.has(r.rowId)) continue;
    requiredChecks.push(itemFromAssignmentRow(r, 'check'));
  }
  if (screeningBriefs.length && !hasScreeningPackageCheckRow) {
    const synthetic = screeningAutomationSyntheticRowContent(
      screeningBriefs,
      backgroundChecksForEntity,
      primaryId,
      'admin'
    );
    if (synthetic) {
      requiredChecks = [
        {
          id: '__screening_automation_dispatch__',
          category: 'check',
          title: 'Background screening (automation)',
          statusLabel: synthetic.statusLabel,
          blocking: false,
          inlineExplainer: synthetic.inlineExplainer || undefined,
        },
        ...requiredChecks,
      ];
    }
  }
  const requiredCertifications = certRows.map((r) => itemFromAssignmentRow(r, 'certification'));
  const requiredUploads = uploadRows.map((r) => itemFromAssignmentRow(r, 'upload'));
  const assignmentDocuments = docRows.map((r) => itemFromAssignmentRow(r, 'document'));
  const adminSteps = adminRows.map((r) => itemFromAssignmentRow(r, 'admin_step'));

  const bgStatusOpts = { screeningBriefs, primaryAssignmentId: primaryId };
  const backgroundOrdersLinked = backgroundChecksForEntity.map((r) => {
    const base = itemFromBackgroundRecord(r);
    return {
      ...base,
      statusLabel: screeningOrderRequirementStatusLabel(r, bgStatusOpts),
    };
  });

  const openBlockers = [
    ...entityScreeningMilestones,
    ...requiredChecks,
    ...requiredCertifications,
    ...requiredUploads,
    ...assignmentDocuments,
    ...adminSteps,
  ].filter((i) => i.blocking && i.pathRow && !isRowDone(i.pathRow)).length;

  const readiness = primary?.assignmentReadinessV1 ?? null;
  const primaryCanonicalReadinessHeadline =
    readiness?.readinessSummary?.trim() ||
    (readiness ? assignmentReadinessStateDisplay(readiness.assignmentReadinessState) : null);
  const primaryCanonicalScreeningLine = readiness ? screeningLineFromReadiness(readiness) : null;
  const primaryCanonicalPackageLine = readiness ? packageSectionsSummaryFromReadiness(readiness) : null;

  return {
    entityKey,
    hasPrimaryAssignment: Boolean(primary),
    primaryAssignmentId: primaryId,
    primaryJobTitle: primary?.title ?? null,
    primaryJobOrderId: primary?.jobOrderId ?? null,
    primaryAssignmentStatus: primary?.status != null ? normalizeAssignmentStatus(primary.status) : null,
    onboardingInstanceId: primary?.onboardingInstanceId ?? null,
    onboardingPackageStatus: primary?.onboardingStatus ?? inst?.status ?? null,
    onboardingPercentComplete:
      primary?.onboardingPercent != null ? primary.onboardingPercent : inst != null ? inst.percentComplete : null,
    entityScreeningMilestones,
    requiredChecks,
    requiredCertifications,
    requiredUploads,
    assignmentDocuments,
    adminSteps,
    backgroundOrdersLinked,
    openBlockerCount: openBlockers,
    primaryAssignmentReadinessV1: readiness,
    primaryCanonicalReadinessHeadline,
    primaryCanonicalScreeningLine,
    primaryCanonicalPackageLine,
  };
}

function isRowDone(row: EmploymentOnboardingRow | undefined): boolean {
  if (!row) return false;
  return row.status === 'completed' || row.status === 'satisfied_by_existing_record' || row.status === 'not_required';
}

/** Blocking assignment-package / path-linked rows for summary-first UI and global banner lines. */
export function blockingAssignmentRequirementLines(
  vm: AssignmentRequirementsViewModel
): Array<{ title: string; statusLabel: string }> {
  const items = [
    ...vm.entityScreeningMilestones,
    ...vm.requiredChecks,
    ...vm.requiredCertifications,
    ...vm.requiredUploads,
    ...vm.assignmentDocuments,
    ...vm.adminSteps,
  ];
  const out: Array<{ title: string; statusLabel: string }> = [];
  for (const i of items) {
    if (!i.blocking || !i.pathRow || isRowDone(i.pathRow)) continue;
    out.push({ title: i.title, statusLabel: i.statusLabel });
  }
  return out;
}

/**
 * One-line status for systems strip when screenings move out of path ( paystub-style label).
 */
export function assignmentRequirementsSystemsLine(vm: AssignmentRequirementsViewModel): string | null {
  const parts: string[] = [];
  if (vm.primaryCanonicalReadinessHeadline) {
    parts.push(vm.primaryCanonicalReadinessHeadline);
  }
  if (vm.primaryCanonicalScreeningLine) {
    parts.push(vm.primaryCanonicalScreeningLine);
  }
  if (vm.primaryCanonicalPackageLine) {
    parts.push(vm.primaryCanonicalPackageLine);
  }
  if (vm.hasPrimaryAssignment && !vm.primaryCanonicalReadinessHeadline) {
    parts.push(vm.onboardingPackageStatus || 'Job onboarding in progress');
  }
  if (vm.backgroundOrdersLinked.length > 0) {
    const open = vm.backgroundOrdersLinked.filter((b) => !/completed|canceled|error/i.test(b.statusLabel)).length;
    parts.push(open > 0 ? `${open} open screening order(s)` : 'Screening orders closed');
  }
  if (vm.entityScreeningMilestones.length > 0) {
    const pending = vm.entityScreeningMilestones.filter((m) => !m.pathRow || !isRowDone(m.pathRow)).length;
    if (pending > 0) parts.push(`${pending} open screening requirement(s)`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Short subheader for Systems card when canonical assignment readiness is already shown on Assignment —
 * avoids repeating headline + screening + package in the card header.
 */
export function assignmentRequirementsSystemsSubheaderSupplement(vm: AssignmentRequirementsViewModel): string | null {
  const parts: string[] = [];
  if (vm.backgroundOrdersLinked.length > 0) {
    const open = vm.backgroundOrdersLinked.filter((b) => !/completed|canceled|error/i.test(b.statusLabel)).length;
    parts.push(open > 0 ? `${open} open screening order(s)` : 'Screening orders closed');
  }
  if (vm.entityScreeningMilestones.length > 0) {
    const pending = vm.entityScreeningMilestones.filter((m) => !m.pathRow || !isRowDone(m.pathRow)).length;
    if (pending > 0) parts.push(`${pending} entity screening requirement(s)`);
  }
  return parts.length ? parts.join(' · ') : null;
}
