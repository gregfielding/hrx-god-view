/**
 * **Slice 6a unit tests — payload composition.**
 *
 * Pure-function tests for `composeTimesheetBatchPayloads`. No
 * Firestore, no Everee, no Cloud Tasks. Every test feeds explicit
 * inputs and asserts on the wire-shaped output.
 *
 * Why exhaustive: the wire shapes are load-bearing — a typo here
 * turns a $1,000 pay run into Everee rejecting every entry. Cheaper
 * to test every branch than to discover the gap at submit time.
 */

import { expect } from 'chai';

import {
  composeBatchEntryPayloads,
  composeContractorPayable,
  composeW2AdditionalPayables,
  composeW2WorkedShift,
  makeSegment,
  money,
  type ComposeBatchInput,
  type ComposeEntry,
} from '../../payroll/composeTimesheetBatchPayloads';

/** Fixed reference shift: Mon 2026-05-19, 08:00–16:00 UTC.
 *  Picked so segment math is easy to eyeball. */
const SHIFT_START = 1_747_641_600; // 2026-05-19T08:00:00Z
const SHIFT_END = 1_747_670_400; // 2026-05-19T16:00:00Z (8 hours)

function makeEntry(overrides: Partial<ComposeEntry> = {}): ComposeEntry {
  return {
    tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
    assignmentId: 'assign-001',
    workerId: 'worker-uid-1',
    workDate: '2026-05-19',
    payRate: 20,
    totalRegularHours: 8,
    totalFlsaOTHours: 0,
    totalNonFlsaOTHours: 0,
    totalDoubleTimeHours: 0,
    mealBreakPenaltyHours: 0,
    restBreakPenaltyHours: 0,
    tips: 0,
    bonusAmount: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ComposeBatchInput> = {}): ComposeBatchInput {
  return {
    entry: makeEntry(),
    workerKind: 'w2',
    externalWorkerId: 'worker-uid-1',
    evereeWorkLocationId: 42,
    workersCompClassCode: '9079',
    shiftStartEpochSeconds: SHIFT_START,
    shiftEndEpochSeconds: SHIFT_END,
    breaks: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// money() helper
// ─────────────────────────────────────────────────────────────────────

describe('money', () => {
  it('formats whole dollars to two decimals', () => {
    expect(money(100)).to.deep.equal({ amount: '100.00', currency: 'USD' });
  });

  it('rounds fractional cents to 2dp', () => {
    expect(money(12.345)).to.deep.equal({ amount: '12.35', currency: 'USD' });
  });

  it('clamps negative inputs to 0 (Everee rejects negatives)', () => {
    expect(money(-5)).to.deep.equal({ amount: '0.00', currency: 'USD' });
  });

  it('handles zero', () => {
    expect(money(0)).to.deep.equal({ amount: '0.00', currency: 'USD' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// makeSegment() helper
// ─────────────────────────────────────────────────────────────────────

describe('makeSegment', () => {
  it('REGULAR_TIME — 8 hours × $20 = $160', () => {
    const seg = makeSegment(SHIFT_START, 8, 'REGULAR_TIME', 20, 8);
    expect(seg.type).to.equal('REGULAR_TIME');
    expect(seg.startEpochSeconds).to.equal(SHIFT_START);
    expect(seg.endEpochSeconds).to.equal(SHIFT_START + 8 * 3600);
    expect(seg.hourlyPayRate).to.deep.equal({ amount: '20.00', currency: 'USD' });
    expect(seg.grossPayAmount).to.deep.equal({ amount: '160.00', currency: 'USD' });
  });

  it('OVERTIME — 4 hours × $30 (= $20 × 1.5) = $120', () => {
    const seg = makeSegment(SHIFT_START, 4, 'OVERTIME', 30, 4);
    expect(seg.grossPayAmount.amount).to.equal('120.00');
    expect(seg.endEpochSeconds).to.equal(SHIFT_START + 4 * 3600);
  });

  it('handles fractional hours (15-min increment)', () => {
    const seg = makeSegment(SHIFT_START, 0.25, 'REGULAR_TIME', 20, 0.25);
    expect(seg.endEpochSeconds).to.equal(SHIFT_START + 900);
    expect(seg.grossPayAmount.amount).to.equal('5.00');
  });
});

// ─────────────────────────────────────────────────────────────────────
// W-2 worked-shift
// ─────────────────────────────────────────────────────────────────────

describe('composeW2WorkedShift', () => {
  it('pure 8h regular shift, no breaks, no extras', () => {
    const out = composeW2WorkedShift(makeInput());
    expect(out.externalWorkerId).to.equal('worker-uid-1');
    expect(out.shiftStartEpochSeconds).to.equal(SHIFT_START);
    expect(out.shiftEndEpochSeconds).to.equal(SHIFT_END);
    expect(out.effectiveHourlyPayRate.amount).to.equal('20.00');
    expect(out.overrideWorkLocationId).to.equal(42);
    expect(out.workersCompClassCode).to.equal('9079');
    expect(out.fullyClassifiedHours).to.have.length(1);
    expect(out.fullyClassifiedHours![0].type).to.equal('REGULAR_TIME');
    expect(out.createBreaks).to.equal(undefined);
  });

  it('classified hours split: 8 reg + 2 OT + 1 DT', () => {
    const out = composeW2WorkedShift(
      makeInput({
        entry: makeEntry({
          totalRegularHours: 8,
          totalFlsaOTHours: 2,
          totalNonFlsaOTHours: 0,
          totalDoubleTimeHours: 1,
        }),
      }),
    );
    expect(out.fullyClassifiedHours).to.have.length(3);
    const [reg, ot, dt] = out.fullyClassifiedHours!;
    expect(reg.type).to.equal('REGULAR_TIME');
    expect(reg.hourlyPayRate.amount).to.equal('20.00');
    expect(reg.grossPayAmount.amount).to.equal('160.00');
    expect(ot.type).to.equal('OVERTIME');
    expect(ot.hourlyPayRate.amount).to.equal('30.00');
    expect(ot.grossPayAmount.amount).to.equal('60.00');
    expect(dt.type).to.equal('DOUBLE_TIME');
    expect(dt.hourlyPayRate.amount).to.equal('40.00');
    expect(dt.grossPayAmount.amount).to.equal('40.00');
  });

  it('FLSA + non-FLSA OT collapse into a single OVERTIME segment', () => {
    // Per the addendum: the default worked-shifts endpoint's `type`
    // enum is REGULAR_TIME | OVERTIME | DOUBLE_TIME only. FLSA vs
    // non-FLSA distinction matters only on the bulk fallback endpoint.
    const out = composeW2WorkedShift(
      makeInput({
        entry: makeEntry({
          totalRegularHours: 8,
          totalFlsaOTHours: 1.5,
          totalNonFlsaOTHours: 2.0,
          totalDoubleTimeHours: 0,
        }),
      }),
    );
    const otSegs = out.fullyClassifiedHours!.filter((s) => s.type === 'OVERTIME');
    expect(otSegs).to.have.length(1);
    expect(otSegs[0].grossPayAmount.amount).to.equal((3.5 * 30).toFixed(2));
  });

  it('includes createBreaks when breaks are provided', () => {
    const out = composeW2WorkedShift(
      makeInput({
        breaks: [
          { startEpochSeconds: SHIFT_START + 3 * 3600, endEpochSeconds: SHIFT_START + 3 * 3600 + 1800, paid: false },
        ],
      }),
    );
    expect(out.createBreaks).to.have.length(1);
    expect(out.createBreaks![0].segmentConfigCode).to.equal('DEFAULT_UNPAID');
    expect(out.createBreaks![0].breakStartEpochSeconds).to.equal(SHIFT_START + 3 * 3600);
  });

  it('uses DEFAULT_PAID for paid breaks', () => {
    const out = composeW2WorkedShift(
      makeInput({
        breaks: [
          { startEpochSeconds: SHIFT_START + 4 * 3600, endEpochSeconds: SHIFT_START + 4 * 3600 + 900, paid: true },
        ],
      }),
    );
    expect(out.createBreaks![0].segmentConfigCode).to.equal('DEFAULT_PAID');
  });

  it('omits displayHourlyPayRate when equal to effective rate', () => {
    const out = composeW2WorkedShift(makeInput({ displayHourlyPayRate: 20 }));
    expect(out.displayHourlyPayRate).to.equal(undefined);
  });

  it('includes displayHourlyPayRate when different from effective rate', () => {
    const out = composeW2WorkedShift(makeInput({ displayHourlyPayRate: 22 }));
    expect(out.displayHourlyPayRate?.amount).to.equal('22.00');
  });

  it('omits workersCompClassCode when not provided', () => {
    const out = composeW2WorkedShift(makeInput({ workersCompClassCode: undefined }));
    expect(out.workersCompClassCode).to.equal(undefined);
  });

  it('omits note when not provided; includes it when provided', () => {
    expect(composeW2WorkedShift(makeInput()).note).to.equal(undefined);
    expect(composeW2WorkedShift(makeInput({ note: 'Late arrival' })).note).to.equal('Late arrival');
  });

  it('zero hours produces empty fullyClassifiedHours (omitted)', () => {
    const out = composeW2WorkedShift(
      makeInput({
        entry: makeEntry({
          totalRegularHours: 0,
          totalFlsaOTHours: 0,
          totalNonFlsaOTHours: 0,
          totalDoubleTimeHours: 0,
        }),
      }),
    );
    expect(out.fullyClassifiedHours).to.equal(undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────
// W-2 additional payables
// ─────────────────────────────────────────────────────────────────────

describe('composeW2AdditionalPayables', () => {
  it('no extras → empty array', () => {
    expect(composeW2AdditionalPayables(makeInput())).to.deep.equal([]);
  });

  it('tips only', () => {
    const out = composeW2AdditionalPayables(makeInput({ entry: makeEntry({ tips: 25.5 }) }));
    expect(out).to.have.length(1);
    expect(out[0].payCode).to.equal('TIPS');
    expect(out[0].amount.amount).to.equal('25.50');
    expect(out[0].externalId).to.equal('BCiP2bQ9CgVOCTfV6MhD::assign-001::2026-05-19::TIPS');
    expect(out[0].externalWorkerId).to.equal('worker-uid-1');
    expect(out[0].timestamp).to.equal(SHIFT_START);
    expect(out[0].workLocationId).to.equal(42);
    expect(out[0].payableModel).to.equal('PRE_CALCULATED');
  });

  it('bonus only', () => {
    const out = composeW2AdditionalPayables(makeInput({ entry: makeEntry({ bonusAmount: 50 }) }));
    expect(out).to.have.length(1);
    expect(out[0].payCode).to.equal('BONUS');
    expect(out[0].externalId).to.match(/::BONUS$/);
  });

  it('meal premium — 1h × $20 base = $20', () => {
    const out = composeW2AdditionalPayables(
      makeInput({ entry: makeEntry({ mealBreakPenaltyHours: 1 }) }),
    );
    expect(out).to.have.length(1);
    expect(out[0].payCode).to.equal('REGULAR_HOURLY');
    expect(out[0].label).to.equal('Meal Break Premium (CA §226.7)');
    expect(out[0].amount.amount).to.equal('20.00');
    expect(out[0].externalId).to.match(/::MEAL_PREMIUM$/);
  });

  it('rest premium — 0.5h × $20 base = $10', () => {
    const out = composeW2AdditionalPayables(
      makeInput({ entry: makeEntry({ restBreakPenaltyHours: 0.5 }) }),
    );
    expect(out).to.have.length(1);
    expect(out[0].payCode).to.equal('REGULAR_HOURLY');
    expect(out[0].amount.amount).to.equal('10.00');
    expect(out[0].externalId).to.match(/::REST_PREMIUM$/);
  });

  it('all four extras — emits 4 payables in tips/bonus/meal/rest order', () => {
    const out = composeW2AdditionalPayables(
      makeInput({
        entry: makeEntry({
          tips: 10,
          bonusAmount: 20,
          mealBreakPenaltyHours: 1,
          restBreakPenaltyHours: 0.5,
        }),
      }),
    );
    expect(out.map((p) => p.payCode)).to.deep.equal([
      'TIPS',
      'BONUS',
      'REGULAR_HOURLY',
      'REGULAR_HOURLY',
    ]);
    expect(out.map((p) => p.externalId.split('::').pop())).to.deep.equal([
      'TIPS',
      'BONUS',
      'MEAL_PREMIUM',
      'REST_PREMIUM',
    ]);
  });

  it('zero amounts are filtered (no $0 payables hit Everee)', () => {
    const out = composeW2AdditionalPayables(
      makeInput({
        entry: makeEntry({
          tips: 0,
          bonusAmount: 0,
          mealBreakPenaltyHours: 0,
          restBreakPenaltyHours: 0,
        }),
      }),
    );
    expect(out).to.have.length(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 1099 contractor payable
// ─────────────────────────────────────────────────────────────────────

describe('composeContractorPayable', () => {
  const contractorInput = (): ComposeBatchInput =>
    makeInput({
      workerKind: 'contractor',
      workersCompClassCode: undefined, // contractors don't carry WC
    });

  it('flat 8h × $25 = $200 gross, no extras', () => {
    const out = composeContractorPayable(
      makeInput({
        workerKind: 'contractor',
        entry: makeEntry({ payRate: 25, totalRegularHours: 8 }),
      }),
    );
    expect(out.payCode).to.equal('CONTRACTOR');
    expect(out.amount.amount).to.equal('200.00');
    expect(out.externalId).to.equal(
      'BCiP2bQ9CgVOCTfV6MhD::assign-001::2026-05-19::CONTRACTOR',
    );
  });

  it('gross = (reg+OT+DT) × rate + tips + bonus', () => {
    const out = composeContractorPayable(
      makeInput({
        workerKind: 'contractor',
        entry: makeEntry({
          payRate: 30,
          totalRegularHours: 8,
          totalFlsaOTHours: 2,
          totalNonFlsaOTHours: 1,
          totalDoubleTimeHours: 0,
          tips: 15,
          bonusAmount: 25,
        }),
      }),
    );
    // (8 + 2 + 1) × 30 = 330, + 15 + 25 = 370
    expect(out.amount.amount).to.equal('370.00');
  });

  it('folds premium hours into the gross (defensive — §226.7 N/A for 1099)', () => {
    const out = composeContractorPayable(
      makeInput({
        workerKind: 'contractor',
        entry: makeEntry({
          payRate: 20,
          totalRegularHours: 8,
          mealBreakPenaltyHours: 1,
          restBreakPenaltyHours: 1,
        }),
      }),
    );
    // (8 × 20) + (2 × 20) = 200
    expect(out.amount.amount).to.equal('200.00');
  });

  it('shape: timestamp = shiftStart, model = PRE_CALCULATED, location passed through', () => {
    const out = composeContractorPayable(contractorInput());
    expect(out.timestamp).to.equal(SHIFT_START);
    expect(out.payableModel).to.equal('PRE_CALCULATED');
    expect(out.workLocationId).to.equal(42);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Top-level dispatcher
// ─────────────────────────────────────────────────────────────────────

describe('composeBatchEntryPayloads', () => {
  it('routes W-2 → kind:w2 with workedShift + payables', () => {
    const out = composeBatchEntryPayloads(
      makeInput({ entry: makeEntry({ tips: 5 }) }),
    );
    expect(out.kind).to.equal('w2');
    if (out.kind !== 'w2') throw new Error('narrow');
    expect(out.workedShift.externalWorkerId).to.equal('worker-uid-1');
    expect(out.payables).to.have.length(1);
    expect(out.payables[0].payCode).to.equal('TIPS');
  });

  it('routes 1099 → kind:contractor with single payable', () => {
    const out = composeBatchEntryPayloads(
      makeInput({
        workerKind: 'contractor',
        workersCompClassCode: undefined,
      }),
    );
    expect(out.kind).to.equal('contractor');
    if (out.kind !== 'contractor') throw new Error('narrow');
    expect(out.payables).to.have.length(1);
    expect(out.payables[0].payCode).to.equal('CONTRACTOR');
  });

  it('1099 ignores worked-shift fields entirely', () => {
    const out = composeBatchEntryPayloads(
      makeInput({
        workerKind: 'contractor',
        breaks: [
          { startEpochSeconds: SHIFT_START + 1800, endEpochSeconds: SHIFT_START + 2700, paid: false },
        ],
      }),
    );
    // No worked-shift field exists on the contractor union arm.
    expect((out as { workedShift?: unknown }).workedShift).to.equal(undefined);
  });
});
