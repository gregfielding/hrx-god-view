/**
 * Claim Shift — pure policy (no Firestore, no admin SDK state).
 *
 * The worker-initiated "Claim Shift" flow (docs/claude/project_tier_system_
 * claim_shift_spec.md, agreed model in project_tiered_shift_access.md) turns
 * a gig shift into a CONFIRMED assignment with no recruiter offer in between.
 * Everything that decides whether a claim is allowed and what it means lives
 * here so mocha can exercise every branch; `claimShift.ts` is the Firestore
 * glue (transaction, side effects) and `placementsApi.respondToAssignment`
 * routes `decision: 'claim'` into it.
 *
 * Errors are `HttpsError('failed-precondition', message, { code, ...extra })`
 * with a typed `code` so both clients (web `formatClaimShiftError`, Flutter
 * `ClaimShiftBlock.tryParse`) render the right state instead of matching on
 * strings — same contract the headshot gate uses.
 *
 * Tier release windows (T+0 / +10h / +24h from publish) are WIRED but OFF
 * (`CLAIM_TIER_WINDOWS_ENABLED`) — v1 ships with everyone treated as one
 * tier per the agreed build order (windows come with the tier cron +
 * worker-visible tier UI). Flip the constant when that lands; nothing else
 * changes.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { ASSIGNMENT_STATUS_QUERY_LIVE } from '../utils/assignmentStatusNormalize';

export type ClaimShiftErrorCode =
  /** Posting / job order / shift is not opted in or not live for claims. */
  | 'not_claimable'
  /** Capacity for that day is gone (lost the race, or already full). */
  | 'shift_filled'
  /** Release window for the worker's tier hasn't opened yet. */
  | 'tier_locked'
  /** Overlaps a live assignment the worker already holds. */
  | 'conflict'
  /** Unproven worker already holds the max concurrent claimed shifts. */
  | 'claim_cap'
  /** Worker can't be booked here at all (DNR, missing profile, not hired at a non-self-serve entity). */
  | 'ineligible'
  /** Payroll isn't finished at the shift's hiring entity (Greg 2026-09-11). */
  | 'setup_required';

export interface ClaimConflictDetails {
  assignmentId: string;
  jobTitle: string;
  locationName: string;
  startDate: string;
  startTime: string;
  endTime: string;
}

export interface ClaimShiftErrorDetails {
  code: ClaimShiftErrorCode;
  reason?: string;
  tier?: WorkerTier;
  opensAtMs?: number;
  cap?: number;
  remaining?: number;
  conflict?: ClaimConflictDetails;
  /** Hiring entity the readiness gate checked (`setup_required`, `ineligible`/not_hired). */
  entityId?: string;
  /** `setup_required`: 'started' = onboarding was just started by this claim. */
  stage?: ClaimSetupStage;
}

export function claimError(
  code: ClaimShiftErrorCode,
  message: string,
  extra: Omit<ClaimShiftErrorDetails, 'code'> = {},
): HttpsError {
  const details: ClaimShiftErrorDetails = { code, ...extra };
  return new HttpsError('failed-precondition', message, details);
}

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

export type WorkerTier = 1 | 2 | 3;

/** `users/{uid}.workerTiers.global`; ABSENT MEANS TIER 3 (never backfilled). */
export function resolveWorkerTier(userData: unknown): WorkerTier {
  if (!userData || typeof userData !== 'object') return 3;
  const tiers = (userData as Record<string, unknown>).workerTiers;
  if (!tiers || typeof tiers !== 'object') return 3;
  const g = Number((tiers as Record<string, unknown>).global);
  return g === 1 || g === 2 ? g : 3;
}

/** Release-window enforcement. OFF for claim v1 — see file header. */
export const CLAIM_TIER_WINDOWS_ENABLED = false;

/** Hours after publish each tier may see + claim (agreed 2026-08-31). */
export const CLAIM_TIER_RELEASE_OFFSET_HOURS: Record<WorkerTier, number> = { 1: 0, 2: 10, 3: 24 };

export function evaluateClaimTierWindow(args: {
  tier: WorkerTier;
  /** When the posting went live; null = no clock, window treated as open. */
  publishedAtMs: number | null;
  nowMs: number;
  enabled?: boolean;
}): { locked: boolean; opensAtMs: number | null } {
  const enabled = args.enabled ?? CLAIM_TIER_WINDOWS_ENABLED;
  if (!enabled || args.publishedAtMs == null || !Number.isFinite(args.publishedAtMs)) {
    return { locked: false, opensAtMs: null };
  }
  const opensAtMs = args.publishedAtMs + CLAIM_TIER_RELEASE_OFFSET_HOURS[args.tier] * 60 * 60 * 1000;
  return { locked: args.nowMs < opensAtMs, opensAtMs };
}

// ---------------------------------------------------------------------------
// Concurrent-claim cap for unproven workers
// ---------------------------------------------------------------------------

/**
 * Agreed spec: Tier 3 gets "limited concurrent claims until first few shifts
 * completed". Default 2 live claimed shifts for a worker with no completed
 * assignment yet (Greg to tune Friday; one constant).
 */
export const CLAIM_UNPROVEN_CONCURRENT_CAP = 2;

export function evaluateClaimCap(args: {
  hasCompletedShift: boolean;
  liveClaimedCount: number;
  cap?: number;
}): { blocked: boolean; cap: number } {
  const cap = args.cap ?? CLAIM_UNPROVEN_CONCURRENT_CAP;
  if (args.hasCompletedShift) return { blocked: false, cap };
  return { blocked: args.liveClaimedCount >= cap, cap };
}

// ---------------------------------------------------------------------------
// What can be claimed
// ---------------------------------------------------------------------------

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function normStatusToken(v: unknown): string {
  return norm(v).replace(/[\s-]+/g, '_');
}

/** Posting opt-in: recruiters flip `claimShiftEnabled` per posting; default off. */
export function isPostingClaimable(posting: Record<string, unknown> | null | undefined): boolean {
  if (!posting) return false;
  if (posting.claimShiftEnabled !== true) return false;
  return norm(posting.status) === 'active';
}

const JOB_ORDER_BLOCKED_STATUSES = new Set([
  'draft',
  'on_hold',
  'onhold',
  'paused',
  'cancelled',
  'canceled',
  'closed',
  'completed',
  'filled_by_another_agency',
]);

export function isJobOrderClaimable(
  jobOrder: Record<string, unknown> | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!jobOrder) return { ok: false, reason: 'job_order_missing' };
  if (norm(jobOrder.jobType) !== 'gig') return { ok: false, reason: 'not_gig' };
  const status = normStatusToken(jobOrder.status);
  if (status && JOB_ORDER_BLOCKED_STATUSES.has(status)) return { ok: false, reason: `job_order_${status}` };
  return { ok: true };
}

const SHIFT_BLOCKED_STATUSES = new Set(['cancelled', 'canceled', 'closed']);

export function isShiftClaimable(
  shift: Record<string, unknown> | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!shift) return { ok: false, reason: 'shift_missing' };
  if (norm(shift.shiftType) === 'open') return { ok: false, reason: 'open_shift' };
  const status = normStatusToken(shift.status);
  if (status && SHIFT_BLOCKED_STATUSES.has(status)) return { ok: false, reason: `shift_${status}` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Day resolution + capacity
// ---------------------------------------------------------------------------

/** Mirror of `shiftFillAutomation.computeAssignmentsTarget` (kept in sync by test). */
export function computeShiftAssignmentsTarget(shift: Record<string, unknown>): number {
  const base = Number(shift?.totalStaffRequested ?? 1) || 1;
  const overstaffCount = Number(shift?.overstaffCount ?? 0) || 0;
  const overstaffPercent = Number(shift?.overstaffPercent ?? 0) || 0;
  const pctExtra = overstaffPercent > 0 ? Math.ceil((base * overstaffPercent) / 100) : 0;
  const extra = Math.max(0, overstaffCount, pctExtra);
  return Math.max(1, base + extra);
}

export function toDayKey(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.split('T')[0];
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe?.toDate === 'function') {
    try {
      return maybe.toDate().toISOString().split('T')[0];
    } catch {
      return '';
    }
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return '';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ResolvedShiftDay =
  | {
      ok: true;
      dayKey: string;
      startTime: string;
      endTime: string;
      /** Spots for THIS day (per-day `dateSchedule.workersNeeded` when set). */
      capacity: number;
      /** True when the shift is a multi-day gig with one assignment per day. */
      multiDay: boolean;
    }
  | { ok: false; reason: 'date_required' | 'invalid_date' | 'no_times' };

/**
 * Which calendar day is being claimed, its hours, and how many spots that day
 * has. Multi-day gigs (dateSchedule + endDate ≠ shiftDate) are claimed one
 * day at a time — the day-scoped assignment id `${shiftId}__${uid}__${day}`
 * is also the idempotency key.
 */
export function resolveShiftDay(shift: Record<string, unknown>, requestedDate?: string | null): ResolvedShiftDay {
  const shiftDate = toDayKey(shift.shiftDate);
  const endDate = toDayKey(shift.endDate) || shiftDate;
  const requested = typeof requestedDate === 'string' && DAY_RE.test(requestedDate) ? requestedDate : '';
  const dateSchedule =
    shift.dateSchedule && typeof shift.dateSchedule === 'object'
      ? (shift.dateSchedule as Record<string, { startTime?: string; endTime?: string; workersNeeded?: unknown; overstaff?: unknown }>)
      : null;
  const multiDay = Boolean(dateSchedule) && Boolean(shiftDate) && endDate !== shiftDate;

  if (multiDay && dateSchedule) {
    const days = Object.entries(dateSchedule)
      .filter(([d, cfg]) => DAY_RE.test(d) && d >= shiftDate && d <= endDate && Boolean(cfg?.startTime && cfg?.endTime))
      .map(([d]) => d)
      .sort();
    const dayKey = requested || (days.length === 1 ? days[0] : '');
    if (!dayKey) return { ok: false, reason: 'date_required' };
    if (!days.includes(dayKey)) return { ok: false, reason: 'invalid_date' };
    const cfg = dateSchedule[dayKey];
    const perDay = Number(cfg.workersNeeded);
    const over = Number(cfg.overstaff);
    const capacity =
      Number.isFinite(perDay) && perDay > 0
        ? perDay + (Number.isFinite(over) && over > 0 ? over : 0)
        : computeShiftAssignmentsTarget(shift);
    return {
      ok: true,
      dayKey,
      startTime: String(cfg.startTime),
      endTime: String(cfg.endTime),
      capacity: Math.max(1, capacity),
      multiDay: true,
    };
  }

  if (!shiftDate) return { ok: false, reason: 'invalid_date' };
  if (requested && requested !== shiftDate) return { ok: false, reason: 'invalid_date' };
  const startTime = String(shift.startTime || shift.defaultStartTime || '');
  const endTime = String(shift.endTime || shift.defaultEndTime || '');
  if (!startTime || !endTime) return { ok: false, reason: 'no_times' };
  return {
    ok: true,
    dayKey: shiftDate,
    startTime,
    endTime,
    capacity: computeShiftAssignmentsTarget(shift),
    multiDay: false,
  };
}

/** Same live set the placement overlap guard uses. */
export function countsTowardCapacity(status: unknown): boolean {
  return ASSIGNMENT_STATUS_QUERY_LIVE.includes(norm(status));
}

/**
 * Does an existing live assignment on this shift occupy the day being
 * claimed? Day-scoped docs carry `startDate === day`; a legacy shift-only doc
 * with no startDate occupies the single-day shift's own date.
 */
export function assignmentOccupiesDay(
  assignment: Record<string, unknown>,
  dayKey: string,
  singleDayShiftDate: string,
): boolean {
  const sd = toDayKey(assignment.startDate);
  if (sd) return sd === dayKey;
  return Boolean(singleDayShiftDate) && dayKey === singleDayShiftDate;
}

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

export interface ClaimAcknowledgements {
  uniform: boolean;
  transportation: boolean;
  arrival: boolean;
  attendancePolicy: boolean;
}

const ACK_ALIASES: Record<keyof ClaimAcknowledgements, string[]> = {
  uniform: ['uniform', 'uniformPpeCommitment', 'understandsUniformAndRequirements'],
  transportation: ['transportation', 'transportCommitment'],
  arrival: ['arrival', 'arrivalCommitment', 'onTimeArrival'],
  attendancePolicy: ['attendancePolicy', 'attendancePolicyAcknowledged', 'understandsNoShowConsequence'],
};

/** Accepts the web sheet's keys, the app offer sheet's keys, or the short names. */
export function normalizeClaimAcknowledgements(raw: unknown): ClaimAcknowledgements {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (keys: string[]) => keys.some((k) => src[k] === true);
  return {
    uniform: pick(ACK_ALIASES.uniform),
    transportation: pick(ACK_ALIASES.transportation),
    arrival: pick(ACK_ALIASES.arrival),
    attendancePolicy: pick(ACK_ALIASES.attendancePolicy),
  };
}

export function allAcknowledged(acks: ClaimAcknowledgements): boolean {
  return acks.uniform && acks.transportation && acks.arrival && acks.attendancePolicy;
}

/** Posting "went live" clock for the tier windows: postedAt, else createdAt. */
export function resolvePostingPublishedAtMs(posting: Record<string, unknown> | null | undefined): number | null {
  if (!posting) return null;
  for (const key of ['postedAt', 'publishedAt', 'createdAt']) {
    const v = posting[key] as { toMillis?: () => number } | Date | string | undefined;
    if (!v) continue;
    if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
      const ms = (v as { toMillis: () => number }).toMillis();
      if (Number.isFinite(ms)) return ms;
    } else if (v instanceof Date) {
      if (Number.isFinite(v.getTime())) return v.getTime();
    } else if (typeof v === 'string') {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payroll readiness at the shift's hiring entity (Greg 2026-09-11)
// docs/claude/project_events_onboarding_claim_readiness.md
// ---------------------------------------------------------------------------

/**
 * Entities a worker can get hired at on their own: C1 Events hires everyone.
 * Anywhere else a claim needs an employment a recruiter or the hiring plan
 * already started.
 */
export const SELF_SERVE_HIRE_ENTITY_IDS: ReadonlySet<string> = new Set(['c1_events_llc']);

export type ClaimSetupStage = 'started' | 'in_progress';

const ENDED_EMPLOYMENT_STATUSES = new Set(['terminated', 'inactive', 'blocked']);

function lowerTrim(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Payroll is finished at this entity. The onboarding engine's
 * `status`/`onboardingComplete` alone lags (it covers more than payroll): the
 * 2026-09-11 check found it read 92 of 174 paid C1 Events workers as not
 * ready. The Everee link or any payroll field below matched Everee for every
 * paid worker. Rows must already be filtered to this user + entity.
 */
export function isPayrollReadyForClaim(
  employments: ReadonlyArray<Record<string, unknown>>,
  link: Record<string, unknown> | null | undefined,
): boolean {
  if (link && (lowerTrim(link.status) === 'onboarding_complete' || Boolean(link.apiObservedOnboardingCompleteAt))) {
    return true;
  }
  return employments.some((e) => {
    if (ENDED_EMPLOYMENT_STATUSES.has(lowerTrim(e.status))) return false;
    return (
      lowerTrim(e.status) === 'active' ||
      e.onboardingComplete === true ||
      lowerTrim(e.evereeOnboardingStatus) === 'complete' ||
      Boolean(e.payrollOnboardingCompletedAt) ||
      lowerTrim(e.payrollStatus) === 'complete'
    );
  });
}

export type ClaimReadinessDecision =
  | { kind: 'ready' }
  /** Self-serve entity, never hired there: start onboarding, then send them to setup. */
  | { kind: 'start_onboarding' }
  /** Hired there, payroll not finished per cached signals (ask Everee live before refusing). */
  | { kind: 'setup_in_progress' }
  /** Not self-serve and no employment there: the worker applies instead. */
  | { kind: 'not_hired' }
  /** Every employment row at this entity is terminated / inactive / blocked. */
  | { kind: 'employment_ended' };

export function evaluateClaimReadiness(args: {
  entityId: string;
  /** This worker's `entity_employments` rows AT `entityId`. */
  employments: ReadonlyArray<Record<string, unknown>>;
  /** `everee_workers/{entityId}__{uid}` or null. */
  link: Record<string, unknown> | null | undefined;
}): ClaimReadinessDecision {
  const live = args.employments.filter((e) => !ENDED_EMPLOYMENT_STATUSES.has(lowerTrim(e.status)));
  if (args.employments.length > 0 && live.length === 0) return { kind: 'employment_ended' };
  if (isPayrollReadyForClaim(live, args.link)) return { kind: 'ready' };
  if (live.length > 0) return { kind: 'setup_in_progress' };
  return SELF_SERVE_HIRE_ENTITY_IDS.has(args.entityId) ? { kind: 'start_onboarding' } : { kind: 'not_hired' };
}
