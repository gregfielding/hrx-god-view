/**
 * Pure builders: Firestore-shaped inputs → onboarding queue row view models.
 */

import { format } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import type {
  OnboardingBackgroundQueueRow,
  OnboardingEverifyQueueRow,
  OnboardingQueueOwnerLabel,
  OnboardingTaxPayrollQueueRow,
} from '../types/onboardingQueue';
import type { ExternalOnboardingStepRecord } from '../types/externalOnboardingSteps';
import {
  isExternalOnboardingStepVerifiedComplete,
  lastUpdatedIsoForExternalStep,
  parseExternalOnboardingSteps,
} from './externalOnboardingSteps';
import {
  normalizeWorkerTypeForExternalSteps,
  externalStepAppliesToWorkerType,
} from './externalOnboardingSteps';
import {
  deriveC1EntityKeyFromEntityName,
  everifyUiAppliesToEntityKey,
  resolveC1SelectEntityId,
} from './c1EntityWorkAuthorizationUi';
import type { EmploymentEntityKey } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { normalizeEntityKey } from './employmentEntityPresentation';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { HrxBackgroundCheckStatus } from '../types/backgroundCheck';

export function entityLabelFromKey(entityKey: string | undefined): string {
  const k = String(entityKey || '').toLowerCase();
  if (k === 'select') return 'C1 Select';
  if (k === 'events') return 'C1 Events';
  if (k === 'workforce') return 'C1 Workforce';
  return entityKey?.trim() || '—';
}

function firestoreTimeMs(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Timestamp) return v.toMillis();
  if (
    typeof v === 'object' &&
    v !== null &&
    'toMillis' in v &&
    typeof (v as Timestamp).toMillis === 'function'
  ) {
    try {
      return (v as Timestamp).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

function formatQueueTime(v: unknown): string {
  if (v == null) return '—';
  if (v instanceof Timestamp) {
    try {
      return format(v.toDate(), 'MMM d, yyyy p');
    } catch {
      return '—';
    }
  }
  if (
    typeof v === 'object' &&
    v !== null &&
    'toDate' in v &&
    typeof (v as Timestamp).toDate === 'function'
  ) {
    try {
      return format((v as Timestamp).toDate(), 'MMM d, yyyy p');
    } catch {
      return '—';
    }
  }
  return '—';
}

function externalStepQueueLabel(
  record: ExternalOnboardingStepRecord | undefined,
  applies: boolean,
): { label: string; tier: number } {
  if (!applies) return { label: "Doesn't apply", tier: 50 };
  if (!record) return { label: 'Waiting on worker', tier: 30 };
  if (record.status === 'error') return { label: 'Needs attention', tier: 10 };
  if (
    record.status === 'pending_admin_verification' ||
    record.status === 'worker_completed_external'
  ) {
    return { label: 'Needs review', tier: 0 };
  }
  if (record.status === 'completed') {
    return isExternalOnboardingStepVerifiedComplete(record)
      ? { label: 'Ready', tier: 60 }
      : { label: 'Needs review', tier: 0 };
  }
  if (record.status === 'invite_sent') return { label: 'Waiting on worker', tier: 25 };
  return { label: 'Waiting on worker', tier: 30 };
}

function evereeStepFromPipeline(steps: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(steps)) return undefined;
  for (const s of steps) {
    if (s && typeof s === 'object' && (s as { id?: string }).id === 'everee') {
      return s as Record<string, unknown>;
    }
  }
  return undefined;
}

function evereeLabel(step: Record<string, unknown> | undefined): { label: string; tier: number } {
  if (!step) return { label: 'Waiting on payroll', tier: 28 };
  const wf = String(step.workflowStatus || step.status || '').toLowerCase();
  if (wf === 'complete') return { label: 'Ready', tier: 60 };
  if (wf === 'failed' || wf === 'blocked') return { label: 'Needs attention', tier: 10 };
  if (wf === 'awaiting_worker') return { label: 'Waiting on worker', tier: 25 };
  if (wf === 'ordered' || wf === 'in_progress') return { label: 'Waiting on payroll', tier: 22 };
  if (wf === 'not_started' || !wf) return { label: 'Waiting on payroll', tier: 28 };
  return { label: 'Waiting on payroll', tier: 25 };
}

function worstTier(...tiers: number[]): number {
  return tiers.length ? Math.min(...tiers) : 99;
}

const TAX_PAYROLL_WHY_QUEUED = {
  onboardingOpen: 'Onboarding still open',
  waitingOnWorker: 'Waiting on worker',
  needsReview: 'Needs review',
  waitingOnPayroll: 'Waiting on payroll',
} as const;

function mapStepLabelToWhyQueuedPreferred(label: string): string {
  const s = label.toLowerCase();
  if (s.includes('needs review') || s.includes('needs attention'))
    return TAX_PAYROLL_WHY_QUEUED.needsReview;
  if (s.includes('waiting on worker')) return TAX_PAYROLL_WHY_QUEUED.waitingOnWorker;
  if (s.includes('waiting on payroll')) return TAX_PAYROLL_WHY_QUEUED.waitingOnPayroll;
  return TAX_PAYROLL_WHY_QUEUED.needsReview;
}

/** Picks the first dimension tied at `sortPriority` (payroll external → Everee → direct deposit → tax). */
function taxPayrollWhyQueuedLabel(args: {
  pipelineComplete: boolean;
  allReadyOrNA: boolean;
  sortPriority: number;
  payrollUi: { tier: number; label: string };
  evereeUi: { tier: number; label: string } | null;
  ddUi: { tier: number; label: string };
  taxFormsUi: { tier: number; label: string };
}): string {
  if (args.allReadyOrNA && !args.pipelineComplete) {
    return TAX_PAYROLL_WHY_QUEUED.onboardingOpen;
  }
  const candidates: { tier: number; label: string }[] = [args.payrollUi];
  if (args.evereeUi) candidates.push(args.evereeUi);
  candidates.push(args.ddUi, args.taxFormsUi);
  for (const c of candidates) {
    if (c.tier === args.sortPriority) {
      return mapStepLabelToWhyQueuedPreferred(c.label);
    }
  }
  const fallback = candidates.reduce((a, b) => (a.tier <= b.tier ? a : b));
  return mapStepLabelToWhyQueuedPreferred(fallback.label);
}

function taxPayrollOwner(
  externalNeedsReview: boolean,
  externalWaitingWorker: boolean,
  evereeTier: number,
  extTiers: number[],
): OnboardingQueueOwnerLabel {
  if (externalNeedsReview || evereeTier <= 10 || extTiers.some((t) => t <= 10)) return 'You';
  if (externalWaitingWorker || extTiers.some((t) => t >= 20 && t < 50)) return 'Worker';
  return 'System';
}

export interface TaxPayrollPipelineInput {
  id: string;
  userId?: string;
  userName?: string;
  entityName?: string;
  entityKey?: string;
  status?: string;
  updatedAt?: unknown;
  externalOnboardingSteps?: unknown;
  steps?: unknown;
  assignmentIds?: unknown;
}

export interface EntityEmploymentLite {
  workerType?: string;
  employmentEntryMode?: string;
  currentAssignmentId?: string;
  sourceAssignmentId?: string;
  status?: string;
  updatedAt?: unknown;
  everifyStatus?: string;
}

/** Loaded from `tenants/{tid}/assignments/{id}` for the tax/payroll queue. */
export interface AssignmentQueueLite {
  jobOrderId?: string | null;
  startDate?: string | null;
  status?: string | null;
}

export interface JobOrderQueueLite {
  jobOrderName: string;
  jobTitle: string;
  /** Stored on the job order document (may be empty if the order predates account hiring-entity setup). */
  hiringEntityId?: string | null;
  /** hiringEntityId or the linked recruiter account’s hiringEntityId when the job omits it. */
  effectiveHiringEntityId?: string | null;
}

export interface UserProfileLite {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** `users.avatar` — download URL or storage path used elsewhere in the app. */
  avatarUrl?: string;
}

/** Shared shape for queue hooks that read `users/{uid}`. */
export function userProfileLiteFromUserDoc(d: Record<string, unknown>): UserProfileLite {
  const av = d.avatar;
  const photoURL = d.photoURL;
  const wp = d.workerProfile as Record<string, unknown> | undefined;
  const wpPhoto = wp?.photoUrl;
  const avatarUrl =
    (typeof av === 'string' && av.trim() ? av.trim() : undefined) ||
    (typeof photoURL === 'string' && photoURL.trim() ? photoURL.trim() : undefined) ||
    (typeof wpPhoto === 'string' && wpPhoto.trim() ? wpPhoto.trim() : undefined);
  return {
    firstName: typeof d.firstName === 'string' ? d.firstName : undefined,
    lastName: typeof d.lastName === 'string' ? d.lastName : undefined,
    email: typeof d.email === 'string' ? d.email : undefined,
    phone: typeof d.phone === 'string' ? d.phone : undefined,
    avatarUrl,
  };
}

function taxPayrollRowIsC1Select(entityKey: string, entityLabel: string): boolean {
  if (everifyUiAppliesToEntityKey(entityKey)) return true;
  const n = entityLabel.trim().toLowerCase();
  return n === 'c1 select' || n === 'c1 select llc' || /^c1\s+select\b/i.test(entityLabel.trim());
}

function assignmentQualifiesForDisplay(a: AssignmentQueueLite | undefined): boolean {
  if (!a) return false;
  const sd = String(a.startDate || '').trim();
  if (!sd) return false;
  const st = String(a.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'completed') return false;
  return true;
}

function formatAssignmentStartDate(isoOrRaw: string): string {
  const s = String(isoOrRaw || '').trim();
  if (!s) return '';
  const day = s.split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    try {
      return format(new Date(`${day}T12:00:00`), 'MMM d, yyyy');
    } catch {
      return day;
    }
  }
  return s;
}

function everifyStepFromPipeline(steps: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(steps)) return undefined;
  for (const s of steps) {
    if (s && typeof s === 'object' && (s as { id?: string }).id === 'e_verify') {
      return s as Record<string, unknown>;
    }
  }
  return undefined;
}

function humanizeUnderscoreLabel(raw: string): string {
  return String(raw || '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function employmentAssignmentId(emp: EntityEmploymentLite | undefined): string {
  return String(emp?.currentAssignmentId || emp?.sourceAssignmentId || '').trim();
}

function assignmentIdForTaxPayrollRow(
  emp: EntityEmploymentLite | undefined,
  pipeline: TaxPayrollPipelineInput,
): string {
  const fromEmp = employmentAssignmentId(emp);
  if (fromEmp) return fromEmp;
  const raw = pipeline.assignmentIds;
  if (!Array.isArray(raw)) return '';
  for (const x of raw) {
    const a = String(x || '').trim();
    if (a) return a;
  }
  return '';
}

function jobOrderRowEntityKey(
  jo: JobOrderQueueLite | undefined,
  entityIdToKey: Map<string, EmploymentEntityKey>,
): EmploymentEntityKey | null {
  if (!jo) return null;
  const hid = String(jo.effectiveHiringEntityId || jo.hiringEntityId || '').trim();
  if (!hid) return null;
  return entityIdToKey.get(hid) ?? null;
}

function collectAssignmentIdsForUser(
  uid: string,
  pipelines: TaxPayrollPipelineInput[],
  employmentByPipelineId: Record<string, EntityEmploymentLite | undefined>,
): string[] {
  const set = new Set<string>();
  for (const pipe of pipelines) {
    if (String(pipe.userId || '').trim() !== uid) continue;
    const em = employmentByPipelineId[pipe.id];
    const fromEmp = employmentAssignmentId(em);
    if (fromEmp) set.add(fromEmp);
    const raw = pipe.assignmentIds;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        const a = String(x || '').trim();
        if (a) set.add(a);
      }
    }
  }
  return Array.from(set);
}

/** Prefer assignments whose job order resolves to this pipeline’s entity (cross-pipeline when hiring entity comes from account). */
function pickAssignmentIdForTaxPayrollRow(args: {
  uid: string;
  pipeline: TaxPayrollPipelineInput;
  emp: EntityEmploymentLite | undefined;
  allPipelines: TaxPayrollPipelineInput[];
  employmentByPipelineId: Record<string, EntityEmploymentLite | undefined>;
  assignmentById: Record<string, AssignmentQueueLite | undefined>;
  jobOrderById: Record<string, JobOrderQueueLite | undefined>;
  entityIdToKey: Map<string, EmploymentEntityKey>;
}): string {
  const rowKey = normalizeEntityKey(args.pipeline.entityKey);
  const allIds = collectAssignmentIdsForUser(args.uid, args.allPipelines, args.employmentByPipelineId);
  const matches: { aid: string; startDate: string }[] = [];
  for (const aid of allIds) {
    const a = args.assignmentById[aid];
    if (!assignmentQualifiesForDisplay(a)) continue;
    const jid = String(a?.jobOrderId || '').trim();
    const jo = jid ? args.jobOrderById[jid] : undefined;
    const joEk = jobOrderRowEntityKey(jo, args.entityIdToKey);
    if (rowKey && joEk && joEk === rowKey) {
      matches.push({ aid, startDate: String(a?.startDate || '') });
    }
  }
  if (matches.length) {
    matches.sort((x, y) => String(y.startDate || '').localeCompare(String(x.startDate || '')));
    return matches[0].aid;
  }
  const legacy = assignmentIdForTaxPayrollRow(args.emp, args.pipeline);
  if (!legacy) return '';
  const la = args.assignmentById[legacy];
  if (!assignmentQualifiesForDisplay(la)) return '';
  const jid = String(la?.jobOrderId || '').trim();
  const jo = jid ? args.jobOrderById[jid] : undefined;
  const joEk = jobOrderRowEntityKey(jo, args.entityIdToKey);
  if (joEk && rowKey && joEk !== rowKey) return '';
  return legacy;
}

function resolveAssignmentFieldsFromId(
  assignmentId: string,
  assignmentById: Record<string, AssignmentQueueLite | undefined>,
  jobOrderById: Record<string, JobOrderQueueLite | undefined>,
): Pick<
  OnboardingTaxPayrollQueueRow,
  'assignmentJobOrderName' | 'assignmentJobTitle' | 'assignmentStartDateLabel'
> {
  if (!assignmentId) return {};
  const a = assignmentById[assignmentId];
  if (!assignmentQualifiesForDisplay(a)) return {};
  const jid = String(a?.jobOrderId || '').trim();
  const jo = jid ? jobOrderById[jid] : undefined;
  const startLabel = formatAssignmentStartDate(String(a?.startDate || ''));
  const name = jo?.jobOrderName?.trim() || '';
  const title = jo?.jobTitle?.trim() || '';
  if (!name && !title && !startLabel) return {};
  return {
    assignmentJobOrderName: name || undefined,
    assignmentJobTitle: title || undefined,
    assignmentStartDateLabel: startLabel || undefined,
  };
}

/** Public mirror row shape — shared by E-Verify tab and Tax & Payroll E-Verify column. */
export interface EverifyCaseInput {
  id: string;
  userId?: string | null;
  entityId?: string | null;
  userEmploymentId?: string | null;
  assignmentId?: string | null;
  status?: string;
  updatedAt?: unknown;
  public?: { status?: string; statusDisplay?: string };
}

export function everifyCaseIsClosedForQueue(c: EverifyCaseInput): boolean {
  const pub = c.public;
  const rawStatus = String(pub?.status ?? c.status ?? '').toLowerCase();
  const display = String(pub?.statusDisplay ?? c.status ?? '—');
  return (
    rawStatus.includes('employment_authorized') ||
    rawStatus.includes('closed') ||
    rawStatus === 'final_nonconfirmation' ||
    display.toLowerCase().includes('authorized')
  );
}

/**
 * Same status wording as `buildEverifyQueueRows` (E-Verify tab). Returns null when the case is closed
 * (tab would omit the row) so callers can fall back to employment / pipeline.
 */
export function everifyStatusLabelFromOpenCase(c: EverifyCaseInput): string | null {
  if (everifyCaseIsClosedForQueue(c)) return null;
  const pub = c.public;
  const rawStatus = String(pub?.status ?? c.status ?? '').toLowerCase();
  const display = String(pub?.statusDisplay ?? c.status ?? '—');
  if (!rawStatus || rawStatus === 'draft' || display === '—') {
    return 'Not started';
  }
  if (rawStatus.includes('error') || display.toLowerCase().includes('error')) {
    return 'Error';
  }
  if (rawStatus.includes('tnc') || rawStatus.includes('further_action')) {
    return 'Needs review';
  }
  if (
    rawStatus.includes('submitted') ||
    rawStatus.includes('pending') ||
    rawStatus.includes('dhs')
  ) {
    return 'In progress';
  }
  return 'In progress';
}

/** Latest C1 Select case per user (by `updatedAt`) for Tax & Payroll E-Verify column. */
export function latestSelectEverifyCaseByUserId(
  cases: EverifyCaseInput[],
  selectEntityId: string | null,
): Map<string, EverifyCaseInput> {
  const map = new Map<string, EverifyCaseInput>();
  if (!selectEntityId) return map;
  for (const c of cases) {
    if (String(c.entityId || '') !== selectEntityId) continue;
    const uid = String(c.userId || '').trim();
    if (!uid) continue;
    const prev = map.get(uid);
    if (!prev || firestoreTimeMs(c.updatedAt) > firestoreTimeMs(prev.updatedAt)) {
      map.set(uid, c);
    }
  }
  return map;
}

function formatEverifyStatusForTaxPayrollQueue(
  selectCase: EverifyCaseInput | undefined,
  employmentEverify: string | undefined,
  pipelineSteps: unknown,
): string {
  if (selectCase) {
    const fromCase = everifyStatusLabelFromOpenCase(selectCase);
    if (fromCase !== null) return fromCase;
  }
  const emp = String(employmentEverify || '').trim().toLowerCase();
  if (emp && emp !== 'not_started') {
    return humanizeUnderscoreLabel(String(employmentEverify || ''));
  }
  const step = everifyStepFromPipeline(pipelineSteps);
  const wf = String(step?.workflowStatus || step?.status || '').toLowerCase();
  if (wf === 'complete' || wf === 'skipped') return wf === 'complete' ? 'Complete' : 'Skipped';
  if (wf === 'failed' || wf === 'blocked') return 'Needs attention';
  if (wf && wf !== 'not_started') {
    return humanizeUnderscoreLabel(String(step?.workflowStatus || step?.status || ''));
  }
  return 'Not started';
}

export function buildTaxPayrollQueueRows(
  pipelines: TaxPayrollPipelineInput[],
  employmentByPipelineId: Record<string, EntityEmploymentLite | undefined>,
  userById: Record<string, UserProfileLite | undefined>,
  assignmentById: Record<string, AssignmentQueueLite | undefined> = {},
  jobOrderById: Record<string, JobOrderQueueLite | undefined> = {},
  everifySelectCaseByUserId: Map<string, EverifyCaseInput> | undefined = undefined,
  entityIdToKey: Map<string, EmploymentEntityKey> = new Map(),
): OnboardingTaxPayrollQueueRow[] {
  const rows: OnboardingTaxPayrollQueueRow[] = [];

  for (const p of pipelines) {
    const uid = String(p.userId || '').trim();
    if (!uid) continue;
    const pipelineStatus = String(p.status || '').toLowerCase();
    const extMap = parseExternalOnboardingSteps(p.externalOnboardingSteps);
    const emp = employmentByPipelineId[p.id];
    const wtNorm = normalizeWorkerTypeForExternalSteps(emp?.workerType || '');
    const workerTypeLabel =
      wtNorm === '1099'
        ? '1099'
        : wtNorm === 'w2'
        ? 'W-2'
        : String(emp?.workerType || '—').toUpperCase() || '—';

    const everee = evereeStepFromPipeline(p.steps);
    const evereeUi = everee ? evereeLabel(everee) : { label: 'Ready', tier: 60 };

    const payrollExt = extMap?.payroll_onboarding;
    const payrollApplies = externalStepAppliesToWorkerType('payroll_onboarding', wtNorm);
    const payrollUi = externalStepQueueLabel(payrollExt, payrollApplies);

    const ddApplies = externalStepAppliesToWorkerType('direct_deposit', wtNorm);
    const ddUi = externalStepQueueLabel(extMap?.direct_deposit, ddApplies);

    const taxW2Applies = externalStepAppliesToWorkerType('tax_withholding_forms', wtNorm);
    const tax1099Applies = externalStepAppliesToWorkerType('contractor_tax_form_w9', wtNorm);
    const taxUiW2 = externalStepQueueLabel(extMap?.tax_withholding_forms, taxW2Applies);
    const taxUi1099 = externalStepQueueLabel(extMap?.contractor_tax_form_w9, tax1099Applies);
    const taxFormsUi = wtNorm === '1099' ? taxUi1099 : taxUiW2;

    const payrollSetupTier = everee ? worstTier(payrollUi.tier, evereeUi.tier) : payrollUi.tier;
    const payrollSetupLabel = everee
      ? payrollUi.tier <= evereeUi.tier
        ? payrollUi.label
        : evereeUi.label
      : payrollUi.label;

    let lastMs = firestoreTimeMs(p.updatedAt);
    const extKeys = [
      'payroll_onboarding',
      'direct_deposit',
      'tax_withholding_forms',
      'contractor_tax_form_w9',
    ] as const;
    for (const k of extKeys) {
      const rec = extMap?.[k];
      if (rec) {
        const iso = lastUpdatedIsoForExternalStep(rec);
        if (iso) lastMs = Math.max(lastMs, new Date(iso).getTime());
      }
    }
    if (emp?.updatedAt) lastMs = Math.max(lastMs, firestoreTimeMs(emp.updatedAt));

    const extNeedsReview = [
      payrollExt,
      extMap?.direct_deposit,
      extMap?.tax_withholding_forms,
      extMap?.contractor_tax_form_w9,
    ].some(
      (r) =>
        r &&
        (r.status === 'pending_admin_verification' ||
          r.status === 'worker_completed_external' ||
          (r.status === 'completed' && !isExternalOnboardingStepVerifiedComplete(r))),
    );
    const extWaitingWorker = [
      payrollExt,
      extMap?.direct_deposit,
      extMap?.tax_withholding_forms,
      extMap?.contractor_tax_form_w9,
    ].some((r) => r && (r.status === 'invite_sent' || r.status === 'not_started'));

    const owner = taxPayrollOwner(extNeedsReview, extWaitingWorker, everee ? evereeUi.tier : 60, [
      payrollUi.tier,
      ddUi.tier,
      taxFormsUi.tier,
    ]);

    const sortPriority = worstTier(
      payrollSetupTier,
      ddUi.tier,
      taxFormsUi.tier,
      everee ? evereeUi.tier : 60,
    );

    const prof = userById[uid];
    const fn = String(prof?.firstName || '').trim();
    const ln = String(prof?.lastName || '').trim();
    const workerDisplayName =
      fn || ln ? `${fn} ${ln}`.trim() : String(p.userName || '').trim() || uid;

    const allReadyOrNA =
      (payrollUi.label === 'Ready' || payrollUi.label === "Doesn't apply") &&
      (evereeUi.label === 'Ready' || evereeUi.label === "Doesn't apply") &&
      (ddUi.label === 'Ready' || ddUi.label === "Doesn't apply") &&
      (taxFormsUi.label === 'Ready' || taxFormsUi.label === "Doesn't apply");

    if (pipelineStatus === 'complete' && allReadyOrNA) continue;

    const pickedAssignmentId = pickAssignmentIdForTaxPayrollRow({
      uid,
      pipeline: p,
      emp,
      allPipelines: pipelines,
      employmentByPipelineId,
      assignmentById,
      jobOrderById,
      entityIdToKey,
    });

    let employmentModeLabel = '—';
    if (emp) {
      const mode = String(emp.employmentEntryMode || '');
      if (mode === 'on_call_pool') employmentModeLabel = 'On-call';
      else if (pickedAssignmentId) employmentModeLabel = 'Assignment';
      else if (String(emp.status || '').toLowerCase() === 'active') employmentModeLabel = 'Active';
      else employmentModeLabel = String(emp.status || 'Onboarding');
    }

    const whyQueuedLabel = taxPayrollWhyQueuedLabel({
      pipelineComplete: pipelineStatus === 'complete',
      allReadyOrNA,
      sortPriority,
      payrollUi,
      evereeUi: everee ? evereeUi : null,
      ddUi,
      taxFormsUi,
    });

    const entityLabel = p.entityName?.trim() || entityLabelFromKey(p.entityKey);
    const ek = String(p.entityKey || '');
    const assignmentFields = resolveAssignmentFieldsFromId(pickedAssignmentId, assignmentById, jobOrderById);
    const selectCase = everifySelectCaseByUserId?.get(uid);
    const everifyStatusLabel = taxPayrollRowIsC1Select(ek, entityLabel)
      ? formatEverifyStatusForTaxPayrollQueue(selectCase, emp?.everifyStatus, p.steps)
      : undefined;

    rows.push({
      rowId: `tp:${p.id}`,
      userId: uid,
      workerDisplayName,
      workerEmail: prof?.email,
      workerPhone: prof?.phone,
      workerAvatarUrl: prof?.avatarUrl,
      pipelineId: p.id,
      entityKey: ek,
      entityLabel,
      workerTypeLabel,
      employmentModeLabel,
      payrollSetupLabel,
      directDepositLabel: ddUi.label,
      taxFormsLabel: taxFormsUi.label,
      whyQueuedLabel,
      lastActivityLabel: lastMs
        ? format(new Date(lastMs), 'MMM d, yyyy p')
        : formatQueueTime(p.updatedAt),
      lastActivityMs: lastMs,
      ownerLabel: owner,
      sortPriority,
      profilePath: `/users/${uid}`,
      ...assignmentFields,
      ...(everifyStatusLabel !== undefined ? { everifyStatusLabel } : {}),
    });
  }

  // Newest activity first (recruiter expectation for /staff-onboarding); urgency breaks ties.
  rows.sort((a, b) => {
    if (b.lastActivityMs !== a.lastActivityMs) return b.lastActivityMs - a.lastActivityMs;
    if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
    return a.workerDisplayName.localeCompare(b.workerDisplayName);
  });

  return rows;
}

export function buildEverifyQueueRows(
  cases: EverifyCaseInput[],
  selectEntityId: string | null,
  entityIdToName: Map<string, string>,
  userById: Record<string, UserProfileLite | undefined>,
): OnboardingEverifyQueueRow[] {
  const rows: OnboardingEverifyQueueRow[] = [];

  for (const c of cases) {
    const eid = String(c.entityId || '');
    if (!selectEntityId || eid !== selectEntityId) continue;

    if (everifyCaseIsClosedForQueue(c)) continue;

    const uid = String(c.userId || '').trim();
    if (!uid) continue;

    const pub = c.public;
    const rawStatus = String(pub?.status ?? c.status ?? '').toLowerCase();
    const display = String(pub?.statusDisplay ?? c.status ?? '—');

    const statusLabel = everifyStatusLabelFromOpenCase(c) || 'In progress';
    let currentStepLabel = 'Waiting on result';
    let sortPriority = 30;
    let owner: OnboardingQueueOwnerLabel = 'System';

    if (!rawStatus || rawStatus === 'draft' || display === '—') {
      currentStepLabel = 'Ready to run';
      sortPriority = 20;
      owner = 'You';
    } else if (rawStatus.includes('error') || display.toLowerCase().includes('error')) {
      currentStepLabel = 'Needs attention';
      sortPriority = 0;
      owner = 'You';
    } else if (rawStatus.includes('tnc') || rawStatus.includes('further_action')) {
      currentStepLabel = 'Needs recruiter review';
      sortPriority = 5;
      owner = 'You';
    } else if (
      rawStatus.includes('submitted') ||
      rawStatus.includes('pending') ||
      rawStatus.includes('dhs')
    ) {
      currentStepLabel = 'Waiting on result';
      sortPriority = 25;
      owner = 'System';
    }

    const prof = userById[uid];
    const fn = String(prof?.firstName || '').trim();
    const ln = String(prof?.lastName || '').trim();
    const workerDisplayName = fn || ln ? `${fn} ${ln}`.trim() : uid;

    const entName = entityIdToName.get(eid) || 'C1 Select';
    const employmentContextLabel = c.assignmentId
      ? 'Assignment'
      : c.userEmploymentId
      ? 'On-call / Employment'
      : 'Not linked on case — open profile';

    rows.push({
      rowId: `ev:${c.id}`,
      userId: uid,
      workerDisplayName,
      workerAvatarUrl: prof?.avatarUrl,
      caseId: c.id,
      entityLabel: deriveC1EntityKeyFromEntityName(entName) === 'select' ? 'C1 Select' : entName,
      employmentContextLabel,
      statusLabel,
      currentStepLabel,
      lastUpdateLabel: formatQueueTime(c.updatedAt),
      lastUpdateMs: firestoreTimeMs(c.updatedAt),
      ownerLabel: owner,
      sortPriority,
      profilePath: `/users/${uid}`,
      userEmploymentId: c.userEmploymentId ? String(c.userEmploymentId) : null,
    });
  }

  rows.sort((a, b) => {
    if (b.lastUpdateMs !== a.lastUpdateMs) return b.lastUpdateMs - a.lastUpdateMs;
    if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
    return a.workerDisplayName.localeCompare(b.workerDisplayName);
  });

  return rows;
}

function bgStatusDisplay(
  hrx: HrxBackgroundCheckStatus | undefined,
  provider: string | undefined,
): string {
  const h = String(hrx || '').toLowerCase();
  if (h === 'draft' || !hrx) return 'Not started';
  if (h === 'queued' || h === 'submitted') return 'Ordered';
  if (h === 'awaiting_applicant') return 'In progress';
  if (h === 'in_progress') return 'In progress';
  if (h === 'report_ready') return 'Report ready';
  if (h === 'drug_report_ready') return 'Drug report ready';
  if (h === 'completed') return 'Complete';
  if (h === 'error') return 'Error';
  if (h === 'canceled') return 'Doesn’t apply';
  return provider || 'In progress';
}

function bgSortPriority(hrx: HrxBackgroundCheckStatus | undefined): number {
  const h = String(hrx || '').toLowerCase();
  if (!hrx || h === 'draft') return 5;
  if (h === 'error') return 10;
  if (h === 'awaiting_applicant' || h === 'in_progress' || h === 'submitted' || h === 'queued')
    return 20;
  if (h === 'report_ready' || h === 'drug_report_ready') return 35;
  if (h === 'completed' || h === 'canceled') return 90;
  return 40;
}

function bgOwner(hrx: HrxBackgroundCheckStatus | undefined): OnboardingQueueOwnerLabel {
  const h = String(hrx || '').toLowerCase();
  if (h === 'error' || h === 'draft' || !hrx) return 'You';
  if (h === 'report_ready' || h === 'drug_report_ready') return 'You';
  if (h === 'completed') return 'System';
  return 'Vendor';
}

export function buildBackgroundQueueRows(
  records: BackgroundCheckRecord[],
  userById: Record<string, UserProfileLite | undefined>,
): OnboardingBackgroundQueueRow[] {
  const rows: OnboardingBackgroundQueueRow[] = [];

  for (const r of records) {
    const uid = String(r.candidateId || '').trim();
    if (!uid) continue;
    const hrx = r.hrxStatus;
    const stLabel = bgStatusDisplay(hrx, r.providerStatus || undefined);

    const actionable =
      stLabel !== 'Complete' &&
      stLabel !== 'Doesn’t apply' &&
      !(hrx === 'completed' || hrx === 'canceled');

    if (!actionable) continue;

    const prof = userById[uid];
    const fn = String(prof?.firstName || '').trim();
    const ln = String(prof?.lastName || '').trim();
    const workerDisplayName =
      fn || ln ? `${fn} ${ln}`.trim() : String(r.candidateName || '').trim() || uid;

    const rel = String(r.relationshipEntityKey || '').toLowerCase();
    const entityLabel =
      rel === 'select'
        ? 'C1 Select'
        : rel === 'workforce'
        ? 'C1 Workforce'
        : rel === 'events'
        ? 'C1 Events'
        : '—';

    let employmentModeLabel = '—';
    if (r.jobOrderId) employmentModeLabel = 'Assignment';
    else if (r.automationHiringEntityId || r.relationshipEntityKey)
      employmentModeLabel = 'On-call / Employment';

    const packageLabel = String(r.requestedPackageName || '').trim() || '—';

    rows.push({
      rowId: `bg:${r.id}`,
      userId: uid,
      workerDisplayName,
      workerAvatarUrl: prof?.avatarUrl,
      backgroundCheckId: r.id,
      entityLabel,
      employmentModeLabel,
      packageLabel,
      statusLabel: stLabel === 'Not started' ? 'Not started' : stLabel,
      lastUpdateLabel: formatQueueTime(r.updatedAt),
      lastUpdateMs: firestoreTimeMs(r.updatedAt),
      ownerLabel: bgOwner(hrx),
      sortPriority: bgSortPriority(hrx),
      profilePath: `/users/${uid}`,
    });
  }

  rows.sort((a, b) => {
    if (b.lastUpdateMs !== a.lastUpdateMs) return b.lastUpdateMs - a.lastUpdateMs;
    if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
    return a.workerDisplayName.localeCompare(b.workerDisplayName);
  });

  return rows;
}

export function resolveSelectEntityIdFromBriefs(
  entities: Array<{ id: string; name: string; entityCode?: string }>,
): string | null {
  return resolveC1SelectEntityId(entities);
}
