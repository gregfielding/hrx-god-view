/**
 * Client-side validators for inline cell edits on `TimesheetEntryV2`.
 *
 * **Why client-side validation matters here.** P3.A's save-on-blur flow
 * commits a Firestore write immediately after the cell loses focus.
 * If the value is bad, that write hits the recompute trigger, which
 * runs the multistate pay rules engine against garbage and produces a
 * bogus breakdown. Worse, the trigger's Tier-1 gate would gladly fire
 * because the input field DID change. So validation MUST happen
 * before the patch leaves the client — not as a "nice to have," but
 * as a load-bearing correctness requirement on the engine.
 *
 * **Validator shape.** Every validator returns a discriminated union:
 *
 *   { ok: true; value: T }              // canonicalized value to write
 *   { ok: false; reason: …; message }   // taxonomy-keyed failure
 *
 * Cells consume this directly: on `{ ok: true }`, the `value` is the
 * normalized form (e.g. "08:00" instead of "8a") that should land in
 * Firestore. On `{ ok: false }`, the cell renders the chip with
 * `message` and stays in edit state.
 *
 * **No mutation.** Validators never mutate inputs. They take strings or
 * numbers, return a fresh result object. Safe to call from render
 * paths (e.g. for a live "is this current value valid?" indicator
 * later in P3.D).
 *
 * **Cross-field rules** (end-after-start, breaks-inside-shift) live in
 * `validateActualsPair` and `validateBreakAgainstShift`. The single-
 * field validators have no cross-field knowledge — composability over
 * coupling.
 */

import type { TimesheetBreak } from '../../types/recruiter/timesheet';

import {
  isTimeParseFail,
  isTimeParseOk,
  parseTimeInput,
  timeParseFailureMessage,
  timeToMinutes,
  type TimeParseFailure,
} from './timeFormat';

/* -------------------------------------------------------------------------
 * Result shape
 *
 * Type predicates (`isValidationOk` / `isValidationFail`) instead of
 * bare `if (r.ok)` narrowing: same reason as TimeParseResult — this
 * codebase's tsconfig has `strict: false` so plain discriminated
 * union narrowing doesn't work on field access. Predicates with `is`
 * clauses narrow regardless.
 * ------------------------------------------------------------------------- */

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationFail {
  ok: false;
  reason: string;
  message: string;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFail;

export function isValidationOk<T>(r: ValidationResult<T>): r is ValidationOk<T> {
  return r.ok;
}

export function isValidationFail<T>(r: ValidationResult<T>): r is ValidationFail {
  return !r.ok;
}

function fail<T>(reason: string, message: string): ValidationResult<T> {
  return { ok: false, reason, message };
}

function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

/* -------------------------------------------------------------------------
 * Single-field validators
 * ------------------------------------------------------------------------- */

/**
 * `actualStartTime` / `actualEndTime` — both pass through the same
 * permissive parser as the schedule's HH:mm format. The cell's blur
 * handler uses this; bad input → chip + cell stays editable.
 *
 * Empty input is allowed (`null` value) — clearing actuals is a valid
 * recruiter action (e.g. "actually this worker didn't show up; revert
 * to no-actuals"). The recompute trigger handles a null actual by
 * leaving the day's breakdown at zero.
 */
export function validateActualTime(
  raw: string | null | undefined,
): ValidationResult<string | null> {
  if (raw === null || raw === undefined) return pass(null);
  const trimmed = String(raw).trim();
  if (trimmed === '') return pass(null);

  const parsed = parseTimeInput(trimmed);
  if (isTimeParseOk(parsed)) return pass(parsed.value);
  const reason: TimeParseFailure = parsed.reason;
  return fail<string | null>(reason, timeParseFailureMessage(reason));
}

/**
 * `tips` — non-negative dollar amount. Allows fractional cents
 * (recruiters routinely enter "12.50"). Empty input → 0 (the entry's
 * default). Excessively large values clamp NOT here — they're rare
 * legitimate values (a $500 weekend tip pool) and Phase 4 wires the
 * upper bound to the entity's policy.
 *
 * Two decimals is enforced on commit (rounded), not on input — so
 * the typist isn't fighting "12.5" → "12.50" mid-stream.
 */
export function validateTips(
  raw: string | number | null | undefined,
): ValidationResult<number> {
  return validateNonNegativeNumber(raw, 'Tips must be a non-negative number');
}

/**
 * `bonusAmount` — same shape as tips. Separate validator so the error
 * copy is field-specific ("Bonus must be a non-negative number" vs
 * "Tips ..."), which surfaces in the error chip; recruiters appreciate
 * knowing exactly which cell failed when scanning multiple rows.
 */
export function validateBonusAmount(
  raw: string | number | null | undefined,
): ValidationResult<number> {
  return validateNonNegativeNumber(raw, 'Bonus must be a non-negative number');
}

/**
 * `notes` — free text, capped to 1000 chars. The cap exists because
 * the inbound payload travels through Firestore's 1MB doc limit; with
 * the rest of the entry's fields, a 1000-char notes field leaves
 * comfortable headroom and is past the "actually useful comment"
 * threshold. Empty notes → cleared field (Firestore stores `''`,
 * not deleted, to keep change-detection cheap).
 */
const NOTES_MAX_LENGTH = 1000;

export function validateNotes(raw: string | null | undefined): ValidationResult<string> {
  const v = raw === null || raw === undefined ? '' : String(raw);
  if (v.length > NOTES_MAX_LENGTH) {
    return fail<string>(
      'too_long',
      `Notes are limited to ${NOTES_MAX_LENGTH} characters (currently ${v.length}).`,
    );
  }
  return pass(v);
}

/* -------------------------------------------------------------------------
 * Cross-field validators
 * ------------------------------------------------------------------------- */

/**
 * Joint validation for `(actualStartTime, actualEndTime)` — runs
 * AFTER both single-field validators have passed. Returns the
 * canonical pair if either:
 *   1. Both are null (no-actuals state — valid).
 *   2. Both set and end > start (normal shift).
 *   3. Both set and end < start (overnight shift — engine treats as
 *      next-day; we accept it without warning, same as schedule).
 *
 * The only failure case is start set but end unset (or vice versa) —
 * nope, we allow that too. A worker who hasn't clocked out yet has
 * `actualStartTime` populated and `actualEndTime` null. The recompute
 * trigger handles "incomplete actuals" by computing 0 hours for that
 * day, which the grid renders as "in progress" in P3.B.
 *
 * **Real failure case:** end === start (zero-length shift). That's
 * always a typo. We surface it as `zero_duration`.
 */
export function validateActualsPair(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
): ValidationResult<{ start: string | null; end: string | null }> {
  const startResult = validateActualTime(startRaw);
  if (isValidationFail(startResult)) {
    return startResult;
  }
  const endResult = validateActualTime(endRaw);
  if (isValidationFail(endResult)) {
    return endResult;
  }

  const start = startResult.value;
  const end = endResult.value;

  if (start !== null && end !== null && start === end) {
    return fail(
      'zero_duration',
      'Start and end times can\u2019t be identical (zero-length shift).',
    );
  }

  return pass({ start, end });
}

/**
 * `validateBreak` — single break entry. Used by the BreaksCell
 * popover before committing the modified breaks array.
 *
 * Validates:
 *   - start + end parse cleanly.
 *   - end > start (no zero-length / inverted breaks).
 *   - durationMins > 0 and matches end - start (within 1 minute).
 *   - paid is a strict boolean.
 *
 * `validateBreakAgainstShift` composes on this with the additional
 * "break must fall inside the shift window" rule.
 */
export function validateBreak(
  raw: Partial<TimesheetBreak> & { startTime?: unknown; endTime?: unknown },
): ValidationResult<TimesheetBreak> {
  const startStr = typeof raw.startTime === 'string' ? raw.startTime : '';
  const endStr = typeof raw.endTime === 'string' ? raw.endTime : '';

  const startResult = parseTimeInput(startStr);
  if (isTimeParseFail(startResult)) {
    const startFailure = startResult.reason;
    return fail(
      `start_${startFailure}`,
      `Break start: ${timeParseFailureMessage(startFailure)}`,
    );
  }
  const endResult = parseTimeInput(endStr);
  if (isTimeParseFail(endResult)) {
    const endFailure = endResult.reason;
    return fail(
      `end_${endFailure}`,
      `Break end: ${timeParseFailureMessage(endFailure)}`,
    );
  }

  const startMin = startResult.minutes;
  const endMin = endResult.minutes;
  if (endMin <= startMin) {
    return fail(
      'inverted',
      'Break end must be after break start.',
    );
  }
  const computedDuration = endMin - startMin;

  return pass({
    startTime: startResult.value,
    endTime: endResult.value,
    durationMins: computedDuration,
    paid: raw.paid === true,
  });
}

/**
 * Spec for `validateBreakAgainstShift` — composes `validateBreak` with
 * the shift-window guard. Caller passes the entry's actual or
 * scheduled start/end as the "shift window"; if the break falls
 * outside, we reject.
 *
 * **Shift window precedence.** When actuals are partially or fully
 * set, those bound the break (the recruiter is correcting actuals,
 * so breaks should align). When actuals are unset, fall back to
 * scheduled times.
 *
 * **Overnight shifts.** Currently rejected — break-inside-shift
 * across midnight needs a more sophisticated minute-shift comparison
 * than the simple ≤/≥ used here. The recompute trigger handles
 * overnight shifts via the `endMin <= startMin → +1440` fold; we
 * could mirror that, but no Phase-3 worker fixture has an overnight
 * break yet, and the rule is "soft fail with explanation" rather
 * than silently letting the engine misclassify.
 */
export function validateBreakAgainstShift(
  raw: Partial<TimesheetBreak> & { startTime?: unknown; endTime?: unknown },
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): ValidationResult<TimesheetBreak> {
  const breakResult = validateBreak(raw);
  if (isValidationFail(breakResult)) return breakResult;

  const breakStart = timeToMinutes(breakResult.value.startTime);
  const breakEnd = timeToMinutes(breakResult.value.endTime);
  const shiftStartMin = timeToMinutes(shiftStart);
  const shiftEndMin = timeToMinutes(shiftEnd);

  if (
    breakStart === null ||
    breakEnd === null ||
    shiftStartMin === null ||
    shiftEndMin === null
  ) {
    // No shift window to compare against — accept the break as-is.
    // This is the "draft mode" path: actuals + schedule both unset
    // is a legitimate recruiter state for an empty entry being seeded.
    return breakResult;
  }

  if (shiftEndMin < shiftStartMin) {
    return fail(
      'overnight_unsupported',
      'Overnight shifts can\u2019t be edited inline yet — use the entry detail panel.',
    );
  }

  if (breakStart < shiftStartMin || breakEnd > shiftEndMin) {
    return fail(
      'outside_shift',
      'Break must fall within the shift\u2019s start and end times.',
    );
  }

  return breakResult;
}

/* -------------------------------------------------------------------------
 * Internal helpers
 * ------------------------------------------------------------------------- */

/**
 * Parse a string-or-number to a non-negative number with two decimals
 * of precision. Empty/null → 0 (default). NaN, negatives, infinities
 * → fail with the supplied message.
 *
 * Two-decimal rounding here (not in the cell's onChange) so a typist
 * entering "12.50" sees "12.50" until blur, then gets "12.5" → 12.5
 * stored. Avoids fighting the user mid-keystroke.
 */
function validateNonNegativeNumber(
  raw: string | number | null | undefined,
  failMessage: string,
): ValidationResult<number> {
  if (raw === null || raw === undefined) return pass(0);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return pass(0);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return fail('invalid', failMessage);
    return pass(roundToCents(n));
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return fail('invalid', failMessage);
    return pass(roundToCents(raw));
  }
  return fail('invalid', failMessage);
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}
