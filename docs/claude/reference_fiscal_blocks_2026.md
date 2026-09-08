# Fiscal "blocks" — the reporting calendar (Greg, 2026-09-08)

Calendar months split a Sunday–Saturday work week, so a month that starts
or ends mid-week swings labor % wildly (July 2026 read as 98% labor on a
calendar basis, 81% on a block basis). **Blocks are the standard unit for
P&L review.**

## Rule

- A week runs Sunday → Saturday.
- A week belongs to the calendar month that contains its **Wednesday**
  (i.e. the month holding 4+ of its 7 days). Blocks are therefore 4 or 5
  weeks and hug the calendar month.
- Code: `blocksForYear(year)` in `functions/scripts/qboReports.ts`
  (single source; port it into `shared/` if the app needs it).

## 2026 blocks

| Block | Start (Sun) | End (Sat) | Weeks |
|---|---|---|---|
| 1 | 2026-01-04 | 2026-01-31 | 4 |
| 2 | 2026-02-01 | 2026-02-28 | 4 |
| 3 | 2026-03-01 | 2026-03-28 | 4 |
| 4 | 2026-03-29 | 2026-05-02 | 5 |
| 5 | 2026-05-03 | 2026-05-30 | 4 |
| 6 | 2026-05-31 | 2026-06-27 | 4 |
| 7 | 2026-06-28 | 2026-08-01 | 5 |
| 8 | 2026-08-02 | 2026-08-29 | 4 |
| 9 | 2026-08-30 | 2026-10-03 | 5 |
| 10 | 2026-10-04 | 2026-10-31 | 4 |
| 11 | 2026-11-01 | 2026-11-28 | 4 |
| 12 | 2026-11-29 | 2027-01-02 | 5 |

Jan 1–3 2026 fall in block 12 of 2025 under this rule.

## Pulling block P&Ls

- From the laptop (needs QBO tokens): `scripts/qboReports.ts blocks 2026`
  prints every closed/open block with income, 5010 labor, labor %, COGS,
  GM, opex, NOI, net, and the internal payroll lines.
- In the QBO UI there is no API to save a custom report; to have them as
  saved reports, open Reports → Profit and Loss → set the block's dates →
  Save customization as `Block NN 2026`. Twelve saves, once.

## Two views, both exact — how the automated JEs are dated (2026-09-08)

Greg wants BOTH a monthly P&L and a "Block N" P&L. So the automated
month-level entries are posted per **segment = calendar month ∩ block**,
dated the segment's last day (or today while open), tagged
`[revrc:YYYY-MM/B<n>]` / `[wcalloc:YYYY-MM/B<n>]`, DocNumber
`Rev Reclass MMYY B<n>` / `WC Alloc MMYY B<n>`. A month that straddles a
block boundary gets two entries (June 2026: `2026-06/B6` Jun 1–27 and
`2026-06/B7` Jun 28–30). Month totals and block totals both sum from whole
entries. Code: `functions/src/payroll/fiscalBlocks.ts` (`segmentFor`,
`resolvePriors`); writers: revenueAccountReclass.ts, wcAllocations.ts.
Screening JEs were already dated per charge; wire (`EV Alloc`) JEs are
dated per wire. Nothing else is month-lumped.

Migration: the pre-9/8 month-keyed JEs (`[revrc:2026-06]`) are rewritten
in place (lines, date, DocNumber, tag) into the month's first segment
that has data; the remaining segments are created. A tagged JE whose
month no longer has data is reported `stale_prior_delete_manually`.
Runner: `scripts/qboReclassRerun.ts dry|write [reclass|wc|trueup]`.

## Jan–May (Lone Oak / TempWorks era) caveat

5010 direct labor is not reliably booked Jan–May 2026 (block 3 shows $729
of labor against $230K revenue; block 4 catches $281K). Field payroll was
funded by Lone Oak then; the cost lives partly in factoring/clearing
accounts. Blocks 1–5 gross margin is NOT comparable to 6+ until Tabitha
closes the Lone Oak AR reconciliation (docs/claude/project_lone_oak_ar_reconciliation.md).
