# 1099 contractor OT/DT paid at flat rate, not 1.5x/2.0x (fixed 2026-08-26)

`composeContractorPayable` (functions/src/payroll/composeTimesheetBatchPayloads.ts)
summed regular + OT + DT hours and multiplied the total by the flat
`payRate` — no overtime premium at all for 1099 contractors. The weekly
rules engine (`payRules/`) correctly flags OT/DT hours regardless of W-2
vs 1099 classification, but that flag was discarded when the contractor
payable was built: a worker who legitimately crossed 40h/week got paid
straight time on every hour past 40, not 1.5x.

**Found via:** Aitiana Garza (C1 Events LLC, 1099 contractor,
`employmentType: "CONTRACTOR"` on Everee). Two confirmed weeks:
- Week of 2026-08-09: 20.33h correctly classified as OT, paid $406.60
  (flat) instead of $609.90 (1.5x). Shortfall $203.30.
- Week of 2026-07-26: 6.08h OT, paid $121.60 instead of $182.40.
  Shortfall $60.80.

Mark caught the discrepancy against Everee's numbers and had already sent
a manual off-cycle correction before the root cause was found.

**Why this matters beyond one worker:** worker classification (W-2 vs
1099) is set per hiring entity, not per person
(`resolveEvereeWorkerTypeForOnCall` — `c1_events_llc` is always
contractor). Every C1 Events LLC contractor who accrues weekly OT hits
this same underpayment. Meal/rest premiums were correctly exempted for
1099 (CA §226.7 doesn't apply to contractors) — only the OT/DT hours
multiplier was missing.

**Fix:** `composeContractorPayable` now computes
`regular×rate + OT×rate×1.5 + DT×rate×2.0` instead of `totalHours×rate`,
matching the multiplier the W-2 path (`composeW2WorkedShift`) already
applied. Deployed via `submitTimesheetEntryWorker` (the only function
that calls this composer — `submitTimesheetBatch`/`submitImportTimesheetBatch`
don't; CSV-import entries are excluded from the weekly OT engine
entirely and keep Everee's own classification).

**How to apply:** if a contractor's HRX-shown pay doesn't match what
Everee actually paid, check whether `totalFlsaOTHours` /
`totalNonFlsaOTHours` / `totalDoubleTimeHours` were non-zero on an
already-`sent_to_everee` entry — before this fix, those hours were
underpaid, not misclassified, so `git log` the entry's `sentAt` against
this fix's deploy date to know if it predates the correction.
