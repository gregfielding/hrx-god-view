/**
 * **TS.1.P4 Slice 6a — pure payload composition for the Everee batch
 * submission.**
 *
 * Pure functions that take a `TimesheetEntryV2` (plus its
 * already-resolved context — worker external id, work location, comp
 * code, shift datetimes converted to epoch seconds) and produce the
 * wire-shaped payloads the Slice 2 wrappers POST to Everee:
 *
 *   W-2 entry → one `CreateWorkedShiftInput` for /labor/worked-shifts
 *               + N `CreatePayableInput`s for tips / bonus /
 *                 §226.7 meal & rest premiums
 *
 *   1099 entry → one `CreatePayableInput` for /payables (CONTRACTOR
 *                 earning type, gross-aggregated amount)
 *
 * **What's NOT here** (lives in Slice 6b — the orchestrator):
 *   - Reading the entry / assignment / JO / hiring-entity from Firestore.
 *   - Resolving the worker's externalWorkerId (uid lookup + linkage
 *     fallback — the same pattern as the worker-payroll-recovery PR).
 *   - Resolving Everee `workLocationId` (the orchestrator memoizes
 *     `ensureEvereeWorkLocation` per run).
 *   - Resolving `workersCompClassCode` from the JO cascade.
 *   - Converting worksite-local HH:mm clock times to UTC epoch seconds
 *     using the worksite's time-zone — orchestrator does this once
 *     per entry, then the result flows in here.
 *   - Calling Everee, retrying on 429, stamping `everee.workedShiftId`
 *     onto the entry — those are Slice 2 wrapper calls + Cloud Tasks
 *     work in 6b.
 *
 * This module is heavily unit-tested because the wire shapes are
 * load-bearing: a typo here turns a $1,000 pay run into Everee
 * rejecting every entry.
 *
 * **References:**
 *   - `evereeWorkedShifts.ts` — `CreateWorkedShiftInput` + segment
 *     shapes
 *   - `evereePayables.ts` — `CreatePayableInput` + `buildPayableExternalId`
 *   - `timesheet-build-plan-addendum-phase4.md` §4-§7 — the source spec
 */

import {
  buildPayableExternalId,
  type CreatePayableInput,
  type EvereeStandardEarningType,
} from '../integrations/everee/evereePayables';
import type {
  CreateWorkedShiftInput,
  EvereeFullyClassifiedHoursSegment,
  EvereeMoney,
  EvereeWorkedShiftBreak,
} from '../integrations/everee/evereeWorkedShifts';

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

/**
 * Entry fields the composer reads. Mirrors the relevant slice of
 * `TimesheetEntryV2` but kept narrow on purpose — coupling to the full
 * type would drag a frontend Firestore-types dependency into a pure
 * compute module.
 */
export interface ComposeEntry {
  tenantId: string;
  assignmentId: string;
  workerId: string;
  workDate: string;
  payRate: number;
  /** Hours classified by the rules engine (Slice 2). Defensive defaults
   *  treat missing fields as zero — older entries written before P2.C
   *  may not have the FLSA/non-FLSA split. */
  totalRegularHours: number;
  totalFlsaOTHours?: number;
  totalNonFlsaOTHours?: number;
  totalDoubleTimeHours: number;
  mealBreakPenaltyHours: number;
  restBreakPenaltyHours: number;
  tips: number;
  bonusAmount: number;
}

/**
 * One break resolved to UTC epoch seconds (the orchestrator does the
 * worksite-local → UTC conversion before calling here).
 */
export interface ComposeBreak {
  startEpochSeconds: number;
  endEpochSeconds: number;
  /** Paid breaks count toward worked hours; affects the wire's
   *  `segmentConfigCode` choice. */
  paid: boolean;
}

/**
 * Worker classification — derived from the hiring entity's worker
 * type. W-2 entries route to the Timesheets API (worked-shifts);
 * 1099 entries route to Payables (CONTRACTOR earning type).
 */
export type WorkerKind = 'w2' | 'contractor';

export interface ComposeBatchInput {
  entry: ComposeEntry;
  /** Worker classification per the hiring entity. */
  workerKind: WorkerKind;
  /** Everee's externalWorkerId — HRX uid by convention. */
  externalWorkerId: string;
  /** Everee numeric work location id, resolved upstream by
   *  `ensureEvereeWorkLocation`. */
  evereeWorkLocationId: number;
  /** From the JO cascade. Pre-flight in the orchestrator fails fast
   *  when this is missing on a W-2 entry. */
  workersCompClassCode?: string;
  /** Shift start in UTC epoch seconds. Orchestrator combines
   *  `entry.workDate` + `entry.actualStartTime` (or
   *  `entry.scheduledStartTime`) with the worksite TZ. */
  shiftStartEpochSeconds: number;
  shiftEndEpochSeconds: number;
  /** Breaks resolved to UTC epoch seconds. Already filtered for valid
   *  durations by the orchestrator. */
  breaks: ComposeBreak[];
  /** Optional display rate when it differs from the effective rate
   *  (weighted-average cases). */
  displayHourlyPayRate?: number;
  /** Free-form note that surfaces on the worked-shift in Everee. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Outputs
// ─────────────────────────────────────────────────────────────────────

/**
 * The composed batch entry — what the orchestrator hands to the Slice 2
 * wrappers. Discriminated union so callers can switch on `kind` instead
 * of probing fields.
 *
 * Idempotency hooks live on each payload:
 *   - W-2 worked-shift: server-assigned `workedShiftId` after the first
 *     POST; orchestrator stamps it on `entry.everee.workedShiftId` and
 *     uses it on retries via PUT.
 *   - Payables: deterministic `externalId` per `buildPayableExternalId`.
 */
export type ComposedBatchEntry =
  | {
      kind: 'w2';
      workedShift: CreateWorkedShiftInput;
      payables: CreatePayableInput[];
    }
  | {
      kind: 'contractor';
      payables: CreatePayableInput[];
    };

// ─────────────────────────────────────────────────────────────────────
// Top-level composer
// ─────────────────────────────────────────────────────────────────────

/**
 * Top-level dispatcher. Pure: same input → same output, no IO. Safe
 * from triggers, callables, and unit tests alike.
 */
export function composeBatchEntryPayloads(input: ComposeBatchInput): ComposedBatchEntry {
  if (input.workerKind === 'contractor') {
    return {
      kind: 'contractor',
      payables: [composeContractorPayable(input)],
    };
  }
  return {
    kind: 'w2',
    workedShift: composeW2WorkedShift(input),
    payables: composeW2AdditionalPayables(input),
  };
}

// ─────────────────────────────────────────────────────────────────────
// W-2: worked-shift
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the `CreateWorkedShiftInput` for a W-2 entry. The
 * `fullyClassifiedHours[]` array slices the worked window into
 * REGULAR_TIME / OVERTIME / DOUBLE_TIME segments sized by the rules
 * engine's output. Everee's worked-shifts enum collapses FLSA and
 * non-FLSA OT into a single `OVERTIME` value — the split only matters
 * on the bulk fallback endpoint.
 *
 * Segment time spans are derived sequentially starting at
 * `shiftStartEpochSeconds`. Everee doesn't strictly require the
 * segments to add up to (shiftEnd - shiftStart) — the canonical
 * source of truth is the hours field — but laying them out in order
 * gives Everee a sensible default to display on the pay stub.
 */
export function composeW2WorkedShift(input: ComposeBatchInput): CreateWorkedShiftInput {
  const totalOTHours = (input.entry.totalFlsaOTHours ?? 0) + (input.entry.totalNonFlsaOTHours ?? 0);
  const regularHours = nonNegative(input.entry.totalRegularHours);
  const otHours = nonNegative(totalOTHours);
  const dtHours = nonNegative(input.entry.totalDoubleTimeHours);

  const fullyClassifiedHours: EvereeFullyClassifiedHoursSegment[] = [];
  let cursor = input.shiftStartEpochSeconds;
  const base = input.entry.payRate;

  if (regularHours > 0) {
    const seg = makeSegment(cursor, regularHours, 'REGULAR_TIME', base, regularHours);
    fullyClassifiedHours.push(seg);
    cursor = seg.endEpochSeconds;
  }
  if (otHours > 0) {
    const seg = makeSegment(cursor, otHours, 'OVERTIME', base * 1.5, otHours);
    fullyClassifiedHours.push(seg);
    cursor = seg.endEpochSeconds;
  }
  if (dtHours > 0) {
    const seg = makeSegment(cursor, dtHours, 'DOUBLE_TIME', base * 2.0, dtHours);
    fullyClassifiedHours.push(seg);
    cursor = seg.endEpochSeconds;
  }

  const createBreaks: EvereeWorkedShiftBreak[] = input.breaks.map((b) => ({
    segmentConfigCode: b.paid ? 'DEFAULT_PAID' : 'DEFAULT_UNPAID',
    breakStartEpochSeconds: b.startEpochSeconds,
    breakEndEpochSeconds: b.endEpochSeconds,
  }));

  const out: CreateWorkedShiftInput = {
    externalWorkerId: input.externalWorkerId,
    shiftStartEpochSeconds: input.shiftStartEpochSeconds,
    shiftEndEpochSeconds: input.shiftEndEpochSeconds,
    effectiveHourlyPayRate: money(base),
    overrideWorkLocationId: input.evereeWorkLocationId,
  };
  if (input.displayHourlyPayRate != null && input.displayHourlyPayRate !== base) {
    out.displayHourlyPayRate = money(input.displayHourlyPayRate);
  }
  if (input.workersCompClassCode) out.workersCompClassCode = input.workersCompClassCode;
  if (createBreaks.length > 0) out.createBreaks = createBreaks;
  if (fullyClassifiedHours.length > 0) out.fullyClassifiedHours = fullyClassifiedHours;
  if (input.note) out.note = input.note;
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// W-2: additional payables (tips, bonus, CA §226.7 premiums)
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the non-hourly payables that ride alongside a W-2 entry's
 * worked-shift submission:
 *
 *   - Tips        — TIPS earning type
 *   - Bonus       — BONUS earning type
 *   - Meal premium  — REGULAR_HOURLY (custom-named pay code, see
 *                     `provisionCustomPayCodes.ts`; Piers's tax-
 *                     treatment guidance)
 *   - Rest premium  — REGULAR_HOURLY (same)
 *
 * Each gets a deterministic `externalId` per `buildPayableExternalId`.
 * Zero-amount payables are filtered out — no need to clutter Everee's
 * pay run with $0.00 rows. The amount for meal/rest premiums equals
 * the entry's premium hours × base pay rate (CA Labor Code §226.7
 * standard: one hour of pay per missed break).
 */
export function composeW2AdditionalPayables(input: ComposeBatchInput): CreatePayableInput[] {
  const payables: CreatePayableInput[] = [];
  const base = input.entry.payRate;

  if (input.entry.tips > 0) {
    payables.push(
      makePayableForEntry(input, {
        kind: 'TIPS',
        earningType: 'TIPS',
        amount: input.entry.tips,
        label: 'Tips',
      }),
    );
  }
  if (input.entry.bonusAmount > 0) {
    payables.push(
      makePayableForEntry(input, {
        kind: 'BONUS',
        earningType: 'BONUS',
        amount: input.entry.bonusAmount,
        label: 'Bonus',
      }),
    );
  }
  if (input.entry.mealBreakPenaltyHours > 0) {
    payables.push(
      makePayableForEntry(input, {
        kind: 'MEAL_PREMIUM',
        earningType: 'REGULAR_HOURLY',
        amount: input.entry.mealBreakPenaltyHours * base,
        label: 'Meal Break Premium (CA §226.7)',
      }),
    );
  }
  if (input.entry.restBreakPenaltyHours > 0) {
    payables.push(
      makePayableForEntry(input, {
        kind: 'REST_PREMIUM',
        earningType: 'REGULAR_HOURLY',
        amount: input.entry.restBreakPenaltyHours * base,
        label: 'Rest Break Premium (CA §226.7)',
      }),
    );
  }
  return payables;
}

// ─────────────────────────────────────────────────────────────────────
// 1099: contractor payable (gross-aggregated)
// ─────────────────────────────────────────────────────────────────────

/**
 * 1099 contractor entries route as a single payable carrying the
 * aggregate gross. Everee handles 1099 tax mechanics on its side; we
 * just submit the dollar amount we owe.
 *
 *   gross = (regularHours + flsaOT + nonFlsaOT + DT) × payRate
 *           + tips + bonus
 *           + (mealPremiumHours + restPremiumHours) × payRate
 *
 * Premiums are folded in to the gross for 1099 because CA §226.7
 * doesn't apply to contractors (§226.7 is a wages-and-hours law for
 * employees). If an entry classifies a contractor with premium hours,
 * that's almost certainly a data issue upstream; the orchestrator's
 * pre-flight should catch it, but the composer is defensive and
 * includes the dollars rather than dropping them.
 */
export function composeContractorPayable(input: ComposeBatchInput): CreatePayableInput {
  const e = input.entry;
  const otHours = (e.totalFlsaOTHours ?? 0) + (e.totalNonFlsaOTHours ?? 0);
  const hourlyPay =
    (nonNegative(e.totalRegularHours) +
      nonNegative(otHours) +
      nonNegative(e.totalDoubleTimeHours)) *
    e.payRate;
  const premiumPay =
    (nonNegative(e.mealBreakPenaltyHours) + nonNegative(e.restBreakPenaltyHours)) * e.payRate;
  const gross = hourlyPay + nonNegative(e.tips) + nonNegative(e.bonusAmount) + premiumPay;

  return {
    externalId: buildPayableExternalId({
      tenantId: e.tenantId,
      assignmentId: e.assignmentId,
      workDate: e.workDate,
      kind: 'CONTRACTOR',
    }),
    externalWorkerId: input.externalWorkerId,
    label: 'Contractor pay',
    type: 'contractor',
    payCode: 'CONTRACTOR',
    timestamp: input.shiftStartEpochSeconds,
    amount: money(gross),
    payableModel: 'PRE_CALCULATED',
    workLocationId: input.evereeWorkLocationId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a single classified-hours segment. Hours come straight from the
 * rules engine; rate is the multiplier-adjusted hourly rate
 * (base × 1.0/1.5/2.0); `grossPayAmount` is rate × hours rounded to
 * 2 decimals.
 */
export function makeSegment(
  startEpochSeconds: number,
  hours: number,
  type: 'REGULAR_TIME' | 'OVERTIME' | 'DOUBLE_TIME',
  hourlyRate: number,
  hoursForGross: number,
): EvereeFullyClassifiedHoursSegment {
  return {
    type,
    startEpochSeconds,
    endEpochSeconds: startEpochSeconds + Math.round(hours * 3600),
    hourlyPayRate: money(hourlyRate),
    grossPayAmount: money(hourlyRate * hoursForGross),
  };
}

/**
 * Construct an `EvereeMoney` from a numeric amount. Two-decimal string;
 * USD only. Negative inputs are clamped to 0 — Everee rejects negative
 * worked-shift / payable amounts at the API layer, and a "minus tips"
 * scenario is genuinely an upstream bug rather than a valid case.
 */
export function money(amount: number): EvereeMoney {
  const safe = Math.max(0, amount);
  return { amount: safe.toFixed(2), currency: 'USD' };
}

function nonNegative(n: number | undefined): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n as number);
}

interface MakePayableArgs {
  kind: 'TIPS' | 'BONUS' | 'MEAL_PREMIUM' | 'REST_PREMIUM';
  earningType: EvereeStandardEarningType;
  amount: number;
  label: string;
}

function makePayableForEntry(
  input: ComposeBatchInput,
  args: MakePayableArgs,
): CreatePayableInput {
  return {
    externalId: buildPayableExternalId({
      tenantId: input.entry.tenantId,
      assignmentId: input.entry.assignmentId,
      workDate: input.entry.workDate,
      kind: args.kind,
    }),
    externalWorkerId: input.externalWorkerId,
    label: args.label,
    type: args.kind.toLowerCase(),
    payCode: args.earningType,
    timestamp: input.shiftStartEpochSeconds,
    amount: money(args.amount),
    payableModel: 'PRE_CALCULATED',
    workLocationId: input.evereeWorkLocationId,
  };
}
