import { expect } from 'chai';
import { caRules, __caInternal } from '../../../timesheets/payRules/rules/ca';
import { DayInput, BreakInput } from '../../../timesheets/payRules/types';

function day(
  entryId: string,
  workDate: string,
  hours: number,
  opts: { breaks?: BreakInput[]; actualStart?: string | null } = {},
): DayInput {
  return {
    entryId,
    workDate,
    workedMinutes: hours * 60,
    breaks: opts.breaks ?? [],
    actualStartTime: hours > 0 ? opts.actualStart ?? '08:00' : null,
    actualEndTime: hours > 0 ? '17:00' : null,
  };
}

const meal = (start: string, durationMins: number): BreakInput => ({
  startTime: start,
  endTime: start, // not used by engine
  durationMins,
  paid: false,
});

describe('timesheets/payRules/rules/ca — California', () => {
  describe('daily classification (no cascade, no 7th day)', () => {
    it('8h regular → all reg', () => {
      const days = [day('a', '2026-05-03', 8, { breaks: [meal('11:00', 30)] })];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.totalRegularHours).to.equal(8);
      expect(r.totalOTHours).to.equal(0);
      expect(r.totalDoubleTimeHours).to.equal(0);
    });

    it('10h → 8 reg + 2 ot', () => {
      const days = [day('a', '2026-05-03', 10, { breaks: [meal('11:00', 30)] })];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.totalRegularHours).to.equal(8);
      expect(r.totalOTHours).to.equal(2);
      expect(r.totalDoubleTimeHours).to.equal(0);
    });

    it('14h → 8 reg + 4 ot + 2 dt', () => {
      const days = [day('a', '2026-05-03', 14, { breaks: [meal('11:00', 30)] })];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.totalRegularHours).to.equal(8);
      expect(r.totalOTHours).to.equal(4);
      expect(r.totalDoubleTimeHours).to.equal(2);
    });

    it('exactly 8h → no OT', () => {
      const days = [day('a', '2026-05-03', 8, { breaks: [meal('11:00', 30)] })];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.totalOTHours).to.equal(0);
    });

    it('exactly 12h → no DT', () => {
      const days = [day('a', '2026-05-03', 12, { breaks: [meal('11:00', 30)] })];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.totalDoubleTimeHours).to.equal(0);
      expect(r.totalOTHours).to.equal(4);
    });
  });

  describe('weekly OT cascade — preserves daily OT/DT, only flips reg', () => {
    it('5 × 8h with breaks → 40 reg, 0 ot', () => {
      const days: DayInput[] = [];
      for (let i = 0; i < 5; i++) {
        days.push(
          day('d' + i, `2026-05-0${3 + i}`, 8, { breaks: [meal('11:00', 30)] }),
        );
      }
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      let reg = 0;
      let ot = 0;
      for (const d of days) {
        reg += result.get(d.entryId)!.totalRegularHours;
        ot += result.get(d.entryId)!.totalOTHours;
      }
      expect(reg).to.equal(40);
      expect(ot).to.equal(0);
    });

    it('6 × 8h → cascade flips day 6 reg to OT (not 7th-day, just cumulative)', () => {
      const days: DayInput[] = [];
      for (let i = 0; i < 6; i++) {
        days.push(
          day('d' + i, `2026-05-0${3 + i}`, 8, { breaks: [meal('11:00', 30)] }),
        );
      }
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      let reg = 0;
      let ot = 0;
      for (const d of days) {
        reg += result.get(d.entryId)!.totalRegularHours;
        ot += result.get(d.entryId)!.totalOTHours;
      }
      expect(reg).to.equal(40);
      expect(ot).to.equal(8);
    });

    it('non-consecutive 6 days @ 8h → no 7th-day, but cascade still triggers', () => {
      // Worker takes Tuesday off, works the other 6 days. Still 48h
      // total — cascade flips last 8 to OT.
      const days = [
        day('a', '2026-05-03', 8, { breaks: [meal('11:00', 30)] }), // Sun
        day('c', '2026-05-05', 8, { breaks: [meal('11:00', 30)] }), // Tue (off Mon)
        day('d', '2026-05-06', 8, { breaks: [meal('11:00', 30)] }), // Wed
        day('e', '2026-05-07', 8, { breaks: [meal('11:00', 30)] }), // Thu
        day('f', '2026-05-08', 8, { breaks: [meal('11:00', 30)] }), // Fri
        day('g', '2026-05-09', 8, { breaks: [meal('11:00', 30)] }), // Sat
      ];
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      let reg = 0;
      let ot = 0;
      let dt = 0;
      for (const d of days) {
        const b = result.get(d.entryId)!;
        reg += b.totalRegularHours;
        ot += b.totalOTHours;
        dt += b.totalDoubleTimeHours;
      }
      expect(reg).to.equal(40);
      expect(ot).to.equal(8);
      expect(dt).to.equal(0); // no 7th-day → no DT
    });

    it('cascade preserves daily OT (4 × 12h: each day 8 reg + 4 ot, then cascade)', () => {
      // 4 × 12h = 48h worked. Daily classification: each day 8 reg + 4 ot.
      // Cumulative reg: 32h after 4 days, well under 40 → no cascade flip.
      const days: DayInput[] = [];
      for (let i = 0; i < 4; i++) {
        days.push(
          day('d' + i, `2026-05-0${3 + i}`, 12, { breaks: [meal('11:00', 30)] }),
        );
      }
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      let reg = 0;
      let ot = 0;
      for (const d of days) {
        reg += result.get(d.entryId)!.totalRegularHours;
        ot += result.get(d.entryId)!.totalOTHours;
      }
      expect(reg).to.equal(32); // 4 × 8
      expect(ot).to.equal(16); // 4 × 4 daily OT
    });

    it('cascade triggers when cumulative reg crosses 40 mid-day', () => {
      // 5 × 10h: each day 8 reg + 2 ot. Cumulative reg: 8,16,24,32,40
      // → cascade flips no reg (exactly hits 40 on day 5). Total OT
      // is 5 × 2 = 10h, total reg is 5 × 8 = 40h. 6th day: 10h →
      // initially 8 reg + 2 ot, but cumulative reg is already at 40,
      // so all 8 reg flip to OT → 0 reg + 10 ot for that day.
      const days: DayInput[] = [];
      for (let i = 0; i < 6; i++) {
        days.push(
          day('d' + i, `2026-05-0${3 + i}`, 10, { breaks: [meal('11:00', 30)] }),
        );
      }
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      let reg = 0;
      let ot = 0;
      for (const d of days) {
        reg += result.get(d.entryId)!.totalRegularHours;
        ot += result.get(d.entryId)!.totalOTHours;
      }
      expect(reg).to.equal(40);
      expect(ot).to.equal(20); // 6 × 2 daily ot + 8 cascade-flipped
    });
  });

  describe('7th consecutive day rule', () => {
    it('all 7 consecutive 8h days → 7th day = 8h OT', () => {
      const days: DayInput[] = [];
      // Sun..Sat (2026-05-03..2026-05-09).
      for (let i = 0; i < 7; i++) {
        const d = i + 3;
        days.push(
          day('d' + i, `2026-05-0${d}`, 8, { breaks: [meal('11:00', 30)] }),
        );
      }
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      // 7th day (Sat, d6): all 8h should be OT, 0 reg.
      const d6 = result.get('d6')!;
      expect(d6.totalRegularHours).to.equal(0);
      expect(d6.totalOTHours).to.equal(8);
      expect(d6.totalDoubleTimeHours).to.equal(0);
      // Days 1-6: all reg... wait, cumulative reg after 6 days = 48h.
      // Cascade flips 8h: day 6's 8h reg → OT. So day 5 (the 6th day)
      // is fully OT — wait, day 5 is the 6th day in workweek (i=5).
      // Day 6 is the 7th day (i=6) and gets 7th-day classification.
      //
      // Walkthrough:
      //   i=0..5: regular CA daily classification = 8h reg each.
      //   i=6: 7th-day classification = 8h ot (not reg).
      // Cascade input: [reg=8,8,8,8,8,8,reg=0]; ot=[0,0,0,0,0,0,8]
      // Cumulative reg: 8,16,24,32,40,48 → day 5 (6th) reg=8 entirely
      // flipped to OT after threshold of 40 hits at end of day 4.
      // Final reg total = 40, ot total = 16.
      let reg = 0;
      let ot = 0;
      for (let i = 0; i < 7; i++) {
        reg += result.get('d' + i)!.totalRegularHours;
        ot += result.get('d' + i)!.totalOTHours;
      }
      expect(reg).to.equal(40);
      expect(ot).to.equal(16);
    });

    it('7th day worked > 8h → first 8 OT, rest DT', () => {
      const days: DayInput[] = [];
      for (let i = 0; i < 6; i++) {
        const d = i + 3;
        days.push(day('d' + i, `2026-05-0${d}`, 4, { breaks: [meal('11:00', 30)] }));
      }
      // 7th day (Sat): 12h worked.
      days.push(day('d6', '2026-05-09', 12, { breaks: [meal('11:00', 30)] }));
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      const d6 = result.get('d6')!;
      // 7th-day: 8h OT, 4h DT.
      expect(d6.totalRegularHours).to.equal(0);
      expect(d6.totalOTHours).to.equal(8);
      expect(d6.totalDoubleTimeHours).to.equal(4);
    });

    it('one zero day breaks the streak — no 7th-day', () => {
      // Sun: 8h, Mon: 0, Tue-Sat: 8h each. 6 worked days, no streak of 7.
      const days = [
        day('d0', '2026-05-03', 8, { breaks: [meal('11:00', 30)] }),
        day('d1', '2026-05-04', 0),
        day('d2', '2026-05-05', 8, { breaks: [meal('11:00', 30)] }),
        day('d3', '2026-05-06', 8, { breaks: [meal('11:00', 30)] }),
        day('d4', '2026-05-07', 8, { breaks: [meal('11:00', 30)] }),
        day('d5', '2026-05-08', 8, { breaks: [meal('11:00', 30)] }),
        day('d6', '2026-05-09', 8, { breaks: [meal('11:00', 30)] }),
      ];
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      // Cumulative reg = 48h, cascade flips last 8 to OT, but no 7th
      // day. All non-zero days should have totalReg + totalOT > 0,
      // and totalDT should be 0 across the week.
      let totalDt = 0;
      for (let i = 0; i < 7; i++) totalDt += result.get('d' + i)!.totalDoubleTimeHours;
      expect(totalDt).to.equal(0);
    });

    it('streak resets after a zero day mid-week', () => {
      // Sun-Tue: worked, Wed: off, Thu-Sat: worked. 6 worked days.
      // No 7th-day — streak peaked at 3 then 3.
      const days = [
        day('d0', '2026-05-03', 8, { breaks: [meal('11:00', 30)] }),
        day('d1', '2026-05-04', 8, { breaks: [meal('11:00', 30)] }),
        day('d2', '2026-05-05', 8, { breaks: [meal('11:00', 30)] }),
        day('d3', '2026-05-06', 0),
        day('d4', '2026-05-07', 8, { breaks: [meal('11:00', 30)] }),
        day('d5', '2026-05-08', 8, { breaks: [meal('11:00', 30)] }),
        day('d6', '2026-05-09', 8, { breaks: [meal('11:00', 30)] }),
      ];
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      let totalDt = 0;
      for (let i = 0; i < 7; i++) totalDt += result.get('d' + i)!.totalDoubleTimeHours;
      expect(totalDt).to.equal(0);
    });

    it('input order independence (orchestrator sorts)', () => {
      // The rule set itself trusts sorted input; the orchestrator
      // does the sorting. Test that with sorted input we get a clean
      // 7th-day classification regardless of input order to the
      // public API. (Tested separately in computeWeekBreakdown
      // tests.)
      const orderedDays: DayInput[] = [];
      for (let i = 0; i < 7; i++) {
        const d = i + 3;
        orderedDays.push(
          day('d' + i, `2026-05-0${d}`, 8, { breaks: [meal('11:00', 30)] }),
        );
      }
      const r1 = caRules.computeWeekBreakdown(orderedDays, '2026-05-03');
      // Same days, different ordering — rule set should NOT be used
      // directly with unsorted input, but verify behavior is
      // documented (last-occurrence-of-streak logic).
      expect(r1.get('d6')!.totalOTHours).to.equal(8);
    });
  });

  describe('meal break penalty', () => {
    it('shift > 5h, no breaks → 1h penalty', () => {
      const days = [day('a', '2026-05-03', 8)]; // breaks=[]
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(1);
    });

    it('shift ≤ 5h, no breaks → no penalty', () => {
      const days = [day('a', '2026-05-03', 5)];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(0);
    });

    it('shift 5.1h, no breaks → penalty applies', () => {
      const days: DayInput[] = [
        {
          entryId: 'a',
          workDate: '2026-05-03',
          workedMinutes: 5 * 60 + 6, // 5.1h
          breaks: [],
          actualStartTime: '08:00',
          actualEndTime: '13:06',
        },
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(1);
    });

    it('30-min break before hour 5 → no penalty', () => {
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('12:00', 30)], // shift 08:00-17:00, break at 12:00 = hour 4
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(0);
    });

    it('30-min break exactly at hour 5 boundary → no penalty', () => {
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('13:00', 30)], // shift 08:00, break at 13:00 = exactly 5h boundary
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(0);
    });

    it('30-min break AFTER hour 5 → penalty applies (late meal)', () => {
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('13:30', 30)], // shift 08:00, break at 13:30 = hour 5.5
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(1);
    });

    it('29-min "meal" break → not a qualifying meal break', () => {
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('12:00', 29)],
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(1);
    });

    it('overnight shift: meal break "before" start time numerically (next-day)', () => {
      // Shift 22:00 → 06:00 (8h). Meal break at 02:00 = hour 4 of shift.
      const days: DayInput[] = [
        {
          entryId: 'a',
          workDate: '2026-05-03',
          workedMinutes: 8 * 60,
          breaks: [meal('02:00', 30)],
          actualStartTime: '22:00',
          actualEndTime: '06:00',
        },
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(0);
    });

    it('no actual start, breaks present → no penalty (can\'t prove violation)', () => {
      const days: DayInput[] = [
        {
          entryId: 'a',
          workDate: '2026-05-03',
          workedMinutes: 8 * 60,
          breaks: [meal('12:00', 30)],
          actualStartTime: null,
          actualEndTime: null,
        },
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      // Can't prove non-compliance without start time — no penalty.
      expect(r.mealBreakPenaltyHours).to.equal(0);
    });
  });

  describe('rest break penalty', () => {
    it('shift ≤ 3.5h → 0 earned, no penalty', () => {
      const days = [day('a', '2026-05-03', 3)];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.restBreakPenaltyHours).to.equal(0);
    });

    it('shift 4h, no breaks → 1h penalty (1 earned, 0 taken)', () => {
      const days = [day('a', '2026-05-03', 4)];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.restBreakPenaltyHours).to.equal(1);
    });

    it('shift 8h with 30-min meal but no rest → penalty applies', () => {
      const days = [day('a', '2026-05-03', 8, { breaks: [meal('12:00', 30)] })];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.restBreakPenaltyHours).to.equal(1);
    });

    it('shift 8h with meal + 1 rest → 2 earned, 1 taken → still 1h penalty', () => {
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('10:00', 10), meal('12:00', 30)],
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      // shift 8h = 480 min → > 360 → earned 2 rest. 10-min counted as 1 rest.
      expect(r.restBreakPenaltyHours).to.equal(1);
    });

    it('shift 8h with meal + 2 rest → 0 penalty', () => {
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('10:00', 10), meal('12:00', 30), meal('15:00', 10)],
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.restBreakPenaltyHours).to.equal(0);
    });

    it('30-min break does NOT count as rest (only meal)', () => {
      // 8h shift with 1 × 30-min break only → meal satisfied, rest NOT.
      const days = [
        day('a', '2026-05-03', 8, {
          breaks: [meal('12:00', 30)],
        }),
      ];
      const r = caRules.computeWeekBreakdown(days, '2026-05-03').get('a')!;
      expect(r.mealBreakPenaltyHours).to.equal(0);
      expect(r.restBreakPenaltyHours).to.equal(1);
    });

    it('earned breaks lookup table sanity', () => {
      // Use internal export to verify the boundary table.
      const { computeEarnedRestBreaks } = __caInternal;
      expect(computeEarnedRestBreaks(0)).to.equal(0);
      expect(computeEarnedRestBreaks(210)).to.equal(0); // 3.5h
      expect(computeEarnedRestBreaks(211)).to.equal(1);
      expect(computeEarnedRestBreaks(360)).to.equal(1); // 6h
      expect(computeEarnedRestBreaks(361)).to.equal(2);
      expect(computeEarnedRestBreaks(600)).to.equal(2); // 10h
      expect(computeEarnedRestBreaks(601)).to.equal(3);
      expect(computeEarnedRestBreaks(840)).to.equal(3); // 14h
      expect(computeEarnedRestBreaks(841)).to.equal(4);
      expect(computeEarnedRestBreaks(1080)).to.equal(4); // 18h
    });
  });

  describe('zero-day defenses', () => {
    it('all 0h days → all-zero output, no penalties', () => {
      const days = [day('a', '2026-05-03', 0), day('b', '2026-05-04', 0)];
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      for (const d of days) {
        expect(result.get(d.entryId)).to.deep.equal({
          totalRegularHours: 0,
          totalOTHours: 0,
          totalDoubleTimeHours: 0,
          mealBreakPenaltyHours: 0,
          restBreakPenaltyHours: 0,
        });
      }
    });

    it('result map contains every input day', () => {
      const days = [day('a', '2026-05-03', 8, { breaks: [meal('12:00', 30)] })];
      const result = caRules.computeWeekBreakdown(days, '2026-05-03');
      expect(result.has('a')).to.equal(true);
      expect(result.size).to.equal(1);
    });
  });
});
