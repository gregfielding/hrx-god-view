/**
 * Reminder schedule planner (extracted 2026-08-29, OnTrac hardening).
 *
 * Pure scheduling logic for a shift's reminder set: per-step early-morning
 * flooring, then whole-schedule repair — escalation-ladder re-spacing when
 * the floor collapses steps together, the previous-evening re-anchor for
 * the T-4h re-confirm on early-morning shifts, and the synthesized
 * late-fill confirmation ask when an assignment is created inside the 24h
 * window. Kept free of Firestore so jest can exercise every branch
 * (__tests__/reminderSchedulePlanner.test.ts).
 */
import { logger } from 'firebase-functions/v2';
import type { ShiftReminderStep, ShiftReminderType } from './shiftReminderProfile';

export const REMINDER_EARLY_MORNING_FLOOR_LOCAL_HOUR = 8;
export const REMINDER_FLOOR_LATEST_OFFSET_MIN_BEFORE_START = 15; // T-15m cap

/**
 * Return the minute-of-day (0..1439) for `ms` rendered in `timezone`.
 * Used by `applyEarlyMorningFloor` to decide whether a scheduled time
 * lands inside the worker's local pre-dawn window.
 */
export function getLocalMinutesSinceMidnight(ms: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms));
    const hStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const mStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (h === 24) h = 0; // some locales render midnight as "24"
    return h * 60 + m;
  } catch (err) {
    logger.warn('[worker_shift_reminders] tz_minute_extract_fallback', {
      timezone,
      err: (err as Error)?.message || String(err),
    });
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  }
}

/**
 * If `scheduledForMs` falls before the early-morning floor in the
 * worker's local timezone AND the reminder's lead time is long enough
 * to safely defer (offsetHours >= 2), push it forward to the floor.
 *
 * Capped at `start - REMINDER_FLOOR_LATEST_OFFSET_MIN_BEFORE_START`
 * so we never push the reminder to fire after the shift has started
 * (or so close that the worker has no useful prep time).
 */
export function applyEarlyMorningFloor(
  scheduledForMs: number,
  shiftStartMs: number,
  offsetHours: number,
  timezone: string,
): { scheduledForMs: number; deferred: boolean; deferredReason?: string } {
  // Short-lead steps (T-15m, T-0h, post-start) always send when scheduled —
  // they're the imminent-arrival pings whose value IS waking the worker.
  if (offsetHours < 2) return { scheduledForMs, deferred: false };

  const localMinutes = getLocalMinutesSinceMidnight(scheduledForMs, timezone);
  const floorMinutes = REMINDER_EARLY_MORNING_FLOOR_LOCAL_HOUR * 60;
  if (localMinutes >= floorMinutes) return { scheduledForMs, deferred: false };

  const liftMs = (floorMinutes - localMinutes) * 60 * 1000;
  let deferredMs = scheduledForMs + liftMs;
  // Cap: never push the reminder past the shift's own T-15m gate.
  const latestAllowedMs =
    shiftStartMs - REMINDER_FLOOR_LATEST_OFFSET_MIN_BEFORE_START * 60 * 1000;
  let cappedAtTMinus15 = false;
  if (deferredMs > latestAllowedMs) {
    deferredMs = latestAllowedMs;
    cappedAtTMinus15 = true;
  }
  // If the cap brings the deferred time back before/at the original time,
  // the floor would be a no-op or backwards move — keep the original.
  if (deferredMs <= scheduledForMs) return { scheduledForMs, deferred: false };

  return {
    scheduledForMs: deferredMs,
    deferred: true,
    deferredReason: cappedAtTMinus15
      ? 'early_morning_floor_capped_at_t_minus_15m'
      : `early_morning_floor_${REMINDER_EARLY_MORNING_FLOOR_LOCAL_HOUR}am_local`,
  };
}

export interface StepPlan {
  offsetHours: number;
  rawScheduledForMs: number;
  scheduledForMs: number;
  deferred: boolean;
  deferredReason?: string;
  forceCancelReason?: string;
}

/**
 * Compute every step's fire time FIRST, then repair the schedule as a
 * whole. Per-step flooring alone collapsed the 24h/23h/22h ladder of any
 * pre-8AM shift onto the same 8:00 timestamp (three texts in one dispatch
 * batch, before the worker could possibly reply) and left workers
 * assigned inside the 24h window with no confirmation ask at all.
 */
export function planReminderSchedule(args: {
  steps: ShiftReminderStep[];
  startMs: number;
  nowMs: number;
  timezone: string;
  scheduleMode: string;
  profileId: string;
}): Map<ShiftReminderType, StepPlan> {
  const { steps, startMs, nowMs, timezone, scheduleMode, profileId } = args;
  const plan = new Map<ShiftReminderType, StepPlan>();

  for (const step of steps) {
    const stepType = step.type;
    let offsetHours = step.offsetHours;
    let rawMs = startMs - offsetHours * 60 * 60 * 1000;
    // Early-morning re-anchor for the re-confirm: T-4h before a 5–9 AM
    // start is the middle of the night; ask the previous EVENING (T-12h →
    // 5–9 PM) instead — a floored 8 AM same-day ask would collide with the
    // worksite-details step.
    if (stepType === 'assignment_reconfirm_4h' && scheduleMode === 'production_default') {
      const rawLocalMin = getLocalMinutesSinceMidnight(rawMs, timezone);
      const startLocalMin = getLocalMinutesSinceMidnight(startMs, timezone);
      if (rawLocalMin < 8 * 60 && startLocalMin >= 5 * 60 && startLocalMin < 10 * 60) {
        offsetHours = 12;
        rawMs = startMs - 12 * 60 * 60 * 1000;
      }
    }
    const floorResult =
      scheduleMode === 'production_default'
        ? applyEarlyMorningFloor(rawMs, startMs, offsetHours, timezone)
        : { scheduledForMs: rawMs, deferred: false as const };
    plan.set(stepType, {
      offsetHours,
      rawScheduledForMs: rawMs,
      scheduledForMs: floorResult.scheduledForMs,
      deferred: floorResult.deferred,
      deferredReason: (floorResult as { deferredReason?: string }).deferredReason,
    });
  }

  const isConfirmTrack = profileId === 'cort_gig' || profileId === 'gig_standard';
  const askPlan = plan.get('assignment_reminder_24h');
  const latestEscalationMs = startMs - 60 * 60 * 1000;
  const LADDER: ReadonlyArray<readonly [ShiftReminderType, number]> = [
    ['assignment_reminder_23h_escalate', 1],
    ['assignment_reminder_22h_final', 2],
  ];

  // Late fill: the 24h ask is already in the past but the shift is still
  // ≥45 minutes away — synthesize an immediate confirmation ask (its body
  // carries the address, since the T-2h details step may be past too) and
  // rebuild the escalation ladder off it.
  const askIsPast = !!askPlan && askPlan.scheduledForMs <= nowMs;
  const confirmNowMs = nowMs + 2 * 60 * 1000;
  if (isConfirmTrack && askIsPast && startMs - nowMs >= 45 * 60 * 1000) {
    plan.set('assignment_confirm_now', {
      offsetHours: (startMs - confirmNowMs) / (60 * 60 * 1000),
      rawScheduledForMs: confirmNowMs,
      scheduledForMs: confirmNowMs,
      deferred: false,
    });
    for (const [stepType, i] of LADDER) {
      const e = plan.get(stepType);
      if (!e) continue;
      const respaced = confirmNowMs + i * 2 * 60 * 60 * 1000;
      if (respaced >= latestEscalationMs) {
        e.forceCancelReason = 'skipped_late_fill_no_room';
      } else {
        e.scheduledForMs = respaced;
        e.deferred = true;
        e.deferredReason = 'late_fill_ladder_respaced';
      }
    }
  } else if (askPlan && askPlan.scheduledForMs > nowMs) {
    // Ladder re-space: escalations that landed within 45 minutes of the ask
    // (the pre-8AM floor collapse) move to ask+2h / ask+4h so the worker
    // has time to reply between texts. Normal shifts keep their 1h gaps.
    for (const [stepType, i] of LADDER) {
      const e = plan.get(stepType);
      if (!e) continue;
      if (e.scheduledForMs - askPlan.scheduledForMs < 45 * 60 * 1000) {
        const respaced = askPlan.scheduledForMs + i * 2 * 60 * 60 * 1000;
        if (respaced >= latestEscalationMs) {
          e.forceCancelReason = 'skipped_floor_compressed';
        } else {
          e.scheduledForMs = respaced;
          e.deferred = true;
          e.deferredReason = 'floor_ladder_respaced';
        }
      }
    }
  }

  // If the (possibly re-anchored) re-confirm still lands on top of the
  // worksite-details step, drop it — one message at that moment is plenty.
  const rcPlan = plan.get('assignment_reconfirm_4h');
  const instrPlan = plan.get('assignment_reminder_2h_instructions');
  if (
    rcPlan &&
    !rcPlan.forceCancelReason &&
    instrPlan &&
    Math.abs(rcPlan.scheduledForMs - instrPlan.scheduledForMs) < 30 * 60 * 1000
  ) {
    rcPlan.forceCancelReason = 'skipped_collides_with_instructions';
  }

  return plan;
}
