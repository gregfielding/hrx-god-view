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

/** Pay history item (whitelisted fields for UI) */
export interface EvereePayHistoryItem {
  id?: string;
  payPeriodStart?: string;
  payPeriodEnd?: string;
  payDate?: string;
  grossPay?: number;
  netPay?: number;
  status?: string;
}

/** Pay statement (proxy from Everee; no PII stored) */
export interface EvereePayStatementSummary {
  id: string;
  payDate?: string;
  netPay?: number;
  downloadUrl?: string;
}
