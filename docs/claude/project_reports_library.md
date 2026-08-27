---
name: project-reports-library
description: The /reports library — registry architecture, what exists, and the researched roadmap of reports the payroll/finance/compliance teams need
metadata:
  type: project
---

# Reports library (/reports)

Greg's directive (2026-08-19): centralize ALL reports on one index page.
`/reports` is the library; each report lives at `/reports/<slug>`.

## Architecture

- **Registry**: `src/pages/reports/reportsRegistry.tsx` — one `ReportDef`
  per report (slug, title, description, category, minLevel, icon). The
  index (`ReportsIndexPage.tsx`) renders from it, grouped by category,
  hiding reports above the viewer's security level.
- **Adding a report** = one registry entry + one `<Route>` in `App.tsx`
  (guarded to the same level as the registry's `minLevel` — and match
  the server callable's own gate, e.g. `getQboDashboard` is level 7 in
  `qboInvoicing.ts`).
- Legacy `/payroll-costs` → `/reports/payroll` redirect.
- `PayrollCostsPage` takes a `report` prop (`'payroll' | 'workers-comp'`)
  — set: single-report layout with back link; unset: legacy tab strip
  (no route uses unset anymore).

## Live reports (2026-08-19)

| slug | Report | Level | Data source |
|---|---|---|---|
| payroll | Payroll Cost Report | 6 | getPayrollCostReport (timesheet_entries → Everee) |
| workers-comp | Workers' Comp Wage Report | 6 | same callable, WC class-code grouping |
| gross-margin | Gross Margin | 7 | getPayrollCostReport + includeBilling:true (live QBO invoices) — PAUSED for later adjustments (Greg 2026-08-19) |
| job-costing | Job Costing | 7 | same callable + includeExpenses:true — per-JO P&L: billing + payroll + burden + QBO Purchase expenses (Everee-vendor wires EXCLUDED to avoid payroll double-count); entity→client→JO cascade; range cap now 366 days |
| payroll-register | Payroll Register | 6 | same callable + includeEvereeRegister:true — live Everee /api/v2/payments (page/size paging + id dedupe), gross/net/funding per payment, pay-run rollup, per-companyFundingId wire register (each wire = one bank ACH pull); name fill users → everee_workers reverse linkage; covers roadmap #5+#6 |
| accounts-receivable | A/R Aging | 7 | getQboDashboard (QBO AgedReceivables cache) |

**Conventions (Greg 2026-08-19):** every report that can be entity-scoped
gets a "Hiring entity" filter at the top (results below narrow to it).

**Gross-margin mechanics:** bill side = live QBO invoice query (the
per-account caches store headers only — no Line/ClassRef); per-class
dollars come from pre-tax line amounts, per-customer from header totals.
Class↔JO matching: exact (Account:Name) → fuzzy (substring ≥5 chars OR
token-subset either way, MN/KC abbreviation expansion), with
SPACE-INSENSITIVE account-prefix compatibility ("Venue Smart" class
prefix vs "Venuesmart LLC National") so same-named JOs under different
clients can't cross-match; bare account-named classes stay billed-only.
Under an entity filter, unmatched billed-only classes and pay-less
customers are EXCLUDED (invoices carry no HRX entity — showing them
would leak the other entity's billing). Burden is a client-side
adjustable % of pay (default 12). ☠️ Month-boundary: billed uses invoice
TxnDate, pay uses workDate — big events (Lollapalooza) often invoice the
month after the work, so single-month job rows can look wildly negative.

## Researched roadmap (2026-08-19 platform survey)

Survey of ADP WFN standard reports, Bullhorn (+Middle Office), TempWorks,
Avionté, Gusto, Paychex, Everee. Key structural insight: payroll
platforms own registers/tax/compliance reports; staffing platforms
(Bullhorn/TempWorks/Avionté) differentiate on **pay-vs-bill** reports
(gross margin, unbilled, cash requirements). HRX sits across Everee AND
QuickBooks, so the pay-vs-bill and cash-gap reports are simultaneously
the industry's most-demanded and the ones only HRX can produce for C1.

Priority list (⭐ = top-12 pick; "direct" = data already in HRX):

1. ⭐ **Gross Margin by Client/Venue/JO** — ✅ SHIPPED 2026-08-19 as
   /reports/gross-margin (see mechanics above).
2. ⭐ **Unbilled Revenue / WIP** — approved `timesheet_entries` hours not
   yet on a QBO invoice. Leakage detector. Direct.
3. ⭐ **Payroll-Paid vs Invoiced (cash-flow gap)** — per client: paid to
   workers vs invoiced vs collected. The staffing "payroll funding gap".
   Direct; unique to HRX's dual position.
4. ⭐ **Cash Requirements Forecast** — next payroll's cash need from
   pending/approved entries × rates + employer burden. (Avionté
   "essential back-office" report.)
5. ⭐ **Payroll Register** — unified W-2 + 1099 per pay period (gross/
   taxes/net/employer taxes). Audit foundation. Everee payments API.
6. ⭐ **Payment/Wire Register** — formalize the July wire-reconciliation
   work (fundingList groups, payroll_class_overrides) as a standing
   report.
7. ⭐ **Payroll Journal by QBO Class** — self-serve version of the
   bookkeeper class-split report; future: auto-write into QBO.
8. ⭐ **A/R Aging + DSO by client** — extend live report with DSO calc +
   trend (staffing DSO benchmark ~47+ days).
9. ⭐ **WC Premium Audit Package** — policy-period extension of the WC
   report: OT breakout, excluded pay (per-diem/reimbursements — e.g.
   VenueSmart $50/day untaxed per diem), supporting 941s.
10. ⭐ **I-9/Onboarding Completion Status** — WorkBright data; staffing's
    #1 audit exposure. NOTE: HRX E-Verify processing disabled since
    2026-06-30 (see project_everify_disabled.md); report should show I-9
    completion regardless and add E-Verify state when available.
11. ⭐ **ACA Hours/Eligibility Lookback** — variable-hour W-2 event staff
    are exactly the ACA lookback population; hours in timesheet_entries.
12. ⭐ **Employer Tax Liability Summary** / **PTO-Sick Accrual Liability
    by state** — verification/liability views over Everee-held data.

Second tier (common in platforms, situational for C1): labor cost
distribution (≈ existing payroll report), contractor 1099 YTD, invoice
register/short-pays, revenue by class, client concentration, fill rate,
missing/unapproved time exceptions, OT + approaching-OT, redeployment %,
turnover, OSHA 300/300A/301 (needs incident capture), CA meal/rest
premium report (HRX already computes premiums — reporting is nearly
free), EEO-1 (needs demographic capture), new-hire reporting
verification. Skip unless circumstances change: certified payroll
WH-347 (only for prevailing-wage work), minor work permits, NY
spread-of-hours.

**payroll-journal (live 2026-08-19):** same callable + includeWireJournal
— the wire-recon engine ported server-side (overrides → JO# tags → entry
index → venue tokens → period fallback; largest-remainder rounding;
funding-date range = bank view). Verified vs July: 31 wires, $450,087.80,
100% attributed, every wire's splits sum exact. QBO Class list resolves
names to FQN with a NOT-IN-QBO flag — the auto-write step only needs a
Purchase-update writer on top of these splits. Payroll roadmap #5/#6/#7
ALL SHIPPED.

## 2026-08-19 PM wave — all shipped

| slug | Report | Level | Notes |
|---|---|---|---|
| wc-audit | WC Premium Audit | 6 | getWorkersCompMonthlyReport range mode (startDate/endDate ≤400d) + OT-excess (0.5x/1.0x premium portions), tips, reimbursements breakouts → auditable payroll + premium; by-month rollup; audit-package CSV |
| (A/R upgrade) | DSO + payment speed | 7 | getQboDashboard includeDso — DSO = openAR/billed91×91 (family rollup), avg days-to-pay recent-vs-prior 91d halves = trend without snapshots |
| i9-status | I-9 / Onboarding Status | 6 | includeI9Status — everee_workers mirror (i9SignedAt/employerI9SignedAt/documentsVerifiedByCompany/hasWorkbrightDocs); contractors excluded; E-Verify note |
| aca-lookback | ACA Hours Lookback | 6 | includeAcaLookback — W-2 hours/worker/month, 130h FT equivalency, contractor entities excluded |
| tax-liability | Tax & Sick-Leave Liability | 6 | tax view = register client-side (withheld = gross−net, employer = funding−gross by month); includeSickLeave = hours by state ×1/30 accrual basis |
| qbo-classes | QBO Classes & Mapping | 7 | includeClassCatalog + savePayrollVenueMapping branches (below) |

## qbo_class_mappings — the class↔HRX loop-closer

`tenants/{t}/qbo_class_mappings/{classId}`: {classId, className, fqn,
jobOrderId, jobOrderName, accountId, accountName, source manual|auto}.
Written from /reports/qbo-classes; consulted as PASS 0 by the
gross-margin/job-costing matcher (mapped classes never fuzzy-match).
**Write API** (rides savePayrollVenueMapping, level 7):
- `{action:'mapQboClass', classId, className, fqn?, jobOrderId?|accountId?, remove?}`
- `{action:'createQboClass', name, parentClassId?}` → creates the Class
  IN QBO (qboEntityCreate) and returns {classId, fqn}.
☠️ These are the branches Mark's email-driven VenueSmart class automation
should call — create the class, then map it to the JO it creates.

**Auto-create design (agreed direction, not yet wired):** on job-order
creation (FG orchestrator + manual JO create), auto-create QBO class
`{parent=account class}:{joName}` if no mapping exists, write the
mapping doc with source:'auto'. Idempotent via qbo_class_mappings check.
First run of /reports/qbo-classes showed: 56 classes, 0 mapped, 45
unmapped-with-activity — "National" carries $789k YTD expenses (the
default class Expensify spend lands on when unclassed).

**cash-flow (live 2026-08-19):** /reports/cash-flow (Forecast &
budgeting, L7) — includeCashFlow on getPayrollCostReport. Cash
requirements = draft/approved entries not yet sent (work dates
today−45→+7, contractor-flat math) per entity; cash-flow gap by client =
gmByAccount pay/billed + QBO Payments in range rolled to accounts via
the billing customer map (BillingAggregates now returns
acctByCustomerId). Client float = pay×(1+burden) − collected. Note:
clients whose QBO customer isn't mapped to their HRX account(s) (e.g.
CORT per-warehouse accounts) show pay-only float until mapped — the
"(payments from unmapped customers)" row catches the collections side.
Unbilled/WIP report = HELD by Greg for now.

**Auto-create classes: ON HOLD (Greg 2026-08-19)** — do NOT wire the
JO-creation hook yet. Greg + Mark will define per-client/job-order/
worksite rules and exceptions first. The building blocks are live and
waiting (createQboClass/mapQboClass branches on savePayrollVenueMapping).

## FIN-1 — weekly finance rollups (SHIPPED 2026-08-25, Greg's forecasting keystone)

- `tenants/{t}/finance_week_rollups/{week__entity__account__jo}` — nightly
  server-built aggregates (functions/src/payroll/financeWeekRollups.ts):
  hours, payGross (cost-report math, same status filter so numbers tie),
  billGross = hours × the entry `billRate` snapshot (ACCRUAL revenue — the
  field every entry carried and nothing ever read), marginGross,
  billMissingPayGross/-Entries (honest coverage), tips/bonus/premiums,
  distinct workers, denormalized account/JO names. Account resolves
  entry.accountId → jo.recruiterAccountId (import rows carry empty
  accountId). Delete-then-write per week range = idempotent rebuilds.
- Host: reconcileTimesheetBatchesCron (15-min finance cron) behind a
  once-per-day `function_runs/financeWeekRollups_{day}` claim; trailing
  6-week rebuild catches late edits/status flips. Backfilled 2026-06→now
  (199 docs, ~8k entries).
- Consumer: /reports/weekly-trends ('weekly-trends', Forecast & budgeting,
  level 6) — per-week bill/pay/margin/hours + per-account window totals +
  the coverage banner. Rules: finance_week_rollups read = books band ≥6.
- ☠️ First live insight: bill-rate coverage is only ~45% of pay gross —
  CSV-import entries mostly have NO billRate snapshot (VenueSmart shows a
  phantom -$489k margin). Before trusting accrual revenue for forecasting,
  backfill entry billRate from account pricing (AccountPositionPricing
  markup/billRate chain) — needs Greg's go, it's a historical-entry
  migration. Recent placement-flow weeks are well covered (8/10 week: 20%
  margin, $3.8k uncovered).
- Next: FIN-2 wire Everee burden endpoint (/integration/v1/expenses/
  by-date-range) into the rollups per entity-week → replaces the 12%
  slider with actuals.

## Data Health — the reconciliation spine (SHIPPED 2026-08-26, Greg's "most upstream place")

- /reports/data-health ('data-health', Payroll category, level 7) —
  buildDataHealthReport (functions/src/payroll/dataHealthReport.ts) via
  getPayrollCostReport({dataHealth:true}). Per month × entity:
  Everee-settled gross (reuses buildEvereeRegister — now exported — the
  wire-recon truth built for the bookkeeper) vs HRX entry gross, off-cycle
  itemized, UNEXPLAINED residual = money Everee settled with no entry
  behind it; then gross-weighted %-of-dollars coverage for assignment /
  JO / account / billRate / workState / wcCode / wcRate.
- Month buckets: register by periodEnd, entries by workDate — boundary
  bleed shows as paired ± residuals (July Events +$20k vs Select −$13.8k).
- First run findings (Jun→Aug 26): **June unexplained $163.7k** (the
  pre-tagging hole — real missing entries, mostly Events), July nets
  ±$6.4k (clean), August MTD $115k (import lag, expect to shrink as CSVs
  land). Coverage post-backfills is 93-100% nearly everywhere; residual
  queues: June Events wcCode 66.8%, June Select assignment 19.5% (small $),
  Aug Select wcCode 59.1%, "Maryland Warehouse" csv rows with no
  assignment.
- Doctrine: fix upstream queues here (materialize assignments — never
  read-time patches), and every downstream report corrects itself.
- **2026-08-26 drain: unassigned paid payroll = $0.** The whole
  no-assignment queue (~$66k) was materialized in one day: Select $21.5k
  (Maryland/Hanover 2-JO CORT pair, Woodbridge, PA Convention Center,
  Chicago ORS Nasco, NorCal + Colorado Domino's, Gaylord) and Events
  $44.9k (FIFA Dallas/NY/KC, MN Yacht Club, COTA, Electric Forest, Obama
  Library). Conventions that worked: follow the jobOrderId ALREADY STAMPED
  on each row (site→JO ambiguity resolves itself — every site's rows
  pointed at exactly one JO); stamp ONLY missing fields on settled rows
  (assignmentId/account — never money fields); assignment id =
  `<openShiftId|jo_<joId>>__<uid>`, retro flags per
  feedback_assignment_point_of_truth.md. **New defect class found:
  DANGLING assignmentIds** — paid rows stamped with assignment ids that
  were never created (7 rows/$1.2k); data-health counts them uncovered
  because it resolves the DOC, not the field — fix by creating the doc AT
  the referenced id (or repointing to the worker's real assignment and
  widening its date window). Per-show COTA JOs (#462-464 Toto/Simple
  Plan/Kesha) follow the VenueSmart family convention (Janitors and
  Cleaners, 16/20, WC 9014@1.34); "COTA Home Office" rows ride the
  umbrella JO 8nrUOK7bK2DWDgupx6gC via a timesheet_site_mappings doc
  (connect_team__cota_home_office) so future Connecteam imports
  auto-resolve. After any backfill touching weeks older than ~6 weeks,
  rebuild finance_week_rollups manually (nightly only covers trailing 6).
  Remaining data-quality queues are WC-code coverage (Aug Select, June
  Events), not attribution.
- **2026-08-26 WC backfill (matrix + placeholder rules, Greg-approved):**
  1,224 paid entries + 518 assignments stamped. Rules that are now
  precedent: matrix is authority (exact state+title match overrides a
  differing entry code — NC janitors 9014→9040, MO 9014@2.64); '*'
  state-default rows fill empty codes (IL events janitors $52.8k →
  9014@3.25); TN + NY have NO policy (the only true no-policy states —
  workers_comp policy records are generic/not entity-scoped) → 8040@2.35
  placeholder ($117.6k awaiting Mass PN coverage). Data-health wcCode
  counts matrix-RESOLVABLE entries as covered even when the entry field is
  empty — the backfill materialized those virtual resolutions onto the
  rows. Gotchas: some JO worksiteAddress.state values are FULL NAMES
  ("Missouri") — normalize before matrix lookup; TX's 9014@1.34 default is
  EVENTS-scoped (select TX has no default). Remaining wcCode gaps =
  8040-placeholder class (TN/NY/DC-janitors, blocked on coverage) + a
  ~$14k murky list (CT/CO/KY rates absent from matrix, DC/VA/CA title→code
  calls) awaiting Greg.
- **2026-08-26 close: WC data-state final.** Greg's call: "all the 8044
  should be 8040" — any code WITHOUT a carrier rate on file is not really
  classified → 79 more rows ($14.5k: CO/KY/CT/MN/MO 8044s, CT/DC
  janitors, CA dishwashers, VA janitors, TX-select utility) moved to
  8040@2.35 (source placeholder_backfill; 28 assignments too). 8044 WITH
  a rate (MD 2.25, IL 3.45, DC 1.83) KEPT — carrier-schedule codes.
  End-state Jun–Aug: assignment/workState 100% everywhere; wcCode
  uncovered = PURELY the 8040 placeholder class (~$148k: TN+NY no-policy
  $117.6k, rest awaiting carrier rates) — the 8040 Placeholders report is
  now the single reclassification queue, and it drains only when the Mass
  PN request lands coverage / broker supplies rates, not by data work.
- **FIN-2 SHIPPED 2026-08-26 (commit 6d4a59f0): real burden in Gross
  Margin + Job Costing.** The 12% slider is replaced by (a) WC premium per
  row = Σ entry total × entry workersCompRate/100 (same basis as the WC
  wage report — the WC backfill above is what made this line real), and
  (b) employer taxes at each entity's ACTUAL Everee rate from
  /integration/v1/expenses/by-date-range (taxes+contributions ÷ wages;
  buildEvereeBurdenRates exported in payrollCostReport.ts). 1099 entities
  are correctly 0% — the old slider burdened contractor pay too. Aug
  1–26 verified live: Select 12.66%, Events 0%; WC premium $5,262.76 +
  taxes $3,644.54 vs the slider's ~$40k — margin was understated ~$31k/mo.
  Rows carry wcPremium/taxBurden; payload carries burdenAvailable/
  burdenByEntity/totalWcPremium/totalTaxBurden; the manual % field
  renders ONLY when Everee is unavailable (fail-soft fallback).
  ☠️ expenses endpoint page size caps at 100 (size>100 = hard 400).
  Next enhancement unchanged (P2.5): stamp dimensions on submissions to
  get per-JO burden from Everee instead of entity-rate × pay.
- **☠️ Phantom "Venue Smart, LLC" account (fixed 2026-08-26):** the whole
  VenueSmart JO family (53 JOs — Lollapalooza, FIFA, Bonnaroo, every COTA
  show) carried accountName "Venue Smart, LLC" + accountId/companyId
  NHc6r1yOVUK6aOqt0EQH, which is a COMPANY id with NO accounts doc — the
  only real account is **Venuesmart LLC National (m1JEJs8YPohuXTQVjVQp)**.
  Reports resolving names via the accounts collection showed "—", and
  new JOs/venue-mappings cloned from family members inherited the phantom
  (that's how the COTA backfill picked it up). Repointed everywhere: 53
  job_orders (recruiterAccountId/accountId/accountName), 23
  payroll_venue_mappings, 23 assignments, 30 entries, 1
  timesheet_site_mapping. Rule: when cloning a JO's shape, take the
  account from jo.recruiterAccountId AND VERIFY the accounts doc exists —
  never trust jo.accountId/companyId/accountName.
- **2026-08-27 Job Costing v2 (JO-based):** `buildJobOrderCosting`
  (getPayrollCostReport {jobCosting:true, jobOrderIds[]}) — whole-life
  P&L per engagement, no date window (horizon = first worked day −45d →
  today); entity→account→JO cascading pickers (accounts nested under
  parents; parent selection pulls children's JOs; JO field = multi-select
  autocomplete). MULTI-JO combine: successor/companion JOs sharing a
  class aggregate (MN Yacht #315 + Country Club #209 = +$11.5k GP where
  the split showed −$5.5k). ☠️ BARE ACCOUNT-CLASS GUARD: a QBO class
  whose every token lives inside the account name ("Black Caviar") is
  ACCOUNT-level — never fuzzy-matched to a JO (Outside Lands was
  claiming all 19 Black Caviar invoices); reported as
  accountLevelBilled/-Classes + warning chip. Attribution for such
  accounts requires per-event QBO classes (Venue Smart pattern) or
  qbo_class_mappings. Expensify note: JEs classed to venues are the
  bookkeeper's "EV Pay Alloc" payroll reallocations — correctly EXCLUDED
  (payroll already counted from entries); Expensify exporter sees only
  ON-REPORT expenses, so unreported card spend is invisible until moved
  to a report + tagged (write-back verified current: 0 unmatched/unknown).
