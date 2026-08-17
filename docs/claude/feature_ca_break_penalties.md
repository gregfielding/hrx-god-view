# ca break penalties

> "CA break penalties in timesheet totals — 2026-07-30: REST penalty now DISABLED (always 0); MEAL penalty is duration-only (any >=30-min break clears it, >5h only); existing entries backfilled"

## The recurring "hours don't add up" report = California break penalties

Danny (2026-07-27, WWE Smackdown @ Oakland, Legends Global / C1 Events, draft batch) reported timesheet totals not adding up: 20 workers, totals ~30% high ($3,601 vs $2,773 correct). Root cause is NOT a math bug — the Total legitimately includes CA meal + rest **break-penalty pay** (1 hr each at the regular rate) computed by the pay engine.

**Where it's computed:** `functions/src/timesheets/payRules/rules/ca.ts` — `computeMealBreakPenalty` (1 hr if shift >5h AND no ≥30-min meal break started by the 5th hour) + `computeRestBreakPenalty` (1 hr if earned rest breaks — 1 for ≤6h, 2 for ≤10h — aren't met; a 10–29 min break counts as a rest break). Stored on the entry as `mealBreakPenaltyHours`/`restBreakPenaltyHours`, added in `dollarAmountForRow` (timesheetGridResolver.ts:1068) AND the server/Everee totals (createTimesheetBatch.ts:191, composeTimesheetBatchPayloads, submitTimesheetEntryWorker).

**Why it fired:** the workers took 15-min breaks (on the paper sign-in sheet) but the breaks were NEVER ENTERED into HRX (Break column blank) → engine assumes breaks missed → penalties. Pattern: **+1 hr for shifts ≤5h (rest only), +2 hr for >5h (meal+rest).**

**⚠️ The CA quirk to remember:** a **15-min break clears the REST penalty but NOT the MEAL penalty** — meal needs a recorded **30-min** meal for shifts >5h. So entering the paper's 15-min breaks clears rest penalties but leaves meal penalties on every >5h shift unless a real 30-min meal is recorded. Diagnostic: `Total / payRate` = implied hours; if it exceeds actual hours by ~1–2, it's break penalties.

**⚠️ FIX 2026-07-27 (Danny follow-up, commit ef03586c, deployed onTimesheetEntryWriteRecomputePayBreakdown):** the meal penalty was previously UN-CLEARABLE — `computeMealBreakPenalty` required the break's clock START time to verify it began by the 5th hour, but the break UI is DURATION-ONLY (#47, no start time) so every entered meal was skipped → penalty never cleared ("still paying more even when adding a break"). Now a recorded **≥30-min break with no start time = compliant meal → penalty 0**; breaks that DO carry a start time keep the precise 5th-hour check. So the manual-correction workflow (enter the 30-min meal → meal penalty recomputes to 0) now actually works. 2 regression tests added (caRules.test.ts, 40 passing). NOTE rest penalty unchanged: a 30-min break is NOT a rest break; >6h shifts earn 2 rest breaks, so a lone break may leave a rest penalty — separate policy question if Greg wants it relaxed.

## ⚠️ SUPERSEDED 2026-07-30 — REST penalty OFF + MEAL fully duration-only (commits e3f7eaab, 2b00f4f1; recompute trigger + backfill deployed)

Two changes that override much of the FIX-2026-07-27 note above:

1. **REST penalty is now DISABLED** — `computeRestBreakPenalty` always returns `0` (commit 2b00f4f1). Greg's call: rest breaks are PAID / on-the-clock and HRX doesn't track them, so inferring a *denied* rest break from a missing log fired on essentially every shift and inflated pay (a compliant 4.25h shift was charged +1 hr → $125.69 vs 4.25×$23.94=$101.75). `computeEarnedRestBreaks` retained + exported in `__caInternal` for a future re-enable, but no longer gates pay. So a lone break no longer leaves a rest penalty.

2. **MEAL penalty is now FULLY DURATION-ONLY** — the 5th-hour clock gate was removed (commit e3f7eaab). BreaksCell stamps every grid break at a synthetic noon (`BreaksCell.tsx` validateAll), so the old "keep the precise 5th-hour check when a start time exists" branch was firing on FAKE times and kept the penalty on override rows + early-start shifts even with a real 30-min break. Now: `workedMinutes>5h AND no break >=30min → 1, else 0`. Plus the override bug: `onTimesheetEntryWriteRecomputePayBreakdown.ts` used to strip the breaks array to `[]` for `actualHoursOverride` entries before the engine ran (so a 30-min break could never clear meal on an open-shift/manual-hours row) — breaks now always pass through.

3. **Backfill** (`functions/.scratch/backfill-break-penalties.cjs`): directly patched `mealBreakPenaltyHours` (duration rule) + `restBreakPenaltyHours=0` on 36 NON-TERMINAL entries (status draft/approved, source!=csv_import). 332 already-sent/paid entries deliberately left untouched (already paid at old amount; retroactive claw-back is a separate business call). Direct field write is safe: the recompute trigger's tier-1 guard ignores computed-only writes, and the values match what the deployed engine now computes.

Net current behavior: **MEAL** = 1 hr only when >5h with no recorded >=30-min break; **REST** = never. `Total = hours × rate` unless a genuine meal-penalty hour applies.

## SHIPPED 2026-07-27 — yellow break-cell cue (commit on main, hosting deployed)

`src/components/timesheets/TimesheetGrid.tsx`: the break cell glows **warning.light (yellow)** with a tooltip when a meal/rest penalty is in the total ("+1 hr meal (no 30-min meal recorded) · +1 hr rest … enter the break the worker actually took to clear it"). Reads EFFECTIVE penalty (0 when waived) so a waived row won't glow. Added forward-looking fields to TimesheetEntryV2 (`src/types/recruiter/timesheet.ts`): `mealBreakPenaltyWaived`/`restBreakPenaltyWaived`, `computedMealBreakPenaltyHours`/`computedRestBreakPenaltyHours`, `breakPenaltyWaiveReason`/`WaivedBy`/`WaivedAt`. Greg's call: Danny's team corrects the WWE batch MANUALLY using the cue (enter the real breaks → penalties recompute); it stays in draft, NOT submitted to Everee.

## STILL TO BUILD — per-entry break-penalty WAIVER override (Greg confirmed "build both")

For documented cases where a break was provided but doesn't key in as compliant (CA meal waiver on ≤6h shifts; break offered and declined). Design decided but NOT built: recruiter waives per entry → effective penalty 0 in ALL totals incl. Everee. RECOMMENDED impl = single source of truth via the recompute trigger (`onTimesheetEntryWriteRecomputePayBreakdown.ts`): after the engine computes penalties, write EFFECTIVE (0 if waived) into `mealBreakPenaltyHours`/`restBreakPenaltyHours` + the raw into `computed*` fields — so every existing total consumer stays correct with no per-site changes and no risk of missing the Everee path. Must add the waive fields to WATCHED_FIELDS + the computed* fields to COMPUTED_FIELDS/readBreakdown/breakdownsEqual, and build the target with the waiver applied to avoid a re-write loop. Plus a client waive control (from the yellow cell). Greg also wanted the "break entry" step clearer — the yellow cue largely addresses discoverability; the existing BreaksCell already captures start+duration.
Related: [[reference_everee_environments_and_submit]] [[project_conventions]]
