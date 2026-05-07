import { expect } from 'chai';
import { computeWeekBreakdown } from '../../../timesheets/payRules/computeWeekBreakdown';
import {
  getPayRuleSetForState,
  listPayRuleSets,
} from '../../../timesheets/payRules/rules';
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

describe('timesheets/payRules/computeWeekBreakdown — orchestrator', () => {
  describe('state dispatch', () => {
    it('CA → caRules (DT triggers at 12h)', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: 'CA',
        days,
        workWeekStartDate: '2026-05-03',
      });
      const b = r.get('a')!;
      expect(b.totalDoubleTimeHours).to.equal(2); // 14 - 12
    });

    it('NY → defaultRules (no daily OT/DT)', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: 'NY',
        days,
        workWeekStartDate: '2026-05-03',
      });
      const b = r.get('a')!;
      expect(b.totalDoubleTimeHours).to.equal(0);
      expect(b.totalOTHours).to.equal(0); // single 14h day, no weekly OT yet
      expect(b.totalRegularHours).to.equal(14);
    });

    it('TX → defaultRules', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: 'TX',
        days,
        workWeekStartDate: '2026-05-03',
      });
      expect(r.get('a')!.totalDoubleTimeHours).to.equal(0);
    });

    it('MA → defaultRules', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: 'MA',
        days,
        workWeekStartDate: '2026-05-03',
      });
      expect(r.get('a')!.totalDoubleTimeHours).to.equal(0);
    });

    it('unknown state → defaultRules (no throw)', () => {
      const days = [day('a', '2026-05-03', 50)];
      const r = computeWeekBreakdown({
        stateCode: 'ZZ',
        days,
        workWeekStartDate: '2026-05-03',
      });
      const b = r.get('a')!;
      // 50h single day under DEFAULT: 40 reg + 10 ot (cascade in 1 day).
      expect(b.totalRegularHours).to.equal(40);
      expect(b.totalOTHours).to.equal(10);
      expect(b.totalDoubleTimeHours).to.equal(0);
    });

    it('null stateCode → defaultRules', () => {
      const days = [day('a', '2026-05-03', 8)];
      const r = computeWeekBreakdown({
        stateCode: null as any,
        days,
        workWeekStartDate: '2026-05-03',
      });
      expect(r.get('a')!.totalRegularHours).to.equal(8);
    });

    it('lowercase state code → matches via normalization', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: 'ca',
        days,
        workWeekStartDate: '2026-05-03',
      });
      expect(r.get('a')!.totalDoubleTimeHours).to.equal(2);
    });

    it('whitespace state code → trim-tolerant', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: ' CA ',
        days,
        workWeekStartDate: '2026-05-03',
      });
      expect(r.get('a')!.totalDoubleTimeHours).to.equal(2);
    });
  });

  describe('input sorting', () => {
    it('reverses-input is sorted before dispatch (CA 7th-day correctness)', () => {
      // Build 7 consecutive days IN REVERSE ORDER. The orchestrator
      // must sort before passing to CA, otherwise the streak counter
      // would read backwards and 7th-day classification could land
      // on the wrong entry.
      const reversed: DayInput[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = i + 3;
        reversed.push({
          entryId: 'd' + i,
          workDate: `2026-05-0${d}`,
          workedMinutes: 8 * 60,
          breaks: [
            { startTime: '11:00', endTime: '11:30', durationMins: 30, paid: false },
            { startTime: '14:00', endTime: '14:10', durationMins: 10, paid: false },
            { startTime: '15:00', endTime: '15:10', durationMins: 10, paid: false },
          ],
          actualStartTime: '08:00',
          actualEndTime: '17:00',
        });
      }
      const r = computeWeekBreakdown({
        stateCode: 'CA',
        days: reversed,
        workWeekStartDate: '2026-05-03',
      });
      // d6 is the 7th day chronologically (Sat, latest workDate).
      // After sorting it should be classified as the 7th-day → 8h OT.
      const d6 = r.get('d6')!;
      expect(d6.totalRegularHours).to.equal(0);
      expect(d6.totalOTHours).to.equal(8);
    });

    it('does not mutate the caller\'s array', () => {
      const original: DayInput[] = [
        day('b', '2026-05-04', 8),
        day('a', '2026-05-03', 8),
      ];
      const snapshot = original.map((d) => d.entryId);
      computeWeekBreakdown({
        stateCode: 'CA',
        days: original,
        workWeekStartDate: '2026-05-03',
      });
      expect(original.map((d) => d.entryId)).to.deep.equal(snapshot);
    });
  });

  describe('contract guarantees', () => {
    it('returns a result entry for every input day', () => {
      const days = [
        day('a', '2026-05-03', 0),
        day('b', '2026-05-04', 4),
        day('c', '2026-05-05', 0),
      ];
      const r = computeWeekBreakdown({
        stateCode: 'CA',
        days,
        workWeekStartDate: '2026-05-03',
      });
      expect(r.size).to.equal(3);
      expect(r.has('a')).to.equal(true);
      expect(r.has('b')).to.equal(true);
      expect(r.has('c')).to.equal(true);
    });

    it('empty days → empty map', () => {
      const r = computeWeekBreakdown({
        stateCode: 'CA',
        days: [],
        workWeekStartDate: '2026-05-03',
      });
      expect(r.size).to.equal(0);
    });

    it('all values non-negative', () => {
      const days = [day('a', '2026-05-03', 8)];
      const r = computeWeekBreakdown({
        stateCode: 'CA',
        days,
        workWeekStartDate: '2026-05-03',
      });
      const b = r.get('a')!;
      expect(b.totalRegularHours).to.be.at.least(0);
      expect(b.totalOTHours).to.be.at.least(0);
      expect(b.totalDoubleTimeHours).to.be.at.least(0);
      expect(b.mealBreakPenaltyHours).to.be.at.least(0);
      expect(b.restBreakPenaltyHours).to.be.at.least(0);
    });

    it('reg + ot + dt sums to workedMinutes / 60 (within rounding)', () => {
      const days = [day('a', '2026-05-03', 14)];
      const r = computeWeekBreakdown({
        stateCode: 'CA',
        days,
        workWeekStartDate: '2026-05-03',
      });
      const b = r.get('a')!;
      const sum = b.totalRegularHours + b.totalOTHours + b.totalDoubleTimeHours;
      expect(Math.abs(sum - 14)).to.be.lessThan(0.01);
    });
  });

  describe('registry helpers', () => {
    it('getPayRuleSetForState exposes dispatch directly', () => {
      expect(getPayRuleSetForState('CA').stateCode).to.equal('CA');
      expect(getPayRuleSetForState('NY').stateCode).to.equal('NY');
      expect(getPayRuleSetForState('TX').stateCode).to.equal('TX');
      expect(getPayRuleSetForState('MA').stateCode).to.equal('MA');
      expect(getPayRuleSetForState('XX').stateCode).to.equal('DEFAULT');
      expect(getPayRuleSetForState(null).stateCode).to.equal('DEFAULT');
    });

    it('listPayRuleSets returns all registered sets', () => {
      const all = listPayRuleSets();
      const codes = all.map((r) => r.stateCode).sort();
      expect(codes).to.include('CA');
      expect(codes).to.include('NY');
      expect(codes).to.include('TX');
      expect(codes).to.include('MA');
      expect(codes).to.include('DEFAULT');
    });
  });

  describe('cross-state cascade scenario from user spec', () => {
    it('user example: add 5h to Wednesday → Thursday flips reg→OT', () => {
      // 5 days × 8h = 40h. No OT yet.
      const baseline = [
        day('mon', '2026-05-04', 8),
        day('tue', '2026-05-05', 8),
        day('wed', '2026-05-06', 8),
        day('thu', '2026-05-07', 8),
        day('fri', '2026-05-08', 8),
      ];
      const r1 = computeWeekBreakdown({
        stateCode: 'TX', // FLSA-only state to isolate weekly cascade
        days: baseline,
        workWeekStartDate: '2026-05-03',
      });
      let totalOt1 = 0;
      for (const d of baseline) totalOt1 += r1.get(d.entryId)!.totalOTHours;
      expect(totalOt1).to.equal(0);

      // Now add 5h to Wednesday → 13h. Total week = 45h.
      const updated = baseline.map((d) =>
        d.entryId === 'wed' ? { ...d, workedMinutes: 13 * 60 } : d,
      );
      const r2 = computeWeekBreakdown({
        stateCode: 'TX',
        days: updated,
        workWeekStartDate: '2026-05-03',
      });
      let totalOt2 = 0;
      let totalReg2 = 0;
      for (const d of updated) {
        totalOt2 += r2.get(d.entryId)!.totalOTHours;
        totalReg2 += r2.get(d.entryId)!.totalRegularHours;
      }
      expect(totalReg2).to.equal(40);
      expect(totalOt2).to.equal(5);
      // Specifically: Friday's 8h should now be partially OT (since
      // cumulative reg crosses 40 mid-week with the Wed bump).
      const fri = r2.get('fri')!;
      // Mon 8 + Tue 8 + Wed 13 + Thu 8 = 37 reg cumulative. Friday's
      // first 3h = reg, last 5h = OT.
      expect(fri.totalRegularHours).to.equal(3);
      expect(fri.totalOTHours).to.equal(5);
    });
  });
});
