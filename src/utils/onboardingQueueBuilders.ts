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
  type ExternalOnboardingWorkerTypeNorm,
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
import type { WorkerPayrollAccount } from '../types/payroll';
import { workerPayrollAccountId } from '../types/payroll';
import {
  isDirectDepositCompleteFromExternalAndPayrollAccount,
  isTaxFormCompleteFromExternalAndEntityEmployment,
} from './employmentMinimalChecklistModel';

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

/** Picks the first dimension tied at `sortPriority` (I-9 external → Everee → direct deposit → tax). */
function taxPayrollWhyQueuedLabel(args: {
  pipelineComplete: boolean;
  allReadyOrNA: boolean;
  sortPriority: number;
  i9Ui: { tier: number; label: string };
  evereeUi: { tier: number; label: string } | null;
  ddUi: { tier: number; label: string };
  taxFormsUi: { tier: number; label: string };
}): string {
  if (args.allReadyOrNA && !args.pipelineComplete) {
    return TAX_PAYROLL_WHY_QUEUED.onboardingOpen;
  }
  const candidates: { tier: number; label: string }[] = [args.i9Ui];
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
  /** Mirrors W-4/W-9 when recruiter marks tax identity complete on employment (same as Employment checklist). */
  taxIdentityStatus?: string | null;
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

function externalStepInviteOrNotStarted(r: ExternalOnboardingStepRecord | undefined): boolean {
  return Boolean(r && (r.status === 'invite_sent' || r.status === 'not_started'));
}

function payrollAccountDocIdForPipelineUser(
  pipeline: TaxPayrollPipelineInput,
  uid: string,
): string | null {
  const ek =
    normalizeEntityKey(pipeline.entityKey) || String(pipeline.entityKey || '').trim().toLowerCase();
  if (!ek) return null;
  return workerPayrollAccountId(uid, ek);
}

export function buildTaxPayrollQueueRows(
  pipelines: TaxPayrollPipelineInput[],
  employmentByPipelineId: Record<string, EntityEmploymentLite | undefined>,
  userById: Record<string, UserProfileLite | undefined>,
  assignmentById: Record<string, AssignmentQueueLite | undefined> = {},
  jobOrderById: Record<string, JobOrderQueueLite | undefined> = {},
  everifySelectCaseByUserId: Map<string, EverifyCaseInput> | undefined = undefined,
  entityIdToKey: Map<string, EmploymentEntityKey> = new Map(),
  payrollAccountByDocId: Record<string, WorkerPayrollAccount | undefined> = {},
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
    const i9Ext = extMap?.i9_employee_section;
    const i9Applies = externalStepAppliesToWorkerType('i9_employee_section', wtNorm);
    const i9Ui = externalStepQueueLabel(i9Ext, i9Applies);

    const ddApplies = externalStepAppliesToWorkerType('direct_deposit', wtNorm);
    const ddUi = externalStepQueueLabel(extMap?.direct_deposit, ddApplies);

    const taxW2Applies = externalStepAppliesToWorkerType('tax_withholding_forms', wtNorm);
    const tax1099Applies = externalStepAppliesToWorkerType('contractor_tax_form_w9', wtNorm);
    const taxUiW2 = externalStepQueueLabel(extMap?.tax_withholding_forms, taxW2Applies);
    const taxUi1099 = externalStepQueueLabel(extMap?.contractor_tax_form_w9, tax1099Applies);
    const taxFormsUi = wtNorm === '1099' ? taxUi1099 : taxUiW2;

    const payrollAcctDocId = payrollAccountDocIdForPipelineUser(p, uid);
    const payrollAccount = payrollAcctDocId ? payrollAccountByDocId[payrollAcctDocId] : undefined;
    const taxRecActive =
      wtNorm === '1099' ? extMap?.contractor_tax_form_w9 : extMap?.tax_withholding_forms;

    let ddUiFinal = ddUi;
    if (
      ddApplies &&
      isDirectDepositCompleteFromExternalAndPayrollAccount(extMap?.direct_deposit, payrollAccount)
    ) {
      ddUiFinal = { label: 'Ready', tier: 60 };
    }

    let taxFormsUiFinal = taxFormsUi;
    if (
      (wtNorm === '1099' ? tax1099Applies : taxW2Applies) &&
      isTaxFormCompleteFromExternalAndEntityEmployment(taxRecActive, emp ?? null)
    ) {
      taxFormsUiFinal = { label: 'Ready', tier: 60 };
    }

    const i9CompleteLabel = i9Ui.label;
    const i9Tier = i9Ui.tier;

    let lastMs = firestoreTimeMs(p.updatedAt);
    const extKeys = [
      'payroll_onboarding',
      'i9_employee_section',
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
      i9Ext,
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
    const extWaitingWorker =
      (i9Applies && externalStepInviteOrNotStarted(i9Ext)) ||
      externalStepInviteOrNotStarted(payrollExt) ||
      (externalStepInviteOrNotStarted(extMap?.direct_deposit) &&
        !isDirectDepositCompleteFromExternalAndPayrollAccount(extMap?.direct_deposit, payrollAccount)) ||
      (wtNorm === '1099'
        ? externalStepInviteOrNotStarted(extMap?.contractor_tax_form_w9) &&
          !isTaxFormCompleteFromExternalAndEntityEmployment(
            extMap?.contractor_tax_form_w9,
            emp ?? null,
          )
        : externalStepInviteOrNotStarted(extMap?.tax_withholding_forms) &&
          !isTaxFormCompleteFromExternalAndEntityEmployment(
            extMap?.tax_withholding_forms,
            emp ?? null,
          ));

    const owner = taxPayrollOwner(extNeedsReview, extWaitingWorker, everee ? evereeUi.tier : 60, [
      i9Ui.tier,
      ddUiFinal.tier,
      taxFormsUiFinal.tier,
    ]);

    const sortPriority = worstTier(
      i9Tier,
      ddUiFinal.tier,
      taxFormsUiFinal.tier,
      everee ? evereeUi.tier : 60,
    );

    const prof = userById[uid];
    const fn = String(prof?.firstName || '').trim();
    const ln = String(prof?.lastName || '').trim();
    const workerDisplayName =
      fn || ln ? `${fn} ${ln}`.trim() : String(p.userName || '').trim() || uid;

    const i9ReadyOrNA = i9Ui.label === 'Ready' || i9Ui.label === "Doesn't apply";
    const allReadyOrNA =
      i9ReadyOrNA &&
      (ddUiFinal.label === 'Ready' || ddUiFinal.label === "Doesn't apply") &&
      (taxFormsUiFinal.label === 'Ready' || taxFormsUiFinal.label === "Doesn't apply");

    /** Tax & Payroll queue = follow-up until I-9, direct deposit, and tax forms are all Ready (or N/A). Then they drop off — onboarded for these milestones regardless of pipeline `status`. */
    if (allReadyOrNA) continue;

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
      i9Ui,
      evereeUi: everee ? evereeUi : null,
      ddUi: ddUiFinal,
      taxFormsUi: taxFormsUiFinal,
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
      i9CompleteLabel,
      directDepositLabel: ddUiFinal.label,
      taxFormsLabel: taxFormsUiFinal.label,
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

function isSelectPipeline(p: TaxPayrollPipelineInput): boolean {
  const ek =
    normalizeEntityKey(p.entityKey as string | undefined) || String(p.entityKey || '').trim().toLowerCase();
  return ek === 'select';
}

function findSelectPipelineForUser(
  uid: string,
  pipelines: TaxPayrollPipelineInput[],
): TaxPayrollPipelineInput | undefined {
  const u = String(uid || '').trim();
  for (const p of pipelines) {
    if (String(p.userId || '').trim() !== u) continue;
    if (isSelectPipeline(p)) return p;
  }
  return undefined;
}

/** I-9 verified (or N/A for worker types without I-9) — same external step as Tax & Payroll “I-9 Complete”. */
function i9SatisfiedForEverifyQueue(
  extMap: ReturnType<typeof parseExternalOnboardingSteps>,
  wtNorm: ExternalOnboardingWorkerTypeNorm,
): boolean {
  const i9Applies = externalStepAppliesToWorkerType('i9_employee_section', wtNorm);
  const i9Ui = externalStepQueueLabel(extMap?.i9_employee_section, i9Applies);
  return i9Ui.label === 'Ready' || i9Ui.label === "Doesn't apply";
}

/**
 * True when E-Verify still needs recruiter/system follow-up (contrast: employment authorized, manual outside HRX,
 * pipeline e_verify complete, or a closed/authorized case).
 */
function eVerifyFollowUpNeeded(
  emp: EntityEmploymentLite | undefined,
  pipelineSteps: unknown,
  latestCase: EverifyCaseInput | undefined,
): boolean {
  const st = String(emp?.everifyStatus || '').toLowerCase();
  if (st === 'employment_authorized' || st === 'manual_outside_hrx') return false;

  const step = everifyStepFromPipeline(pipelineSteps);
  const wf = String(step?.workflowStatus || step?.status || '').toLowerCase();
  if (wf === 'complete' || wf === 'completed' || wf === 'skipped') return false;

  if (latestCase) {
    if (!everifyCaseIsClosedForQueue(latestCase)) return true;
    return false;
  }
  return true;
}

function employmentContextForSelectPipeline(
  p: TaxPayrollPipelineInput,
  emp: EntityEmploymentLite | undefined,
): string {
  const aid = assignmentIdForTaxPayrollRow(emp, p);
  if (aid) return 'Assignment';
  if (emp?.employmentEntryMode === 'on_call_pool') return 'On-call / Employment';
  if (emp) return 'On-call / Employment';
  return 'Not linked — open profile';
}

/** When the row is synthesized from worker_onboarding + employment (no open case), infer step/owner from the status chip label. */
function syntheticEverifyStepOwnerFromStatusLabel(statusLabel: string): {
  currentStepLabel: string;
  sortPriority: number;
  owner: OnboardingQueueOwnerLabel;
} {
  const s = statusLabel.toLowerCase();
  if (s.includes('not started')) {
    return { currentStepLabel: 'Ready to run', sortPriority: 20, owner: 'You' };
  }
  if (s.includes('error') || s.includes('attention') || s.includes('review')) {
    return { currentStepLabel: 'Needs attention', sortPriority: 0, owner: 'You' };
  }
  if (s.includes('progress')) {
    return { currentStepLabel: 'Waiting on result', sortPriority: 25, owner: 'System' };
  }
  if (s.includes('complete') || s.includes('authorized') || s.includes('manual')) {
    return { currentStepLabel: 'Recorded', sortPriority: 40, owner: 'System' };
  }
  return { currentStepLabel: 'Follow up on profile', sortPriority: 30, owner: 'System' };
}

export function buildEverifyQueueRows(
  cases: EverifyCaseInput[],
  selectEntityId: string | null,
  entityIdToName: Map<string, string>,
  userById: Record<string, UserProfileLite | undefined>,
  pipelines: TaxPayrollPipelineInput[] = [],
  employmentByPipelineId: Record<string, EntityEmploymentLite | undefined> = {},
): OnboardingEverifyQueueRow[] {
  const rows: OnboardingEverifyQueueRow[] = [];
  const usersWithOpenCaseRow = new Set<string>();
  const latestCaseByUser = latestSelectEverifyCaseByUserId(cases, selectEntityId);

  for (const c of cases) {
    const eid = String(c.entityId || '');
    if (!selectEntityId || eid !== selectEntityId) continue;

    if (everifyCaseIsClosedForQueue(c)) continue;

    const uid = String(c.userId || '').trim();
    if (!uid) continue;

    const pipe = findSelectPipelineForUser(uid, pipelines);
    if (!pipe) continue;
    const extMap = parseExternalOnboardingSteps(pipe.externalOnboardingSteps);
    const empCase = employmentByPipelineId[pipe.id];
    const wtNormCase = normalizeWorkerTypeForExternalSteps(empCase?.workerType || '');
    if (!i9SatisfiedForEverifyQueue(extMap, wtNormCase)) continue;
    if (!eVerifyFollowUpNeeded(empCase, pipe.steps, c)) continue;

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

    usersWithOpenCaseRow.add(uid);

    rows.push({
      rowId: `ev:${c.id}`,
      userId: uid,
      workerDisplayName,
      workerEmail: prof?.email,
      workerPhone: prof?.phone,
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

  for (const p of pipelines) {
    if (!isSelectPipeline(p)) continue;
    const uid = String(p.userId || '').trim();
    if (!uid || usersWithOpenCaseRow.has(uid)) continue;

    const emp = employmentByPipelineId[p.id];
    const extMapP = parseExternalOnboardingSteps(p.externalOnboardingSteps);
    const wtNormP = normalizeWorkerTypeForExternalSteps(emp?.workerType || '');
    if (!i9SatisfiedForEverifyQueue(extMapP, wtNormP)) continue;

    const latestCase = latestCaseByUser.get(uid);
    if (!eVerifyFollowUpNeeded(emp, p.steps, latestCase)) continue;

    const statusLabel = formatEverifyStatusForTaxPayrollQueue(
      latestCase,
      emp?.everifyStatus,
      p.steps,
    );
    const { currentStepLabel, sortPriority, owner } = syntheticEverifyStepOwnerFromStatusLabel(statusLabel);

    let lastMs = firestoreTimeMs(p.updatedAt);
    if (emp?.updatedAt) lastMs = Math.max(lastMs, firestoreTimeMs(emp.updatedAt));
    if (latestCase?.updatedAt) lastMs = Math.max(lastMs, firestoreTimeMs(latestCase.updatedAt));

    const prof = userById[uid];
    const fn = String(prof?.firstName || '').trim();
    const ln = String(prof?.lastName || '').trim();
    const workerDisplayName = fn || ln ? `${fn} ${ln}`.trim() : uid;

    const entName = selectEntityId ? entityIdToName.get(selectEntityId) || 'C1 Select' : 'C1 Select';

    rows.push({
      rowId: `evp:${p.id}`,
      userId: uid,
      workerDisplayName,
      workerEmail: prof?.email,
      workerPhone: prof?.phone,
      workerAvatarUrl: prof?.avatarUrl,
      entityLabel: deriveC1EntityKeyFromEntityName(entName) === 'select' ? 'C1 Select' : entName,
      employmentContextLabel: employmentContextForSelectPipeline(p, emp),
      statusLabel,
      currentStepLabel,
      lastUpdateLabel: lastMs ? format(new Date(lastMs), 'MMM d, yyyy p') : '—',
      lastUpdateMs: lastMs,
      ownerLabel: owner,
      sortPriority,
      profilePath: `/users/${uid}`,
      userEmploymentId: p.id,
    });
  }

  rows.sort((a, b) => {
    if (b.lastUpdateMs !== a.lastUpdateMs) return b.lastUpdateMs - a.lastUpdateMs;
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
      workerEmail: prof?.email,
      workerPhone: prof?.phone,
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
