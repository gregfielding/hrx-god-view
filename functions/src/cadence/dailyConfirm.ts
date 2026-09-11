/**
 * Daily (every-workday) shift confirmation for standing career crews — pure planning.
 *
 * Greg 2026-09-11: Indeed Flex's scorecard (week of 8/31–9/6) put CORT
 * Woodridge at 73% fill / 27% no-show. That crew is a CAREER job order (#121)
 * whose assignments are open-ended Mon–Fri `weeklySchedule`s — and the cadence
 * never asked about a single one of those days: careers are fenced into the
 * quiet placement track (2026-08-29), and every reminder anchors to the
 * assignment's FIRST day. A messagingSequences doc can now opt one venue's
 * careers in (`targeting.includeCareer`, see shiftReminderProfile.ts), and this
 * module turns the weeklySchedule into per-workday reminder docs on a rolling
 * horizon. Each day carries its own confirmation state in
 * `assignment.cortConfirmationDays[YYYY-MM-DD]` — a YES for Monday never counts
 * for Tuesday.
 *
 * `assignment.cortConfirmation` stays as a MIRROR of the current cadence day
 * (`dailyConfirm: true`, `workDate`) so the single-shift readers keep working;
 * everything that gates or routes (dispatcher, reply handler, Scheduling
 * Health, Natalie) reads the per-day map.
 *
 * Pure: no Firestore. Timestamps are "anything with toMillis()".
 */
import { dowFromIsoDate } from '../timesheets/careerWeeklySchedule';
import { getLocalMinutesSinceMidnight, planReminderSchedule, type StepPlan } from './reminderSchedulePlanner';
import type { ShiftReminderStep, ShiftReminderType } from './shiftReminderProfile';

const HOUR = 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Days AFTER today (worksite-local) that get reminder docs. The top-up runs
 *  daily; 3 leaves room for a missed run before any T-24h ask is lost. */
export const DAILY_CONFIRM_HORIZON_DAYS = 3;
/** Self-re-arming doc in the reminder subcollection; the 5-minute dispatcher
 *  re-runs the scheduler for the assignment when it comes due. */
export const DAILY_CONFIRM_TOPUP_DOC_ID = 'daily_confirm_topup';
export const DAILY_CONFIRM_TOPUP_LOCAL_TIME = '01:00';
/** Per-day state kept on the assignment (recent reliability for Natalie). */
export const DAILY_CONFIRM_DAY_RETENTION_DAYS = 45;
/** Terminal per-day reminder docs are deleted after this many days. */
export const DAILY_CONFIRM_DOC_RETENTION_DAYS = 14;
/** A day stays the "current" cadence day until 12h after its start. */
export const DAILY_CONFIRM_DAY_ACTIVE_MS = 12 * HOUR;
/** Late-fill asks never go out before this local hour on a daily crew. */
const DAILY_LATE_FILL_FLOOR_LOCAL_HOUR = 8;

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && ISO_DATE_RE.test(v.trim());
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function toMillisLoose(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const maybe = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  if (typeof maybe._seconds === 'number') return maybe._seconds * 1000;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  return null;
}

/** YYYY-MM-DD of `ms` on the worksite's wall calendar. */
export function localDateIso(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** endDate / startDate are YYYY-MM-DD strings on most docs, Timestamps on some. */
export function isoDateLoose(v: unknown, timeZone: string): string | null {
  if (isIsoDate(v)) return v.trim();
  if (typeof v === 'string' && ISO_DATE_RE.test(v.trim().slice(0, 10))) return v.trim().slice(0, 10);
  const ms = toMillisLoose(v);
  return ms === null ? null : localDateIso(ms, timeZone);
}

export function normalizeHhmm(v: unknown): string | null {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${m[2]}`;
}

function tzOffsetMs(timeZone: string, ms: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - ms;
}

/**
 * Epoch ms of a worksite wall-clock time. Same two-pass DST-safe resolution as
 * workerShiftRemindersV2.combineDateAndTimeToTimestamp.
 */
export function wallClockToUtcMs(dateIso: string, hhmm: string, timeZone: string): number | null {
  if (!isIsoDate(dateIso)) return null;
  const t = normalizeHhmm(hhmm);
  if (!t) return null;
  const [y, mo, d] = dateIso.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);
  try {
    let instant = guess - tzOffsetMs(timeZone, guess);
    instant = guess - tzOffsetMs(timeZone, instant);
    return instant;
  } catch {
    return guess;
  }
}

/** The day's times when `workDate` is an ENABLED weeklySchedule day, else null. */
export function scheduledTimesFor(
  weeklySchedule: unknown,
  workDate: string,
): { startTime: string; endTime: string | null } | null {
  if (!weeklySchedule || typeof weeklySchedule !== 'object' || Array.isArray(weeklySchedule)) return null;
  const dow = dowFromIsoDate(workDate);
  if (dow === null) return null;
  const day = (weeklySchedule as Record<string, Record<string, unknown> | undefined>)[String(dow)];
  if (!day || day.enabled !== true) return null;
  const startTime = normalizeHhmm(day.startTime);
  if (!startTime) return null;
  return { startTime, endTime: normalizeHhmm(day.endTime) };
}

export interface WorkDay {
  workDate: string;
  startTime: string;
  endTime: string | null;
  startMs: number;
  endMs: number;
}

/**
 * Scheduled workdays from today (worksite-local) through today + horizon:
 * enabled weeklySchedule days only, never before startDate or after endDate.
 * Never materializes more than the horizon — open-ended assignments roll.
 */
export function enumerateWorkDays(args: {
  weeklySchedule: unknown;
  startDate?: unknown;
  endDate?: unknown;
  timezone: string;
  nowMs: number;
  horizonDays?: number;
}): WorkDay[] {
  const horizon = Math.max(0, Math.min(14, args.horizonDays ?? DAILY_CONFIRM_HORIZON_DAYS));
  const today = localDateIso(args.nowMs, args.timezone);
  const startDate = isoDateLoose(args.startDate, args.timezone);
  const endDate = isoDateLoose(args.endDate, args.timezone);
  const out: WorkDay[] = [];
  for (let i = 0; i <= horizon; i += 1) {
    const workDate = addDaysIso(today, i);
    if (startDate && workDate < startDate) continue;
    if (endDate && workDate > endDate) break;
    const times = scheduledTimesFor(args.weeklySchedule, workDate);
    if (!times) continue;
    const startMs = wallClockToUtcMs(workDate, times.startTime, args.timezone);
    if (startMs === null) continue;
    let endMs = times.endTime ? wallClockToUtcMs(workDate, times.endTime, args.timezone) : null;
    if (endMs === null) endMs = startMs + 8 * HOUR;
    else if (endMs <= startMs) endMs += 24 * HOUR; // overnight shift
    out.push({ workDate, startTime: times.startTime, endTime: times.endTime, startMs, endMs });
  }
  return out;
}

/** Next 01:00 worksite-local strictly after now — when the top-up doc fires. */
export function nextTopUpMs(nowMs: number, timeZone: string): number {
  const today = localDateIso(nowMs, timeZone);
  for (const d of [today, addDaysIso(today, 1), addDaysIso(today, 2)]) {
    const ms = wallClockToUtcMs(d, DAILY_CONFIRM_TOPUP_LOCAL_TIME, timeZone);
    if (ms !== null && ms > nowMs + 60 * 1000) return ms;
  }
  return nowMs + 24 * HOUR;
}

export function dailyReminderDocId(type: string, workDate: string): string {
  return `${type}__${workDate}`;
}

export function parseDailyReminderDocId(id: string): { type: string; workDate: string } | null {
  const m = /^(.+)__(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? { type: m[1], workDate: m[2] } : null;
}

// ---------------------------------------------------------------------------
// Per-day state
// ---------------------------------------------------------------------------

export type DayEntry = Record<string, unknown>;

export function isDailyConfirmAssignment(assignment: Record<string, unknown> | null | undefined): boolean {
  const cort = assignment?.cortConfirmation as Record<string, unknown> | undefined;
  return cort?.dailyConfirm === true;
}

export function dayEntriesOf(assignment: Record<string, unknown> | null | undefined): Record<string, DayEntry> {
  const raw = assignment?.cortConfirmationDays;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, DayEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isIsoDate(k) && v && typeof v === 'object') out[k] = v as DayEntry;
  }
  return out;
}

export function dayStateOf(assignment: Record<string, unknown> | null | undefined, workDate: string): string {
  return String(dayEntriesOf(assignment)[workDate]?.state ?? '').trim().toLowerCase();
}

function dayStartMs(workDate: string, entry: DayEntry | undefined): number {
  // Unseeded entries (e.g. a Flex punch on a day outside the horizon) have no
  // startAt; noon UTC keeps them ordered by date.
  return toMillisLoose(entry?.startAt) ?? Date.parse(`${workDate}T12:00:00Z`);
}

/**
 * The day the mirror reflects: the earliest day whose start + 12h is still
 * ahead (today's shift until it's well over, then tomorrow's). Falls back to
 * the latest day when every entry is in the past.
 */
export function pickCurrentCadenceDay(days: Record<string, DayEntry>, nowMs: number): string | null {
  const dates = Object.keys(days).filter(isIsoDate).sort();
  if (dates.length === 0) return null;
  for (const d of dates) {
    if (dayStartMs(d, days[d]) + DAILY_CONFIRM_DAY_ACTIVE_MS > nowMs) return d;
  }
  return dates[dates.length - 1];
}

/** `cortConfirmation` mirror for a daily-confirm assignment. Undefined extras are dropped. */
export function buildDailyMirror(
  days: Record<string, DayEntry>,
  nowMs: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const cleanExtra = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
  const cur = pickCurrentCadenceDay(days, nowMs);
  if (!cur) return { ...cleanExtra, dailyConfirm: true };
  return { ...days[cur], ...cleanExtra, dailyConfirm: true, workDate: cur };
}

export interface DaySeedPlan {
  create: WorkDay[];
  refresh: WorkDay[];
  remove: string[];
}

/**
 * Reconcile the per-day map with the enumerated schedule: create missing days,
 * refresh times that moved (state is kept), drop still-pending days the
 * schedule no longer has, and age out entries past retention.
 */
export function planDailyDaySeeds(args: {
  existingDays: Record<string, DayEntry>;
  workDays: WorkDay[];
  todayIso: string;
  horizonEndIso: string;
  retentionDays?: number;
}): DaySeedPlan {
  const plan: DaySeedPlan = { create: [], refresh: [], remove: [] };
  const scheduled = new Set(args.workDays.map((d) => d.workDate));
  for (const day of args.workDays) {
    const cur = args.existingDays[day.workDate];
    if (!cur) {
      plan.create.push(day);
      continue;
    }
    const moved =
      toMillisLoose(cur.startAt) !== day.startMs ||
      String(cur.startTime ?? '') !== day.startTime ||
      String(cur.endTime ?? '') !== String(day.endTime ?? '');
    if (moved) plan.refresh.push(day);
  }
  const retireBefore = addDaysIso(args.todayIso, -(args.retentionDays ?? DAILY_CONFIRM_DAY_RETENTION_DAYS));
  for (const [date, entry] of Object.entries(args.existingDays)) {
    if (date < retireBefore) {
      plan.remove.push(date);
      continue;
    }
    const inWindow = date >= args.todayIso && date <= args.horizonEndIso;
    const state = String(entry?.state ?? '').trim().toLowerCase();
    if (inWindow && !scheduled.has(date) && state === 'pending') plan.remove.push(date);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Reminder planning + dispatch gates
// ---------------------------------------------------------------------------

const ASK_LADDER: ReadonlyArray<string> = [
  'assignment_reminder_24h',
  'assignment_reminder_23h_escalate',
  'assignment_reminder_22h_final',
  'assignment_confirm_now',
];

/**
 * Per-day step suppression. A day the worker declined, no-showed, or is already
 * on site gets nothing more; a confirmed day skips the ask ladder (the daily
 * top-up re-plans every day, so a pre-confirmed day must not be re-asked).
 */
export function dailyDaySuppressReason(reminderType: string, dayState: string): string | null {
  const s = String(dayState ?? '').trim().toLowerCase();
  if (s === 'cancelled' || s === 'no_show' || s === 'checked_in') return `daily_day_state_${s}`;
  if (s === 'confirmed' && ASK_LADDER.includes(reminderType)) return 'daily_day_already_confirmed';
  return null;
}

export interface DailyReminderPlanRow extends StepPlan {
  docId: string;
  workDate: string;
  type: ShiftReminderType;
  startMs: number;
  endMs: number;
}

/**
 * The track's steps, planned independently for every workday. Two daily-only
 * rules on top of the shared planner:
 *   - A day whose ask doc already exists is re-planned WITHOUT the late-fill
 *     synth (planner "now" pinned just before the ask). The top-up re-plans
 *     every day; without this, today's 5 AM shift re-planned at 1 AM would
 *     synthesize a "confirm now" text for 1:02 AM.
 *   - A genuine late fill (new crew member, first materialization) never
 *     sends before 8 AM local; if 8 AM is inside 45 minutes of start the ask
 *     and its re-spaced ladder are dropped.
 */
export function planDailyConfirmReminders(args: {
  steps: ShiftReminderStep[];
  workDays: WorkDay[];
  dayStates: Record<string, string>;
  existingAskDays: ReadonlySet<string>;
  nowMs: number;
  timezone: string;
  scheduleMode: string;
  profileId: string;
}): DailyReminderPlanRow[] {
  const rows: DailyReminderPlanRow[] = [];
  for (const day of args.workDays) {
    const planFor = (nowMs: number) =>
      planReminderSchedule({
        steps: args.steps,
        startMs: day.startMs,
        nowMs,
        timezone: args.timezone,
        scheduleMode: args.scheduleMode,
        profileId: args.profileId,
      });
    let plan = planFor(args.nowMs);
    const ask = plan.get('assignment_reminder_24h');
    if (plan.has('assignment_confirm_now') && ask) {
      if (args.existingAskDays.has(day.workDate)) {
        plan = planFor(Math.min(args.nowMs, ask.scheduledForMs - 1));
      } else {
        applyDailyLateFillFloor(plan, day, args.timezone);
      }
    }
    const state = args.dayStates[day.workDate] ?? '';
    for (const [type, p] of plan) {
      const suppress = dailyDaySuppressReason(type, state);
      rows.push({
        ...p,
        forceCancelReason: p.forceCancelReason ?? suppress ?? undefined,
        docId: dailyReminderDocId(type, day.workDate),
        workDate: day.workDate,
        type,
        startMs: day.startMs,
        endMs: day.endMs,
      });
    }
  }
  return rows;
}

function applyDailyLateFillFloor(plan: Map<ShiftReminderType, StepPlan>, day: WorkDay, timezone: string): void {
  const confirmNow = plan.get('assignment_confirm_now');
  if (!confirmNow) return;
  const localMin = getLocalMinutesSinceMidnight(confirmNow.scheduledForMs, timezone);
  const floorMin = DAILY_LATE_FILL_FLOOR_LOCAL_HOUR * 60;
  if (localMin >= floorMin) return;
  const flooredMs = confirmNow.scheduledForMs + (floorMin - localMin) * 60 * 1000;
  const respaced = ['assignment_reminder_23h_escalate', 'assignment_reminder_22h_final'] as const;
  if (flooredMs > day.startMs - 45 * 60 * 1000) {
    confirmNow.forceCancelReason = 'daily_late_fill_quiet_hours';
    for (const t of respaced) {
      const e = plan.get(t);
      if (e && e.deferredReason === 'late_fill_ladder_respaced') e.forceCancelReason = 'daily_late_fill_quiet_hours';
    }
    return;
  }
  confirmNow.scheduledForMs = flooredMs;
  confirmNow.deferred = true;
  confirmNow.deferredReason = 'daily_late_fill_morning_floor';
  respaced.forEach((t, i) => {
    const e = plan.get(t);
    if (!e || e.deferredReason !== 'late_fill_ladder_respaced') return;
    const ms = flooredMs + (i + 1) * 2 * HOUR;
    if (ms >= day.startMs - HOUR) e.forceCancelReason = 'skipped_late_fill_no_room';
    else e.scheduledForMs = ms;
  });
}

/**
 * Dispatch-time gate for a per-day reminder doc: the assignment-level reasons
 * a day's step must not go out even though its doc is still pending.
 */
export function dailyConfirmDispatchBlockReason(
  assignment: Record<string, unknown>,
  workDate: string,
  timezone: string,
): string | null {
  if (assignment.retroactive === true || assignment.notificationsSuppressed === true) {
    return 'notifications_suppressed';
  }
  if (!isDailyConfirmAssignment(assignment)) return 'daily_confirm_withdrawn';
  const endIso = isoDateLoose(assignment.endDate, timezone);
  if (endIso && workDate > endIso) return 'assignment_ended';
  if (!scheduledTimesFor(assignment.weeklySchedule, workDate)) return 'day_not_scheduled';
  return null;
}

// ---------------------------------------------------------------------------
// Reply routing
// ---------------------------------------------------------------------------

export interface DailyCadenceDay {
  workDate: string;
  startMs: number;
  startTime: string;
  state: string;
  lastAskedAtMs: number;
}

/** Per-day cadences in [fromMs, toMs] (by start) for the inbound reply lookup. */
export function expandDailyCadenceDays(
  assignment: Record<string, unknown>,
  fromMs: number,
  toMs: number,
): DailyCadenceDay[] {
  const out: DailyCadenceDay[] = [];
  for (const [workDate, entry] of Object.entries(dayEntriesOf(assignment))) {
    const state = String(entry.state ?? '').trim().toLowerCase();
    const startMs = toMillisLoose(entry.startAt);
    if (!state || startMs === null || startMs < fromMs || startMs > toMs) continue;
    out.push({
      workDate,
      startMs,
      startTime: normalizeHhmm(entry.startTime) ?? '',
      state,
      lastAskedAtMs: toMillisLoose(entry.lastAskedAt) ?? 0,
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
