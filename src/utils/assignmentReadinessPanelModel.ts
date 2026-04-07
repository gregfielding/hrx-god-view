/**
 * User Profile → Assignments tab: per-assignment readiness rows (assignment-centric, not entity employment).
 */

import type { AssignmentReadinessStateV1, AssignmentReadinessV1Snapshot } from '../types/assignmentReadinessV1';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import {
  assignmentReadinessSectionDisplayName,
  assignmentReadinessSectionStatusDisplay,
  assignmentReadinessStateDisplay,
  coerceAssignmentReadinessV1FromDoc,
} from './assignmentReadinessUi';

/** Persisted states on `assignmentReadinessV1` (unknown / legacy strings fall back to recruiter-safe chip copy). */
const ASSIGNMENT_READINESS_STATES_V1 = new Set<string>([
  'not_applicable',
  'pending_confirmation',
  'requirements_incomplete',
  'ready',
  'active',
  'blocked',
  'completed',
  'canceled',
]);

export type AssignmentReadinessReasonCode =
  | 'missing_snapshot'
  | 'awaiting_confirmation'
  | 'blocked_no_rows'
  | 'blocked_with_rows'
  | 'data_incomplete'
  | 'data_mismatch'
  | 'screening_pending'
  | 'unknown_fallback';

const REASON_PHRASES: Record<AssignmentReadinessReasonCode, string> = {
  missing_snapshot: 'Readiness not yet initialized',
  awaiting_confirmation: 'Waiting for confirmation',
  blocked_no_rows: 'Requirements are blocking start',
  blocked_with_rows: 'Complete required items to proceed',
  data_incomplete: 'Assignment data incomplete',
  data_mismatch: 'Assignment data needs review',
  screening_pending: 'Screening in progress',
  unknown_fallback: 'Review assignment details',
};

function blockingLinesAreOnlyScreenings(lines: string[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((l) => {
      const t = l.trimStart();
      return t.startsWith('Screening:');
    })
  );
}

/** UI bucket for assignment readiness control panel (subset of persisted states). */
export type AssignmentPanelReadinessUi =
  | 'not_ready'
  | 'requirements_incomplete'
  | 'ready'
  | 'active'
  | 'completed'
  | 'canceled'
  | 'not_applicable'
  | 'unknown';

/** Local-midnight delta from today to scheduled start (negative = already started). */
export type StartDateUrgency =
  | 'no_date'
  | 'past_start'
  | 'starts_today'
  | 'critical'
  | 'soon'
  | 'upcoming'
  | 'distant';

export type StartDateContext = {
  urgency: StartDateUrgency;
  daysUntilStart: number | null;
  label: string;
  /** Chip / accent (MUI `color` where applicable). */
  tone: 'default' | 'warning' | 'error' | 'success' | 'info';
};

export type AssignmentReadinessPanelRow = {
  assignmentId: string;
  title: string;
  companyDisplay: string;
  worksiteDisplay: string;
  startDate: string;
  endDate: string;
  assignmentStatus: string;
  readiness: AssignmentReadinessV1Snapshot | null;
  /** Normalized readiness bucket for chips. */
  readinessUi: AssignmentPanelReadinessUi;
  readinessLabel: string;
  jobOrderId: string | null;
  onboardingInstanceId: string | null;
  blockingLines: string[];
  linkedScreenings: BackgroundCheckRecord[];
  startDateContext: StartDateContext;
  /** Analytics / automation; derived from snapshot, blockers, and UI bucket. */
  reasonCode: AssignmentReadinessReasonCode;
};

export type DeriveAssignmentReasonCodeParams = {
  readiness: AssignmentReadinessV1Snapshot | null;
  readinessUi: AssignmentPanelReadinessUi;
  blockingLines: string[];
  assignmentStatus: string;
};

/**
 * Single reason code per row for UI + analytics. No free-text branching here.
 */
export function deriveAssignmentReasonCode(params: DeriveAssignmentReasonCodeParams): AssignmentReadinessReasonCode {
  const { readiness, readinessUi, blockingLines } = params;
  const hasBlock = blockingLines.length > 0;
  const persisted = readiness?.assignmentReadinessState ?? null;

  if (!readiness) {
    return 'missing_snapshot';
  }

  if (persisted === 'pending_confirmation') {
    return 'awaiting_confirmation';
  }

  if (persisted === 'blocked') {
    return hasBlock ? 'blocked_with_rows' : 'blocked_no_rows';
  }

  if (persisted === 'requirements_incomplete') {
    return 'blocked_with_rows';
  }

  if ((persisted === 'ready' || persisted === 'active') && hasBlock && blockingLinesAreOnlyScreenings(blockingLines)) {
    return 'screening_pending';
  }

  if (readinessUi === 'unknown') {
    return 'data_mismatch';
  }

  if (readinessUi === 'not_ready') {
    return 'data_incomplete';
  }

  return 'unknown_fallback';
}

export function assignmentReadinessReasonPhrase(code: AssignmentReadinessReasonCode): string {
  return REASON_PHRASES[code];
}

function parseAssignmentStartDate(raw: string): Date | null {
  const s = String(raw || '').trim();
  if (!s || s === '—') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Days-until-start and urgency for assignment cards. Tones are conservative for completed/canceled rows.
 */
export function computeStartDateContext(
  startDateRaw: string,
  readinessUi: AssignmentPanelReadinessUi
): StartDateContext {
  const muted = readinessUi === 'completed' || readinessUi === 'canceled' || readinessUi === 'not_applicable';

  const start = parseAssignmentStartDate(startDateRaw);
  if (!start) {
    return { urgency: 'no_date', daysUntilStart: null, label: 'No start date', tone: 'default' };
  }

  const today = startOfLocalDay(new Date());
  const startDay = startOfLocalDay(start);
  const daysUntil = Math.round((startDay.getTime() - today.getTime()) / 86400000);

  const soften = (ctx: StartDateContext): StartDateContext =>
    muted ? { ...ctx, tone: 'default' } : ctx;

  if (daysUntil < 0) {
    const n = Math.abs(daysUntil);
    return soften({
      urgency: 'past_start',
      daysUntilStart: daysUntil,
      label: n === 1 ? 'Started yesterday' : `Started ${n} days ago`,
      tone: 'info',
    });
  }
  if (daysUntil === 0) {
    return soften({
      urgency: 'starts_today',
      daysUntilStart: 0,
      label: 'Starts today',
      tone: 'warning',
    });
  }
  if (daysUntil <= 3) {
    return soften({
      urgency: 'critical',
      daysUntilStart: daysUntil,
      label: daysUntil === 1 ? 'Starts tomorrow' : `Starts in ${daysUntil} days`,
      tone: 'error',
    });
  }
  if (daysUntil <= 7) {
    return soften({
      urgency: 'soon',
      daysUntilStart: daysUntil,
      label: `Starts in ${daysUntil} days`,
      tone: 'warning',
    });
  }
  if (daysUntil <= 30) {
    return soften({
      urgency: 'upcoming',
      daysUntilStart: daysUntil,
      label: `Starts in ${daysUntil} days`,
      tone: 'info',
    });
  }
  return {
    urgency: 'distant',
    daysUntilStart: daysUntil,
    label: `Starts in ${daysUntil} days`,
    tone: 'default',
  };
}

/**
 * Adjust start-date chip tone/label using readiness so “starts soon + not cleared” reads hotter than
 * “starts soon + ready”. Terminal placements stay date-muted from `computeStartDateContext`.
 */
export function blendStartDateContextWithReadiness(
  base: StartDateContext,
  readinessUi: AssignmentPanelReadinessUi
): StartDateContext {
  const terminal = readinessUi === 'completed' || readinessUi === 'canceled' || readinessUi === 'not_applicable';
  if (terminal) return base;

  const notCleared =
    readinessUi === 'not_ready' || readinessUi === 'unknown' || readinessUi === 'requirements_incomplete';
  const cleared = readinessUi === 'ready' || readinessUi === 'active';
  const { urgency, daysUntilStart } = base;
  const { label, tone } = base;

  if (notCleared) {
    if (urgency === 'starts_today') {
      return { ...base, tone: 'error', label: `${label} · Not cleared to start` };
    }
    if (urgency === 'critical') {
      return { ...base, tone: 'error', label: `${label} · Still open` };
    }
    if (urgency === 'soon') {
      return { ...base, tone: 'warning', label: `${label} · Needs attention` };
    }
    if (urgency === 'past_start' && daysUntilStart != null && daysUntilStart >= -14) {
      return { ...base, tone: 'warning', label: `${label} · Readiness still open` };
    }
  }

  if (cleared) {
    if (urgency === 'starts_today') {
      return { ...base, tone: 'warning', label: `${label} · Cleared to start` };
    }
    if (urgency === 'critical') {
      return { ...base, tone: 'warning', label: `${label} · Cleared — confirm details` };
    }
    if (urgency === 'soon') {
      return { ...base, tone: 'info' };
    }
  }

  return base;
}

export type PrimaryAssignmentAction = {
  label: string;
  variant: 'contained' | 'outlined';
  /** MUI Button `color`. */
  color: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' | 'inherit';
};

/**
 * Single primary CTA per card — driven by readiness + whether open blockers exist.
 */
export function primaryActionForAssignmentRow(row: AssignmentReadinessPanelRow): PrimaryAssignmentAction {
  const { readinessUi, blockingLines } = row;
  const hasBlock = blockingLines.length > 0;
  const terminal = readinessUi === 'completed' || readinessUi === 'canceled' || readinessUi === 'not_applicable';

  if (!terminal && hasBlock) {
    if (readinessUi === 'requirements_incomplete') {
      return { label: 'Complete requirements', variant: 'contained', color: 'warning' };
    }
    return { label: 'Resolve blockers', variant: 'contained', color: 'warning' };
  }

  switch (readinessUi) {
    case 'ready':
      return { label: 'Open assignment', variant: 'contained', color: 'success' };
    case 'active':
      return { label: 'Open assignment', variant: 'contained', color: 'primary' };
    case 'completed':
      return { label: 'View assignment record', variant: 'outlined', color: 'inherit' };
    case 'canceled':
    case 'not_applicable':
      return { label: 'View assignment', variant: 'outlined', color: 'inherit' };
    case 'requirements_incomplete':
      return { label: 'Complete requirements', variant: 'contained', color: 'warning' };
    case 'not_ready':
    case 'unknown':
      return { label: 'Open assignment to review', variant: 'contained', color: 'primary' };
    default:
      return { label: 'Open assignment', variant: 'contained', color: 'primary' };
  }
}

const TERMINAL_BG = new Set(['completed', 'canceled', 'error']);

function mapPersistedStateToUi(state: AssignmentReadinessStateV1 | null | undefined): AssignmentPanelReadinessUi {
  const s = String(state || '').trim() as AssignmentReadinessStateV1;
  switch (s) {
    case 'requirements_incomplete':
      return 'requirements_incomplete';
    case 'ready':
      return 'ready';
    case 'active':
      return 'active';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
    case 'not_applicable':
      return 'not_applicable';
    case 'pending_confirmation':
    case 'blocked':
      return 'not_ready';
    default:
      return 'unknown';
  }
}

/** Accept partial Firestore payloads when section array is missing (legacy rows). */
function readReadinessSnapshot(raw: unknown): AssignmentReadinessV1Snapshot | null {
  const coerced = coerceAssignmentReadinessV1FromDoc(raw);
  if (coerced) return coerced;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const st = o.assignmentReadinessState;
  if (typeof st !== 'string') return null;
  return {
    assignmentReadinessState: st as AssignmentReadinessStateV1,
    readinessSummary:
      o.readinessSummary == null || o.readinessSummary === '' ? null : String(o.readinessSummary),
    assignmentSectionStatuses: [],
    blockingRequirementIds: Array.isArray(o.blockingRequirementIds)
      ? (o.blockingRequirementIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
  };
}

export function backgroundChecksForAssignment(
  assignmentId: string,
  jobOrderId: string | null | undefined,
  all: BackgroundCheckRecord[]
): BackgroundCheckRecord[] {
  const aid = String(assignmentId || '').trim();
  const jo = String(jobOrderId || '').trim();
  return all.filter((c) => {
    if (aid && String(c.automationAssignmentId || '').trim() === aid) return true;
    if (jo && String(c.jobOrderId || '').trim() === jo) return true;
    return false;
  });
}

function buildBlockingLines(
  readiness: AssignmentReadinessV1Snapshot | null,
  screenings: BackgroundCheckRecord[]
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    lines.push(t);
  };

  if (readiness?.readinessSummary?.trim()) push(readiness.readinessSummary.trim());
  readiness?.blockingRequirementIds?.forEach((id) => push(`Blocking requirement: ${id}`));
  readiness?.assignmentSectionStatuses?.forEach((row) => {
    if (row.status === 'blocked' || row.status === 'incomplete') {
      push(
        `${assignmentReadinessSectionDisplayName(row.sectionId)}: ${assignmentReadinessSectionStatusDisplay(row.status)}`
      );
    }
  });

  screenings.forEach((c) => {
    const st = String(c.hrxStatus || '').toLowerCase();
    if (TERMINAL_BG.has(st)) return;
    const name = c.requestedPackageName || `Order ${c.id.slice(0, 8)}…`;
    push(`Screening: ${name} (${st || 'pending'})`);
  });

  return lines;
}

function pickTitle(row: Record<string, unknown>): string {
  return (
    String(row.shiftTitle || row.jobTitle || row.jobOrderTitle || row.title || '').trim() ||
    (row.jobOrderId ? `Job order ${String(row.jobOrderId).slice(0, 8)}…` : 'Assignment')
  );
}

export function buildAssignmentReadinessPanelRows(
  assignmentRows: Record<string, unknown>[],
  allBackgroundChecks: BackgroundCheckRecord[]
): AssignmentReadinessPanelRow[] {
  return assignmentRows.map((raw) => {
    const id = String(raw.id || '');
    const jobOrderId = raw.jobOrderId ? String(raw.jobOrderId) : null;
    const readiness = readReadinessSnapshot(raw.assignmentReadinessV1);
    const screenings = backgroundChecksForAssignment(id, jobOrderId, allBackgroundChecks);
    const state = readiness?.assignmentReadinessState ?? null;
    let readinessUi = mapPersistedStateToUi(state);
    if (readinessUi === 'unknown' && !readiness) {
      readinessUi = 'not_ready';
    }
    const readinessLabel = state ? assignmentReadinessStateDisplay(state) : 'Readiness not on file yet';
    const startDateStr = String(raw.startDate || '—');
    const assignmentStatus = String(raw.status || '—');
    const blockingLines = buildBlockingLines(readiness, screenings);
    const baseStart = computeStartDateContext(startDateStr, readinessUi);
    const startDateContext = blendStartDateContextWithReadiness(baseStart, readinessUi);

    const panelRowBase = {
      assignmentId: id,
      title: pickTitle(raw),
      companyDisplay: String(
        raw.companyDisplayName ||
          raw.companyName ||
          raw.agencyName ||
          raw.tenantName ||
          raw.customerName ||
          '—'
      ),
      worksiteDisplay: String(
        raw.worksiteDisplayName ||
          raw.worksiteName ||
          raw.worksiteNickname ||
          raw.worksiteTitle ||
          raw.location ||
          '—'
      ),
      startDate: startDateStr,
      endDate: String(raw.endDate || '—'),
      assignmentStatus,
      readiness,
      readinessUi,
      readinessLabel,
      jobOrderId,
      onboardingInstanceId: raw.onboardingInstanceId ? String(raw.onboardingInstanceId) : null,
      blockingLines,
      linkedScreenings: screenings,
      startDateContext,
    };

    const reasonCode = deriveAssignmentReasonCode({
      readiness,
      readinessUi,
      blockingLines,
      assignmentStatus,
    });

    return {
      ...panelRowBase,
      reasonCode,
    };
  });
}

/** Recruiter-facing readiness chip label — never surfaces internal buckets like `unknown` or raw enum strings. */
export function assignmentReadinessRecruiterChipLabel(row: AssignmentReadinessPanelRow): string {
  if (!row.readiness) return 'Readiness pending';
  const state = String(row.readiness.assignmentReadinessState || '').trim();
  if (!state || !ASSIGNMENT_READINESS_STATES_V1.has(state)) return 'Readiness pending';
  switch (state as AssignmentReadinessStateV1) {
    case 'pending_confirmation':
      return 'Pending confirmation';
    case 'requirements_incomplete':
      return 'Requirements incomplete';
    case 'ready':
      return 'Ready';
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    case 'canceled':
      return 'Canceled';
    case 'blocked':
      return 'Blocked';
    case 'not_applicable':
      return 'N/A';
    default:
      return 'Readiness pending';
  }
}

export function assignmentReadinessRecruiterChipColor(
  row: AssignmentReadinessPanelRow
): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' {
  if (!row.readiness) return 'info';
  const state = String(row.readiness.assignmentReadinessState || '').trim();
  if (!state || !ASSIGNMENT_READINESS_STATES_V1.has(state)) return 'info';
  switch (state as AssignmentReadinessStateV1) {
    case 'ready':
      return 'success';
    case 'active':
      return 'primary';
    case 'requirements_incomplete':
    case 'pending_confirmation':
    case 'blocked':
      return 'warning';
    case 'completed':
      return 'success';
    case 'canceled':
    case 'not_applicable':
      return 'default';
    default:
      return 'info';
  }
}

/** Filled chip for cleared / live placement states only. */
export function assignmentReadinessRecruiterChipFilled(row: AssignmentReadinessPanelRow): boolean {
  const state = row.readiness?.assignmentReadinessState;
  return state === 'ready' || state === 'active';
}
