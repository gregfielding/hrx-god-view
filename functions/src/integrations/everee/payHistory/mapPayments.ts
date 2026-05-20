/**
 * **Pure mapper — Everee `/api/v2/payments` response → HRX pay
 * history items.**
 *
 * Each Everee payment is already at the granularity our recruiter
 * card wants (one row per worker × pay period). The mapping is
 * straight: extract dates, amounts, status, and the
 * `employee.externalWorkerId` we'll use to filter client-side.
 *
 * **Filtering happens here**, not in the wrapper, because Everee's
 * `external-worker-id` query param is silently ignored on
 * `/api/v2/payments` (see `evereePayments.ts` for the gory detail).
 *
 * Pure: no IO, no Firestore. Unit-tested against captured payment
 * shapes from the live API.
 */

import type { EvereePayHistoryItem } from '../evereeSchemas';

/** Loose payment shape — only fields we read. Everee surfaces ~80
 *  more we ignore. */
export interface RawPayment {
  id?: string | number;
  payDate?: string;
  payPeriodStartDate?: string;
  payPeriodEndDate?: string;
  forDate?: string;
  /** Money objects. Each has `.amount` (string OR number) + `.currency`. */
  grossEarnings?: { amount?: string | number; currency?: string };
  netEarnings?: { amount?: string | number; currency?: string };
  /** Lifecycle / approval / deposit status fields — Everee surfaces all
   *  three and the recruiter needs a single rollup. */
  status?: string;
  queryStatus?: string;
  depositStatus?: string;
  /** Nested employee object — carries the HRX uid in
   *  `employee.externalWorkerId`. */
  employee?: {
    externalWorkerId?: string;
    employeeId?: number;
    userId?: number;
    workerId?: string;
  };
  /** Top-level fallbacks Everee sometimes surfaces. */
  externalWorkerId?: string;
}

/** Envelope wrapper Everee returns — `{ items, totalItems, ... }`. */
export interface RawPaymentsResponse {
  items?: RawPayment[];
  totalItems?: number;
  pageNumber?: number;
  pageSize?: number;
  totalPages?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Public mapper
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert Everee `/api/v2/payments` response → pay-history items for
 * a single worker. Filters client-side because Everee silently ignores
 * `external-worker-id` query params on this endpoint.
 *
 * **Two filter candidates** because the HRX → Everee linkage was set
 * up with `externalWorkerId = evereeWorkerId` (Everee UUID) for some
 * workers and `externalWorkerId = HRX uid` for others — schema drift
 * across waves. Each `Payment.employee.externalWorkerId` may match
 * either format, so we accept both keys and treat a hit on either as
 * a match.
 *
 * @param raw      Everee response (envelope-shape or bare array)
 * @param keys     Candidate filter keys — HRX uid + resolved
 *                 externalWorkerId. Caller passes both; mapper unions.
 * @returns Sorted newest-payDate-first; empty when no matches.
 */
export function mapPaymentsToPayHistory(
  raw: unknown,
  keys: string | string[],
): { items: EvereePayHistoryItem[]; nextCursor: string | null } {
  const targetSet = new Set(
    (Array.isArray(keys) ? keys : [keys])
      .map((k) => (k ?? '').trim())
      .filter((k) => k.length > 0),
  );
  if (targetSet.size === 0) return { items: [], nextCursor: null };

  const payments = extractPayments(raw);
  const items: EvereePayHistoryItem[] = [];
  for (const p of payments) {
    const subKey = (p.employee?.externalWorkerId ?? '').trim();
    const topKey = (p.externalWorkerId ?? '').trim();
    if (!targetSet.has(subKey) && !targetSet.has(topKey)) continue;
    items.push(mapOne(p));
  }
  items.sort((a, b) => {
    const aKey = a.payDate ?? a.periodEnd ?? '';
    const bKey = b.payDate ?? b.periodEnd ?? '';
    return bKey.localeCompare(aKey);
  });
  return { items, nextCursor: null };
}

// ─────────────────────────────────────────────────────────────────────
// Per-record mapping
// ─────────────────────────────────────────────────────────────────────

function mapOne(p: RawPayment): EvereePayHistoryItem {
  const gross = parseMoney(p.grossEarnings?.amount);
  const net = parseMoney(p.netEarnings?.amount);
  const currency =
    p.netEarnings?.currency?.toUpperCase() ??
    p.grossEarnings?.currency?.toUpperCase() ??
    'USD';

  return {
    statementId: `pmt_${String(p.id ?? '')}`,
    periodStart: p.payPeriodStartDate ?? null,
    periodEnd: p.payPeriodEndDate ?? null,
    payDate: p.payDate ?? p.forDate ?? p.payPeriodEndDate ?? null,
    gross: round2(gross),
    net: round2(net || gross),
    currency,
    status: rollupPaymentStatus(p),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Status rollup
// ─────────────────────────────────────────────────────────────────────

/**
 * Combine Everee's three status fields (`status`, `queryStatus`,
 * `depositStatus`) into the single chip label our recruiter card
 * renders. Severity order matches what the existing payables mapper
 * uses so chip colors stay consistent across the two data sources:
 *
 *   PENDING < SUBMITTED < PAID < ERROR / RETURNED / UNPAYABLE_WORKER
 *
 * Mapping rules (conservative — unknown combos default to PENDING):
 *
 *   - depositStatus=PAID            → PAID
 *   - depositStatus=ERROR/RETURNED  → ERROR / RETURNED
 *   - queryStatus=PENDING_APPROVAL  → PENDING
 *   - queryStatus=APPROVED + no deposit yet → SUBMITTED
 *   - status=CALCULATED + no approval yet  → PENDING
 *   - anything else                 → status verbatim (debug-friendly)
 */
export function rollupPaymentStatus(p: RawPayment): string {
  const deposit = (p.depositStatus ?? '').toUpperCase();
  const query = (p.queryStatus ?? '').toUpperCase();
  const status = (p.status ?? '').toUpperCase();

  if (deposit === 'PAID') return 'PAID';
  if (deposit === 'ERROR') return 'ERROR';
  if (deposit === 'RETURNED') return 'RETURNED';

  // Worker-level error from approval pipeline — surfaces UNPAYABLE
  // chip even when depositStatus is still NONE.
  if (query === 'UNPAYABLE_WORKER') return 'UNPAYABLE_WORKER';
  if (query === 'PENDING_APPROVAL' || query === 'READY_TO_CALCULATE') return 'PENDING';
  if (query === 'APPROVED') return 'SUBMITTED';
  if (query === 'REJECTED') return 'ERROR';

  if (status === 'CALCULATED' || status === 'PRE_CALCULATED') return 'PENDING';
  if (status === 'FAILED' || status === 'ERROR' || status === 'ERRORED') return 'ERROR';
  if (status === 'PAID' || status === 'COMPLETED') return 'PAID';

  return status || query || deposit || 'PENDING';
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function extractPayments(raw: unknown): RawPayment[] {
  if (Array.isArray(raw)) return raw as RawPayment[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as RawPayment[];
    if (Array.isArray(obj.data)) return obj.data as RawPayment[];
  }
  return [];
}

function parseMoney(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const trimmed = String(value).trim().replace(/[$,]/g, '');
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
