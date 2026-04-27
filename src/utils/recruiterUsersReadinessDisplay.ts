/**
 * Presentation helpers for Recruiter Users table (/users/all): work readiness, breakdown, top concern.
 *
 * **Onboarding** column (Users + group members tables): mirrors the **Employment** onboarding checklist for the
 * primary entity — Direct deposit, Work auth, I-9, W-4 / 1099 (W-9), E-Verify, Handbook, Policies. **Background
 * screening stays in the Backgrounds column only**, not here.
 *
 * **Backgrounds** column (separate cell): AccuSource line items + legacy orders.
 */

import { hasRecruiterInterviewCompletionEvidence, type ScoreSummary } from './scoreSummary';
import { getWorkAuthorizedStatus } from './workAuthorizedDisplay';
import { getEVerifyComfortStatusFromUserData } from './eVerifyComfortDisplay';
import type { UserListEntityOnboardingItem } from './userListEntityEmploymentStatus';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { RecruiterUserEmploymentBreakdownContext } from '../types/recruiterEmploymentBreakdownContext';
import type { EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { resolveEffectiveEmploymentWorkerType } from './employmentWorkerTypeResolution';
import {
  buildDirectDepositItem,
  buildHandbookPoliciesItems,
  buildTaxIdentityChecklistItems,
  type MinimalChecklistItem,
} from './employmentMinimalChecklistModel';
import { mapExternalOnboardingStepToPathStatus, parseExternalOnboardingSteps } from './externalOnboardingSteps';
import type { ExternalOnboardingStepRecord } from '../types/externalOnboardingSteps';
import { accusourceScreeningLineItems } from './accusourceScreeningLineItems';
export type ReadinessOperationalKind = 'ready' | 'needs_action' | 'blocked' | 'incomplete';

export type RecruiterUserReadinessLike = {
  securityLevel?: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onboardingType?: string;
  scoreSummary?: ScoreSummary;
  workEligibility?: boolean;
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean; attestedAt?: unknown };
  comfortableEVerify?: string;
  workerAttestations?: { eVerifyWillingness?: string };
  hasWorkerAiPrescreenInterview?: boolean;
  interviewStatus?: string;
  lastInterviewCompletedAt?: unknown;
};

/** Optional screening / payroll fields already stored on `users/{uid}` (same as credentials tab). */
export type RecruiterUserBreakdownExtras = {
  eVerifyOrders?: Array<{
    status?: string;
    result?: string;
    dateSubmitted?: string;
    completionDate?: string;
    dateOrdered?: string;
  }>;
  backgroundCheckOrders?: Array<{
    status?: string;
    result?: string;
    dateOrdered?: string;
    completionDate?: string;
  }>;
};

export function getWorkReadinessOperationalStatus(
  user: RecruiterUserReadinessLike,
  ctx: { hasActiveAssignment: boolean },
): { kind: ReadinessOperationalKind; label: string } {
  const sec = String(user.securityLevel ?? '0');
  if (sec === '0') return { kind: 'blocked', label: 'Blocked' };

  const auth = getWorkAuthorizedStatus(user);
  if (auth === 'no') return { kind: 'blocked', label: 'Blocked' };

  const ev = getEVerifyComfortStatusFromUserData(user);
  if (ev === 'no') return { kind: 'blocked', label: 'Blocked' };

  if (ctx.hasActiveAssignment) return { kind: 'ready', label: 'Ready to Work' };

  const employeeInProgress = String(user.employeeOnboardStatus || '').toLowerCase() === 'in progress';
  const contractorInProgress = String(user.contractorOnboardStatus || '').toLowerCase() === 'in progress';
  if (employeeInProgress || contractorInProgress) {
    return { kind: 'needs_action', label: 'Needs Action' };
  }

  if (sec === '4') return { kind: 'ready', label: 'Ready to Work' };

  const hasInterview = hasRecruiterInterviewCompletionEvidence(user.scoreSummary, user);

  if (sec === '2' || sec === '3') {
    if (!hasInterview) return { kind: 'needs_action', label: 'Needs Action' };
    if (auth === 'skipped' || ev === 'skipped' || ev === 'maybe') {
      return { kind: 'incomplete', label: 'Incomplete' };
    }
    if (auth === 'yes' && ev === 'yes') {
      return { kind: 'ready', label: 'Ready to Work' };
    }
    return { kind: 'incomplete', label: 'Incomplete' };
  }

  return { kind: 'incomplete', label: 'Incomplete' };
}

export type ReadinessBreakdownRow = { key: string; text: string; sublines?: string[] };

export type ReadinessBreakdownOpts = {
  /** Latest manual interview submitter from `users/{uid}/interviews` when batch-loaded */
  lastInterviewSubmitterName?: string | null;
  /** Same AccuSource doc as the Backgrounds column (batch-loaded); no extra reads. */
  latestAccusourceBackground?: BackgroundCheckRecord | null;
  /**
   * Primary entity employment + pipeline + payroll — same inputs as the profile Employment checklist.
   * When present, breakdown lines use `employmentMinimalChecklistModel` (not legacy root `employeeOnboardStatus`).
   */
  employmentBreakdown?: RecruiterUserEmploymentBreakdownContext | null;
};

function toMillisSafe(input: unknown): number {
  if (input == null) return 0;
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input;
  if (typeof input === 'string') {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof input === 'object') {
    const o = input as { toDate?: () => Date; _seconds?: number };
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate().getTime();
      } catch {
        return 0;
      }
    }
    if (typeof o._seconds === 'number') return o._seconds * 1000;
  }
  return 0;
}

function humanizeScreeningToken(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^[A-Z0-9\s-]+$/.test(s) && s === s.toUpperCase()) return s;
  return s
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function pickLatestScreeningRow<T extends Record<string, unknown>>(rows: T[], dateKeys: string[]): T | undefined {
  if (!rows.length) return undefined;
  const scored = rows.map((row) => {
    let best = 0;
    for (const k of dateKeys) {
      const m = toMillisSafe(row[k]);
      if (m > best) best = m;
    }
    return { row, best };
  });
  scored.sort((a, b) => b.best - a.best);
  return scored[0]?.row;
}

function formatI9BreakdownLine(user: RecruiterUserReadinessLike, entityItems?: UserListEntityOnboardingItem[]): string {
  const emp = String(user.employeeOnboardStatus || '').toLowerCase();
  const con = String(user.contractorOnboardStatus || '').toLowerCase();
  if (emp === 'in progress' || con === 'in progress') return 'I-9: In progress';
  if (emp === 'completed' || con === 'completed') return 'I-9: Complete';

  if (entityItems?.length) {
    const hay = entityItems.map((i) => `${i.statusLabel} ${i.entityLabel}`).join(' ');
    if (/i-?9|i9/i.test(hay)) {
      const needs = entityItems.some((i) => i.tone === 'needs_attention');
      const onboarding = entityItems.some((i) => i.tone === 'onboarding');
      if (needs) return 'I-9: In progress';
      if (onboarding) return 'I-9: In progress';
      const anyReady = entityItems.some((i) => i.tone === 'ready');
      if (anyReady) return 'I-9: Complete';
    }
  }

  if (emp || con) {
    if (emp === 'not started' || con === 'not started') return 'I-9: Not started';
  }

  return 'I-9: Not started';
}

function formatEverifyBreakdownLine(user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras): string {
  const orders = user.eVerifyOrders;
  if (Array.isArray(orders) && orders.length > 0) {
    const latest = pickLatestScreeningRow(orders as Record<string, unknown>[], [
      'completionDate',
      'dateSubmitted',
      'dateOrdered',
    ]) as { status?: string; result?: string } | undefined;
    if (latest) {
      const raw = String(latest.result || latest.status || '').trim();
      if (raw) return `E-Verify: ${humanizeScreeningToken(raw)}`;
    }
    return 'E-Verify: Submitted';
  }
  return 'E-Verify: Not started';
}

function formatBackgroundBreakdownLine(
  user: RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
): string {
  const bg = user.backgroundCheckOrders;
  if (Array.isArray(bg) && bg.length > 0) {
    const latest = pickLatestScreeningRow(bg as Record<string, unknown>[], ['completionDate', 'dateOrdered']) as
      | { status?: string; result?: string }
      | undefined;
    if (latest) {
      const raw = String(latest.result || latest.status || '').trim();
      if (raw) return `Background ${humanizeScreeningToken(raw)}`;
    }
    return 'Background Pending';
  }

  if (!entityItems?.length) return 'Background —';
  const blocked = entityItems.find(
    (i) =>
      i.tone === 'needs_attention' &&
      /background|criminal|screen|check|clearance/i.test(`${i.statusLabel} ${i.entityLabel}`),
  );
  if (blocked) return 'Background Needs attention';
  const onboardingBg = entityItems.some(
    (i) => i.tone === 'onboarding' && /background|screen/i.test(`${i.statusLabel} ${i.entityLabel}`),
  );
  if (onboardingBg) return 'Background In progress';
  return 'Background —';
}

function buildBackgroundReadinessRow(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems: UserListEntityOnboardingItem[] | undefined,
  latestBg: BackgroundCheckRecord | null | undefined,
): ReadinessBreakdownRow {
  const isAccusourceDoc = latestBg && (!latestBg.provider || latestBg.provider === 'accusource');
  if (isAccusourceDoc && latestBg) {
    const lines = accusourceScreeningLineItems(latestBg);
    if (lines.length > 0) {
      const pkg = [latestBg.requestedPackageName, latestBg.requestedPackageId].filter(Boolean).join(' · ');
      const text = pkg ? `Background · ${pkg}` : 'Background screening';
      const sublines = lines.map((l) => `· ${l.name}${l.type ? ` (${l.type})` : ''}: ${l.status}`);
      return { key: 'background', text, sublines };
    }
    const st = [latestBg.hrxStatus, latestBg.providerStatus].filter(Boolean).join(' · ') || 'In progress';
    return {
      key: 'background',
      text: 'Background screening',
      sublines: [`· Order status: ${st}`],
    };
  }

  const legacy = formatBackgroundBreakdownLine(user, entityItems);
  if (legacy === 'Background —') {
    return { key: 'background', text: 'Background — Not started' };
  }
  return { key: 'background', text: legacy };
}

export type BackgroundBreakdownOpts = {
  latestAccusourceBackground?: BackgroundCheckRecord | null;
};

/** Job/assignment screening status for the recruiter “Backgrounds” column (AccuSource + legacy orders + entity hints). */
export function getBackgroundBreakdownRows(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
  opts?: BackgroundBreakdownOpts,
): ReadinessBreakdownRow[] {
  return [buildBackgroundReadinessRow(user, entityItems, opts?.latestAccusourceBackground ?? null)];
}

function buildChecklistOverview(ctx: RecruiterUserEmploymentBreakdownContext): EmploymentEntityOverview {
  const ee = ctx.entityEmployment;
  const wt = resolveEffectiveEmploymentWorkerType({
    entityWorkerType: ee.workerType ?? null,
    employmentWorkerType: null,
  });
  const workerType: 'w2' | '1099' | null = wt.normalizedExternal === '1099' ? '1099' : 'w2';

  return {
    entityEmployment: ee,
    workerOnboarding: ctx.workerOnboarding ?? null,
    workerPayrollAccount: ctx.workerPayrollAccount,
    workerType,
    everifyCaseBriefs: [],
  } as EmploymentEntityOverview;
}

function formatEverifyBreakdownLineShort(user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras): string {
  const line = formatEverifyBreakdownLine(user);
  const lower = line.toLowerCase();
  if (lower.includes('submitted')) return 'E-Verify: In progress';
  if (/authorized|employment authorized|authorized to work|photo match|close match/i.test(line)) {
    return 'E-Verify: Employment authorized';
  }
  if (/tentative|dhs|ssa|referral|no match|not eligible|final nonconfirmation|error/i.test(line)) {
    return 'E-Verify: Issue';
  }
  return line;
}

/**
 * E-Verify: pipeline `e_verify`, entity `everifyStatus`, else legacy `users.eVerifyOrders`.
 * C1 Select only when `everifyRequired !== false`.
 */
function formatEverifyDecisionShort(
  ctx: RecruiterUserEmploymentBreakdownContext,
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
): string | null {
  const ee = ctx.entityEmployment;
  const wo = ctx.workerOnboarding;
  const entityKey = String(ee.entityKey || '').toLowerCase();
  if (entityKey !== 'select') return null;
  if (ee.everifyRequired === false) return null;

  const step = (wo?.steps || []).find((s) => String(s.id || '') === 'e_verify');
  const stepStatus = String(step?.status || '').toLowerCase();
  const pipeDone = ['complete', 'completed'].includes(stepStatus);
  const evs = String(ee.everifyStatus || '').toLowerCase();
  const manualOutside = evs === 'manual_outside_hrx';
  const employmentAuthorized = evs === 'employment_authorized';

  if (manualOutside) return 'E-Verify: Outside HRX';
  if (employmentAuthorized || pipeDone) return 'E-Verify: Employment authorized';
  if (evs === 'error' || stepStatus === 'error') return 'E-Verify: Issue';
  if (['in_progress', 'incomplete', 'active', 'pending'].includes(stepStatus)) return 'E-Verify: In progress';

  return formatEverifyBreakdownLineShort(user);
}

function checklistItemToTableLine(
  label: string,
  item: MinimalChecklistItem,
  record?: ExternalOnboardingStepRecord | null,
): string {
  if (item.completed) return `${label}: Complete`;
  if (record) {
    const m = mapExternalOnboardingStepToPathStatus(record, 'admin');
    if (m.status === 'completed') return `${label}: Complete`;
    if (m.status === 'error') return `${label}: Issue`;
    if (m.status === 'not_started') return `${label}: Not started`;
    return `${label}: In progress`;
  }
  return `${label}: Not started`;
}

function formatWorkAuthTableLine(user: RecruiterUserReadinessLike): string {
  const auth = getWorkAuthorizedStatus(user);
  if (auth === 'no') return 'Work auth: Not authorized';
  if (auth === 'skipped') return 'Work auth: Pending';
  return 'Work auth: Authorized';
}

function formatEverifyTableLineEmployment(
  ctx: RecruiterUserEmploymentBreakdownContext,
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
): string {
  const short = formatEverifyDecisionShort(ctx, user);
  if (short) return short;
  const ee = ctx.entityEmployment;
  if (String(ee.entityKey || '').toLowerCase() !== 'select') return 'E-Verify: Not required';
  if (ee.everifyRequired === false) return 'E-Verify: Not required';
  return formatEverifyBreakdownLineShort(user);
}

function getReadinessBreakdownRowsFromEmployment(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  ctx: RecruiterUserEmploymentBreakdownContext,
): ReadinessBreakdownRow[] {
  const overview = buildChecklistOverview(ctx);
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};

  const directDeposit = buildDirectDepositItem(overview);
  const directDepositLine = checklistItemToTableLine('Direct deposit', directDeposit, steps.direct_deposit ?? null);

  const workAuthLine = formatWorkAuthTableLine(user);

  const { i9, w4OrW9 } = buildTaxIdentityChecklistItems(overview);
  const i9Line = checklistItemToTableLine('I-9', i9, steps.i9_employee_section ?? null);

  const taxKey = overview.workerType === '1099' ? 'contractor_tax_form_w9' : 'tax_withholding_forms';
  const taxRec = steps[taxKey] ?? null;

  let w4Line: string;
  let form1099Line: string;
  if (overview.workerType === '1099') {
    w4Line = 'W-4: N/A';
    form1099Line = checklistItemToTableLine('1099', w4OrW9, taxRec);
  } else {
    w4Line = checklistItemToTableLine('W-4', w4OrW9, taxRec);
    form1099Line = '1099: N/A';
  }

  const everifyLine = formatEverifyTableLineEmployment(ctx, user);

  const { handbook, policies } = buildHandbookPoliciesItems(overview);
  const handbookLine = checklistItemToTableLine('Handbook', handbook, steps.handbook_acknowledgment ?? null);
  const policiesLine = checklistItemToTableLine('Policies', policies, steps.policies_acknowledgment ?? null);

  return [
    { key: 'direct_deposit', text: directDepositLine },
    { key: 'work_auth', text: workAuthLine },
    { key: 'i9', text: i9Line },
    { key: 'w4', text: w4Line },
    { key: 'tax_1099', text: form1099Line },
    { key: 'everify', text: everifyLine },
    { key: 'handbook', text: handbookLine },
    { key: 'policies', text: policiesLine },
  ];
}

function getReadinessBreakdownRowsLegacy(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
): ReadinessBreakdownRow[] {
  const ot = String(user.onboardingType || '').toLowerCase();
  const is1099 = ot === '1099' || ot === 'contractor';
  return [
    { key: 'direct_deposit', text: 'Direct deposit: —' },
    { key: 'work_auth', text: formatWorkAuthTableLine(user) },
    { key: 'i9', text: formatI9BreakdownLine(user, entityItems) },
    { key: 'w4', text: is1099 ? 'W-4: N/A' : 'W-4: —' },
    { key: 'tax_1099', text: is1099 ? '1099: —' : '1099: N/A' },
    { key: 'everify', text: formatEverifyBreakdownLineShort(user) },
    { key: 'handbook', text: 'Handbook: —' },
    { key: 'policies', text: 'Policies: —' },
  ];
}

/** Employment checklist mirror for the primary entity (same signals as the Employment tab). No background rows. */
export function getReadinessBreakdownRows(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
  opts?: ReadinessBreakdownOpts,
): ReadinessBreakdownRow[] {
  if (opts?.employmentBreakdown) {
    return getReadinessBreakdownRowsFromEmployment(user, opts.employmentBreakdown);
  }
  return getReadinessBreakdownRowsLegacy(user, entityItems);
}

/** Letter grade for displayed (0–100) score — matches prescreen banding for recruiter consistency. */
export function recruiterTableLetterGrade(displayScore: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  if (displayScore >= 90) return 'A';
  if (displayScore >= 80) return 'B';
  if (displayScore >= 70) return 'C';
  if (displayScore >= 60) return 'D';
  return 'E';
}
