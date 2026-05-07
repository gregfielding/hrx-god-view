import { expect } from 'chai';
import {
  applyWeeklyOTCascade,
  dateToLocalYyyyMmDd,
  hhmmToMinutes,
  minutesBetween,
  minutesToHours,
  parseYyyyMmDdLocal,
  splitDailyHoursWithThresholds,
  sumUnpaidBreakMinutes,
  workedMinutesFromActuals,
  workWeekRangeFor,
  workWeekStartFor,
} from '../../../timesheets/payRules/helpers';

describe('timesheets/payRules/helpers', () => {
  describe('hhmmToMinutes', () => {
    it('parses standard HH:mm', () => {
      expect(hhmmToMinutes('07:00')).to.equal(7 * 60);
      expect(hhmmToMinutes('00:00')).to.equal(0);
      expect(hhmmToMinutes('23:59')).to.equal(23 * 60 + 59);
    });

    it('accepts unpadded hours', () => {
      expect(hhmmToMinutes('7:00')).to.equal(7 * 60);
      expect(hhmmToMinutes('9:30')).to.equal(9 * 60 + 30);
    });

    it('trims whitespace', () => {
      expect(hhmmToMinutes(' 07:00 ')).to.equal(7 * 60);
    });

    it('returns null on malformed input', () => {
      expect(hhmmToMinutes('25:00')).to.equal(null);
      expect(hhmmToMinutes('07:60')).to.equal(null);
      expect(hhmmToMinutes('7:0')).to.equal(null);
      expect(hhmmToMinutes('not-a-time')).to.equal(null);
      expect(hhmmToMinutes('')).to.equal(null);
      expect(hhmmToMinutes(null as any)).to.equal(null);
      expect(hhmmToMinutes(undefined as any)).to.equal(null);
    });
  });

  describe('minutesBetween', () => {
    it('computes a normal day shift', () => {
      expect(minutesBetween('07:00', '15:30')).to.equal(8 * 60 + 30);
    });

    it('handles overnight by adding 24h', () => {
      expect(minutesBetween('22:00', '06:00')).to.equal(8 * 60);
      expect(minutesBetween('23:30', '00:30')).to.equal(60);
    });

    it('treats end == start as 24h (round-trip)', () => {
      // matches resolver convention: when end <= start, add 24h.
      expect(minutesBetween('09:00', '09:00')).to.equal(24 * 60);
    });

    it('returns null on bad input', () => {
      expect(minutesBetween('bad', '15:30')).to.equal(null);
      expect(minutesBetween('07:00', null)).to.equal(null);
    });
  });

  describe('sumUnpaidBreakMinutes', () => {
    it('sums only unpaid breaks', () => {
      const breaks = [
        { durationMins: 30, paid: false },
        { durationMins: 10, paid: true },
        { durationMins: 15, paid: false },
      ];
      expect(sumUnpaidBreakMinutes(breaks)).to.equal(45);
    });

    it('skips invalid durations', () => {
      const breaks = [
        { durationMins: 30, paid: false },
        { durationMins: -5, paid: false },
        { durationMins: NaN, paid: false },
      ];
      expect(sumUnpaidBreakMinutes(breaks)).to.equal(30);
    });

    it('returns 0 for empty / undefined', () => {
      expect(sumUnpaidBreakMinutes([])).to.equal(0);
      expect(sumUnpaidBreakMinutes(undefined)).to.equal(0);
    });
  });

  describe('workedMinutesFromActuals', () => {
    it('computes elapsed minus unpaid breaks', () => {
      const breaks = [{ durationMins: 30, paid: false }];
      expect(workedMinutesFromActuals('07:00', '15:30', breaks)).to.equal(8 * 60);
    });

    it('handles overnight + breaks', () => {
      const breaks = [{ durationMins: 60, paid: false }];
      // 22:00 → 06:00 = 480 min, minus 60 unpaid = 420
      expect(workedMinutesFromActuals('22:00', '06:00', breaks)).to.equal(420);
    });

    it('returns 0 for missing actuals', () => {
      expect(workedMinutesFromActuals(null, '15:30', [])).to.equal(0);
      expect(workedMinutesFromActuals('07:00', null, [])).to.equal(0);
      expect(workedMinutesFromActuals(undefined, undefined, [])).to.equal(0);
    });

    it('floors at 0 when breaks exceed shift', () => {
      const breaks = [{ durationMins: 600, paid: false }]; // 10h break
      expect(workedMinutesFromActuals('07:00', '15:00', breaks)).to.equal(0);
    });

    it('does not subtract paid breaks', () => {
      const breaks = [{ durationMins: 30, paid: true }];
      expect(workedMinutesFromActuals('07:00', '15:30', breaks)).to.equal(8 * 60 + 30);
    });
  });

  describe('parseYyyyMmDdLocal / dateToLocalYyyyMmDd round-trip', () => {
    it('parses and reformats consistently', () => {
      const d = parseYyyyMmDdLocal('2026-05-06');
      expect(d).to.not.equal(null);
      expect(dateToLocalYyyyMmDd(d!)).to.equal('2026-05-06');
    });

    it('returns null on malformed input', () => {
      expect(parseYyyyMmDdLocal('2026-5-6')).to.equal(null);
      expect(parseYyyyMmDdLocal('not-a-date')).to.equal(null);
      expect(parseYyyyMmDdLocal('')).to.equal(null);
      expect(parseYyyyMmDdLocal(null)).to.equal(null);
    });
  });

  describe('workWeekStartFor', () => {
    it('Sun-start workweek: Wed maps to prior Sun', () => {
      // 2026-05-06 is a Wed.
      expect(workWeekStartFor('2026-05-06', 0)).to.equal('2026-05-03');
    });

    it('Sun-start: Sun maps to itself', () => {
      expect(workWeekStartFor('2026-05-03', 0)).to.equal('2026-05-03');
    });

    it('Sun-start: Sat maps back to that Sun', () => {
      expect(workWeekStartFor('2026-05-09', 0)).to.equal('2026-05-03');
    });

    it('Mon-start workweek: Sun maps back to prior Mon', () => {
      expect(workWeekStartFor('2026-05-03', 1)).to.equal('2026-04-27');
    });

    it('Mon-start: Mon maps to itself', () => {
      expect(workWeekStartFor('2026-05-04', 1)).to.equal('2026-05-04');
    });

    it('crosses month boundary', () => {
      // 2026-05-02 is a Sat. Sun-start workweek is 2026-04-26 (Sun).
      expect(workWeekStartFor('2026-05-02', 0)).to.equal('2026-04-26');
    });

    it('normalizes negative or out-of-range DOW', () => {
      expect(workWeekStartFor('2026-05-06', -7)).to.equal('2026-05-03');
      expect(workWeekStartFor('2026-05-06', 7)).to.equal('2026-05-03');
    });

    it('returns null on bad input', () => {
      expect(workWeekStartFor('not-a-date', 0)).to.equal(null);
    });
  });

  describe('workWeekRangeFor', () => {
    it('returns 7-day inclusive range', () => {
      expect(workWeekRangeFor('2026-05-06', 0)).to.deep.equal({
        start: '2026-05-03',
        end: '2026-05-09',
      });
    });

    it('crosses month boundary', () => {
      expect(workWeekRangeFor('2026-05-02', 0)).to.deep.equal({
        start: '2026-04-26',
        end: '2026-05-02',
      });
    });
  });

  describe('splitDailyHoursWithThresholds', () => {
    it('all regular when under regCap', () => {
      expect(splitDailyHoursWithThresholds(6 * 60, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 360,
        ot: 0,
        dt: 0,
      });
    });

    it('reg + ot when between caps', () => {
      // 10h: 8 reg + 2 ot
      expect(splitDailyHoursWithThresholds(10 * 60, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 480,
        ot: 120,
        dt: 0,
      });
    });

    it('reg + ot + dt past second cap', () => {
      // 14h: 8 reg + 4 ot + 2 dt
      expect(splitDailyHoursWithThresholds(14 * 60, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 480,
        ot: 240,
        dt: 120,
      });
    });

    it('exactly at regCap', () => {
      expect(splitDailyHoursWithThresholds(8 * 60, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 480,
        ot: 0,
        dt: 0,
      });
    });

    it('exactly at otCap', () => {
      expect(splitDailyHoursWithThresholds(12 * 60, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 480,
        ot: 240,
        dt: 0,
      });
    });

    it('Infinity caps → all reg (DEFAULT semantics)', () => {
      expect(splitDailyHoursWithThresholds(20 * 60, Infinity, Infinity)).to.deep.equal({
        reg: 1200,
        ot: 0,
        dt: 0,
      });
    });

    it('zero or negative input → all zeros', () => {
      expect(splitDailyHoursWithThresholds(0, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 0,
        ot: 0,
        dt: 0,
      });
      expect(splitDailyHoursWithThresholds(-100, 8 * 60, 12 * 60)).to.deep.equal({
        reg: 0,
        ot: 0,
        dt: 0,
      });
    });

    it('throws on inverted thresholds', () => {
      expect(() => splitDailyHoursWithThresholds(60, 12 * 60, 8 * 60)).to.throw(
        /regCap.*cannot exceed otCap/,
      );
    });
  });

  describe('applyWeeklyOTCascade', () => {
    it('no-op when below threshold', () => {
      const days = [
        { reg: 8 * 60, ot: 0, dt: 0 },
        { reg: 8 * 60, ot: 0, dt: 0 },
      ];
      expect(applyWeeklyOTCascade(days, 40 * 60)).to.deep.equal([
        { reg: 480, ot: 0, dt: 0 },
        { reg: 480, ot: 0, dt: 0 },
      ]);
    });

    it('flips reg → ot once cumulative reg crosses threshold', () => {
      // 5 days × 10h reg = 50h reg pre-cascade.
      // Cascade: first 40h reg, last 10h all ot.
      const days = Array.from({ length: 5 }, () => ({ reg: 10 * 60, ot: 0, dt: 0 }));
      const result = applyWeeklyOTCascade(days, 40 * 60);
      const totalReg = result.reduce((s, d) => s + d.reg, 0);
      const totalOt = result.reduce((s, d) => s + d.ot, 0);
      expect(totalReg).to.equal(40 * 60);
      expect(totalOt).to.equal(10 * 60);
      // The 5th day should be entirely ot.
      expect(result[4]).to.deep.equal({ reg: 0, ot: 10 * 60, dt: 0 });
      // The 4th day should be partially flipped.
      expect(result[3].reg + result[3].ot).to.equal(10 * 60);
    });

    it('preserves daily ot/dt across cascade', () => {
      // CA-style: each day is 10h with 8 reg + 2 ot pre-cascade.
      // 5 days × 8h reg = 40h reg → cascade just barely doesn't fire.
      const days = Array.from({ length: 5 }, () => ({
        reg: 8 * 60,
        ot: 2 * 60,
        dt: 0,
      }));
      const result = applyWeeklyOTCascade(days, 40 * 60);
      const totalReg = result.reduce((s, d) => s + d.reg, 0);
      const totalOt = result.reduce((s, d) => s + d.ot, 0);
      expect(totalReg).to.equal(40 * 60);
      expect(totalOt).to.equal(10 * 60); // 5 × 2 daily ot, no cascade flip
    });

    it('cascade activates with daily-classified inputs', () => {
      // 6 days × 8h reg = 48h. Cascade flips last 8h to OT.
      const days = Array.from({ length: 6 }, () => ({ reg: 8 * 60, ot: 0, dt: 0 }));
      const result = applyWeeklyOTCascade(days, 40 * 60);
      // Day 5 (0-indexed) is the 6th day, all 8h becomes OT.
      expect(result[5]).to.deep.equal({ reg: 0, ot: 8 * 60, dt: 0 });
      // Days 0-4 are unchanged.
      for (let i = 0; i < 5; i++) {
        expect(result[i]).to.deep.equal({ reg: 8 * 60, ot: 0, dt: 0 });
      }
    });

    it('Infinity threshold → no-op clones', () => {
      const days = [{ reg: 100 * 60, ot: 0, dt: 0 }];
      const result = applyWeeklyOTCascade(days, Infinity);
      expect(result).to.deep.equal(days);
      // ensures it's a clone, not the same reference
      expect(result[0]).to.not.equal(days[0]);
    });

    it('throws on negative threshold', () => {
      expect(() => applyWeeklyOTCascade([], -1)).to.throw(
        /weeklyOTThresholdMinutes/,
      );
    });

    it('handles empty input', () => {
      expect(applyWeeklyOTCascade([], 40 * 60)).to.deep.equal([]);
    });
  });

  describe('minutesToHours', () => {
    it('rounds to two decimals', () => {
      expect(minutesToHours(60)).to.equal(1);
      expect(minutesToHours(90)).to.equal(1.5);
      expect(minutesToHours(15)).to.equal(0.25);
      expect(minutesToHours(20)).to.equal(0.33);
      expect(minutesToHours(0)).to.equal(0);
    });

    it('handles negative and non-finite inputs', () => {
      expect(minutesToHours(-60)).to.equal(-1);
      expect(minutesToHours(NaN)).to.equal(0);
      expect(minutesToHours(Infinity)).to.equal(0);
    });
  });
});
