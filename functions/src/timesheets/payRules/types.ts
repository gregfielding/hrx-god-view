/**
 * Pay rules engine — shared types.
 *
 * The rules engine is **pure**: given a week of `DayInput`s and a
 * state code, it produces a `Map<entryId, DayBreakdown>`. No
 * Firestore reads, no side effects, no `Date.now()`, no `Math.random()`.
 * That makes the engine 100% unit-testable and lets us compose it
 * across the recompute trigger, future preview UIs, and any "what-if"
 * tooling we add later.
 *
 * **Why week-scoped, not entry-scoped.** Weekly OT cascades — adding
 * 5 hours to Wednesday can flip Friday from regular to OT once the
 * worker crosses 40h/wk. Single-entry-isolated computation would
 * silently produce wrong numbers in multi-day weeks. The engine
 * always operates on the full week's set of entries, computes day-
 * by-day classification, then folds the cumulative-hours cascade
 * across the whole week. CA's 7th-consecutive-day rule is also
 * cascading and lives in the same fold.
 *
 * @see TS.1 build plan §5 — multistate pay rules
 */

/**
 * Two-letter state code that drives rule dispatch. We keep the
 * `string` fallback so a hiring-entity worksite with an unknown /
 * malformed state code falls through to the DEFAULT rule set
 * gracefully — it should never throw and prevent payroll from
 * computing.
 */
export type StateCode = "CA" | "NY" | "TX" | "MA" | "DEFAULT" | string;

/**
 * One break inside a worked shift. Mirrors `TimesheetBreak` from
 * `src/types/recruiter/timesheet.ts` — duplicated here so the
 * functions package doesn't depend on the React app's type tree.
 *
 * `paid: true` means the break is on the clock and DOES count toward
 * worked hours (rare — typically only for meal periods that the
 * employer voluntarily pays). Most breaks are unpaid.
 */
export interface BreakInput {
  /** HH:mm — start of the break in worksite-local time. */
  startTime: string;
  /** HH:mm — end of the break. */
  endTime: string;
  /** Minutes — pre-computed by the entry writer; the engine trusts it. */
  durationMins: number;
  paid: boolean;
}

/**
 * Per-day input. Built from a `TimesheetEntryV2` doc by the trigger
 * (or the test harness) before invoking the engine.
 *
 * `workedMinutes` is the engine's currency. The trigger computes it
 * once from `actualEndTime - actualStartTime - sumUnpaidBreakMinutes`
 * (with overnight handling) and passes it in — the engine never
 * re-derives from raw HH:mm strings, which keeps the rules simple
 * and the tests obvious.
 *
 * Empty entries (no actuals, no breaks) pass `workedMinutes: 0`. The
 * engine returns all-zero output for those days, which is the steady
 * state for grids that haven't had recruiter input yet.
 */
export interface DayInput {
  /** Doc id of the source `TimesheetEntryV2` — used by the orchestrator
   *  to key the result map. */
  entryId: string;
  /** YYYY-MM-DD in worksite-local time. */
  workDate: string;
  /** Total minutes the worker actually worked, after subtracting
   *  unpaid breaks. 0 when the entry has no actuals. */
  workedMinutes: number;
  /** All breaks recorded on the entry — used by penalty rules
   *  (CA meal/rest). Empty array when the entry has no breaks. */
  breaks: BreakInput[];
  /** Worked-shift start time in HH:mm — used by CA meal-break rules
   *  to determine whether the 5-hour-into-shift threshold was met
   *  before any meal break was taken. `null` for empty entries. */
  actualStartTime: string | null;
  /** Worked-shift end time in HH:mm. `null` for empty entries. */
  actualEndTime: string | null;
}

/**
 * Per-day output. The engine guarantees:
 *   - `regular + ot + dt` exactly equals `workedMinutes / 60` (within
 *     standard floating-point tolerance, ~1e-9).
 *   - `totalOTHours === totalFlsaOTHours + totalNonFlsaOTHours` (within
 *     ~1e-9). The split fields exist so Phase 4 can submit hours
 *     under the right `fullyClassifiedHours.type` enum on Everee's
 *     `/integration/v1/labor/timesheet/worked-shifts`:
 *       - FLSA OT (federal weekly cascade) → `FLSA_QUALIFIED_OVERTIME`
 *       - non-FLSA OT (state-level e.g. CA daily-8 / 7th-day) →
 *         `NON_FLSA_QUALIFIED_OVERTIME`
 *     Without this split, Everee can't compute taxes / reports
 *     correctly. The summed `totalOTHours` field is preserved for
 *     UI consumers (resolver, totals header) so the split is
 *     additive — older code keeps working unchanged.
 *   - Penalties are SEPARATE — they're additional pay obligations
 *     (typically 1 hour of regular-rate pay each), not subtractions
 *     from worked hours.
 *   - All values are non-negative.
 *
 * Numbers are in HOURS (not minutes), to match the
 * `TimesheetEntryV2` schema. The engine's internal math is in minutes;
 * we convert at the boundary.
 */
export interface DayBreakdown {
  totalRegularHours: number;
  /**
   * Sum of `totalFlsaOTHours + totalNonFlsaOTHours`. Kept for
   * backward compatibility with consumers that don't care about the
   * federal/state distinction (UI totals, grid resolver). Phase 4
   * Everee submission reads the split fields directly.
   */
  totalOTHours: number;
  /**
   * OT hours classified by the federal weekly cascade (FLSA §207 —
   * over 40h/wk regular). All states accumulate FLSA OT once the
   * cumulative regular threshold is crossed; in DEFAULT/NY/TX/MA this
   * is the ONLY OT source.
   *
   * Maps to Everee's `FLSA_QUALIFIED_OVERTIME` classification.
   */
  totalFlsaOTHours: number;
  /**
   * OT hours classified by state-specific daily / consecutive-day
   * rules that don't require crossing 40h/wk. CA's daily-8 and
   * 7th-consecutive-day-first-8h rules produce non-FLSA OT.
   * DEFAULT/NY/TX/MA return 0 here today.
   *
   * Maps to Everee's `NON_FLSA_QUALIFIED_OVERTIME` classification.
   */
  totalNonFlsaOTHours: number;
  totalDoubleTimeHours: number;
  /** CA-only today; DEFAULT/NY/TX/MA return 0. */
  mealBreakPenaltyHours: number;
  /** CA-only today; DEFAULT/NY/TX/MA return 0. */
  restBreakPenaltyHours: number;
}

/**
 * Input to the orchestrator. The orchestrator sorts `days` by
 * `workDate` before dispatching, so callers don't have to.
 *
 * `workWeekStartDate` is the YYYY-MM-DD of the first day of the
 * standard 7-day workweek that contains all `days`. For weekly-policy
 * entities this aligns with the pay period; for per_event entities
 * it falls back to the FLSA convention (Sunday-starting workweek)
 * since OT computation is independent of the pay period.
 */
export interface ComputeWeekInput {
  stateCode: StateCode;
  /** Days in the workweek. Order doesn't matter — orchestrator sorts. */
  days: DayInput[];
  /** YYYY-MM-DD of the first day of the standard 7-day workweek. */
  workWeekStartDate: string;
}

/**
 * Output map: `entryId → DayBreakdown`. Same length as `input.days`;
 * every input day produces an entry in the result. Map (not array)
 * so the trigger's write-back loop can do O(1) lookup by entryId
 * without re-aligning.
 */
export type ComputeWeekResult = Map<string, DayBreakdown>;

/**
 * Per-state rule set. Each state's `computeWeekBreakdown` is a pure
 * function from `(days, workWeekStartDate) → Map<entryId,
 * DayBreakdown>`. Implementations live in `rules/*.ts`; the registry
 * in `rules/index.ts` maps state codes to instances.
 */
export interface PayRuleSet {
  /** Two-letter code or 'DEFAULT'. */
  stateCode: StateCode;
  /** Human-readable name for logs / debug. */
  displayName: string;
  /**
   * Compute the entire week's breakdown. Receives `days` already
   * sorted ascending by workDate. Implementations MUST return a
   * result entry for every input day, even days where workedMinutes
   * === 0 (those return all-zero `DayBreakdown`s).
   */
  computeWeekBreakdown(
    days: DayInput[],
    workWeekStartDate: string,
  ): ComputeWeekResult;
}

/**
 * Fixed zero breakdown — returned for empty days, used as a
 * starting point in folds. Frozen so callers can't accidentally
 * mutate a shared instance.
 */
export const EMPTY_BREAKDOWN: Readonly<DayBreakdown> = Object.freeze({
  totalRegularHours: 0,
  totalOTHours: 0,
  totalFlsaOTHours: 0,
  totalNonFlsaOTHours: 0,
  totalDoubleTimeHours: 0,
  mealBreakPenaltyHours: 0,
  restBreakPenaltyHours: 0,
});
