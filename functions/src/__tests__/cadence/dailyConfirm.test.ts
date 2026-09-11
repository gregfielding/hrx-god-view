/**
 * Daily (every-workday) confirmation planning — CORT Woodridge build, 2026-09-11.
 * Pure: no Firestore. The crew under test is JO #121's real shape: Mon–Fri
 * 05:00–13:30 America/Chicago, weekend days present but disabled, open-ended.
 */
import { expect } from 'chai';
import {
  buildDailyMirror,
  dailyConfirmDispatchBlockReason,
  dailyDaySuppressReason,
  dailyReminderDocId,
  enumerateWorkDays,
  expandDailyCadenceDays,
  localDateIso,
  nextTopUpMs,
  parseDailyReminderDocId,
  pickCurrentCadenceDay,
  planDailyConfirmReminders,
  planDailyDaySeeds,
  wallClockToUtcMs,
} from '../../cadence/dailyConfirm';
import { resolveShiftReminderProfileSync } from '../../cadence/shiftReminderProfile';

const TZ = 'America/Chicago';
const HOUR = 60 * 60 * 1000;

const WOODRIDGE_WEEK = {
  '0': { enabled: false, startTime: '05:03', endTime: '13:04' },
  '1': { enabled: true, startTime: '05:00', endTime: '13:30', workersNeeded: 5 },
  '2': { enabled: true, startTime: '05:00', endTime: '13:30', workersNeeded: 5 },
  '3': { enabled: true, startTime: '05:00', endTime: '13:30', workersNeeded: 5 },
  '4': { enabled: true, startTime: '05:00', endTime: '13:30', workersNeeded: 5 },
  '5': { enabled: true, startTime: '05:00', endTime: '13:30', workersNeeded: 5 },
  '6': { enabled: false, startTime: '05:03', endTime: '13:04' },
};

/** Epoch ms for a Chicago wall-clock time in CDT (UTC-5; all September). */
const cdt = (iso: string) => new Date(`${iso}-05:00`).getTime();
const ts = (ms: number) => ({ toMillis: () => ms });
const localDay = (ms: number) => localDateIso(ms, TZ);
const localHM = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

const CORT_STEPS = resolveShiftReminderProfileSync({ tenantProfile: 'cort_gig', assignment: {} }).steps;

function plan(nowMs: number, opts: { dayStates?: Record<string, string>; existingAskDays?: string[]; weeklySchedule?: unknown } = {}) {
  const workDays = enumerateWorkDays({
    weeklySchedule: opts.weeklySchedule ?? WOODRIDGE_WEEK,
    startDate: '2026-07-06',
    endDate: '',
    timezone: TZ,
    nowMs,
  });
  return planDailyConfirmReminders({
    steps: CORT_STEPS,
    workDays,
    dayStates: opts.dayStates ?? {},
    existingAskDays: new Set(opts.existingAskDays ?? []),
    nowMs,
    timezone: TZ,
    scheduleMode: 'production_default',
    profileId: 'cort_gig',
  });
}

describe('dailyConfirm — workday enumeration', () => {
  it('Friday afternoon: horizon reaches Monday, skipping the disabled weekend', () => {
    const days = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '2026-07-06', endDate: '', timezone: TZ, nowMs: cdt('2026-09-11T15:00:00') });
    expect(days.map((d) => d.workDate)).to.deep.equal(['2026-09-11', '2026-09-14']);
    expect(days[1].startMs).to.equal(cdt('2026-09-14T05:00:00'));
    expect(days[1].endMs).to.equal(cdt('2026-09-14T13:30:00'));
  });

  it('an open-ended crew never materializes past today + 3', () => {
    const days = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '2026-07-06', endDate: '', timezone: TZ, nowMs: cdt('2026-09-14T00:30:00') });
    expect(days.map((d) => d.workDate)).to.deep.equal(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
  });

  it('respects startDate and endDate', () => {
    const nowMs = cdt('2026-09-14T00:30:00');
    const notStarted = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '2026-09-16', endDate: '', timezone: TZ, nowMs });
    expect(notStarted.map((d) => d.workDate)).to.deep.equal(['2026-09-16', '2026-09-17']);
    const ending = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '2026-07-06', endDate: '2026-09-15', timezone: TZ, nowMs });
    expect(ending.map((d) => d.workDate)).to.deep.equal(['2026-09-14', '2026-09-15']);
    const tsEnd = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '2026-07-06', endDate: ts(cdt('2026-09-14T12:00:00')), timezone: TZ, nowMs });
    expect(tsEnd.map((d) => d.workDate)).to.deep.equal(['2026-09-14']);
  });

  it('uses the worksite calendar, not UTC — 11 PM Chicago is still today', () => {
    const nowMs = cdt('2026-09-14T23:00:00'); // 04:00Z on the 15th
    expect(localDay(nowMs)).to.equal('2026-09-14');
    const days = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '', endDate: '', timezone: TZ, nowMs });
    expect(days[0].workDate).to.equal('2026-09-14');
  });

  it('5 AM stays 5 AM local across the Nov 1 fall-back', () => {
    expect(wallClockToUtcMs('2026-10-30', '05:00', TZ)).to.equal(new Date('2026-10-30T05:00:00-05:00').getTime());
    expect(wallClockToUtcMs('2026-11-02', '05:00', TZ)).to.equal(new Date('2026-11-02T05:00:00-06:00').getTime());
  });
});

describe('dailyConfirm — per-day step generation (cort_gig, 5 AM crew)', () => {
  const nowMs = cdt('2026-09-11T15:00:00');
  const rows = plan(nowMs);

  it('one doc per (step, workday) — Monday never shares a doc with Tuesday', () => {
    const ids = rows.map((r) => r.docId);
    expect(new Set(ids).size).to.equal(ids.length);
    expect(ids).to.include('assignment_reminder_24h__2026-09-14');
    expect(rows.filter((r) => r.workDate === '2026-09-14').map((r) => r.type).sort()).to.deep.equal(
      CORT_STEPS.map((s) => s.type).sort(),
    );
  });

  it('Monday 5 AM: ask Sunday 8 AM, nudges 10 AM / noon, re-confirm Sunday 5 PM, then the day-of steps', () => {
    const mon = new Map(rows.filter((r) => r.workDate === '2026-09-14').map((r) => [r.type, r]));
    const at = (t: string) => {
      const r = mon.get(t as never)!;
      return `${localDay(r.scheduledForMs)} ${localHM(r.scheduledForMs)}`;
    };
    expect(at('assignment_reminder_24h')).to.equal('2026-09-13 08:00');
    expect(at('assignment_reminder_23h_escalate')).to.equal('2026-09-13 10:00');
    expect(at('assignment_reminder_22h_final')).to.equal('2026-09-13 12:00');
    expect(at('assignment_reconfirm_4h')).to.equal('2026-09-13 17:00');
    expect(at('assignment_reminder_2h_instructions')).to.equal('2026-09-14 04:45');
    expect(at('assignment_reminder_15m_clockin')).to.equal('2026-09-14 04:45');
    expect(at('assignment_checkin_0h')).to.equal('2026-09-14 05:00');
    expect(at('assignment_noshow_check')).to.equal('2026-09-14 05:30');
    for (const r of mon.values()) expect(r.forceCancelReason, r.type).to.equal(undefined);
  });

  it("today's (Friday) steps are all in the past — the writer cancels them", () => {
    const fri = rows.filter((r) => r.workDate === '2026-09-11');
    expect(fri.length).to.be.greaterThan(0);
    for (const r of fri) expect(r.scheduledForMs, r.type).to.be.at.most(nowMs);
  });
});

describe('dailyConfirm — re-planning (the 1 AM top-up)', () => {
  it('never synthesizes a pre-dawn "confirm now" for a day whose ask already went out', () => {
    const nowMs = cdt('2026-09-14T01:00:00');
    const mon = plan(nowMs, { existingAskDays: ['2026-09-14'] }).filter((r) => r.workDate === '2026-09-14');
    expect(mon.map((r) => r.type)).to.not.include('assignment_confirm_now');
    const nudge = mon.find((r) => r.type === 'assignment_reminder_23h_escalate')!;
    expect(nudge.scheduledForMs).to.equal(cdt('2026-09-13T10:00:00'));
  });

  it('a crew member added at 1 AM for a 5 AM shift gets no quiet-hours ask', () => {
    const nowMs = cdt('2026-09-14T01:00:00');
    const mon = new Map(plan(nowMs).filter((r) => r.workDate === '2026-09-14').map((r) => [r.type, r]));
    expect(mon.get('assignment_confirm_now')?.forceCancelReason).to.equal('daily_late_fill_quiet_hours');
    expect(mon.get('assignment_reminder_23h_escalate')?.forceCancelReason).to.equal('daily_late_fill_quiet_hours');
  });

  it('a 6 AM add for a 10 AM shift waits for 8 AM and drops the nudge that no longer fits', () => {
    const tenAm = { '1': { enabled: true, startTime: '10:00', endTime: '18:30' } };
    const nowMs = cdt('2026-09-14T06:00:00');
    const mon = new Map(plan(nowMs, { weeklySchedule: tenAm }).filter((r) => r.workDate === '2026-09-14').map((r) => [r.type, r]));
    const ask = mon.get('assignment_confirm_now')!;
    expect(localHM(ask.scheduledForMs)).to.equal('08:00');
    expect(ask.forceCancelReason).to.equal(undefined);
    expect(mon.get('assignment_reminder_23h_escalate')?.forceCancelReason).to.equal('skipped_late_fill_no_room');
  });
});

describe('dailyConfirm — per-day state gates the steps', () => {
  it('a confirmed Monday skips its ask ladder while Tuesday is still asked', () => {
    const rows = plan(cdt('2026-09-12T01:00:00'), { dayStates: { '2026-09-14': 'confirmed' } });
    const reason = (date: string, type: string) => rows.find((r) => r.workDate === date && r.type === type)?.forceCancelReason;
    expect(reason('2026-09-14', 'assignment_reminder_24h')).to.equal('daily_day_already_confirmed');
    expect(reason('2026-09-14', 'assignment_reminder_22h_final')).to.equal('daily_day_already_confirmed');
    expect(reason('2026-09-14', 'assignment_reconfirm_4h')).to.equal(undefined);
    expect(reason('2026-09-15', 'assignment_reminder_24h')).to.equal(undefined);
  });

  it('a declined, no-show, or on-site day gets nothing more', () => {
    expect(dailyDaySuppressReason('assignment_reminder_2h_instructions', 'cancelled')).to.equal('daily_day_state_cancelled');
    expect(dailyDaySuppressReason('assignment_reconfirm_4h', 'checked_in')).to.equal('daily_day_state_checked_in');
    expect(dailyDaySuppressReason('assignment_checkin_0h', 'no_show')).to.equal('daily_day_state_no_show');
    expect(dailyDaySuppressReason('assignment_reminder_24h', 'pending')).to.equal(null);
  });
});

describe('dailyConfirm — per-day state map + mirror', () => {
  it('seeds missing days, refreshes moved times, keeps answers, retires unscheduled pending + aged-out days', () => {
    const nowMs = cdt('2026-09-14T00:30:00');
    const workDays = enumerateWorkDays({ weeklySchedule: { ...WOODRIDGE_WEEK, '2': { enabled: false } }, startDate: '', endDate: '', timezone: TZ, nowMs });
    const seeds = planDailyDaySeeds({
      existingDays: {
        '2026-07-01': { state: 'confirmed' },
        '2026-09-14': { state: 'confirmed', startAt: ts(cdt('2026-09-14T06:00:00')), startTime: '06:00', endTime: '13:30' },
        '2026-09-15': { state: 'pending' },
        '2026-09-16': { state: 'pending', startAt: ts(cdt('2026-09-16T05:00:00')), startTime: '05:00', endTime: '13:30' },
      },
      workDays,
      todayIso: '2026-09-14',
      horizonEndIso: '2026-09-17',
      nowMs,
    });
    expect(seeds.create.map((d) => d.workDate)).to.deep.equal(['2026-09-17']);
    expect(seeds.refresh.map((d) => d.workDate)).to.deep.equal(['2026-09-14']);
    expect(seeds.remove.sort()).to.deep.equal(['2026-07-01', '2026-09-15']);
  });

  it('never seeds a day that started before anyone was asked, and drops such phantoms (Woodridge go-live, Fri 9/11)', () => {
    const nowMs = cdt('2026-09-11T12:40:00'); // that morning's 5 AM shift is long over
    const workDays = enumerateWorkDays({ weeklySchedule: WOODRIDGE_WEEK, startDate: '', endDate: '', timezone: TZ, nowMs });
    const fresh = planDailyDaySeeds({ existingDays: {}, workDays, todayIso: '2026-09-11', horizonEndIso: '2026-09-14', nowMs });
    expect(fresh.create.map((d) => d.workDate)).to.deep.equal(['2026-09-14']);

    const seeded = planDailyDaySeeds({
      existingDays: {
        '2026-09-11': { state: 'pending', startAt: ts(cdt('2026-09-11T05:00:00')), startTime: '05:00', endTime: '13:30' },
        '2026-09-10': { state: 'pending', startAt: ts(cdt('2026-09-10T05:00:00')), lastAskedAt: ts(cdt('2026-09-09T08:00:00')) },
        '2026-09-14': { state: 'pending', startAt: ts(cdt('2026-09-14T05:00:00')), startTime: '05:00', endTime: '13:30' },
      },
      workDays,
      todayIso: '2026-09-11',
      horizonEndIso: '2026-09-14',
      nowMs,
    });
    // Asked-but-silent 9/10 stays — that's the real "didn't confirm" signal.
    expect(seeded.remove).to.deep.equal(['2026-09-11']);
    expect(seeded.refresh).to.deep.equal([]);
    expect(seeded.create).to.deep.equal([]);
  });

  it('the current day is today until 12h after start, then tomorrow', () => {
    const days = {
      '2026-09-15': { state: 'pending', startAt: ts(cdt('2026-09-15T05:00:00')) },
      '2026-09-14': { state: 'confirmed', startAt: ts(cdt('2026-09-14T05:00:00')) },
    };
    expect(pickCurrentCadenceDay(days, cdt('2026-09-14T16:59:00'))).to.equal('2026-09-14');
    expect(pickCurrentCadenceDay(days, cdt('2026-09-14T17:01:00'))).to.equal('2026-09-15');
    expect(pickCurrentCadenceDay(days, cdt('2026-09-20T09:00:00'))).to.equal('2026-09-15');
    expect(pickCurrentCadenceDay({}, 0)).to.equal(null);
  });

  it('the mirror copies the current day and stamps dailyConfirm + workDate', () => {
    const days = { '2026-09-14': { state: 'confirmed', startAt: ts(cdt('2026-09-14T05:00:00')), startTime: '05:00' } };
    const mirror = buildDailyMirror(days, cdt('2026-09-14T03:00:00'), { profileId: 'cort_gig', sequenceId: undefined });
    expect(mirror).to.include({ state: 'confirmed', dailyConfirm: true, workDate: '2026-09-14', profileId: 'cort_gig', startTime: '05:00' });
    expect(Object.prototype.hasOwnProperty.call(mirror, 'sequenceId')).to.equal(false);
  });

  it('reply routing sees each day separately, windowed by start', () => {
    const assignment = {
      cortConfirmationDays: {
        '2026-09-14': { state: 'confirmed', startAt: ts(cdt('2026-09-14T05:00:00')), startTime: '05:00', lastAskedAt: ts(cdt('2026-09-13T08:00:00')) },
        '2026-09-15': { state: 'pending', startAt: ts(cdt('2026-09-15T05:00:00')), startTime: '05:00' },
        '2026-09-30': { state: 'pending', startAt: ts(cdt('2026-09-30T05:00:00')), startTime: '05:00' },
      },
    };
    const out = expandDailyCadenceDays(assignment, cdt('2026-09-13T00:00:00'), cdt('2026-09-18T00:00:00'));
    expect(out.map((d) => [d.workDate, d.state, d.lastAskedAtMs > 0])).to.deep.equal([
      ['2026-09-14', 'confirmed', true],
      ['2026-09-15', 'pending', false],
    ]);
  });
});

describe('dailyConfirm — dispatch gate, doc ids, top-up', () => {
  const crew = { cortConfirmation: { dailyConfirm: true }, weeklySchedule: WOODRIDGE_WEEK, endDate: '' };

  it('blocks suppressed, withdrawn, ended, and unscheduled days; passes a normal workday', () => {
    expect(dailyConfirmDispatchBlockReason(crew, '2026-09-14', TZ)).to.equal(null);
    expect(dailyConfirmDispatchBlockReason({ ...crew, notificationsSuppressed: true }, '2026-09-14', TZ)).to.equal('notifications_suppressed');
    expect(dailyConfirmDispatchBlockReason({ ...crew, cortConfirmation: { dailyConfirm: false } }, '2026-09-14', TZ)).to.equal('daily_confirm_withdrawn');
    expect(dailyConfirmDispatchBlockReason({ ...crew, endDate: '2026-09-11' }, '2026-09-14', TZ)).to.equal('assignment_ended');
    expect(dailyConfirmDispatchBlockReason(crew, '2026-09-13', TZ)).to.equal('day_not_scheduled');
  });

  it('doc ids round-trip', () => {
    const id = dailyReminderDocId('assignment_reminder_22h_final', '2026-09-14');
    expect(parseDailyReminderDocId(id)).to.deep.equal({ type: 'assignment_reminder_22h_final', workDate: '2026-09-14' });
    expect(parseDailyReminderDocId('assignment_reminder_24h')).to.equal(null);
  });

  it('the top-up fires at the next 01:00 worksite-local', () => {
    expect(nextTopUpMs(cdt('2026-09-11T15:00:00'), TZ)).to.equal(cdt('2026-09-12T01:00:00'));
    expect(nextTopUpMs(cdt('2026-09-12T00:30:00'), TZ)).to.equal(cdt('2026-09-12T01:00:00'));
    expect(nextTopUpMs(cdt('2026-09-12T01:00:00'), TZ) - cdt('2026-09-12T01:00:00')).to.equal(24 * HOUR);
  });
});
