/**
 * Everee Payments API — typed wrapper for `/api/v2/payments`.
 *
 * Distinct from `/api/v2/payables` (which holds line-item earnings):
 * `/api/v2/payments` represents one row per **pay run** — one record
 * per worker × pay period with the full settled tax / deduction /
 * net breakdown. This is the canonical surface for "show me a
 * worker's pay history".
 *
 * **Filtering caveat**: Everee's `external-worker-id` query param is
 * silently ignored on `/api/v2/payments` (confirmed against the live
 * API — passing the param returns the unfiltered tenant-wide list).
 * Server-side filtering uses Everee's internal numeric `employee-id`,
 * which our linkage docs don't carry. So our recruiter card fetches
 * a page sized for the recent activity volume and **filters
 * client-side** by `payment.employee.externalWorkerId === hrxUid`.
 *
 * For a typical worker with 1-5 active pay periods on file at any
 * given time, a page size of 100 covers the "Recent Pay" view's last
 * 3 rows comfortably. Full pagination is deferred to v2 when we
 * implement the "View all" surface.
 */

import { evereeRequest } from './evereeHttp';
import type { EvereeEntityConfig } from './evereeConfig';

// ─────────────────────────────────────────────────────────────────────
// Filter shape
// ─────────────────────────────────────────────────────────────────────

export interface ListPaymentsFilter {
  /** Page index (zero-based). Everee defaults to 0. */
  pageNumber?: number;
  /** Page size. Everee's max appears to be ~500; we default to 100. */
  pageSize?: number;
  /** When omitted, Everee defaults to false (staffing pattern). The
   *  card sets this to `true` so workers on a regular pay cycle
   *  surface here too — without it, ad-hoc and regular-cycle pay
   *  records get split across two filters. */
  includeWorkersOnRegularPayCycle?: boolean;
  /** Everee's `employee-id` filter — if known. The external-worker-id
   *  filter is silently ignored on this endpoint. */
  employeeId?: number | string;
}

// ─────────────────────────────────────────────────────────────────────
// Public wrapper
// ─────────────────────────────────────────────────────────────────────

/**
 * GET `/api/v2/payments`. Returns the raw Everee response — the
 * service-layer mapper consumes it. Defensive typing: we don't
 * declare every field of the payment record here (there are ~80);
 * the mapper picks out only what the recruiter UI needs.
 */
export async function listPayments(
  config: EvereeEntityConfig,
  filter: ListPaymentsFilter = {},
): Promise<unknown> {
  const qs = buildPaymentsQuery(filter);
  const path = qs ? `/api/v2/payments?${qs}` : '/api/v2/payments';
  return evereeRequest<unknown>(config, 'GET', path);
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function buildPaymentsQuery(filter: ListPaymentsFilter): string {
  const parts: string[] = [];
  const push = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };
  push('page-number', filter.pageNumber);
  push('page-size', filter.pageSize ?? 100);
  push('include-workers-on-regular-pay-cycle', filter.includeWorkersOnRegularPayCycle);
  push('employee-id', filter.employeeId);
  return parts.join('&');
}
