/**
 * Time-of-day parsing + formatting for the recruiter timesheet grid.
 *
 * **Why a custom parser instead of `<input type="time">`.**
 *   1. OS chrome diverges — Safari/macOS shows a different stepper than
 *      Chrome/Win, breaks the spreadsheet feel of the grid.
 *   2. We want shorthand ("8", "8a", "8:30p", "0830") to commit cleanly.
 *      Native time input rejects all of those.
 *   3. We need a deterministic round-trip with our wire format
 *      `HH:mm` (24h, zero-padded) — same shape used by `weeklySchedule`,
 *      `scheduledStartTime`/`scheduledEndTime`, and the pay rules engine.
 *      Any time value entering Firestore through the inline editor MUST
 *      match this shape so the recompute trigger sees a clean input.
 *
 * **Scope.** This module is the canonical client-side time I/O for
 * the recruiter grid (P3.A onward). Validators in `entryValidation.ts`
 * compose on top of `parseTimeInput`/`formatTime24` to surface errors
 * to the cell chrome before any Firestore write fires.
 *
 * **Local time only.** Worksite-local — same convention as `dateRange.ts`
 * and the rest of the timesheet stack. We never see a TZ here; the
 * recompute trigger interprets `actualStartTime`/`actualEndTime`
 * relative to the entry's `workDate` (also local).
 */

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Result of `parseTimeInput`. A discriminated union so callers can
 * pattern-match cleanly without nested ternaries:
 *
 *   const r = parseTimeInput(raw);
 *   if (isTimeParseOk(r)) writeFirestore(r.value);
 *   else showInlineError(r.reason);
 *
 * **Why type predicates instead of bare `if (r.ok)`.** This codebase's
 * tsconfig has `strict: false` which, by extension, disables
 * `strictNullChecks` — and without `strictNullChecks`, TypeScript
 * does NOT narrow plain discriminated unions on field access. Type
 * predicates with `is` clauses narrow regardless of strict-mode
 * settings, so we use those.
 */
export interface TimeParseOk {
  ok: true;
  value: string;
  minutes: number;
}

export interface TimeParseFail {
  ok: false;
  reason: TimeParseFailure;
}

export type TimeParseResult = TimeParseOk | TimeParseFail;

export function isTimeParseOk(r: TimeParseResult): r is TimeParseOk {
  return r.ok;
}

export function isTimeParseFail(r: TimeParseResult): r is TimeParseFail {
  return !r.ok;
}

/**
 * Failure taxonomy for `parseTimeInput`. Each case maps to a specific
 * inline error chip message — the cell chrome never has to invent
 * its own copy.
 */
export type TimeParseFailure =
  | 'empty'
  | 'malformed'
  | 'hours_out_of_range'
  | 'minutes_out_of_range';

const TIME_PARSE_FAILURE_MESSAGES: Record<TimeParseFailure, string> = {
  empty: 'Enter a time (e.g. 08:00 or 8a)',
  malformed: 'Use HH:mm or shorthand like 8a, 8:30p',
  hours_out_of_range: 'Hour must be between 0 and 23',
  minutes_out_of_range: 'Minutes must be between 0 and 59',
};

/* -------------------------------------------------------------------------
 * Parsing
 * ------------------------------------------------------------------------- */

/**
 * Permissive time-of-day parser. Accepts:
 *
 *   "8"         → 08:00      (assume top of hour)
 *   "08"        → 08:00
 *   "830"       → 08:30      (3-digit shorthand)
 *   "0830"      → 08:30      (4-digit shorthand)
 *   "8:00"      → 08:00
 *   "08:00"     → 08:00
 *   "8:30"      → 08:30
 *   "8a"        → 08:00      (am/pm meridiem)
 *   "8 am"      → 08:00
 *   "8:30 PM"   → 20:30
 *   "12a"       → 00:00      (midnight)
 *   "12p"       → 12:00      (noon)
 *
 * **Rejects** (returns `{ ok: false, ... }`):
 *   - Empty strings.
 *   - Words ("morning"), letters mixed mid-number ("8a3").
 *   - Negatives ("-8:00").
 *   - 24+ on the hour position WITHOUT a meridiem (24:00 → out of range;
 *     the engine treats end_minutes < start_minutes as overnight, but the
 *     wire format itself never carries 24+).
 *   - 60+ minutes.
 *
 * **Trim-tolerant.** Surrounding whitespace is stripped. Internal
 * whitespace between digits and meridiem is allowed but a single space
 * — "8 30" without a colon is rejected (ambiguous with "830").
 */
export function parseTimeInput(raw: string | null | undefined): TimeParseResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'empty' };
  const s = String(raw).trim();
  if (s.length === 0) return { ok: false, reason: 'empty' };

  // Split off optional meridiem suffix. Case-insensitive; allows "a",
  // "p", "am", "pm" with optional space before. Anything else after the
  // numeric block is malformed.
  const meridiemMatch = /(.*?)\s*(am|pm|a|p)\s*$/i.exec(s);
  const meridiem = meridiemMatch
    ? meridiemMatch[2].toLowerCase().startsWith('p')
      ? 'pm'
      : 'am'
    : null;
  const numericPart = (meridiemMatch ? meridiemMatch[1] : s).trim();

  let h: number;
  let m: number;

  // Branch 1: explicit colon form (preferred).
  const colonMatch = /^(\d{1,2}):(\d{2})$/.exec(numericPart);
  if (colonMatch) {
    h = parseInt(colonMatch[1], 10);
    m = parseInt(colonMatch[2], 10);
  } else if (/^\d+$/.test(numericPart)) {
    // Branch 2: digit-only shorthand. Length disambiguates:
    //   1-2 digits → hours only
    //   3 digits   → H + MM   (e.g. "830" → 8:30)
    //   4 digits   → HH + MM  (e.g. "0830" → 08:30; "1230" → 12:30)
    //   5+ digits  → malformed
    if (numericPart.length <= 2) {
      h = parseInt(numericPart, 10);
      m = 0;
    } else if (numericPart.length === 3) {
      h = parseInt(numericPart[0], 10);
      m = parseInt(numericPart.slice(1), 10);
    } else if (numericPart.length === 4) {
      h = parseInt(numericPart.slice(0, 2), 10);
      m = parseInt(numericPart.slice(2), 10);
    } else {
      return { ok: false, reason: 'malformed' };
    }
  } else {
    return { ok: false, reason: 'malformed' };
  }

  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return { ok: false, reason: 'malformed' };
  }

  // Apply meridiem AFTER digit parsing so "12am" maps to 0 and "12pm"
  // stays at 12 — the standard 12-hour clock convention.
  if (meridiem !== null) {
    if (h < 1 || h > 12) return { ok: false, reason: 'hours_out_of_range' };
    if (meridiem === 'am') {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
  }

  if (h < 0 || h > 23) return { ok: false, reason: 'hours_out_of_range' };
  if (m < 0 || m > 59) return { ok: false, reason: 'minutes_out_of_range' };

  return {
    ok: true,
    value: formatTime24(h, m),
    minutes: h * 60 + m,
  };
}

/* -------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */

/** Zero-pads to width 2. Faster than `String#padStart` in tight loops
 *  and avoids one extra function call per render. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Wire-format `HH:mm` (24h, zero-padded). The single source of truth
 * for what gets written to Firestore.
 *
 * Inputs are clamped, NOT rejected — we only call this from validated
 * paths (after `parseTimeInput`) or from already-canonical sources.
 * Defensive clamping rather than throwing keeps render paths from
 * crashing on a transient bad value during type-as-you-go.
 */
export function formatTime24(hours: number, minutes: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(hours)));
  const m = Math.max(0, Math.min(59, Math.floor(minutes)));
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * Display formatter for the cell's view mode. Returns `HH:mm` (the
 * same wire shape) — no am/pm conversion at the cell level. Reasons:
 *   1. Recruiters compare scheduled vs actual visually; mixing
 *      formats forces them to mentally re-parse.
 *   2. Avoids "8:00 PM" wrapping into a second line in tight columns.
 *   3. The recruiter mental model is shift-times, where 24h is
 *      idiomatic — same convention as the existing scheduled
 *      "08:00–17:00" rendering.
 *
 * Returns the em-dash when the value is null/undefined (matches the
 * empty-state pattern used by `TimesheetGridRowView`).
 */
export function formatTimeForDisplay(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const v = value.trim();
  if (v === '') return '—';
  // Re-parse to normalize ("8:00" → "08:00") so the display column
  // doesn't get misaligned by 1-digit hour values stored from older
  // paths. Best-effort: if the value can't parse, show as-is.
  const parsed = parseTimeInput(v);
  return isTimeParseOk(parsed) ? parsed.value : v;
}

/**
 * Convert `HH:mm` to minutes-since-midnight. Returns `null` on
 * malformed input — never throws, since this runs in render paths
 * where a stale Firestore value shouldn't blank the row.
 */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseTimeInput(value);
  return isTimeParseOk(parsed) ? parsed.minutes : null;
}

/**
 * Inverse of `timeToMinutes`. Used by the breaks editor for clamping
 * a derived end time back into displayable form.
 */
export function minutesToTime(minutes: number): string {
  const safe = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return formatTime24(Math.floor(safe / 60), safe % 60);
}

/* -------------------------------------------------------------------------
 * Error message helper
 * ------------------------------------------------------------------------- */

export function timeParseFailureMessage(reason: TimeParseFailure): string {
  return TIME_PARSE_FAILURE_MESSAGES[reason];
}
