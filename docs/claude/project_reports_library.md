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
| accounts-receivable | A/R Aging | 7 | getQboDashboard (QBO AgedReceivables cache) |

## Researched roadmap (2026-08-19 platform survey)

Survey of ADP WFN standard reports, Bullhorn (+Middle Office), TempWorks,
Avionté, Gusto, Paychex, Everee. Key structural insight: payroll
platforms own registers/tax/compliance reports; staffing platforms
(Bullhorn/TempWorks/Avionté) differentiate on **pay-vs-bill** reports
(gross margin, unbilled, cash requirements). HRX sits across Everee AND
QuickBooks, so the pay-vs-bill and cash-gap reports are simultaneously
the industry's most-demanded and the ones only HRX can produce for C1.

Priority list (⭐ = top-12 pick; "direct" = data already in HRX):

1. ⭐ **Gross Margin by Client/Venue/JO** — bill (QBO invoices) minus pay
   (Everee) minus burden per job order. THE staffing report (Bullhorn/
   TempWorks/Avionté all ship it). Direct: join existing payroll-cost
   report with QBO invoice spine on job order/customer.
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
