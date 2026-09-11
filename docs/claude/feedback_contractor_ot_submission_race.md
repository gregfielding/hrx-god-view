# Contractor OT paid at flat rate — submission races the weekly reclassification (found 2026-09-10)

**Not the same bug as [[feedback_contractor_ot_flat_rate_bug]]** (fixed
2026-08-26 — `composeContractorPayable` omitting the 1.5x/2.0x multiplier
entirely). That fix is still correctly in place and verified deployed. This
is a different failure mode that produces the identical symptom (a
contractor's OT hours paid at straight time), so don't assume a recurrence
means the 8/26 fix regressed — check the mechanism below first.

## What happened

Rosa (Proof of the Pudding recruiter) reported multiple C1 Events LLC
contractors (Dell Diamond Cooks, JO #84) shorted on overtime for the week
of 2026-08-30–09-05. All 5 workers who crossed 40 hours that week
(Maribel Sanchez, Claudia Martinez, Aitiana Garza, Cinthia Linares, Edna
Picasso) were affected — every one of them, not a one-off.

Confirmed via direct Everee `getPayable` lookup (the list endpoints
— `/api/v2/payments`, `/api/v2/payables` — are unreliable for filtering,
see [[feedback_everee_wire_gotchas]]; always fetch a payable by its exact
`externalId` for ground truth) that the amount Everee actually paid on
each worker's OT day equals `otHours × payRate` (flat), not
`otHours × payRate × 1.5`. Total shortfall: $662.04 across the 5 workers,
corrected via 5 off-cycle `payroll_correction` payables
(`createOffCyclePaymentInternal`) for the missing 0.5x premium only.

## Root cause

`composeContractorPayable` (functions/src/payroll/composeTimesheetBatchPayloads.ts)
reads whatever `totalRegularHours` / `totalFlsaOTHours` split is on the
entry **at the moment it's submitted**. That split isn't computed by the
composer — it's written by a separate Firestore trigger,
`onTimesheetEntryWriteRecomputePayBreakdown`
(functions/src/timesheets/onTimesheetEntryWriteRecomputePayBreakdown.ts),
which queries the worker's **sibling entries for the week** to determine
whether the week's cumulative hours have crossed 40, then rewrites the
regular/OT split accordingly.

If an entry gets approved and submitted to Everee (via
`submitTimesheetEntryWorker`) **before** that trigger's async recompute
has landed — plausible whenever days are approved and pushed
incrementally through the week rather than all at once at week's end —
the composer reads a pre-reclassification entry that still looks like
plain regular hours (because, at that exact moment, the trigger hadn't
yet seen enough of the week to know OT applied) and pays it flat. The
trigger then rewrites the entry's Firestore fields to the correct
classification moments later — so by the time anyone looks at the entry
afterward, it *displays* correctly (`totalFlsaOTHours` populated, status
`paid`), masking that the amount actually sent to Everee doesn't match
what's shown. This is exactly why the discrepancy wasn't obvious from the
HRX UI — only a direct Everee-side payable lookup surfaces it.

## How to apply

- **Diagnosing a "worker says they were shorted OT" report**: don't
  trust the entry's displayed `totalFlsaOTHours`/`totalRegularHours` as
  proof of what was actually paid. Pull the entry's
  `everee.payableExternalIds` and `getPayable` each one directly — compare
  the returned `amount` against `otHours × payRate × 1.5`. If it equals
  the flat-rate number exactly, this is the race, not the 8/26 bug.
- **Not yet fixed at the code level.** The real fix needs one of: (a) the
  submission path awaiting/blocking on the recompute trigger's
  completion before reading the entry, (b) the recompute trigger
  detecting an already-submitted entry and re-submitting a correction
  automatically, or (c) simply not allowing submission of an entry until
  the full week is approved (removes the incremental-approval trigger
  for the race, but changes existing recruiter workflow — needs a
  product call). Flagging for engineering; this doc exists so the next
  report doesn't have to re-derive the mechanism from scratch.
- **Everee payment list endpoints are unreliable for auditing this** —
  `/api/v2/payments` and `/api/v2/payables` list calls silently ignore
  filter params and return an inconsistent arbitrary page each call
  (confirmed empirically 2026-09-10, re-querying the same worker/date
  twice returned different result sets). The only reliable read is a
  direct `getPayable(externalId)` / payment-by-ID fetch using an
  `externalId` you already know (e.g. from
  `entry.everee.payableExternalIds`).
