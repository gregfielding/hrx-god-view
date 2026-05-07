/**
 * Pure-helper tests for the recompute trigger. The trigger's
 * Firestore I/O is exercised via integration tests in a separate
 * suite (Phase 2.B follow-up if Karina's audit demands it); this
 * file tests the pure helpers that govern WHEN the trigger reads
 * Firestore — the gate logic that protects the read budget.
 *
 * The pure helpers are the entire correctness boundary for the
 * trigger's cost behavior: if the gate logic is wrong, fan-out
 * doesn't terminate. We test it carefully.
 */

import { expect } from 'chai';
import { __recomputeInternal } from '../../timesheets/onTimesheetEntryWriteRecomputePayBreakdown';

const {
  COMPUTE_INPUT_FIELDS,
  COMPUTED_FIELDS,
  computeInputChanged,
  onlyComputedFieldsChanged,
  buildDayInput,
  breakdownsEqual,
  readBreakdown,
  pickStateCode,
  extractScope,
  scopeKey,
} = __recomputeInternal;

const sampleEntry = {
  id: 'a_2026-05-06',
  tenantId: 't1',
  assignmentId: 'a',
  jobOrderId: 'jo1',
  hiringEntityId: 'e1',
  workerId: 'w1',
  workDate: '2026-05-06',
  workState: 'CA',
  scheduledStartTime: '08:00',
  scheduledEndTime: '17:00',
  scheduledBreakMinutes: 30,
  actualStartTime: '08:00',
  actualEndTime: '17:00',
  breaks: [
    { startTime: '12:00', endTime: '12:30', durationMins: 30, paid: false },
  ],
  totalRegularHours: 8,
  totalOTHours: 0,
  totalFlsaOTHours: 0,
  totalNonFlsaOTHours: 0,
  totalDoubleTimeHours: 0,
  mealBreakPenaltyHours: 0,
  restBreakPenaltyHours: 0,
  tips: 0,
  bonusAmount: 0,
  payRate: 25,
  billRate: 50,
  status: 'draft',
  createdBy: 'recruiter1',
  createdAt: new Date(),
  updatedBy: 'recruiter1',
  updatedAt: new Date(),
};

describe('timesheets/onTimesheetEntryWriteRecomputePayBreakdown — pure helpers', () => {
  describe('COMPUTE_INPUT_FIELDS / COMPUTED_FIELDS — disjoint sets', () => {
    it('no field appears in both sets', () => {
      const inputs = new Set<string>(COMPUTE_INPUT_FIELDS);
      for (const f of COMPUTED_FIELDS) {
        expect(inputs.has(f), `${f} appears in both compute-input and computed sets`).to.equal(false);
      }
    });
  });

  describe('computeInputChanged (Tier-1 gate)', () => {
    it('create (no before) → true', () => {
      expect(computeInputChanged(null, sampleEntry)).to.equal(true);
    });

    it('delete (no after) → true (need to recompute remaining siblings)', () => {
      expect(computeInputChanged(sampleEntry, null)).to.equal(true);
    });

    it('identical before/after → false', () => {
      expect(computeInputChanged(sampleEntry, { ...sampleEntry })).to.equal(false);
    });

    it('only notes changed → false', () => {
      const after = { ...sampleEntry, notes: 'recruiter added a note' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(false);
    });

    it('only status changed → false', () => {
      const after = { ...sampleEntry, status: 'approved', approvedBy: 'r1' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(false);
    });

    it('only payRate / billRate changed → false (rates are NOT pay-input for hours)', () => {
      // Pay rates affect dollars, not classification. Phase 4 gross-
      // pay computation will care; the engine doesn't.
      const after = { ...sampleEntry, payRate: 30, billRate: 60 };
      expect(computeInputChanged(sampleEntry, after)).to.equal(false);
    });

    it('only tips / bonusAmount changed → false', () => {
      const after = { ...sampleEntry, tips: 5, bonusAmount: 25 };
      expect(computeInputChanged(sampleEntry, after)).to.equal(false);
    });

    it('actualStartTime changed → true', () => {
      const after = { ...sampleEntry, actualStartTime: '07:00' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });

    it('actualEndTime changed → true', () => {
      const after = { ...sampleEntry, actualEndTime: '18:30' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });

    it('breaks array changed → true', () => {
      const after = {
        ...sampleEntry,
        breaks: [
          ...sampleEntry.breaks,
          { startTime: '15:00', endTime: '15:10', durationMins: 10, paid: false },
        ],
      };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });

    it('workDate changed (entry moved to different day) → true', () => {
      const after = { ...sampleEntry, workDate: '2026-05-07' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });

    it('workState changed (re-keyed worksite) → true', () => {
      const after = { ...sampleEntry, workState: 'NY' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });

    it('hiringEntityId changed (cross-entity move) → true', () => {
      const after = { ...sampleEntry, hiringEntityId: 'e2' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });

    it('workerId changed (recruiter re-keyed entry) → true', () => {
      const after = { ...sampleEntry, workerId: 'w2' };
      expect(computeInputChanged(sampleEntry, after)).to.equal(true);
    });
  });

  describe('onlyComputedFieldsChanged (Tier-2 self-fire guard)', () => {
    it('create → false (definitely user write, not self-fire)', () => {
      expect(onlyComputedFieldsChanged(null, sampleEntry)).to.equal(false);
    });

    it('only computed fields changed → true (self-fire detected)', () => {
      const after = {
        ...sampleEntry,
        totalRegularHours: 10,
        totalOTHours: 2,
        updatedAt: new Date(),
      };
      expect(onlyComputedFieldsChanged(sampleEntry, after)).to.equal(true);
    });

    it('one computed + one non-computed field changed → false', () => {
      const after = {
        ...sampleEntry,
        totalRegularHours: 10, // computed
        notes: 'edit',         // not in ignored set
      };
      expect(onlyComputedFieldsChanged(sampleEntry, after)).to.equal(false);
    });

    it('only updatedAt changed → true (ancillary field)', () => {
      const after = { ...sampleEntry, updatedAt: new Date(Date.now() + 1000) };
      expect(onlyComputedFieldsChanged(sampleEntry, after)).to.equal(true);
    });

    it('actualStartTime changed → false (compute input)', () => {
      const after = {
        ...sampleEntry,
        actualStartTime: '07:00',
        totalRegularHours: 9,
      };
      expect(onlyComputedFieldsChanged(sampleEntry, after)).to.equal(false);
    });
  });

  describe('buildDayInput', () => {
    it('builds DayInput from a populated entry', () => {
      const di = buildDayInput('e1_2026-05-06', sampleEntry);
      expect(di).to.not.equal(null);
      expect(di!.entryId).to.equal('e1_2026-05-06');
      expect(di!.workDate).to.equal('2026-05-06');
      // 08:00 → 17:00 = 540 min, minus 30-min unpaid break = 510 min.
      expect(di!.workedMinutes).to.equal(510);
      expect(di!.breaks.length).to.equal(1);
      expect(di!.actualStartTime).to.equal('08:00');
      expect(di!.actualEndTime).to.equal('17:00');
    });

    it('returns null for missing workDate', () => {
      const data = { ...sampleEntry, workDate: undefined as any };
      expect(buildDayInput('e1', data)).to.equal(null);
    });

    it('handles empty entry (no actuals, no breaks) → workedMinutes=0', () => {
      const data = {
        ...sampleEntry,
        actualStartTime: undefined,
        actualEndTime: undefined,
        breaks: [],
      };
      const di = buildDayInput('e1', data);
      expect(di).to.not.equal(null);
      expect(di!.workedMinutes).to.equal(0);
      expect(di!.actualStartTime).to.equal(null);
      expect(di!.actualEndTime).to.equal(null);
    });

    it('filters out malformed breaks', () => {
      const data = {
        ...sampleEntry,
        breaks: [
          { startTime: '12:00', endTime: '12:30', durationMins: 30, paid: false },
          { startTime: 'bad', endTime: 'bad', durationMins: 'bad', paid: 'bad' } as any,
          null as any,
          { startTime: '15:00', endTime: '15:10', durationMins: 10, paid: false },
        ],
      };
      const di = buildDayInput('e1', data);
      expect(di!.breaks.length).to.equal(2);
    });

    it('handles overnight shift', () => {
      const data = {
        ...sampleEntry,
        actualStartTime: '22:00',
        actualEndTime: '06:00',
        breaks: [{ startTime: '02:00', endTime: '02:30', durationMins: 30, paid: false }],
      };
      const di = buildDayInput('e1', data);
      // 22:00 → 06:00 (next day) = 8h = 480 min, minus 30 break = 450.
      expect(di!.workedMinutes).to.equal(450);
    });
  });

  describe('breakdownsEqual', () => {
    const z = {
      totalRegularHours: 0,
      totalOTHours: 0,
      totalFlsaOTHours: 0,
      totalNonFlsaOTHours: 0,
      totalDoubleTimeHours: 0,
      mealBreakPenaltyHours: 0,
      restBreakPenaltyHours: 0,
    };

    it('identical → true', () => {
      expect(breakdownsEqual({ ...z, totalRegularHours: 8 }, { ...z, totalRegularHours: 8 })).to.equal(true);
    });

    it('different reg → false', () => {
      expect(breakdownsEqual({ ...z, totalRegularHours: 8 }, { ...z, totalRegularHours: 7 })).to.equal(false);
    });

    it('within epsilon (0.005) → true', () => {
      expect(breakdownsEqual({ ...z, totalRegularHours: 8 }, { ...z, totalRegularHours: 8.001 })).to.equal(true);
    });

    it('just outside epsilon → false', () => {
      expect(breakdownsEqual({ ...z, totalRegularHours: 8 }, { ...z, totalRegularHours: 8.01 })).to.equal(false);
    });

    it('any field differs → false', () => {
      expect(breakdownsEqual(z, { ...z, mealBreakPenaltyHours: 1 })).to.equal(false);
      expect(breakdownsEqual(z, { ...z, restBreakPenaltyHours: 1 })).to.equal(false);
      expect(breakdownsEqual(z, { ...z, totalDoubleTimeHours: 1 })).to.equal(false);
      expect(breakdownsEqual(z, { ...z, totalFlsaOTHours: 1 })).to.equal(false);
      expect(breakdownsEqual(z, { ...z, totalNonFlsaOTHours: 1 })).to.equal(false);
    });

    it('legacy entries (missing FLSA split fields) re-stamp on next write', () => {
      // Simulates an entry written before P2.C: stored breakdown
      // reads as flsa=nonFlsa=0 due to readBreakdown defaults. The
      // engine's split (e.g. flsa=2, nonFlsa=0) doesn't match → trigger
      // proceeds with re-stamp. This is the intended backfill path.
      const legacy = { ...z, totalOTHours: 2 }; // no flsa/nonFlsa fields
      const computed = { ...z, totalOTHours: 2, totalFlsaOTHours: 2, totalNonFlsaOTHours: 0 };
      expect(breakdownsEqual(legacy, computed)).to.equal(false);
    });
  });

  describe('readBreakdown', () => {
    it('reads numeric fields from entry data', () => {
      const b = readBreakdown(sampleEntry);
      expect(b.totalRegularHours).to.equal(8);
      expect(b.totalOTHours).to.equal(0);
    });

    it('defaults missing fields to 0', () => {
      const b = readBreakdown({});
      expect(b.totalRegularHours).to.equal(0);
      expect(b.totalOTHours).to.equal(0);
      expect(b.totalFlsaOTHours).to.equal(0);
      expect(b.totalNonFlsaOTHours).to.equal(0);
      expect(b.totalDoubleTimeHours).to.equal(0);
      expect(b.mealBreakPenaltyHours).to.equal(0);
      expect(b.restBreakPenaltyHours).to.equal(0);
    });

    it('coerces non-numeric to 0', () => {
      const b = readBreakdown({ totalRegularHours: 'eight' as any });
      expect(b.totalRegularHours).to.equal(0);
    });
  });

  describe('pickStateCode', () => {
    it('returns workState when present', () => {
      expect(pickStateCode(sampleEntry)).to.equal('CA');
    });

    it('trims whitespace', () => {
      expect(pickStateCode({ workState: '  CA  ' })).to.equal('CA');
    });

    it('falls back to DEFAULT for empty / missing', () => {
      expect(pickStateCode({ workState: '' })).to.equal('DEFAULT');
      expect(pickStateCode({ workState: '   ' })).to.equal('DEFAULT');
      expect(pickStateCode({})).to.equal('DEFAULT');
      expect(pickStateCode({ workState: null as any })).to.equal('DEFAULT');
    });
  });

  describe('extractScope + scopeKey (cross-entity workweek scoping)', () => {
    it('extracts scope from a populated entry (Sun-start workweek)', () => {
      const scope = extractScope('t1', sampleEntry, 0);
      expect(scope).to.deep.equal({
        tenantId: 't1',
        workerId: 'w1',
        hiringEntityId: 'e1',
        workWeekStart: '2026-05-03',
        workWeekEnd: '2026-05-09',
      });
    });

    it('extracts scope with Mon-start workweek', () => {
      // 2026-05-06 is Wed. Mon-start workweek = 2026-05-04 (Mon).
      const scope = extractScope('t1', sampleEntry, 1);
      expect(scope!.workWeekStart).to.equal('2026-05-04');
    });

    it('returns null when workerId missing', () => {
      const data = { ...sampleEntry, workerId: undefined as any };
      expect(extractScope('t1', data, 0)).to.equal(null);
    });

    it('returns null when hiringEntityId missing', () => {
      const data = { ...sampleEntry, hiringEntityId: undefined as any };
      expect(extractScope('t1', data, 0)).to.equal(null);
    });

    it('returns null when workDate malformed', () => {
      const data = { ...sampleEntry, workDate: 'not-a-date' };
      expect(extractScope('t1', data, 0)).to.equal(null);
    });

    it('scopeKey is stable for identical scopes', () => {
      const a = extractScope('t1', sampleEntry, 0)!;
      const b = extractScope('t1', { ...sampleEntry }, 0)!;
      expect(scopeKey(a)).to.equal(scopeKey(b));
    });

    it('scopeKey differs for different entities (cross-entity isolation)', () => {
      const a = extractScope('t1', sampleEntry, 0)!;
      const b = extractScope('t1', { ...sampleEntry, hiringEntityId: 'e2' }, 0)!;
      expect(scopeKey(a)).to.not.equal(scopeKey(b));
    });

    it('scopeKey differs for different workers in same entity (cross-worker isolation)', () => {
      const a = extractScope('t1', sampleEntry, 0)!;
      const b = extractScope('t1', { ...sampleEntry, workerId: 'w2' }, 0)!;
      expect(scopeKey(a)).to.not.equal(scopeKey(b));
    });

    it('scopeKey same when workDate moves within the same workweek', () => {
      const a = extractScope('t1', sampleEntry, 0)!; // Wed 2026-05-06
      const b = extractScope('t1', { ...sampleEntry, workDate: '2026-05-08' }, 0)!; // Fri same week
      expect(scopeKey(a)).to.equal(scopeKey(b));
    });

    it('scopeKey differs when workDate crosses into next workweek', () => {
      const a = extractScope('t1', sampleEntry, 0)!; // Wed 2026-05-06
      const b = extractScope('t1', { ...sampleEntry, workDate: '2026-05-10' }, 0)!; // Sun next week
      expect(scopeKey(a)).to.not.equal(scopeKey(b));
    });
  });

  describe('cross-entity scoping (user spec)', () => {
    it('worker w1 at C1 Events and C1 Select in same week → distinct scopes', () => {
      // Same worker, same week, different entities. Must produce
      // distinct scopes so weekly OT is tracked independently per
      // staffing-industry convention.
      const c1Events = { ...sampleEntry, hiringEntityId: 'c1-events' };
      const c1Select = { ...sampleEntry, hiringEntityId: 'c1-select' };
      const sa = extractScope('t1', c1Events, 0)!;
      const sb = extractScope('t1', c1Select, 0)!;
      expect(scopeKey(sa)).to.not.equal(scopeKey(sb));
      expect(sa.hiringEntityId).to.equal('c1-events');
      expect(sb.hiringEntityId).to.equal('c1-select');
    });
  });
});
