/**
 * shift.liveFill — worker-facing spots remaining (2026-09-06). Pure.
 */
import { expect } from 'chai';
import { computeAssignmentsTarget, computeLiveFill, liveFillChanged } from '../../shifts/shiftLiveFill';

describe('shiftLiveFill', () => {
  const singleDay = { shiftDate: '2026-09-12', totalStaffRequested: 3 };
  const multiDay = {
    shiftDate: '2026-09-12',
    endDate: '2026-09-14',
    totalStaffRequested: 5,
    dateSchedule: {
      '2026-09-12': { startTime: '09:00', endTime: '17:00', workersNeeded: 2 },
      '2026-09-13': { startTime: '10:00', endTime: '16:00', workersNeeded: 4, overstaff: 1 },
      '2026-09-14': { startTime: '', endTime: '' },
    },
  };

  it('single-day: every live assignment counts, legacy no-date docs land on the shift date', () => {
    const fill = computeLiveFill(singleDay, [
      { startDate: '2026-09-12', status: 'pending' },
      { status: 'confirmed' },
    ]);
    expect(fill).to.deep.equal({
      total: 2,
      byDay: { '2026-09-12': 2 },
      target: 3,
      targetByDay: {},
      remaining: 1,
      remainingByDay: {},
    });
  });

  it('multi-day: per-day counts, per-day targets (workersNeeded + overstaff, else shift target), best-day remaining', () => {
    const fill = computeLiveFill(multiDay, [
      { startDate: '2026-09-12' },
      { startDate: '2026-09-12' },
      { startDate: '2026-09-13T00:00:00' },
    ]);
    expect(fill.total).to.equal(3);
    expect(fill.byDay).to.deep.equal({ '2026-09-12': 2, '2026-09-13': 1 });
    expect(fill.targetByDay).to.deep.equal({ '2026-09-12': 2, '2026-09-13': 5 });
    expect(fill.remainingByDay).to.deep.equal({ '2026-09-12': 0, '2026-09-13': 4 });
    // Any free day → the shift row is not full.
    expect(fill.remaining).to.equal(4);
  });

  it('recurring shift without dateSchedule: only the shift date counts, other occurrences never fill it', () => {
    const weekly = { shiftDate: '2026-08-11', totalStaffRequested: 2, weeklySchedule: { '2': { enabled: true } } };
    const fill = computeLiveFill(weekly, [{ startDate: '2026-08-18' }, { startDate: '2026-08-25' }]);
    expect(fill.total).to.equal(2);
    expect(fill.remaining).to.equal(2);
    const onDate = computeLiveFill(weekly, [{ startDate: '2026-08-11' }, { startDate: '2026-08-11' }]);
    expect(onDate.remaining).to.equal(0);
  });

  it('target mirrors the fill automation math and never drops below zero remaining', () => {
    expect(computeAssignmentsTarget({ totalStaffRequested: 4, overstaffPercent: 25 })).to.equal(5);
    const fill = computeLiveFill({ shiftDate: '2026-09-12', totalStaffRequested: 1 }, [
      { startDate: '2026-09-12' },
      { startDate: '2026-09-12' },
    ]);
    expect(fill.remaining).to.equal(0);
  });

  it('liveFillChanged skips no-op writes', () => {
    const fill = computeLiveFill(multiDay, [{ startDate: '2026-09-12' }]);
    expect(liveFillChanged(undefined, fill)).to.equal(true);
    expect(liveFillChanged({ ...fill, updatedAt: 'ts' }, fill)).to.equal(false);
    expect(liveFillChanged({ ...fill, total: 2 }, fill)).to.equal(true);
    expect(liveFillChanged({ ...fill, remainingByDay: { '2026-09-13': 1 } }, fill)).to.equal(true);
  });
});
