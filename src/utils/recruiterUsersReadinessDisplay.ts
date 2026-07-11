/**
 * Presentation helpers for Recruiter Users table (/users/all): work readiness, breakdown, top concern.
 *
 * **Readiness** column (Users + group members tables + UserProfile
 * header): two rows in May 2026 —
 *   1. `direct_deposit` — Everee mirror (`readinessMirror.directDepositReady`).
 *   2. `employer_i9`    — Section 2 (employer portion) status. Reads
 *      `entity_employments.i9Section2CompletedAt` plus the mirror's
 *      `i9SignedAt` to decide between "Complete", "Action needed",
 *      "Waiting on worker", and "N/A".
 *
 * Removed in May 2026 (Everee owns these now, HRX no longer tracks):
 * Work auth, worker I-9 Section 1, W-4, 1099, TIN/SSN, E-Verify (has
 * its own column), Handbook, Policies. Indeed Flex / Fieldglass live
 * as separate checkboxes in the column container, not as breakdown
 * rows.
 *
 * **Backgrounds** column (separate cell): AccuSource line items + legacy orders.
 */

import { hasRecruiterInterviewCompletionEvidence, type ScoreSummary } from './scoreSummary';
import { getEVerifyComfortStatusFromUserData } from './eVerifyComfortDisplay';
import type { UserListEntityOnboardingItem } from './userListEntityEmploymentStatus';
import { computePackageRollup, isSyntheticOrderRow } from './accusourceVerdictBands';
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
import {
  mirror1099Line,
  mirrorDirectDepositLine,
  mirrorHandbookLine,
  mirrorI9Line,
  mirrorPoliciesLine,
  mirrorTinLine,
  mirrorW4Line,
} from './recruiterUsersReadinessChipMirrorLines';
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

  // Work-authorization "no" no longer blocks here (May 2026): Everee
  // owns work-auth status during external onboarding and HRX has no
  // authoritative view of it. Surfacing it as a blocker created false
  // positives when Everee had already cleared the worker. E-Verify
  // (below) stays as a blocker because HRX still drives that step for
  // C1 Select.

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
    // Work-auth was previously gated alongside E-Verify here. Removed
    // (May 2026) for the same reason as the breakdown row and the
    // top-of-function block: Everee owns work-auth state and HRX no
    // longer tracks it.
    if (ev === 'skipped' || ev === 'maybe') {
      return { kind: 'incomplete', label: 'Incomplete' };
    }
    if (ev === 'yes') {
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
    // 2026-07-11 (Greg): same cleanup as the profile header's Screening
    // column — hide canceled items and bare "Order <id>" webhook echo rows,
    // and once every remaining line is adjudicated PASSED/FAILED collapse
    // the whole package to a single verdict suffix instead of listing items.
    const lines = accusourceScreeningLineItems(latestBg).filter(
      (l) => !isSyntheticOrderRow(l) && !/cancel/i.test(l.status),
    );
    const pkg = [latestBg.requestedPackageName, latestBg.requestedPackageId].filter(Boolean).join(' · ');
    const text = pkg ? `Background · ${pkg}` : 'Background screening';
    let rollup = computePackageRollup(lines);
    if (
      (latestBg as { markedCompleteOutsideHrx?: boolean }).markedCompleteOutsideHrx === true &&
      rollup !== 'FAILED'
    ) {
      rollup = 'CLEARED';
    }
    if (rollup === 'CLEARED') return { key: 'background', text: `${text} — Cleared ✓` };
    if (rollup === 'FAILED') return { key: 'background', text: `${text} — Failed ✕` };
    if (lines.length > 0) {
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

// `formatWorkAuthTableLine` was removed in May 2026: work authorization
// is now collected and verified by Everee during external onboarding,
// not tracked in HRX. The recruiter Onboarding column should not call
// out a "Work auth: …" line because HRX has no authoritative state for
// it — surfacing one created false-positive blockers when Everee had
// already cleared the worker. Both the Everee-aware row builder and the
// legacy fallback below now omit the row entirely. If we ever resume
// HRX-side work-auth tracking, restore this helper and re-insert a
// `work_auth` row in both builders.

/**
 * Employer I-9 (Section 2) status line.
 *
 * Federal compliance reality: I-9 has two halves.
 *   - **Section 1** is the worker portion (handled by Everee in their
 *     onboarding flow, mirrored as `everee_workers.readinessMirror.i9SignedAt`).
 *   - **Section 2** is the employer portion — the employer (C1 Staffing
 *     as employer of record) physically inspects the worker's identity
 *     + work-authorization documents and signs the form within 3
 *     business days of hire. Federal law assigns this to the employer;
 *     Everee CANNOT do it for us.
 *
 * The Readiness column should make it obvious whether HRX needs to do
 * the employer-side step. Surfaced states (May 2026):
 *   - `'Employer I-9: N/A'` — 1099 contractor (no I-9 required)
 *   - `'Employer I-9: Complete'` — Section 2 completion stamp set
 *   - `'Employer I-9: Action needed'` — worker signed Section 1 in
 *     Everee, no Section 2 stamp yet (HRX/CSA owes the work)
 *   - `'Employer I-9: Waiting on worker'` — worker hasn't signed
 *     Section 1 yet; no employer action possible yet
 *   - `'Employer I-9: —'` — no data (legacy fallback, no entity
 *     employment context)
 */
function formatEmployerI9TableLine(ctx: RecruiterUserEmploymentBreakdownContext): string {
  const ee = ctx.entityEmployment;
  const wt = String(ee.workerType || '').toLowerCase();
  if (wt === '1099' || wt === 'contractor') return 'Employer I-9: N/A';
  // Mirror's `i9Applicable: false` is the same signal — contractor in
  // Everee even if the HRX record disagrees. Trust the mirror when present.
  const mirror = ctx.evereeReadinessMirror ?? null;
  if (mirror && mirror.i9Applicable === false) return 'Employer I-9: N/A';

  if (ee.i9Section2CompletedAt) return 'Employer I-9: Complete';

  const workerSignedSection1 = mirror && mirror.i9Applicable && mirror.i9SignedAt != null;
  if (workerSignedSection1) return 'Employer I-9: Action needed';

  return 'Employer I-9: Waiting on worker';
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
  // RD.2 — Everee snapshot for this (worker × entity), populated by
  // `useRecruiterUsersEntityEmploymentChips` from
  // `tenants/{tid}/everee_workers/{entityId}__{userId}.readinessMirror`.
  // When present, it wins for every Everee-owned chip line. Work auth +
  // E-Verify stay HRX-sourced regardless.
  const mirror = ctx.evereeReadinessMirror ?? null;

  const directDeposit = buildDirectDepositItem(overview);
  const directDepositLine = mirror
    ? mirrorDirectDepositLine(mirror)
    : checklistItemToTableLine('Direct deposit', directDeposit, steps.direct_deposit ?? null);

  // May 2026 — Readiness column slimmed down. HRX no longer tracks the
  // worker-side onboarding items it doesn't actually own (Work auth,
  // worker I-9 Section 1, W-4, 1099, TIN/SSN, Handbook, Policies are all
  // Everee-managed). Showing them here created visual noise + suggested
  // HRX had follow-up work it doesn't actually have. Two surviving rows:
  //
  //   1. `direct_deposit` — Everee mirror tells us Pay setup is done.
  //   2. `employer_i9`    — Section 2 is the *only* remaining I-9 step
  //                          HRX (CSA / employer of record) physically
  //                          owns. Section 1 (worker portion) is on
  //                          Everee. The new "Employer I-9" line makes
  //                          it obvious when CSA action is needed.
  //
  // The remaining surfaces (Indeed Flex / Fieldglass checkboxes) live
  // in the column container itself, not as breakdown rows.
  //
  // The unused `mirrorI9Line` / `mirrorW4Line` / `mirror1099Line` /
  // `mirrorTinLine` / `mirrorHandbookLine` / `mirrorPoliciesLine`
  // helpers + `formatEverifyTableLineEmployment` and the
  // `buildTaxIdentityChecklistItems` / `buildHandbookPoliciesItems`
  // step branches above are intentionally **kept in module scope** so a
  // future PR can resurrect any of these rows by uncommenting a single
  // entry below — no archeology required.
  void user; // keep param for signature parity with prior shape
  void steps; // ensure step records remain in scope for resurrection use
  void mirrorI9Line;
  void mirrorW4Line;
  void mirror1099Line;
  void mirrorTinLine;
  void mirrorHandbookLine;
  void mirrorPoliciesLine;
  void buildTaxIdentityChecklistItems;
  void buildHandbookPoliciesItems;
  void formatEverifyTableLineEmployment;

  const rows: ReadinessBreakdownRow[] = [
    { key: 'direct_deposit', text: directDepositLine },
    { key: 'employer_i9', text: formatEmployerI9TableLine(ctx) },
    // Rows removed in May 2026 (kept here as comments so the order is
    // obvious if any are restored):
    //   { key: 'work_auth', text: ... }   // Everee owns work auth
    //   { key: 'i9',        text: ... }   // Section 1 = Everee
    //   { key: 'w4',        text: ... }   // Everee
    //   { key: 'tax_1099',  text: ... }   // Everee
    //   { key: 'tin',       text: ... }   // Everee
    //   { key: 'everify',   text: ... }   // available via separate eVerify column
    //   { key: 'handbook',  text: ... }   // Everee
    //   { key: 'policies',  text: ... }   // Everee
  ];

  return rows;
}

function getReadinessBreakdownRowsLegacy(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
): ReadinessBreakdownRow[] {
  // May 2026 — same trim as the Everee path above. Without an
  // employment-breakdown context we can't compute the employer-side
  // I-9 status with confidence (we don't know workerType or whether
  // Section 1 was signed), so we show an em-dash placeholder. Once a
  // worker has an `entity_employments` row the Everee path takes over
  // and produces a real status line.
  const ot = String(user.onboardingType || '').toLowerCase();
  const is1099 = ot === '1099' || ot === 'contractor';
  void user; // params retained for signature stability
  void entityItems;
  void formatI9BreakdownLine;
  void formatEverifyBreakdownLineShort;

  return [
    { key: 'direct_deposit', text: 'Direct deposit: —' },
    { key: 'employer_i9', text: is1099 ? 'Employer I-9: N/A' : 'Employer I-9: —' },
    // Rows removed in May 2026 (Everee-owned items hidden from the
    // legacy/em-dash view too — same rationale as the breakdown path):
    //   { key: 'work_auth' }
    //   { key: 'i9' }   // worker-side; Everee owns
    //   { key: 'w4' }
    //   { key: 'tax_1099' }
    //   { key: 'everify' }
    //   { key: 'handbook' }
    //   { key: 'policies' }
  ];
}

/** Employment checklist mirror for the primary entity (same signals as the Employment tab). No background rows. */
/** 2026-07-11 (Greg): list surfaces only show items still needing attention —
 *  "…: Complete" and "…: N/A" rows are noise once done. Applied inside
 *  `getReadinessBreakdownRows` so every consumer (users-table Onboarding
 *  cell, user-group tables, profile header) gets the same behavior. */
export function isReadinessRowPending(row: ReadinessBreakdownRow): boolean {
  return !/:\s*(complete|n\/a)\s*$/i.test(row.text);
}

export function getReadinessBreakdownRows(
  user: RecruiterUserReadinessLike & RecruiterUserBreakdownExtras,
  entityItems?: UserListEntityOnboardingItem[],
  opts?: ReadinessBreakdownOpts,
): ReadinessBreakdownRow[] {
  const rows = opts?.employmentBreakdown
    ? getReadinessBreakdownRowsFromEmployment(user, opts.employmentBreakdown)
    : getReadinessBreakdownRowsLegacy(user, entityItems);
  return rows.filter(isReadinessRowPending);
}

/** Letter grade for displayed (0–100) score — matches prescreen banding for recruiter consistency. */
export function recruiterTableLetterGrade(displayScore: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  if (displayScore >= 90) return 'A';
  if (displayScore >= 80) return 'B';
  if (displayScore >= 70) return 'C';
  if (displayScore >= 60) return 'D';
  return 'E';
}
