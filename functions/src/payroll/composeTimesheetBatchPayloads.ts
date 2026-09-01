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
  /** Untaxed expense reimbursement for the day (e.g. Prairie View A&M
   *  $5/day parking — Greg 2026-08-27; also covers VenueSmart travel
   *  crews' $50/day food per diem). Resolved by the orchestrator
   *  from the assignment's `dailyReimbursement` rule when the entry has
   *  worked hours; excluded from OT and WC premium wages by nature of
   *  the REIMBURSEMENT earning type. */
  reimbursementAmount?: number;
  /** Label for the reimbursement payable ("Parking", "Per diem"). */
  reimbursementLabel?: string;
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
  /** Job-cost attribution tag ("JO#182 FIFA Dallas — Adidas KC").
   *  Prepended to every payable `label` so the money self-describes its
   *  job order + worksite inside Everee (pay stubs, payment lists,
   *  report exports). Optional — labels stay bare without it. */
  labelPrefix?: string;
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
    const payables = [composeContractorPayable(input)];
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
    if ((input.entry.reimbursementAmount ?? 0) > 0) {
      payables.push(
        makePayableForEntry(input, {
          kind: 'REIMBURSEMENT',
          earningType: 'REIMBURSEMENT',
          amount: input.entry.reimbursementAmount as number,
          label: (input.entry.reimbursementLabel ?? '').trim() || 'Reimbursement',
        }),
      );
    }
    return { kind: 'contractor', payables };
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
 *   - Tips          — TIPS earning type
 *   - Bonus         — BONUS earning type
 *   - Reimbursement — REIMBURSEMENT earning type (untaxed per diem —
 *                     e.g. VenueSmart travel crews' $50/day food per
 *                     diem; same non-taxable code the CSV-import path
 *                     uses, see submitImportTimesheetBatch.ts)
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
  if ((input.entry.reimbursementAmount ?? 0) > 0) {
    payables.push(
      makePayableForEntry(input, {
        kind: 'REIMBURSEMENT',
        earningType: 'REIMBURSEMENT',
        amount: input.entry.reimbursementAmount as number,
        label: (input.entry.reimbursementLabel ?? '').trim() || 'Reimbursement',
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
 * 1099 contractor entries route as one payable carrying the hours-based
 * gross. Everee handles 1099 tax mechanics on its side; we just submit
 * the dollar amount we owe.
 *
 *   gross = regularHours × payRate
 *           + (flsaOT + nonFlsaOT) × payRate × 1.5
 *           + DT × payRate × 2.0
 *           + bonus
 *           + (mealPremiumHours + restPremiumHours) × payRate
 *
 * Tips are deliberately NOT folded in here — they ride as their own
 * TIPS-earning-type payable (see `composeBatchEntryPayloads`) so a
 * contractor's Everee payables/pay stub show tips as a distinct line
 * next to the hours-worked pay, the same way W-2 tips already do via
 * `composeW2AdditionalPayables` (Greg 2026-08-18 — Proof of the
 * Pudding / C1 Events LLC tips were invisible, folded into "Contractor
 * pay" with no TIPS line).
 *
 * OT/DT hours get the same 1.5x/2.0x multiplier the W-2 path applies
 * (`composeW2WorkedShift`'s OVERTIME/DOUBLE_TIME segments) — the
 * weekly rules engine flags these hours as OT/DT regardless of 1099
 * vs W-2 classification, and paying them at straight time silently
 * shorted every contractor who crossed the weekly/daily threshold
 * (found via Aitiana Garza, C1 Events LLC, 2026-08-26 — required a
 * manual off-cycle correction; see docs/claude/feedback_contractor_ot_flat_rate_bug.md).
 *
 * Premiums (meal/rest) stay flat-rate and folded in to the gross for
 * 1099 because CA §226.7 doesn't apply to contractors (§226.7 is a
 * wages-and-hours law for employees) — that part was already correct.
 * If an entry classifies a contractor with premium hours, that's
 * almost certainly a data issue upstream; the orchestrator's
 * pre-flight should catch it, but the composer is defensive and
 * includes the dollars rather than dropping them.
 */
export function composeContractorPayable(input: ComposeBatchInput): CreatePayableInput {
  const e = input.entry;
  const regularHours = nonNegative(e.totalRegularHours);
  const otHours = nonNegative((e.totalFlsaOTHours ?? 0) + (e.totalNonFlsaOTHours ?? 0));
  const dtHours = nonNegative(e.totalDoubleTimeHours);
  const totalHours = regularHours + otHours + dtHours;
  const hourlyPay = regularHours * e.payRate + otHours * e.payRate * 1.5 + dtHours * e.payRate * 2.0;
  const premiumPay =
    (nonNegative(e.mealBreakPenaltyHours) + nonNegative(e.restBreakPenaltyHours)) * e.payRate;
  const gross = hourlyPay + nonNegative(e.bonusAmount) + premiumPay;

  // Contractor payables carry no native hours field on Everee's stub (unlike
  // the W-2 worked-shift API, which renders "Wages (N hrs @ $X)" from
  // structured fullyClassifiedHours) — the ENTIRE stub line is whatever we
  // put in `label`, so hours must be embedded here or the worker never sees
  // them. Mirrors the CSV-import path's dayLabel() hours suffix (Greg
  // surfaced this gap for C1 Events LLC / Proof of the Pudding, same client
  // as the tips-splitting fix above).
  const hoursSuffix =
    totalHours > 0 ? ` (${Math.round(totalHours * 100) / 100} hrs @ $${e.payRate.toFixed(2)})` : '';

  return {
    externalId: buildPayableExternalId({
      tenantId: e.tenantId,
      assignmentId: e.assignmentId,
      workDate: e.workDate,
      kind: 'CONTRACTOR',
    }),
    externalWorkerId: input.externalWorkerId,
    label: withLabelPrefix(input.labelPrefix, `Contractor pay${hoursSuffix}`),
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

/** "JO#182 FIFA Dallas — Adidas KC · Tips". Pure passthrough without a
 *  prefix so legacy callers/tests keep bare labels. Capped defensively —
 *  Everee's label length limit is undocumented. */
export function withLabelPrefix(prefix: string | undefined, label: string): string {
  const p = (prefix ?? '').trim();
  if (!p) return label.slice(0, 120);
  const suffix = ` · ${label}`;
  const combined = `${p}${suffix}`;
  if (combined.length <= 120) return combined;
  // Truncate the PREFIX, not the label, when the combined string is too
  // long — the label (e.g. "Contractor pay (6.5 hrs @ $18.00)" or "Tips")
  // is the essential, specific part of the stub line; a long attribution
  // prefix is contextual and safe to trim first. A naive end-slice here
  // was silently dropping the hours suffix for long-prefixed clients
  // (Proof of the Pudding / C1 Events LLC — Greg 2026-08-26).
  const maxPrefixLen = Math.max(0, 120 - suffix.length);
  return `${p.slice(0, maxPrefixLen)}${suffix}`;
}

interface MakePayableArgs {
  kind: 'TIPS' | 'BONUS' | 'MEAL_PREMIUM' | 'REST_PREMIUM' | 'REIMBURSEMENT';
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
    label: withLabelPrefix(input.labelPrefix, args.label),
    type: args.kind.toLowerCase(),
    payCode: args.earningType,
    timestamp: input.shiftStartEpochSeconds,
    amount: money(args.amount),
    payableModel: 'PRE_CALCULATED',
    workLocationId: input.evereeWorkLocationId,
  };
}
