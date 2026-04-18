/**
 * Presentation helpers for Recruiter Users table (/users/all): work readiness, breakdown, top concern.
 *
 * **Readiness breakdown** (Users table column) is a **decision surface**: deployability blockers only — interview,
 * I-9 / work authorization, E-Verify when entity rules require it, and background screening status. It is **not** a
 * payroll or policy checklist; handbook, policies, direct deposit, and tax forms stay on the Employment tab / worker UI.
 *
 * **Backgrounds** column (separate cell): detailed AccuSource line items + legacy orders — richer than the single
 * readiness “Background · …” line.
 */

import type { ScoreSummary } from './scoreSummary';
import { getWorkAuthorizedStatus } from './workAuthorizedDisplay';
import { getEVerifyComfortStatusFromUserData } from './eVerifyComfortDisplay';
import type { UserListEntityOnboardingItem } from './userListEntityEmploymentStatus';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import type { RecruiterUserEmploymentBreakdownContext } from '../types/recruiterEmploymentBreakdownContext';
import type { EmploymentEntityOverview } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { resolveEffectiveEmploymentWorkerType } from './employmentWorkerTypeResolution';
import { buildTaxIdentityChecklistItems } from './employmentMinimalChecklistModel';
import { parseExternalOnboardingSteps } from './externalOnboardingSteps';
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

  const hasInterview =
    (user.scoreSummary?.interviewCount ?? 0) > 0 || !!user.scoreSummary?.interviewLastAt;

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

function formatShortUsDate(timestamp: unknown): string {
  const ms = toMillisSafe(timestamp);
  if (!ms) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

function formatInterviewBreakdownLine(
  user: RecruiterUserReadinessLike,
  opts?: ReadinessBreakdownOpts,
): string {
  const hasInterview =
    (user.scoreSummary?.interviewCount ?? 0) > 0 || !!user.scoreSummary?.interviewLastAt;
  if (!hasInterview) return 'Interview —';
  const date = formatShortUsDate(user.scoreSummary?.interviewLastAt);
  const author = (opts?.lastInterviewSubmitterName ?? '').trim() || 'System';
  return `Interview ✓ · ${date} · ${author}`;
}

function formatI9BreakdownLine(user: RecruiterUserReadinessLike, entityItems?: UserListEntityOnboardingItem[]): string {
  const emp = String(user.employeeOnboardStatus || '').toLowerCase();
  const con = String(user.contractorOnboardStatus || '').toLowerCase();
  if (emp === 'in progress' || con === 'in progress') return 'I-9 · In progress';
  if (emp === 'completed' || con === 'completed') return 'I-9 · Complete';

  if (entityItems?.length) {
    const hay = entityItems.map((i) => `${i.statusLabel} ${i.entityLabel}`).join(' ');
    if (/i-?9|i9/i.test(hay)) {
      const needs = entityItems.some((i) => i.tone === 'needs_attention');
      const onboarding = entityItems.some((i) => i.tone === 'onboarding');
      if (needs) return 'I-9 · In progress';
      if (onboarding) return 'I-9 · In progress';
      const anyReady = entityItems.some((i) => i.tone === 'ready');
      if (anyReady) return 'I-9 · Complete';
    }
  }

  if (emp || con) {
    if (emp === 'not started' || con === 'not started') return 'I-9 · Not started';
  }

  return 'I-9 · Not started';
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
      if (raw) return `E-Verify · ${humanizeScreeningToken(raw)}`;
    }
    return 'E-Verify · Submitted';
  }
  return 'E-Verify · Not started';
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

/** Single decision line from TempWorks external I-9 step + work-eligibility attestation (W-2) or work auth only (1099). */
function formatI9WorkAuthDecisionLine(user: RecruiterUserReadinessLike, overview: EmploymentEntityOverview): string {
  const auth = getWorkAuthorizedStatus(user);
  if (overview.workerType === '1099') {
    if (auth === 'no') return 'Work auth · Not authorized';
    if (auth === 'skipped') return 'Work auth · Pending';
    return 'Work auth · Authorized';
  }

  const { i9 } = buildTaxIdentityChecklistItems(overview);
  const raw = overview.workerOnboarding?.externalOnboardingSteps;
  const steps = parseExternalOnboardingSteps(raw) ?? {};
  const i9rec = steps.i9_employee_section;
  const st = String(i9rec?.status || '');

  if (auth === 'no') return 'I-9 / Work auth · Issue';
  if (auth === 'skipped') return 'I-9 / Work auth · Pending';
  if (st === 'error') return 'I-9 / Work auth · Issue';

  if (i9.completed && auth === 'yes') return 'I-9 / Work auth · Complete';

  if (st && st !== 'not_started') return 'I-9 / Work auth · In progress';

  return 'I-9 / Work auth · Not started';
}

/** Fallback when `employmentBreakdown` is missing — same coarse labels, legacy root + entity chip hints. */
function formatI9WorkAuthDecisionLineLegacy(
  user: RecruiterUserReadinessLike,
  entityItems?: UserListEntityOnboardingItem[],
): string {
  const auth = getWorkAuthorizedStatus(user);
  const ot = String(user.onboardingType || '').toLowerCase();
  const is1099 = ot === '1099' || ot === 'contractor';

  if (is1099) {
    if (auth === 'no') return 'Work auth · Not authorized';
    if (auth === 'skipped') return 'Work auth · Pending';
    return 'Work auth · Authorized';
  }

  const i9Line = formatI9BreakdownLine(user, entityItems);
  if (auth === 'no') return 'I-9 / Work auth · Issue';
  if (auth === 'skipped') return 'I-9 / Work auth · Pending';

  if (i9Line.includes('Complete')) {
    return auth === 'yes' ? 'I-9 / Work auth · Complete' : 'I-9 / Work auth · In progress';
  }
  if (i9Line.includes('In progress')) return 'I-9 / Work auth · In progress';
  return 'I-9 / Work auth · Not started';
}

function formatEverifyBreakdownLineShort(user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras): string {
  const line = formatEverifyBreakdownLine(user);
  const lower = line.toLowerCase();
  if (lower.includes('submitted')) return 'E-Verify · In progress';
  if (/authorized|employment authorized|authorized to work|photo match|close match/i.test(line)) {
    return 'E-Verify · Employment authorized';
  }
  if (/tentative|dhs|ssa|referral|no match|not eligible|final nonconfirmation|error/i.test(line)) {
    return 'E-Verify · Issue';
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

  if (manualOutside) return 'E-Verify · Outside HRX';
  if (employmentAuthorized || pipeDone) return 'E-Verify · Employment authorized';
  if (evs === 'error' || stepStatus === 'error') return 'E-Verify · Issue';
  if (['in_progress', 'incomplete', 'active', 'pending'].includes(stepStatus)) return 'E-Verify · In progress';

  return formatEverifyBreakdownLineShort(user);
}

function formatBackgroundDecisionShort(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems: UserListEntityOnboardingItem[] | undefined,
  latestBg: BackgroundCheckRecord | null | undefined,
): string {
  const isAccusourceDoc = latestBg && (!latestBg.provider || latestBg.provider === 'accusource');
  if (isAccusourceDoc && latestBg) {
    const st = String(latestBg.hrxStatus || '').toLowerCase();
    if (['completed', 'report_ready', 'drug_report_ready'].includes(st)) return 'Background · Clear';
    if (['in_progress', 'submitted', 'awaiting_applicant', 'queued'].includes(st)) return 'Background · In progress';
    if (st === 'error') return 'Background · Issue';
    if (st === 'canceled') return 'Background · Review / Issue';
    if (st === 'draft') return 'Background · Not started';
    return 'Background · In progress';
  }

  const legacy = formatBackgroundBreakdownLine(user, entityItems);
  if (legacy === 'Background —') return 'Background · Not started';
  if (/Needs attention/i.test(legacy)) return 'Background · Review / Issue';
  if (/In progress|Pending/i.test(legacy)) return 'Background · In progress';
  if (/Clear|complete/i.test(legacy)) return 'Background · Clear';
  return 'Background · Not started';
}

function getReadinessBreakdownRowsFromEmployment(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  ctx: RecruiterUserEmploymentBreakdownContext,
  opts?: ReadinessBreakdownOpts,
): ReadinessBreakdownRow[] {
  const overview = buildChecklistOverview(ctx);
  const rows: ReadinessBreakdownRow[] = [
    { key: 'interview', text: formatInterviewBreakdownLine(user, opts) },
    { key: 'i9', text: formatI9WorkAuthDecisionLine(user, overview) },
  ];

  const evLine = formatEverifyDecisionShort(ctx, user);
  if (evLine) rows.push({ key: 'everify', text: evLine });

  rows.push({
    key: 'background',
    text: formatBackgroundDecisionShort(user, undefined, opts?.latestAccusourceBackground ?? null),
  });

  return rows;
}

/** Decision-oriented readiness lines (interview, I-9/work auth, E-Verify, background) — not a payroll checklist. */
export function getReadinessBreakdownRows(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
  opts?: ReadinessBreakdownOpts,
): ReadinessBreakdownRow[] {
  if (opts?.employmentBreakdown) {
    return getReadinessBreakdownRowsFromEmployment(user, opts.employmentBreakdown, opts);
  }

  return [
    { key: 'interview', text: formatInterviewBreakdownLine(user, opts) },
    { key: 'i9', text: formatI9WorkAuthDecisionLineLegacy(user, entityItems) },
    { key: 'everify', text: formatEverifyBreakdownLineShort(user) },
    {
      key: 'background',
      text: formatBackgroundDecisionShort(user, entityItems, opts?.latestAccusourceBackground ?? null),
    },
  ];
}

/** Letter grade for displayed (0–100) score — matches prescreen banding for recruiter consistency. */
export function recruiterTableLetterGrade(displayScore: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (displayScore >= 90) return 'A';
  if (displayScore >= 80) return 'B';
  if (displayScore >= 70) return 'C';
  if (displayScore >= 60) return 'D';
  return 'F';
}
