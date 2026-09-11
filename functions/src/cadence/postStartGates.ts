/**
 * Dispatch gates for cadence steps that fire AT or AFTER shift start — pure.
 *
 * Every other step is cancelled as `assignment_start_in_past` once the shift
 * has started. The T+0 check-in, the T+15 late check-in and the T+30 no-show
 * probe are exempt inside a bounded grace window. The late check-in was missing
 * from that allow-list from 2026-09-07 until 2026-09-11, so every one of its
 * docs was cancelled at dispatch and no worker ever received it.
 *
 * T+15 late check-in (`assignment_late_checkin_15m`, signed by Natalie: "we
 * don't see you clocked in yet — are you on your way?"). The question is only
 * honest where HRX has a real clock-in feed — Indeed Flex punches, captured by
 * the portal worker's 10-minute clock-in watch into `indeed_flex_timesheets` —
 * and only once that feed has looked since the shift started. Measured
 * 2026-09-11: live punches reached HRX 16 and 55 min after clock-in, and the
 * watch (running on a laptop) had 27–70 min gaps between 6 and 8 AM CT. A stale
 * feed therefore means silence, never a false "we don't see you".
 *
 * Pure: no Firestore.
 */
import { localDateIso, toMillisLoose } from './dailyConfirm';

const MINUTE = 60 * 1000;

export const CHECKIN_STALE_WINDOW_MS = 120 * MINUTE;
export const LATE_CHECKIN_STALE_WINDOW_MS = 45 * MINUTE;
export const NOSHOW_STALE_WINDOW_MS = 360 * MINUTE;

/**
 * How long after start a step may still dispatch, or null for a pre-shift step
 * (cancelled once the shift has started). Any new step with a negative offset
 * must be listed here or it will never send.
 */
export function postStartStaleWindowMs(reminderType: string): number | null {
  switch (reminderType) {
    case 'assignment_checkin_0h':
      return CHECKIN_STALE_WINDOW_MS;
    case 'assignment_late_checkin_15m':
      return LATE_CHECKIN_STALE_WINDOW_MS;
    case 'assignment_noshow_check':
      return NOSHOW_STALE_WINDOW_MS;
    default:
      return null;
  }
}

/** The Flex feed must have captured at least this long after start before "no punch" counts. */
export const LATE_CHECKIN_FEED_FRESH_AFTER_START_MS = 5 * MINUTE;

/** A shift clock-in link that means the worker punches in Indeed Flex. */
export function isFlexClockInUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  return /time\.indeed\.com|flexJobId|flexRequestId/i.test(url);
}

/**
 * Reasons to dismiss before any lookup: the day is already resolved, or HRX has
 * no clock-in signal for this assignment. `flexLinkedAssignment` is
 * isFlexLinkedAssignment(assignment); `clockInUrl` is the shift's link. The CORT
 * Woodridge crew (2026-09-11) is linked ONLY through the shift's
 * time.indeed.com link — the assignments themselves carry no Flex ids.
 */
export function lateCheckinPrecheckReason(input: {
  cortState: string;
  flexLinkedAssignment: boolean;
  clockInUrl?: string | null;
}): string | null {
  const state = String(input.cortState ?? '').trim().toLowerCase();
  if (state === 'checked_in' || state === 'no_show' || state === 'cancelled') return `late_checkin_state_${state}`;
  if (!input.flexLinkedAssignment && !isFlexClockInUrl(input.clockInUrl)) return 'late_checkin_no_clockin_signal';
  return null;
}

/** One `indeed_flex_timesheets` doc — only the fields the gate reads are typed. */
export interface FlexTimesheetRow {
  id: string;
  hrxAssignmentId?: unknown;
  clockIn?: unknown;
  status?: unknown;
  [field: string]: unknown;
}

export type LateCheckinDecision =
  /** A punch on THIS assignment: stamp checked_in, don't text. */
  | { kind: 'clocked_in'; row: FlexTimesheetRow }
  /** The worker punched but Flex→HRX matching found no assignment: don't text, don't stamp. */
  | { kind: 'clocked_in_unmatched'; row: FlexTimesheetRow }
  /** The feed hasn't looked since start + grace, so "no punch" means nothing. */
  | { kind: 'feed_stale'; feedCapturedAtMs: number | null }
  | { kind: 'send' };

/**
 * `rows` = the worker's `indeed_flex_timesheets` docs for the workday (looked up
 * by hrxAssignmentId and by hrxUserId, merged). `feedCapturedAt` =
 * `integration_health/indeed_flex_timesheets.capturedAt` (last capture wins,
 * epoch ms). A punch beats a stale feed: a real clock-in is a real clock-in.
 */
export function decideLateCheckin(input: {
  assignmentId: string;
  rows: ReadonlyArray<FlexTimesheetRow>;
  feedCapturedAt: unknown;
  startMs: number;
}): LateCheckinDecision {
  // Same exclusions as the grid feed (timesheetGridFeed.applyFlexPunchesToGrid).
  const punched = input.rows.filter(
    (r) =>
      typeof r.clockIn === 'string' &&
      r.clockIn.trim() !== '' &&
      !/cancel|declined|no.?show/i.test(String(r.status ?? '')),
  );
  const mine = punched.find((r) => r.hrxAssignmentId === input.assignmentId);
  if (mine) return { kind: 'clocked_in', row: mine };
  const unmatched = punched.find((r) => !r.hrxAssignmentId);
  if (unmatched) return { kind: 'clocked_in_unmatched', row: unmatched };
  const feedCapturedAtMs = toMillisLoose(input.feedCapturedAt);
  if (feedCapturedAtMs === null || feedCapturedAtMs < input.startMs + LATE_CHECKIN_FEED_FRESH_AFTER_START_MS) {
    return { kind: 'feed_stale', feedCapturedAtMs };
  }
  return { kind: 'send' };
}

/**
 * The workday Flex files this shift under: a per-workday doc's own date for
 * daily crews, else the start's date on the worksite calendar (Flex's workDate
 * is the scheduled start's venue-local date).
 */
export function lateCheckinWorkDate(
  reminderWorkDate: string | null | undefined,
  startMs: number,
  timeZone: string,
): string {
  const wd = String(reminderWorkDate ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(wd) ? wd : localDateIso(startMs, timeZone);
}
