/**
 * Everee request/response schemas and enums (HRX Everee Master Plan).
 * Use zod for runtime validation when calling Everee API; types here for TS.
 */

export const EVEREE_WORKER_STATUS = [
  'not_created',
  'created',
  'onboarding_started',
  'onboarding_complete',
  'error',
] as const;
export type EvereeWorkerStatus = (typeof EVEREE_WORKER_STATUS)[number];

export const EVEREE_EMBED_EXPERIENCE_TYPE = ['ONBOARDING', 'PAY_CARD'] as const;
export type EvereeEmbedExperienceType = (typeof EVEREE_EMBED_EXPERIENCE_TYPE)[number];

/**
 * Pay history item — one row in the recruiter / worker "My Pay" list.
 *
 * `statementId` is the Everee paymentId (server-assigned) — what the
 * `getPayStatement` detail call keys on.
 *
 * Field naming matches the client-side `EvereePayHistoryItem` in
 * `src/services/everee/evereeCallables.ts` so the panel + recruiter
 * card don't have to renormalize. The earlier stub shape (id /
 * payPeriodStart / grossPay / netPay) is kept as the *legacy* alias
 * in the panel's `normalizePayRow` until we drop the stub interop.
 */
export interface EvereePayHistoryItem {
  /** Everee paymentId (groups N payables that landed in one deposit). */
  statementId: string;
  /** Earliest payable timestamp in this payment (ISO date). */
  periodStart?: string | null;
  /** Latest payable timestamp in this payment (ISO date). */
  periodEnd?: string | null;
  /** When the deposit posted (ISO). Falls back to periodEnd when Everee
   *  hasn't surfaced a payment-completed timestamp yet. */
  payDate?: string | null;
  /** Sum of payable amounts before deductions. */
  gross?: number | null;
  /** Same as `gross` until we get an authoritative net from Everee.
   *  Everee's payable-list doesn't expose post-tax net per-payment, so
   *  we surface gross for both until the statement-detail path lands. */
  net?: number | null;
  /** 3-letter currency code. Defaults to USD. */
  currency?: string | null;
  /** Worst-case rollup of contained payable statuses
   *  (`PENDING` < `SUBMITTED` < `PAID` < `ERROR` / `RETURNED`). */
  status?: string | null;
}

/** Envelope shape the callable returns — matches the client's
 *  `EvereeGetPayHistoryResult` so no transformation is required. */
export interface EvereeGetPayHistoryEnvelope {
  items: EvereePayHistoryItem[];
  nextCursor?: string | null;
}

/** Pay statement detail — same as the list row plus optional line-
 *  item breakdowns. The PDF link comes back as a short-lived signed
 *  URL when available. */
export interface EvereePayStatementSummary extends EvereePayHistoryItem {
  /** Short-lived signed PDF URL from Everee. */
  pdfUrl?: string | null;
  /** Earnings line items (e.g. REGULAR_HOURLY, TIPS, BONUS). */
  earnings?: Array<{ label: string; amount: number | null }> | null;
  /** Deduction line items (taxes shown separately below). */
  deductions?: Array<{ label: string; amount: number | null }> | null;
  /** Tax line items. */
  taxes?: Array<{ label: string; amount: number | null }> | null;
}
