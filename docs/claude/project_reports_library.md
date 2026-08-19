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
