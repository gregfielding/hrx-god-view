/**
 * Planner tests (2026-08-29, OnTrac hardening): the escalation-ladder
 * re-space, the late-fill synthesized ask, and the early-morning
 * re-confirm re-anchor. All times built in America/Los_Angeles.
 */
import { planReminderSchedule } from '../reminderSchedulePlanner';
import type { ShiftReminderStep } from '../shiftReminderProfile';

const TZ = 'America/Los_Angeles';
const HOUR = 60 * 60 * 1000;

const GIG_STEPS: ShiftReminderStep[] = [
  { type: 'assignment_reminder_24h', offsetHours: 24 },
  { type: 'assignment_reminder_23h_escalate', offsetHours: 23 },
  { type: 'assignment_reminder_22h_final', offsetHours: 22 },
  { type: 'assignment_reconfirm_4h', offsetHours: 4 },
  { type: 'assignment_reminder_2h_instructions', offsetHours: 2 },
  { type: 'assignment_checkin_0h', offsetHours: 0 },
  { type: 'assignment_noshow_check', offsetHours: -0.5 },
];

/** Ms for a PDT wall-clock time (UTC-7 — all test dates are in August). */
function pdt(iso: string): number {
  return new Date(`${iso}-07:00`).getTime();
}

function localHM(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function makePlan(startMs: number, nowMs: number, profileId = 'gig_standard') {
  return planReminderSchedule({
    steps: GIG_STEPS,
    startMs,
    nowMs,
    timezone: TZ,
    scheduleMode: 'production_default',
    profileId,
  });
}

describe('planReminderSchedule', () => {
  test('normal evening shift keeps the natural ladder untouched', () => {
    const start = pdt('2026-09-04T18:00:00'); // Friday 6 PM
    const plan = makePlan(start, pdt('2026-09-02T12:00:00'));
    expect(localHM(plan.get('assignment_reminder_24h')!.scheduledForMs)).toBe('18:00');
    expect(localHM(plan.get('assignment_reminder_23h_escalate')!.scheduledForMs)).toBe('19:00');
    expect(localHM(plan.get('assignment_reminder_22h_final')!.scheduledForMs)).toBe('20:00');
    expect(plan.get('assignment_reminder_23h_escalate')!.forceCancelReason).toBeUndefined();
    expect(plan.has('assignment_confirm_now')).toBe(false);
  });

  test('6 AM warehouse shift: floored ladder re-spaces to 8/10/12 instead of stacking at 8:00', () => {
    const start = pdt('2026-09-04T06:00:00');
    const plan = makePlan(start, pdt('2026-09-02T12:00:00'));
    expect(localHM(plan.get('assignment_reminder_24h')!.scheduledForMs)).toBe('08:00');
    expect(localHM(plan.get('assignment_reminder_23h_escalate')!.scheduledForMs)).toBe('10:00');
    expect(localHM(plan.get('assignment_reminder_22h_final')!.scheduledForMs)).toBe('12:00');
    expect(plan.get('assignment_reminder_23h_escalate')!.deferredReason).toBe('floor_ladder_respaced');
  });

  test('6 AM shift: re-confirm re-anchors to the previous evening, not 2 AM or a floored 8 AM', () => {
    const start = pdt('2026-09-04T06:00:00');
    const plan = makePlan(start, pdt('2026-09-02T12:00:00'));
    const rc = plan.get('assignment_reconfirm_4h')!;
    // T-12h → 6 PM the evening before.
    expect(rc.scheduledForMs).toBe(start - 12 * HOUR);
    expect(rc.forceCancelReason).toBeUndefined();
  });

  test('evening shift: re-confirm stays at T-4h', () => {
    const start = pdt('2026-09-04T18:00:00');
    const plan = makePlan(start, pdt('2026-09-02T12:00:00'));
    expect(plan.get('assignment_reconfirm_4h')!.scheduledForMs).toBe(start - 4 * HOUR);
  });

  test('re-confirm colliding with the worksite-details step is dropped', () => {
    // 11 AM start: T-4h = 7 AM → floored toward 8 AM; instructions T-2h = 9 AM.
    // Force a collision with a 10 AM start: reconfirm raw 6 AM floored to 8 AM,
    // instructions raw 8 AM stays 8 AM → same minute.
    const start = pdt('2026-09-04T10:00:00');
    const plan = makePlan(start, pdt('2026-09-02T12:00:00'));
    const rc = plan.get('assignment_reconfirm_4h')!;
    expect(rc.forceCancelReason).toBe('skipped_collides_with_instructions');
  });

  test('late fill (6h before shift): synthesizes an immediate ask and rebuilds the ladder', () => {
    const start = pdt('2026-09-04T18:00:00');
    const now = start - 6 * HOUR; // assigned at noon for a 6 PM shift
    const plan = makePlan(start, now);
    const ask = plan.get('assignment_confirm_now')!;
    expect(ask.scheduledForMs).toBe(now + 2 * 60 * 1000);
    // Escalations rebuilt at +2h/+4h from the ask, both before start-1h.
    expect(plan.get('assignment_reminder_23h_escalate')!.scheduledForMs).toBe(
      ask.scheduledForMs + 2 * HOUR,
    );
    expect(plan.get('assignment_reminder_22h_final')!.scheduledForMs).toBe(
      ask.scheduledForMs + 4 * HOUR,
    );
  });

  test('late fill (90 min before shift): ask fires now, no room for escalations', () => {
    const start = pdt('2026-09-04T18:00:00');
    const now = start - 90 * 60 * 1000;
    const plan = makePlan(start, now);
    expect(plan.has('assignment_confirm_now')).toBe(true);
    expect(plan.get('assignment_reminder_23h_escalate')!.forceCancelReason).toBe(
      'skipped_late_fill_no_room',
    );
    expect(plan.get('assignment_reminder_22h_final')!.forceCancelReason).toBe(
      'skipped_late_fill_no_room',
    );
  });

  test('assigned 30 min before shift: too late to ask — no synthesized ask', () => {
    const start = pdt('2026-09-04T18:00:00');
    const plan = makePlan(start, start - 30 * 60 * 1000);
    expect(plan.has('assignment_confirm_now')).toBe(false);
  });

  test('default (non-confirm) profile never synthesizes an ask', () => {
    const start = pdt('2026-09-04T18:00:00');
    const plan = planReminderSchedule({
      steps: [
        { type: 'assignment_reminder_24h', offsetHours: 24 },
        { type: 'assignment_reminder_2h', offsetHours: 2 },
      ],
      startMs: start,
      nowMs: start - 6 * HOUR,
      timezone: TZ,
      scheduleMode: 'production_default',
      profileId: 'default',
    });
    expect(plan.has('assignment_confirm_now')).toBe(false);
  });

  test('deterministic: same input, same output', () => {
    const start = pdt('2026-09-04T06:00:00');
    const now = pdt('2026-09-02T12:00:00');
    const a = makePlan(start, now);
    const b = makePlan(start, now);
    expect(Array.from(a.entries())).toEqual(Array.from(b.entries()));
  });
});
