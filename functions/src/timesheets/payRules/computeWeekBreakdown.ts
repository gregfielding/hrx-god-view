/**
 * Pay rules engine — top-level orchestrator.
 *
 * `computeWeekBreakdown` is the single entry point external callers
 * (the recompute trigger, future preview UIs, ad-hoc what-if tools)
 * use to compute pay classification for a week's worth of timesheet
 * entries. It:
 *
 *   1. Resolves the state code to a `PayRuleSet` (with DEFAULT
 *      fallback so bad input never throws).
 *   2. Sorts the input days by `workDate` ascending — rules can
 *      assume sorted order.
 *   3. Dispatches to the rule set's `computeWeekBreakdown`.
 *   4. Returns a `Map<entryId, DayBreakdown>` covering EVERY input
 *      day (including days with `workedMinutes === 0`, which return
 *      all-zero `DayBreakdown`s).
 *
 * **Why this is the public API.** External callers should never
 * instantiate a `PayRuleSet` directly — that bypasses the registry's
 * fallback semantics and the input sorting contract. Always go
 * through `computeWeekBreakdown`.
 */

import {ComputeWeekInput, ComputeWeekResult, EMPTY_BREAKDOWN} from "./types";
import {getPayRuleSetForState} from "./rules";

/**
 * Compute a week of pay breakdown. Pure function: same input always
 * produces same output. Safe to call from triggers, callables, tests,
 * and any other context.
 *
 * Edge cases:
 *   - `days` empty → returns empty `Map`. Caller decides whether
 *     that's an error or a no-op.
 *   - Duplicate `entryId`s in `days` → later occurrence wins in the
 *     result map. The trigger should de-dupe upstream; we don't
 *     throw because the engine has no good way to surface a useful
 *     error and silent-deterministic-overwrite is at least
 *     reproducible.
 *   - All days `workedMinutes === 0` → returns a map with one entry
 *     per input day, each pointing at a clone of `EMPTY_BREAKDOWN`.
 */
export function computeWeekBreakdown(
  input: ComputeWeekInput,
): ComputeWeekResult {
  const ruleSet = getPayRuleSetForState(input.stateCode);

  if (!input.days || input.days.length === 0) {
    return new Map();
  }

  // Sort by workDate ASC — rules can assume order. Clone first so
  // we don't mutate the caller's array.
  const sorted = [...input.days].sort((a, b) =>
    a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0,
  );

  const result = ruleSet.computeWeekBreakdown(sorted, input.workWeekStartDate);

  // Defensive: ensure every input day has a result entry. Rule sets
  // are expected to do this themselves but if a future rule set
  // forgets a day (e.g., due to a bug), fill in EMPTY_BREAKDOWN
  // rather than letting downstream callers see an undefined.
  for (const day of input.days) {
    if (!result.has(day.entryId)) {
      result.set(day.entryId, {...EMPTY_BREAKDOWN});
    }
  }

  return result;
}

/** Re-exports for convenience — most callers can `import { ...
 *  } from 'payRules/computeWeekBreakdown'` and have everything they
 *  need in one place. */
export {
  ComputeWeekInput,
  ComputeWeekResult,
  DayBreakdown,
  DayInput,
  PayRuleSet,
  StateCode,
} from "./types";
export {getPayRuleSetForState, listPayRuleSets} from "./rules";
