/**
 * **Pure mapper — Everee payables list → HRX pay history items.**
 *
 * Everee's `GET /api/v2/payables` returns individual pay line items
 * (one per wage / tips / bonus / premium per pay run). For our
 * "Recent Pay" surface we want PAY-RUN granularity — group line items
 * by `paymentId` (server-assigned when Everee processes the pay
 * request), sum amounts, roll up status.
 *
 * Defensive on shape: Everee's response is `unknown` at our wrapper
 * boundary. Each payable may surface its payment in one of a few
 * places:
 *   - `payment.id` (nested object)
 *   - `paymentId` (flat string/number)
 *   - `paymentRequestId` (older docs)
 * We walk all of those and fall back to a synthetic group key per
 * day if a payable has no payment id (which means it hasn't been
 * paid yet — still PENDING in Everee).
 *
 * **Pure.** No IO, no Firestore. Unit-tested against captured
 * payables shapes.
 */

import type { EvereePayHistoryItem } from '../evereeSchemas';

/** Loose payable shape — only the fields we read. Everee may surface
 *  additional fields we ignore. */
export interface RawPayable {
  id?: string | number;
  externalId?: string;
  externalWorkerId?: string;
  amount?: { amount?: string | number; currency?: string };
  timestamp?: string | number;
  paymentStatus?: string;
  /** Nested payment object — preferred shape. */
  payment?: {
    id?: string | number;
    status?: string;
    scheduledForPaymentDate?: string;
    paidAt?: string;
    completedAt?: string;
  };
  /** Flat payment id when there's no nested payment object. */
  paymentId?: string | number;
  /** Older docs use this name. */
  paymentRequestId?: string | number;
  /** Date the payment was completed, when surfaced at top level. */
  paidAt?: string;
  scheduledForPaymentDate?: string;
  payCode?: string;
  label?: string;
}

/** Loose envelope — Everee's list endpoints return either a bare
 *  array or `{ items, nextCursor }`. We tolerate both. */
export interface RawPayablesResponse {
  items?: RawPayable[];
  nextCursor?: string | null;
  /** Bare-array case — used when Everee just returns `[...]`. */
  array?: RawPayable[];
}

// ─────────────────────────────────────────────────────────────────────
// Public mapper
// ─────────────────────────────────────────────────────────────────────

export function mapPayablesToPayHistory(
  raw: unknown,
): { items: EvereePayHistoryItem[]; nextCursor: string | null } {
  const { payables, nextCursor } = extractEnvelope(raw);
  const groups = groupByPaymentId(payables);
  const items: EvereePayHistoryItem[] = [];
  for (const [key, group] of groups.entries()) {
    items.push(summarizeGroup(key, group));
  }
  // Sort newest-first by payDate (fall back to periodEnd).
  items.sort((a, b) => {
    const aKey = a.payDate ?? a.periodEnd ?? '';
    const bKey = b.payDate ?? b.periodEnd ?? '';
    return bKey.localeCompare(aKey);
  });
  return { items, nextCursor };
}

// ─────────────────────────────────────────────────────────────────────
// Envelope extraction — Everee surfaces either bare array OR { items }
// ─────────────────────────────────────────────────────────────────────

function extractEnvelope(raw: unknown): {
  payables: RawPayable[];
  nextCursor: string | null;
} {
  if (Array.isArray(raw)) {
    return { payables: raw as RawPayable[], nextCursor: null };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const items = Array.isArray(obj.items)
      ? (obj.items as RawPayable[])
      : Array.isArray(obj.payables)
        ? (obj.payables as RawPayable[])
        : Array.isArray(obj.data)
          ? (obj.data as RawPayable[])
          : [];
    const cursor =
      typeof obj.nextCursor === 'string'
        ? obj.nextCursor
        : typeof obj.cursor === 'string'
          ? obj.cursor
          : null;
    return { payables: items, nextCursor: cursor };
  }
  return { payables: [], nextCursor: null };
}

// ─────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────

/**
 * Group payables by the Everee paymentId (or a synthetic per-day key
 * for PENDING payables that haven't been bundled into a payment yet).
 * Returns Map<groupKey, RawPayable[]>.
 */
export function groupByPaymentId(payables: RawPayable[]): Map<string, RawPayable[]> {
  const groups = new Map<string, RawPayable[]>();
  for (const p of payables) {
    const key = resolveGroupKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return groups;
}

function resolveGroupKey(p: RawPayable): string {
  // Prefer nested payment.id, then flat paymentId, then legacy paymentRequestId.
  const fromNested = p.payment?.id;
  if (fromNested !== undefined && fromNested !== null) return `pmt_${String(fromNested)}`;
  if (p.paymentId !== undefined && p.paymentId !== null) return `pmt_${String(p.paymentId)}`;
  if (p.paymentRequestId !== undefined && p.paymentRequestId !== null) {
    return `pmt_${String(p.paymentRequestId)}`;
  }
  // Pending — fall back to per-day grouping using the payable's own
  // timestamp so the UI can still display unpaid earnings clustered.
  const day = (toIsoDate(p.timestamp) ?? '').slice(0, 10) || 'unknown';
  return `pending_${day}`;
}

// ─────────────────────────────────────────────────────────────────────
// Per-group summarization
// ─────────────────────────────────────────────────────────────────────

function summarizeGroup(groupKey: string, payables: RawPayable[]): EvereePayHistoryItem {
  let gross = 0;
  let currency: string | null = null;
  const timestamps: string[] = [];
  const payDates: string[] = [];
  const statuses = new Set<string>();

  for (const p of payables) {
    const amount = parseMoney(p.amount?.amount);
    if (Number.isFinite(amount)) gross += amount;
    if (!currency && typeof p.amount?.currency === 'string') {
      currency = p.amount.currency.toUpperCase();
    }
    const ts = toIsoDate(p.timestamp);
    if (ts) timestamps.push(ts);
    const completed =
      p.payment?.completedAt ?? p.payment?.paidAt ?? p.paidAt ?? p.payment?.scheduledForPaymentDate ?? null;
    if (typeof completed === 'string' && completed) payDates.push(completed);
    const status = (p.payment?.status ?? p.paymentStatus ?? '').toString().toUpperCase().trim();
    if (status) statuses.add(status);
  }

  timestamps.sort();
  payDates.sort();
  const periodStart = timestamps[0] ?? null;
  const periodEnd = timestamps[timestamps.length - 1] ?? null;
  const payDate = payDates[payDates.length - 1] ?? periodEnd;

  return {
    statementId: groupKey,
    periodStart: periodStart?.slice(0, 10) ?? null,
    periodEnd: periodEnd?.slice(0, 10) ?? null,
    payDate: payDate?.slice(0, 10) ?? null,
    gross: round2(gross),
    // Net is not authoritative from the payables endpoint — surface gross
    // as net until the statement-detail path (with tax/deduction line
    // items) is wired. Surfacing the same number is less misleading than
    // surfacing nothing.
    net: round2(gross),
    currency: currency ?? 'USD',
    status: rollupStatus(statuses),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Status rollup
// ─────────────────────────────────────────────────────────────────────

/**
 * Pick the worst-case status across the group's payables.
 *
 * Severity order (low → high): PENDING < SUBMITTED < IN_PROGRESS < PAID
 *                              < ERROR / RETURNED / UNPAYABLE_WORKER.
 *
 * The UI maps these to colored chips. Unknown statuses pass through
 * verbatim so an operator can still see them.
 */
export function rollupStatus(statuses: Set<string>): string {
  if (statuses.size === 0) return 'PENDING';
  const SEVERITY: Record<string, number> = {
    PENDING: 0,
    SCHEDULED: 1,
    SUBMITTED: 2,
    IN_PROGRESS: 3,
    PAID: 4,
    ERROR: 5,
    RETURNED: 5,
    UNPAYABLE_WORKER: 5,
  };
  let worst = '';
  let worstScore = -1;
  for (const s of statuses) {
    const score = SEVERITY[s] ?? 2;
    if (score > worstScore) {
      worst = s;
      worstScore = score;
    }
  }
  return worst || 'PENDING';
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

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

function toIsoDate(value: string | number | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    // Everee uses epoch seconds for `timestamp`. Detect ms vs s by magnitude.
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  // ISO string in / ISO string out.
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
