/**
 * Fixed Employment onboarding checklist items — { completed, completedAt } only.
 * Reads TempWorks external steps + worker payroll account; optional mirror from entity_employments.
 * Work authorization reflects `users.{uid}.workEligibilityAttestation` (same as Overview → Work Eligibility).
 */

import type { AssignmentReadinessEmploymentInput } from '../shared/buildAssignmentReadiness';
import type { EmploymentEntityKey, EntityEmploymentLike, WorkerOnboardingLike } from '../shared/readinessEntityResolve';
import type { WorkAuthorizedStatus } from './workAuthorizedDisplay';
import type { EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { WorkerPayrollAccount } from '../types/payroll';
import { defaultWorkerTypeForEntity } from './employmentEntityPresentation';
import { resolveEffectiveEmploymentWorkerType } from './employmentWorkerTypeResolution';
import type { ExternalOnboardingStepKey, ExternalOnboardingStepRecord } from '../types/externalOnboardingSteps';
import {
  isExternalOnboardingStepVerifiedComplete,
  parseExternalOnboardingSteps,
} from './externalOnboardingSteps';

export type MinimalChecklistItem = {
  completed: boolean;
  completedAt?: Date | null;
};

function coerceDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  return null;
}

function itemFromExternalRecord(rec: ExternalOnboardingStepRecord | undefined): MinimalChecklistItem {
  if (!rec) return { completed: false };
  const completed = isExternalOnboardingStepVerifiedComplete(rec);
  if (!completed) return { completed: false };
  const completedAt =
    coerceDate(rec.verifiedAt) ||
    coerceDate(rec.workerMarkedCompleteAt) ||
    coerceDate(rec.updatedAt) ||
    null;
  return { completed: true, completedAt };
}

function eeSectionComplete(ee: EntityEmploymentLike | null | undefined, field: 'handbookStatus' | 'taxIdentityStatus'): boolean {
  const s = String(ee?.[field] ?? '').toLowerCase();
  return s === 'complete';
}

function mergeExternalWithEeMirror(
  external: MinimalChecklistItem,
  eeComplete: boolean,
  eeUpdatedAt: unknown
): MinimalChecklistItem {
  if (external.completed) return external;
  if (!eeComplete) return { completed: false };
  return { completed: true, completedAt: coerceDate(eeUpdatedAt) };
}

/** Profile/signup declaration — not an external TempWorks step. */
export function buildWorkAuthorizationChecklistItem(
  status: WorkAuthorizedStatus,
  attestedAtRaw?: unknown | null
): MinimalChecklistItem & { detailLine: string } {
  const completedAt = coerceDate(attestedAtRaw ?? null);
  if (status === 'skipped') {
    return {
      completed: false,
      completedAt: null,
      detailLine: 'Not completed — the worker has not submitted this declaration yet.',
    };
  }
  if (status === 'yes') {
    return {
      completed: true,
      completedAt,
      detailLine: 'Authorized to work in the United States',
    };
  }
  return {
    completed: true,
    completedAt,
    detailLine: 'Not authorized to work in the United States',
  };
}

export function resolvePayrollInviteLastSentAt(overview: EmploymentEntityOverview): Date | null {
  const a = overview.workerPayrollAccount;
  if (!a) return null;
  const candidates = [a.inviteSentAt, a.inviteFirstSentAt, a.payrollInviteSentAt].map(coerceDate).filter(Boolean) as Date[];
  if (candidates.length === 0) return null;
  return candidates.reduce((best, d) => (d.getTime() > best.getTime() ? d : best), candidates[0]);
}

export function buildTaxIdentityChecklistItems(overview: EmploymentEntityOverview): {
  i9: MinimalChecklistItem;
  w4OrW9: MinimalChecklistItem & { taxLabel: 'W-4' | 'W-9' };
} {
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const ee = overview.entityEmployment;

  const i9 = itemFromExternalRecord(steps.i9_employee_section);

  const is1099 = overview.workerType === '1099';
  const taxKey: ExternalOnboardingStepKey = is1099 ? 'contractor_tax_form_w9' : 'tax_withholding_forms';
  const taxExt = itemFromExternalRecord(steps[taxKey]);
  const taxLabel: 'W-4' | 'W-9' = is1099 ? 'W-9' : 'W-4';
  const w4OrW9 = {
    ...mergeExternalWithEeMirror(taxExt, eeSectionComplete(ee, 'taxIdentityStatus'), ee?.updatedAt),
    taxLabel,
  };

  return { i9, w4OrW9 };
}

/** Handbook/policies use external steps + entity employment mirror only (also used by Readiness snapshot server loader). */
export type HandbookPoliciesOverviewInput = {
  entityEmployment?: EntityEmploymentLike | null;
  workerOnboarding?: WorkerOnboardingLike | null;
};

export function buildHandbookPoliciesItems(overview: HandbookPoliciesOverviewInput): {
  handbook: MinimalChecklistItem;
  policies: MinimalChecklistItem;
} {
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const ee = overview.entityEmployment;

  const handbookExt = itemFromExternalRecord(steps.handbook_acknowledgment);
  const handbook = mergeExternalWithEeMirror(handbookExt, eeSectionComplete(ee, 'handbookStatus'), ee?.updatedAt);

  const policies = itemFromExternalRecord(steps.policies_acknowledgment);

  return { handbook, policies };
}

export function buildDirectDepositItem(overview: EmploymentEntityOverview): MinimalChecklistItem {
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const ext = itemFromExternalRecord(steps.direct_deposit);
  if (ext.completed) return ext;

  const a = overview.workerPayrollAccount;
  const ps = String(a?.payrollStatus || '').toLowerCase();
  const dd = String(a?.directDepositStatus || '').toLowerCase();
  const fromAccount =
    ps === 'complete' ||
    dd === 'complete' ||
    dd === 'completed' ||
    Boolean(coerceDate(a?.payrollSetupCompletedAt));
  if (!fromAccount) return { completed: false };
  return { completed: true, completedAt: coerceDate(a?.payrollSetupCompletedAt) || coerceDate(a?.updatedAt) };
}

/**
 * Shared gate for list/queue UIs — same rules as `buildDirectDepositItem` (verified external step or payroll account signals).
 */
export function isDirectDepositCompleteFromExternalAndPayrollAccount(
  ddRec: ExternalOnboardingStepRecord | undefined,
  account: (WorkerPayrollAccount & { id?: string }) | null | undefined,
): boolean {
  const ext = itemFromExternalRecord(ddRec);
  if (ext.completed) return true;
  if (!account) return false;
  const ps = String(account.payrollStatus || '').toLowerCase();
  const dd = String(account.directDepositStatus || '').toLowerCase();
  const fromAccount =
    ps === 'complete' ||
    dd === 'complete' ||
    dd === 'completed' ||
    Boolean(coerceDate(account.payrollSetupCompletedAt));
  return fromAccount;
}

/**
 * Shared gate for W-4 / W-9 — same merge as `buildTaxIdentityChecklistItems` (verified external or entity employment mirror).
 */
export function isTaxFormCompleteFromExternalAndEntityEmployment(
  taxRec: ExternalOnboardingStepRecord | undefined,
  ee: { taxIdentityStatus?: string | null; updatedAt?: unknown } | null | undefined,
): boolean {
  const taxExt = itemFromExternalRecord(taxRec);
  const eeTaxDone = String(ee?.taxIdentityStatus ?? '').toLowerCase() === 'complete';
  return mergeExternalWithEeMirror(taxExt, eeTaxDone, ee?.updatedAt).completed;
}

/** Same signals as Profile Readiness tab / payroll aggregates — scoped to one or more account docs. */
export function aggregatePayrollFromAccounts(
  accounts: Array<WorkerPayrollAccount & { id?: string }>,
): {
  payrollInviteSent: boolean;
  directDepositComplete: boolean;
  taxFormComplete: boolean;
} {
  let payrollInviteSent = false;
  let directDepositComplete = false;
  let taxFormComplete = false;
  for (const a of accounts) {
    const st = String(a.payrollStatus || '');
    if (['invite_sent', 'account_created', 'in_progress', 'complete'].includes(st)) {
      payrollInviteSent = true;
    }
    if (a.inviteStatus === 'sent' || a.inviteSentAt || a.payrollInviteSentAt) {
      payrollInviteSent = true;
    }
    if (st === 'complete') {
      directDepositComplete = true;
    }
    const tfs = String(a.taxFormStatus || '').toLowerCase();
    if (tfs === 'complete' || tfs === 'submitted' || tfs === 'verified') {
      taxFormComplete = true;
    }
    const dds = String(a.directDepositStatus || '').toLowerCase();
    if (dds === 'complete' || dds === 'verified') {
      directDepositComplete = true;
    }
  }
  return { payrollInviteSent, directDepositComplete, taxFormComplete };
}

function workerTypeForReadinessChecklist(
  entityWorkerTypeRaw: string | null | undefined,
  employmentWorkerType: string | null | undefined,
  entityKey: EmploymentEntityKey,
): 'w2' | '1099' | null {
  const effective = resolveEffectiveEmploymentWorkerType({
    entityWorkerType: entityWorkerTypeRaw ?? null,
    employmentWorkerType: employmentWorkerType ?? null,
  });
  const n = effective.normalizedExternal;
  if (n === '1099') return '1099';
  if (n === 'w2') return 'w2';
  return defaultWorkerTypeForEntity(entityKey);
}

/**
 * Employment slice for `buildAssignmentReadiness` — matches Employment onboarding checklist (external steps +
 * entity_employments mirrors + entity-scoped payroll), not global user_employments / all payroll accounts.
 */
export function assignmentReadinessEmploymentFromPipeline(args: {
  entityKey: EmploymentEntityKey;
  entityEmployment: EntityEmploymentLike | null;
  workerOnboarding: WorkerOnboardingLike | null;
  entityWorkerTypeRaw: string | null | undefined;
  workerPayrollAccount: (WorkerPayrollAccount & { id?: string }) | null | undefined;
}): AssignmentReadinessEmploymentInput {
  const ee = args.entityEmployment;
  const empWt = ee && typeof ee === 'object' && 'workerType' in ee ? String((ee as { workerType?: string }).workerType || '').trim() : '';
  const wt = workerTypeForReadinessChecklist(args.entityWorkerTypeRaw, empWt || null, args.entityKey);

  const overviewLike = {
    entityEmployment: ee,
    workerOnboarding: args.workerOnboarding,
    workerType: wt,
    workerPayrollAccount: args.workerPayrollAccount ?? null,
  } as EmploymentEntityOverview;

  const { i9, w4OrW9 } = buildTaxIdentityChecklistItems(overviewLike);
  const { handbook, policies } = buildHandbookPoliciesItems({
    entityEmployment: ee,
    workerOnboarding: args.workerOnboarding,
  });
  const directDeposit = buildDirectDepositItem(overviewLike);
  const payOne = aggregatePayrollFromAccounts(args.workerPayrollAccount ? [args.workerPayrollAccount] : []);

  return {
    i9Complete: i9.completed,
    taxFormComplete: w4OrW9.completed || payOne.taxFormComplete,
    payrollInviteSent: payOne.payrollInviteSent,
    directDepositComplete: directDeposit.completed || payOne.directDepositComplete,
    handbookSigned: handbook.completed,
    policiesSigned: policies.completed,
  };
}

export function formatChecklistTimestamp(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
