/**
 * Central registry for the /reports library (Greg 2026-08-19: one index
 * page listing every report, each report at /reports/<slug>).
 *
 * Adding a report = one entry here + one <Route> in App.tsx. Keep
 * descriptions in plain operator language — the index card is how the
 * payroll/finance/compliance teams discover what a report is for.
 */

import React from 'react';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import StyleOutlinedIcon from '@mui/icons-material/StyleOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import WaterfallChartOutlinedIcon from '@mui/icons-material/WaterfallChartOutlined';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';

export type ReportCategory =
  | 'Payroll'
  | "Workers' comp & insurance"
  | 'Finance & receivables'
  | 'Forecast & budgeting'
  | 'Usage & metrics'
  | 'Compliance';

/** Render order for category sections on the index page. */
export const REPORT_CATEGORY_ORDER: ReportCategory[] = [
  'Payroll',
  'Finance & receivables',
  'Forecast & budgeting',
  "Workers' comp & insurance",
  'Usage & metrics',
  'Compliance',
];

export interface ReportDef {
  /** URL segment: /reports/<slug>. Stable — treat as a public link. */
  slug: string;
  title: string;
  description: string;
  category: ReportCategory;
  /**
   * Lowest tenant security level that can open the report. Must match
   * the route guard in App.tsx AND the server callable's gate (e.g. A/R
   * rides getQboDashboard, which is level-7 in qboInvoicing.ts).
   */
  minLevel: number;
  icon: React.ReactNode;
}

export const REPORTS: ReportDef[] = [
  {
    slug: 'interview-metrics',
    title: 'Interview Metrics',
    description:
      'AI prescreen funnel — invited, started, completed, passed — with drop-off by question, splits by job order, signup group, and language, and SMS-chase effectiveness.',
    category: 'Usage & metrics',
    minLevel: 6,
    icon: <QueryStatsOutlinedIcon />,
  },
  {
    slug: 'payroll',
    title: 'Payroll Cost Report',
    description:
      'Dollars sent to Everee by job order and venue for any date range, with per-worker drill-down, unattributed-pay detection, and CSV export.',
    category: 'Payroll',
    minLevel: 6,
    icon: <PaymentsOutlinedIcon />,
  },
  {
    slug: 'workers-comp',
    title: "Workers' Comp Wage Report",
    description:
      "Payroll grouped by workers' comp class code and work state — the numbers the carrier needs for premium calculation and monthly reporting.",
    category: "Workers' comp & insurance",
    minLevel: 6,
    icon: <HealthAndSafetyOutlinedIcon />,
  },
  {
    slug: 'data-health',
    title: 'Data Health',
    description:
      'The reconciliation spine: Everee-settled dollars vs HRX entries per month × entity (unexplained residual highlighted), plus gross-weighted coverage of every field the financial and WC reports depend on. Fix here first — every report downstream corrects itself.',
    category: 'Payroll',
    minLevel: 7,
    icon: <MonitorHeartOutlinedIcon />,
  },
  {
    slug: 'payroll-register',
    title: 'Payroll Register',
    description:
      'Settled payroll from Everee — every payment (W-2 + 1099) with gross, net, and employer funding, rolled up by pay run and by funding wire (each wire = one bank ACH pull, to the penny).',
    category: 'Payroll',
    minLevel: 6,
    icon: <ListAltOutlinedIcon />,
  },
  {
    slug: 'expense-recon',
    title: 'Expense Reconciliation',
    description:
      'Every purchase still on Uncategorized Expense with a history-mined suggestion — categorize inline, or turn a merchant into a standing rule that runs daily after the Expensify write-back.',
    category: 'Finance & receivables',
    minLevel: 7,
    icon: <RuleOutlinedIcon />,
  },
  {
    slug: 'classification-audit',
    title: 'Classification Verification',
    description:
      'Every payroll dollar since May 15 graded by evidence — confirmed or flagged for manual review, with inline fix-and-freeze. Invoice class-family checks, per-class revenue/labor health, and job orders whose timesheets outrun their billing.',
    category: 'Payroll',
    minLevel: 7,
    icon: <FactCheckOutlinedIcon />,
  },
  {
    slug: 'payroll-journal',
    title: 'Payroll Journal',
    description:
      'Every Everee funding wire split across QBO classes, to the penny — what the bookkeeper enters when classing each wire. The July wire-reconciliation as a standing report.',
    category: 'Payroll',
    minLevel: 6,
    icon: <MenuBookOutlinedIcon />,
  },
  {
    slug: 'job-costing',
    title: 'Job Costing',
    description:
      'One job order’s complete P&L over its whole life — pick entity → account → job order; no date window. Billing and Expensify/QBO expenses classed to the order, payroll, real WC premium and Everee employer taxes.',
    category: 'Finance & receivables',
    minLevel: 7,
    icon: <CalculateOutlinedIcon />,
  },
  {
    slug: 'gross-margin',
    title: 'Gross Margin',
    description:
      'Billed (QuickBooks invoices) vs payroll (Everee) by client and job order, with an adjustable employer-burden estimate — the pay/bill spread.',
    category: 'Finance & receivables',
    minLevel: 7,
    icon: <TrendingUpIcon />,
  },
  {
    slug: 'qbo-classes',
    title: 'QBO Classes & Mapping',
    description:
      'Every QuickBooks class with its billing/expense activity, mapped to HRX job orders and clients — the authoritative link the finance reports use. Add new classes straight into QBO.',
    category: 'Finance & receivables',
    minLevel: 7,
    icon: <AccountTreeOutlinedIcon />,
  },
  {
    slug: 'cash-flow',
    title: 'Cash Requirements & Flow',
    description:
      'Next payroll’s cash need (approved-but-unsent entries + burden) and the per-client cash-flow gap — paid to workers vs billed vs collected, showing whose payroll C1 is floating.',
    category: 'Forecast & budgeting',
    minLevel: 7,
    icon: <WaterfallChartOutlinedIcon />,
  },
  {
    slug: 'weekly-trends',
    title: 'Weekly Trends',
    description:
      'Accrual bill vs pay per week from the nightly finance rollups — revenue from our own bill-rate snapshots (no QBO matching), margin and hours trends with no range ceiling, plus per-account window totals.',
    category: 'Forecast & budgeting',
    minLevel: 6,
    icon: <TimelineOutlinedIcon />,
  },
  {
    slug: 'finances-budgeting',
    title: 'Finances & Budgeting',
    description:
      'Forecasting and budgeting workspace — moved into the report library from the old sidebar item (2026-08-19).',
    category: 'Forecast & budgeting',
    minLevel: 5,
    icon: <InsightsOutlinedIcon />,
  },
  {
    slug: 'wc-coverage',
    title: 'WC Coverage Gaps',
    description:
      "Where we're missing coverage, with dollars attached: payroll in states with no policy on file or outside a policy window, unresolved and 8040-placeholder payroll, codes without rates, and live assignments heading into next cycle uncoded.",
    category: "Workers' comp & insurance",
    minLevel: 6,
    icon: <GppMaybeOutlinedIcon />,
  },
  {
    slug: 'wc-audit',
    title: 'WC Premium Audit',
    description:
      'Policy-period audit package: payroll by state × class code with OT-excess, tips, and per-diem breakouts → auditable payroll and premium, plus a by-month rollup. CSV = what the carrier auditor gets.',
    category: "Workers' comp & insurance",
    minLevel: 6,
    icon: <FactCheckOutlinedIcon />,
  },
  {
    slug: 'wc-class-codes',
    title: 'WC Class Codes',
    description:
      'The central class-code catalog — definitions, rates, review status, Sync to Everee, and Add Class Code. Moved from the Onboarding Library.',
    category: "Workers' comp & insurance",
    minLevel: 6,
    icon: <StyleOutlinedIcon />,
  },
  {
    slug: 'wc-worksites',
    title: 'WC Worksites',
    description:
      'Every insured worksite on the carrier policy — locations, states, and coverage status. Moved from the Onboarding Library.',
    category: "Workers' comp & insurance",
    minLevel: 6,
    icon: <PlaceOutlinedIcon />,
  },
  {
    slug: 'wc-8040',
    title: '8040 Placeholders',
    description:
      'Payroll still riding the 8040 placeholder class — the cleanup queue to reclassify before carrier reporting. Moved from the Onboarding Library.',
    category: "Workers' comp & insurance",
    minLevel: 6,
    icon: <PendingActionsOutlinedIcon />,
  },
  {
    slug: 'accounts-receivable',
    title: 'A/R Aging',
    description:
      'QuickBooks aged receivables by customer — aging buckets, customer-mapping health, and recent invoice and payment activity.',
    category: 'Finance & receivables',
    minLevel: 7,
    icon: <RequestQuoteOutlinedIcon />,
  },
];

export const COMPLIANCE_REPORTS: ReportDef[] = [
  {
    slug: 'i9-status',
    title: 'I-9 / Onboarding Status',
    description:
      "Every I-9-applicable worker's WorkBright/Everee onboarding state — Section 1, Section 2, and company verification. Staffing's #1 audit exposure.",
    category: 'Compliance',
    minLevel: 6,
    icon: <BadgeOutlinedIcon />,
  },
  {
    slug: 'aca-lookback',
    title: 'ACA Hours Lookback',
    description:
      'Hours per W-2 worker per month over a measurement period — who averages ≥130 hrs/month (ACA full-time) and who is approaching. Variable-hour event staff are exactly this population.',
    category: 'Compliance',
    minLevel: 6,
    icon: <EventAvailableOutlinedIcon />,
  },
  {
    slug: 'tax-liability',
    title: 'Tax & Sick-Leave Liability',
    description:
      'Verification views over Everee-held data: employee withholding + employer taxes by month, and sick-leave accrual basis (hours by state, 1:30 estimate).',
    category: 'Compliance',
    minLevel: 6,
    icon: <AccountBalanceOutlinedIcon />,
  },
];
REPORTS.push(...COMPLIANCE_REPORTS);

export function reportsVisibleAtLevel(level: number): ReportDef[] {
  return REPORTS.filter((r) => level >= r.minLevel);
}
