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
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';

export type ReportCategory =
  | 'Payroll'
  | "Workers' comp & insurance"
  | 'Finance & receivables'
  | 'Forecast & budgeting'
  | 'Compliance';

/** Render order for category sections on the index page. */
export const REPORT_CATEGORY_ORDER: ReportCategory[] = [
  'Payroll',
  'Finance & receivables',
  'Forecast & budgeting',
  "Workers' comp & insurance",
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
    slug: 'payroll-register',
    title: 'Payroll Register',
    description:
      'Settled payroll from Everee — every payment (W-2 + 1099) with gross, net, and employer funding, rolled up by pay run and by funding wire (each wire = one bank ACH pull, to the penny).',
    category: 'Payroll',
    minLevel: 6,
    icon: <ListAltOutlinedIcon />,
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
      'One job order’s complete P&L — billing, payroll, burden estimate, and Expensify/QBO expenses classed to the order. Entity → client → job order drill-down.',
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
    slug: 'finances-budgeting',
    title: 'Finances & Budgeting',
    description:
      'Forecasting and budgeting workspace — moved into the report library from the old sidebar item (2026-08-19).',
    category: 'Forecast & budgeting',
    minLevel: 5,
    icon: <InsightsOutlinedIcon />,
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
