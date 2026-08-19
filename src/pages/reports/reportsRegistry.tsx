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

export type ReportCategory =
  | 'Payroll'
  | "Workers' comp & insurance"
  | 'Finance & receivables'
  | 'Compliance';

/** Render order for category sections on the index page. */
export const REPORT_CATEGORY_ORDER: ReportCategory[] = [
  'Payroll',
  'Finance & receivables',
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
    slug: 'accounts-receivable',
    title: 'A/R Aging',
    description:
      'QuickBooks aged receivables by customer — aging buckets, customer-mapping health, and recent invoice and payment activity.',
    category: 'Finance & receivables',
    minLevel: 7,
    icon: <RequestQuoteOutlinedIcon />,
  },
];

export function reportsVisibleAtLevel(level: number): ReportDef[] {
  return REPORTS.filter((r) => level >= r.minLevel);
}
