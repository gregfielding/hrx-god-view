/**
 * Career placement weekly schedules (2026-09-11).
 *
 * Bug: a career (ongoing) placement onto a single-date shift — Fieldglass
 * auto-created, `shiftMode: 'single'` + `shiftDate`, no weeklySchedule — got
 * a ONE-weekday `weeklySchedule` synthesized from the shift date, so the
 * timesheet grid showed one row per week (JO #404 / #479). Career docs now
 * get Mon–Fri (+ a weekend start day); gig / per-day docs keep single-DOW.
 */

import { expect } from 'chai';

import {
  buildCareerDefaultWeeklySchedule,
  dowFromIsoDate,
  sanitizeCareerWeeklyScheduleInput,
  shiftHasUsableWeeklySchedule,
} from '../../timesheets/careerWeeklySchedule';
import {
  makeCaches,
  resolveMissingDenormUpdates,
} from '../../timesheets/backfillAssignmentDenormFieldsCallable';

const fakeFdb = {} as unknown as Parameters<typeof resolveMissingDenormUpdates>[0]['fdb'];
const JO = 'jo1';
const SHIFT = 'shift1';

/** Fieldglass-style single-date shift: Friday 2026-08-28, 09:00–17:00. */
const SINGLE_DATE_SHIFT = {
  shiftMode: 'single',
  shiftDate: '2026-08-28',
  defaultStartTime: '09:00',
  defaultEndTime: '17:00',
  autoCreatedOpenShift: true,
  createdBy: 'system_fieldglass_auto',
};

/** Every other trigger-managed field pre-set so only weeklySchedule resolves. */
const OTHER_FIELDS_SET = {
  hiringEntityId: 'entity1',
  worksiteState: 'TX',
  worksiteDisplayName: 'Site',
  workerDisplayName: 'Worker',
  shiftBreakDefaultMinutes: 30,
  accountId: 'acct1',
  workersCompCode: '8810',
  worksiteAddress: { street: '1 Main St' },
};

const MON_FRI_9_5 = {
  '1': { enabled: true, startTime: '09:00', endTime: '17:00' },
  '2': { enabled: true, startTime: '09:00', endTime: '17:00' },
  '3': { enabled: true, startTime: '09:00', endTime: '17:00' },
  '4': { enabled: true, startTime: '09:00', endTime: '17:00' },
  '5': { enabled: true, startTime: '09:00', endTime: '17:00' },
};

async function resolveSchedule(
  assignment: Record<string, unknown>,
  opts: { shift?: Record<string, unknown>; jo?: Record<string, unknown> } = {},
) {
  const caches = makeCaches();
  caches.shift.set(`${JO}:${SHIFT}`, Promise.resolve(opts.shift ?? SINGLE_DATE_SHIFT));
  caches.jo.set(JO, Promise.resolve(opts.jo ?? {}));
  return resolveMissingDenormUpdates({
    fdb: fakeFdb,
    tenantId: 't1',
    assignmentId: 'a1',
    assignmentData: { jobOrderId: JO, shiftId: SHIFT, ...OTHER_FIELDS_SET, ...assignment },
    caches,
  });
}

describe('careerWeeklySchedule helpers', () => {
  it('dowFromIsoDate is timezone-independent', () => {
    expect(dowFromIsoDate('2026-08-28')).to.equal(5);
    expect(dowFromIsoDate('2026-08-30')).to.equal(0);
    expect(dowFromIsoDate('not-a-date')).to.equal(null);
  });

  it('defaults to Mon–Fri at the given times for a weekday start', () => {
    expect(buildCareerDefaultWeeklySchedule('2026-08-28', '09:00', '17:00')).to.deep.equal(MON_FRI_9_5);
  });

  it('adds a weekend start day so the start date keeps its row', () => {
    const ws = buildCareerDefaultWeeklySchedule('2026-08-29', '07:00', '15:30');
    expect(Object.keys(ws ?? {})).to.deep.equal(['1', '2', '3', '4', '5', '6']);
    expect(ws?.['6']).to.deep.equal({ enabled: true, startTime: '07:00', endTime: '15:30' });
  });

  it('returns null without real HH:mm times', () => {
    expect(buildCareerDefaultWeeklySchedule('2026-08-28', '', '')).to.equal(null);
    expect(buildCareerDefaultWeeklySchedule('2026-08-28', '9:00', '17:00')).to.equal(null);
  });

  it('sanitizes recruiter input — keeps only enabled, well-formed days', () => {
    expect(
      sanitizeCareerWeeklyScheduleInput({
        '1': { enabled: true, startTime: '08:00', endTime: '16:00' },
        '2': { enabled: true, startTime: '8am', endTime: '16:00' },
        '3': { enabled: false, startTime: '08:00', endTime: '16:00' },
        '9': { enabled: true, startTime: '08:00', endTime: '16:00' },
      }),
    ).to.deep.equal({ '1': { enabled: true, startTime: '08:00', endTime: '16:00' } });
    expect(sanitizeCareerWeeklyScheduleInput({ '3': { enabled: false } })).to.equal(null);
    expect(sanitizeCareerWeeklyScheduleInput([])).to.equal(null);
    expect(sanitizeCareerWeeklyScheduleInput('Mon-Fri')).to.equal(null);
    expect(sanitizeCareerWeeklyScheduleInput(null)).to.equal(null);
  });

  it('detects whether a shift carries its own recurring schedule', () => {
    expect(shiftHasUsableWeeklySchedule(SINGLE_DATE_SHIFT)).to.equal(false);
    expect(shiftHasUsableWeeklySchedule({ weeklySchedule: { '1': { enabled: false, startTime: '09:00', endTime: '17:00' } } })).to.equal(false);
    expect(shiftHasUsableWeeklySchedule({ weeklySchedule: { '1': { enabled: true, startTime: '09:00', endTime: '17:00' } } })).to.equal(true);
  });
});

describe('resolveMissingDenormUpdates — weeklySchedule for career placements', () => {
  it('stamps Mon–Fri on an ongoing career assignment on a single-date shift', async () => {
    const r = await resolveSchedule({ jobOrderType: 'career', startDate: '2026-08-28', endDate: '' });
    expect(r.outcomes.weeklySchedule).to.equal('stamped');
    expect(r.updates.weeklySchedule).to.deep.equal(MON_FRI_9_5);
  });

  it('falls back to the JO jobType when the assignment lacks jobOrderType', async () => {
    const r = await resolveSchedule({ startDate: '2026-08-28', endDate: '' }, { jo: { jobType: 'career' } });
    expect(r.updates.weeklySchedule).to.deep.equal(MON_FRI_9_5);
  });

  it('copies a shift weeklySchedule verbatim for career (no default override)', async () => {
    const shiftWs = {
      '1': { enabled: true, startTime: '06:00', endTime: '14:00' },
      '3': { enabled: true, startTime: '06:00', endTime: '14:00' },
    };
    const r = await resolveSchedule(
      { jobOrderType: 'career', startDate: '2026-08-31', endDate: '' },
      { shift: { ...SINGLE_DATE_SHIFT, shiftMode: 'multi', weeklySchedule: shiftWs } },
    );
    expect(r.updates.weeklySchedule).to.deep.equal(shiftWs);
  });

  it('keeps the single-weekday schedule for a one-day gig assignment', async () => {
    const r = await resolveSchedule({ jobOrderType: 'gig', startDate: '2026-08-28', endDate: '2026-08-28' });
    expect(r.updates.weeklySchedule).to.deep.equal({ '5': { enabled: true, startTime: '09:00', endTime: '17:00' } });
  });

  it('keeps the legacy single-weekday schedule for a non-career ongoing assignment', async () => {
    const r = await resolveSchedule({ jobOrderType: 'gig', startDate: '2026-08-28', endDate: '' });
    expect(r.updates.weeklySchedule).to.deep.equal({ '5': { enabled: true, startTime: '09:00', endTime: '17:00' } });
  });

  it('keeps single-weekday for a per-day career doc (startDate === endDate)', async () => {
    const r = await resolveSchedule({ jobOrderType: 'career', startDate: '2026-08-28', endDate: '2026-08-28' });
    expect(r.updates.weeklySchedule).to.deep.equal({ '5': { enabled: true, startTime: '09:00', endTime: '17:00' } });
  });

  it('never overwrites a schedule that is already set (hand-fixed or prompt-picked)', async () => {
    const r = await resolveSchedule({
      jobOrderType: 'career',
      startDate: '2026-08-28',
      endDate: '',
      weeklySchedule: { '5': { enabled: true, startTime: '09:00', endTime: '17:00' } },
    });
    expect(r.outcomes.weeklySchedule).to.equal('already_set');
    expect(r.updates).to.not.have.property('weeklySchedule');
  });
});
