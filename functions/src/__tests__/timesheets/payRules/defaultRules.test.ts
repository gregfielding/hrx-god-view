import { expect } from 'chai';
import { defaultRules } from '../../../timesheets/payRules/rules/default';
import { DayInput } from '../../../timesheets/payRules/types';

function day(entryId: string, workDate: string, hours: number): DayInput {
  return {
    entryId,
    workDate,
    workedMinutes: hours * 60,
    breaks: [],
    actualStartTime: hours > 0 ? '08:00' : null,
    actualEndTime: hours > 0 ? '17:00' : null,
  };
}

describe('timesheets/payRules/rules/default — federal FLSA', () => {
  it('all reg when total ≤ 40h', () => {
    const days = [
      day('a', '2026-05-03', 8),
      day('b', '2026-05-04', 8),
      day('c', '2026-05-05', 8),
      day('d', '2026-05-06', 8),
      day('e', '2026-05-07', 8),
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    let totalReg = 0;
    let totalOt = 0;
    let totalDt = 0;
    for (const d of days) {
      const b = result.get(d.entryId)!;
      totalReg += b.totalRegularHours;
      totalOt += b.totalOTHours;
      totalDt += b.totalDoubleTimeHours;
      expect(b.mealBreakPenaltyHours, 'no meal penalties under DEFAULT').to.equal(0);
      expect(b.restBreakPenaltyHours, 'no rest penalties under DEFAULT').to.equal(0);
      expect(b.totalDoubleTimeHours, 'no DT under DEFAULT').to.equal(0);
    }
    expect(totalReg).to.equal(40);
    expect(totalOt).to.equal(0);
    expect(totalDt).to.equal(0);
  });

  it('flips to OT after 40h (all OT classified as FLSA)', () => {
    // 5 × 10h = 50h total. First 40 reg, next 10 OT.
    // DEFAULT has no daily-OT, so all 10 OT hours are FLSA federal
    // weekly rule, totalNonFlsaOTHours stays 0.
    const days = [
      day('a', '2026-05-03', 10),
      day('b', '2026-05-04', 10),
      day('c', '2026-05-05', 10),
      day('d', '2026-05-06', 10),
      day('e', '2026-05-07', 10),
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    let totalReg = 0;
    let totalOt = 0;
    let totalFlsa = 0;
    let totalNonFlsa = 0;
    for (const d of days) {
      const b = result.get(d.entryId)!;
      totalReg += b.totalRegularHours;
      totalOt += b.totalOTHours;
      totalFlsa += b.totalFlsaOTHours;
      totalNonFlsa += b.totalNonFlsaOTHours;
      // Per-day invariant: split fields sum to totalOTHours.
      expect(b.totalOTHours).to.equal(b.totalFlsaOTHours + b.totalNonFlsaOTHours);
      expect(b.totalNonFlsaOTHours, 'DEFAULT never produces non-FLSA OT').to.equal(0);
    }
    expect(totalReg).to.equal(40);
    expect(totalOt).to.equal(10);
    expect(totalFlsa).to.equal(10);
    expect(totalNonFlsa).to.equal(0);
  });

  it('exact 40h → no OT', () => {
    const days = [
      day('a', '2026-05-03', 8),
      day('b', '2026-05-04', 8),
      day('c', '2026-05-05', 8),
      day('d', '2026-05-06', 8),
      day('e', '2026-05-07', 8),
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    let totalOt = 0;
    for (const d of days) totalOt += result.get(d.entryId)!.totalOTHours;
    expect(totalOt).to.equal(0);
  });

  it('all-zero days produce all-zero breakdowns (with map keys)', () => {
    const days = [
      day('a', '2026-05-03', 0),
      day('b', '2026-05-04', 0),
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    expect(result.size).to.equal(2);
    for (const d of days) {
      expect(result.get(d.entryId)).to.deep.equal({
        totalRegularHours: 0,
        totalOTHours: 0,
        totalFlsaOTHours: 0,
        totalNonFlsaOTHours: 0,
        totalDoubleTimeHours: 0,
        mealBreakPenaltyHours: 0,
        restBreakPenaltyHours: 0,
      });
    }
  });

  it('cascading scenario: 5h × 8 days then 1h on day 9 ', () => {
    // not realistic for a 7-day workweek but tests cascade boundary
    // Sum 41h: 40 reg + 1 ot.
    const days = [
      day('a', '2026-05-03', 5),
      day('b', '2026-05-04', 5),
      day('c', '2026-05-05', 5),
      day('d', '2026-05-06', 5),
      day('e', '2026-05-07', 5),
      day('f', '2026-05-08', 5),
      day('g', '2026-05-09', 5),
      day('h', '2026-05-09', 6), // hypothetical second entry same day
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    let totalReg = 0;
    let totalOt = 0;
    for (const d of days) {
      const b = result.get(d.entryId)!;
      totalReg += b.totalRegularHours;
      totalOt += b.totalOTHours;
    }
    expect(totalReg).to.equal(40);
    expect(totalOt).to.equal(1);
  });

  it('always populates a result for every input day', () => {
    const days = [
      day('a', '2026-05-03', 0),
      day('b', '2026-05-04', 4),
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    expect(result.has('a')).to.equal(true);
    expect(result.has('b')).to.equal(true);
  });

  it('breaks are ignored under DEFAULT (no penalties)', () => {
    const days: DayInput[] = [
      {
        entryId: 'a',
        workDate: '2026-05-03',
        workedMinutes: 10 * 60,
        breaks: [], // no breaks → CA would penalize, DEFAULT does not
        actualStartTime: '08:00',
        actualEndTime: '18:00',
      },
    ];
    const result = defaultRules.computeWeekBreakdown(days, '2026-05-03');
    const b = result.get('a')!;
    expect(b.mealBreakPenaltyHours).to.equal(0);
    expect(b.restBreakPenaltyHours).to.equal(0);
  });
});
