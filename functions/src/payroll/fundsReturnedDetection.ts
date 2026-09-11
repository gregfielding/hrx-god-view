/**
 * Returned-funds detection for the payroll payment-issue sweep (2026-09-11).
 *
 * After ~30–45 days of bounced deposits Everee stops retrying and sends the
 * money back to the employer's funding account. The payment then reads
 * `PAID / DEPOSITED` — at the status level identical to a successful retry —
 * but `GET /api/v2/payments/{id}` shows the deposit re-routed to the
 * company's own bank account (C1 Events, 2026-09-11: four payments, $896.48,
 * back in C1's business checking). The sweep used to mark those issues
 * `resolved` although the workers were never paid.
 *
 * Everee facts this leans on (verified against prod 2026-09-11):
 *  - There is NO company bank-account endpoint, so the funding account is
 *    configured per entity: `tenants/{t}/entities/{entityId}
 *    .evereeFundingAccounts = [{ bankAccountId, routingLast4, accountLast4,
 *    label }]`. "An account that receives deposits for several employees" is
 *    not a usable substitute — a family sharing one account looks the same.
 *  - A bounced payment can be re-issued under a new id whose `prevPaymentId`
 *    is the original; its payables keep pointing at the ORIGINAL payment.
 *  - Payables carry `paymentId` + `label` but no `externalId`, and
 *    `GET /api/v2/payables?external-ids=` ignores the filter — so the
 *    payment → timesheet-entry link is rebuilt from amounts + label work
 *    dates against HRX's per-line import ledger.
 *
 * Pure: no IO. ☠️ PII: raw payments carry the worker's FULL SSN
 * (`employee.taxpayerIdentifier`) and full routing numbers.
 * `sanitizePaymentForDetection` / `sanitizePayableLine` are the only
 * functions that touch raw Everee rows; they keep ids, statuses, amounts,
 * and bank last-4s — nothing else. Never log or persist the raw rows.
 */

import { derivePaymentIssue } from '../integrations/everee/payHistory/mapPayments';

type Rec = Record<string, unknown>;

/** A company funding account a returned deposit lands in. Matches on
 *  Everee's `bankAccountId`, or on routing AND account last-4 together
 *  (routing last-4 alone would match every account at that bank). */
export interface FundingAccountRef {
  bankAccountId: string | null;
  routingLast4: string | null;
  accountLast4: string | null;
  label: string | null;
}

export interface SanitizedDeposit {
  bankAccountId: string | null;
  bankName: string | null;
  routingLast4: string | null;
  accountLast4: string | null;
  status: string;
  amount: number;
  updatedAt: string | null;
}

export interface SanitizedPayment {
  id: string;
  prevPaymentId: string | null;
  status: string;
  depositStatus: string;
  errorType: string;
  payDate: string;
  gross: number;
  externalWorkerId: string;
  payeeName: string;
  deposits: SanitizedDeposit[];
}

export type UnconfirmedReason =
  | 'no_funding_account_configured'
  | 'no_worker_deposit'
  | 'no_deposit_records'
  | 'deposit_in_flight'
  | 'payment_not_found';

export type DepositOutcome =
  /** The payment still shows a worker-fixable issue. */
  | { kind: 'still_failing' }
  /** Money went back to the employer — the worker is still owed. */
  | { kind: 'funds_returned'; amount: number; returnedAt: Date | null; bankName: string | null }
  /** Retry not settled yet. */
  | { kind: 'in_flight' }
  /** Settled deposit to a non-company account — genuinely resolved. */
  | { kind: 'worker_deposited'; amount: number }
  /** Settled, but nothing proves the worker got the money. */
  | { kind: 'unconfirmed'; reason: UnconfirmedReason };

const FAILED_DEPOSIT_STATUSES = new Set(['FAILED', 'RETURNED', 'ERROR']);
const SETTLED_DEPOSIT_STATUSES = new Set(['DEPOSITED', 'PAID']);

// ─────────────────────────────────────────────────────────────────────
// Sanitizers (the only code that reads raw Everee rows)
// ─────────────────────────────────────────────────────────────────────

export function sanitizePaymentForDetection(raw: unknown): SanitizedPayment {
  const p = rec(raw);
  const employee = rec(p.employee);
  const deposits = Array.isArray(p.depositList) ? p.depositList : [];
  return {
    id: idStr(p.id) ?? '',
    prevPaymentId: idStr(p.prevPaymentId),
    status: upper(p.status),
    depositStatus: upper(p.depositStatus),
    errorType: upper(rec(p.error).type),
    payDate: str(p.payDate) || str(p.forDate),
    gross: round2(money(p.grossEarnings)),
    externalWorkerId: str(employee.externalWorkerId) || str(p.externalWorkerId),
    payeeName: str(p.payeeDisplayFullName).slice(0, 80),
    deposits: deposits.map((row) => {
      const d = rec(row);
      return {
        bankAccountId: idStr(d.bankAccountId),
        bankName: str(d.bankName).slice(0, 80) || null,
        routingLast4: last4(d.routingNumber),
        accountLast4: last4(d.accountNumberLast4),
        status: upper(d.status),
        amount: round2(money(rec(d.amounts).amount)),
        updatedAt: str(d.updatedAt) || null,
      };
    }),
  };
}

export interface EvereePayableLine {
  paymentId: string | null;
  amount: number;
  label: string;
}

export function sanitizePayableLine(raw: unknown): EvereePayableLine {
  const r = rec(raw);
  return {
    paymentId: idStr(r.paymentId),
    amount: round2(money(r.earningAmount ?? r.amount)),
    label: str(r.label).slice(0, 160),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Funding accounts
// ─────────────────────────────────────────────────────────────────────

/** Parse `entities/{id}.evereeFundingAccounts` (array, or a single object).
 *  Drops refs that couldn't match anything. */
export function parseFundingAccounts(raw: unknown): FundingAccountRef[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: FundingAccountRef[] = [];
  for (const item of list) {
    const r = rec(item);
    const ref: FundingAccountRef = {
      bankAccountId: idStr(r.bankAccountId),
      routingLast4: last4(r.routingLast4),
      accountLast4: last4(r.accountLast4),
      label: str(r.label).slice(0, 80) || null,
    };
    if (ref.bankAccountId || (ref.routingLast4 && ref.accountLast4)) out.push(ref);
  }
  return out;
}

export function depositMatchesFundingAccount(
  deposit: SanitizedDeposit,
  accounts: FundingAccountRef[],
): FundingAccountRef | null {
  for (const a of accounts) {
    if (a.bankAccountId && deposit.bankAccountId === a.bankAccountId) return a;
    if (
      a.routingLast4 &&
      a.accountLast4 &&
      deposit.routingLast4 === a.routingLast4 &&
      deposit.accountLast4 === a.accountLast4
    ) {
      return a;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────

/**
 * Where did this payment's money go?
 *
 * Order matters: a live deposit row on the company account wins over the
 * payment-level `DEPOSITED` (the 2026-09-11 payments had the worker's row
 * zeroed and a company row carrying the full amount). Without a configured
 * funding account a return and a successful retry look identical, so a
 * settled payment is never called resolved — it comes back `unconfirmed`.
 */
export function classifyDepositOutcome(
  payment: SanitizedPayment,
  accounts: FundingAccountRef[],
): DepositOutcome {
  if (derivePaymentIssue({ error: { type: payment.errorType }, depositStatus: payment.depositStatus })) {
    return { kind: 'still_failing' };
  }
  const live = payment.deposits.filter((d) => d.amount > 0 && !FAILED_DEPOSIT_STATUSES.has(d.status));
  const toCompany = live.filter((d) => depositMatchesFundingAccount(d, accounts) !== null);
  if (toCompany.length > 0) {
    const times = toCompany
      .map((d) => parseEvereeTimestamp(d.updatedAt))
      .filter((t): t is Date => t !== null)
      .map((t) => t.getTime());
    return {
      kind: 'funds_returned',
      amount: round2(toCompany.reduce((sum, d) => sum + d.amount, 0)),
      returnedAt: times.length ? new Date(Math.max(...times)) : null,
      bankName: toCompany[0].bankName,
    };
  }
  if (!SETTLED_DEPOSIT_STATUSES.has(payment.depositStatus)) return { kind: 'in_flight' };
  if (accounts.length === 0) return { kind: 'unconfirmed', reason: 'no_funding_account_configured' };
  const toWorker = live.filter((d) => SETTLED_DEPOSIT_STATUSES.has(d.status));
  if (toWorker.length > 0) {
    return { kind: 'worker_deposited', amount: round2(toWorker.reduce((sum, d) => sum + d.amount, 0)) };
  }
  return {
    kind: 'unconfirmed',
    reason: payment.deposits.length > 0 ? 'no_worker_deposit' : 'no_deposit_records',
  };
}

/**
 * Statuses the sweep must never rewrite or re-text. Once returned funds are
 * on record — by the sweep (`funds_returned`), by the off-cycle repay
 * (`funds_returned_repaid`), or by ops (`funds_returned_already_repaid`) —
 * the doc belongs to people.
 */
export function isFrozenIssueStatus(status: unknown): boolean {
  return str(status).startsWith('funds_returned');
}

// ─────────────────────────────────────────────────────────────────────
// Payment → timesheet entries
// ─────────────────────────────────────────────────────────────────────

/** One HRX payable line: an externalId on a timesheet entry, with the amount
 *  HRX submitted for it (null when HRX keeps no per-line amount — grid rows). */
export interface HrxPayableLine {
  entryId: string;
  externalId: string;
  amount: number | null;
  workDate: string | null;
}

export type PayableMatch =
  | { ok: true; entryIds: string[]; workDates: string[] }
  | {
      ok: false;
      reason: 'no_everee_payables' | 'total_mismatch' | 'unmatched_payable' | 'ambiguous';
    };

/** Work date from a payable label ("Contractor pay — Venue — 2026-08-01 — 5.5 hrs"). */
export function extractLabelWorkDate(label: string): string | null {
  const m = String(label || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

/**
 * Which timesheet entries did this payment pay? All-or-nothing and strict:
 * the payment's payables (any id in the re-issue chain) must add up to the
 * payment gross, and every payable must map to exactly one HRX line of the
 * same amount (and label work date, when the label has one). Anything less
 * returns a reason and links nothing — flipping a genuinely paid entry to
 * `error` would drop it from cost reports and disarm the off-cycle
 * duplicate-pay guard.
 */
export function matchReturnedPayables(args: {
  paymentGross: number;
  chainPaymentIds: string[];
  evereePayables: EvereePayableLine[];
  hrxLines: HrxPayableLine[];
}): PayableMatch {
  const chain = new Set(args.chainPaymentIds);
  const payables = args.evereePayables.filter((p) => p.paymentId !== null && chain.has(p.paymentId));
  if (payables.length === 0) return { ok: false, reason: 'no_everee_payables' };
  if (payables.reduce((sum, p) => sum + cents(p.amount), 0) !== cents(args.paymentGross)) {
    return { ok: false, reason: 'total_mismatch' };
  }

  const groups = new Map<string, { amountCents: number; workDate: string | null; count: number }>();
  for (const p of payables) {
    const workDate = extractLabelWorkDate(p.label);
    const key = `${cents(p.amount)}|${workDate ?? ''}`;
    const group = groups.get(key) ?? { amountCents: cents(p.amount), workDate, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  // Dated groups claim their lines before any undated group looks.
  const ordered = [...groups.values()].sort((a, b) => Number(!a.workDate) - Number(!b.workDate));

  const used = new Set<string>();
  const matched: HrxPayableLine[] = [];
  for (const group of ordered) {
    const candidates = args.hrxLines.filter(
      (l) =>
        !used.has(l.externalId) &&
        l.amount !== null &&
        cents(l.amount) === group.amountCents &&
        (!group.workDate || l.workDate === group.workDate),
    );
    if (candidates.length < group.count) return { ok: false, reason: 'unmatched_payable' };
    if (candidates.length > group.count) return { ok: false, reason: 'ambiguous' };
    for (const c of candidates) {
      used.add(c.externalId);
      matched.push(c);
    }
  }
  return {
    ok: true,
    entryIds: [...new Set(matched.map((l) => l.entryId))],
    workDates: [...new Set(matched.map((l) => l.workDate).filter((d): d is string => !!d))].sort(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Ops-facing helpers
// ─────────────────────────────────────────────────────────────────────

/** Same wording as the 2026-09-11 manual fix, so grid rows read the same. */
export function fundsReturnedEntryMessage(args: {
  amount: number;
  paymentId: string;
  entityName: string;
  returnedAt: Date | null;
}): string {
  const when = args.returnedAt
    ? ` on ${args.returnedAt.toLocaleDateString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'numeric',
        day: 'numeric',
        year: '2-digit',
      })}`
    : '';
  return (
    `Deposit undeliverable — Everee returned $${args.amount.toFixed(2)} (payment ${args.paymentId}) ` +
    `to ${args.entityName}${when}. Worker still owed: repay with an off-cycle payment; ` +
    'do NOT resubmit (Everee dedupes the original payable).'
  );
}

export interface OffCycleSummary {
  id: string;
  total: number;
  status: string;
  createdAtMs: number | null;
}

/**
 * An off-cycle payment for exactly this amount sent after the original pay
 * date — the 2026-09-11 check that found one of four "owed" workers already
 * repaid. A hint for ops, never proof: the issue stays owed until a person
 * says otherwise.
 */
export function findPossibleRepayment(args: {
  amount: number;
  payDate: string;
  offCycles: OffCycleSummary[];
}): OffCycleSummary | null {
  const payDateMs = Date.parse(`${args.payDate}T00:00:00Z`);
  const hits = args.offCycles.filter(
    (o) =>
      o.status !== 'error' &&
      o.status !== 'voided' &&
      cents(o.total) === cents(args.amount) &&
      (Number.isNaN(payDateMs) || (o.createdAtMs ?? 0) >= payDateMs),
  );
  hits.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return hits[0] ?? null;
}

/** Everee timestamps are UTC with no offset and microsecond precision
 *  ("2026-09-11T12:11:56.851504"). */
export function parseEvereeTimestamp(value: string | null | undefined): Date | null {
  const m = str(value).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  const fraction = m[2] ? m[2].slice(0, 4) : '';
  const zone = !m[3] ? 'Z' : m[3] === 'Z' || m[3].includes(':') ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const d = new Date(`${m[1]}${fraction}${zone}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function rec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function upper(v: unknown): string {
  return str(v).toUpperCase();
}

function idStr(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  return str(v) || null;
}

function last4(v: unknown): string | null {
  const digits = str(v).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Everee money: `{ amount: "542.72", currency }`, or a bare string/number. */
function money(v: unknown): number {
  const raw = v && typeof v === 'object' ? (v as Rec).amount : v;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const n = Number(String(raw ?? '').trim().replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cents(n: number): number {
  return Math.round(n * 100);
}
