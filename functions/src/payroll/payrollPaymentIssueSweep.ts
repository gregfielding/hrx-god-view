/**
 * Payroll payment-issue sweep (2026-08-28, Greg's "payroll updates" category).
 *
 * Scans Everee payments for worker-fixable failures and texts the worker a
 * fix-it link. Division of labor with Everee's own notifications: Everee
 * owns "good news" (you got paid) — we NEVER duplicate those; HRX owns
 * "action needed", because our SMS channel is the one this workforce
 * actually reads (three prod workers sat on returned deposits for a month
 * under Everee's email-only notice — the audit that motivated this).
 *
 * Signals (verified against prod 2026-08-28, see
 * `payHistory/mapPayments.ts#derivePaymentIssue`):
 *  - `status=ERRORED` + `error.type=INVALID_BANK_ACCOUNT` → bank details bad.
 *  - `status=ERRORED` + `error.type=MISSING_TAX_PAYER_IDENTIFIER` → payroll
 *    setup never finished.
 *  - `depositStatus=FAILED/RETURNED` → deposit bounced ("No Account" /
 *    "Credit Refused by Receiver" in Everee's UI).
 *
 * State: one doc per payment in `tenants/{t}/payroll_payment_issues/`
 * (`{entityId}__{paymentId}`), status:
 *  - `open` — the payment currently shows an issue. Re-notify every
 *    REMIND_AFTER_DAYS, max MAX_NOTIFY sends.
 *  - `resolved` — the issue cleared. For `deposit_returned` that now takes
 *    proof: a settled deposit to an account that is NOT the entity's
 *    funding account (see below).
 *  - `funds_returned` — ☠️ 2026-09-11: after ~30–45 days of bounced deposits
 *    Everee gives up and re-routes the money to the entity's own funding
 *    account; the payment then reads PAID/DEPOSITED exactly like a
 *    successful retry. The worker is still owed. Linked timesheet entries go
 *    to `error / deposit_returned` (so nobody resubmits and cost reports
 *    drop them until the off-cycle repay) and the Payroll Costs "Returned
 *    deposits" card lists the debt. Every status starting `funds_returned`
 *    (`funds_returned_repaid` from the off-cycle repay,
 *    `funds_returned_already_repaid` from ops) is frozen: never rewritten,
 *    never re-texted.
 *  - `deposit_unconfirmed` — the issue cleared but nothing proves the worker
 *    got the money (no funding account configured, no deposit rows, payment
 *    gone, retry stuck in flight). Listed for ops; re-evaluated every run.
 *
 * Funding accounts are configured per entity at
 * `tenants/{t}/entities/{entityId}.evereeFundingAccounts` — Everee has no
 * company bank-account API. Detection + matching live in
 * `fundsReturnedDetection.ts` (pure, unit-tested).
 *
 * Cadence: hosted by `scheduledOrchestrator` (hourly) but self-gated to
 * every 6h via the marker doc — the scan pages the payments API, which is
 * too heavy to run every hour for a signal that changes daily.
 *
 * ☠️ PII: raw payment rows carry the worker's FULL SSN
 * (`employee.taxpayerIdentifier`). Every Everee row is sanitized the moment
 * it arrives; only non-sensitive fields are persisted to the issue docs —
 * never store or log the raw payment/employee objects.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { claimTypeDailySlot } from '../messaging/rateLimiter';
import { getEvereeConfigForEntity, type EvereeEntityConfig } from '../integrations/everee/evereeConfig';
import { evereeRequest } from '../integrations/everee/evereeHttp';
import { derivePaymentIssue } from '../integrations/everee/payHistory/mapPayments';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';
import { payableStatusDocId } from '../timesheets/importEntryKeys';
import {
  classifyDepositOutcome,
  findPossibleRepayment,
  fundsReturnedEntryMessage,
  isFrozenIssueStatus,
  matchReturnedPayables,
  parseFundingAccounts,
  sanitizePayableLine,
  sanitizePaymentForDetection,
  type DepositOutcome,
  type EvereePayableLine,
  type FundingAccountRef,
  type HrxPayableLine,
  type OffCycleSummary,
  type SanitizedPayment,
  type UnconfirmedReason,
} from './fundsReturnedDetection';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
const ENTITIES: Array<{ entityId: string; evereeTenantId: string }> = [
  { entityId: 'c1_select_llc', evereeTenantId: '3133' },
  { entityId: 'c1_events_llc', evereeTenantId: '3138' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Only payments this recent can raise a fresh alert. */
const LOOKBACK_DAYS = 45;
/** Re-text an unresolved issue after this many days… */
const REMIND_AFTER_DAYS = 5;
/** …but never more than this many texts per payment issue. */
const MAX_NOTIFY = 3;
/** Newest-first page cap — 5k payments comfortably covers the lookback. */
const MAX_PAGES = 10;
/** Self-gate: the orchestrator ticks hourly; we actually run every 6h. */
const MIN_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A cleared deposit_returned whose retry is still unsettled this long after
 *  it was last seen failing goes to ops as deposit_unconfirmed. */
const IN_FLIGHT_MAX_DAYS = 10;
/** Everee re-issues a bounced payment under a new id (`prevPaymentId`). */
const MAX_PREV_HOPS = 3;
const MAX_PAYABLE_PAGES = 5;
/** Entry statuses a returned payment can still be sitting on. */
const LINKABLE_ENTRY_STATUSES = new Set(['sent_to_everee', 'submitted', 'paid', 'error']);

export interface SweepOptions {
  /** Read everything, write and text nothing; planned transitions come back in `plan`. */
  dryRun?: boolean;
  /** Skip the 6h self-gate (manual runs). */
  ignoreGate?: boolean;
  /** `{ [entityId]: evereeFundingAccounts }` to preview detection before an
   *  entity's config is written. Honored on dry runs only. */
  fundingAccountsOverride?: Record<string, unknown>;
}

interface SweepResult {
  success: boolean;
  durationMs: number;
  itemsProcessed?: number;
  errors?: number;
  message?: string;
  plan?: string[];
}

interface OpenIssue {
  docId: string;
  entityId: string;
  evereeTenantId: string;
  paymentId: string;
  uid: string;
  workerName: string;
  issue: 'bank_invalid' | 'missing_tin' | 'deposit_returned';
  payDate: string;
  gross: string;
}

interface EntityRun {
  entityId: string;
  evereeTenantId: string;
  entityName: string;
  config: EvereeEntityConfig;
  fundingAccounts: FundingAccountRef[];
  dryRun: boolean;
  plan: string[];
}

type FundsReturned = Extract<DepositOutcome, { kind: 'funds_returned' }>;

function smsBody(issue: OpenIssue['issue'], lang: 'en' | 'es', evereeTenantId: string): string {
  const depositUrl = `${PUBLIC_APP_ORIGIN}/c1/workers/payroll-settings`;
  const setupUrl = `${PUBLIC_APP_ORIGIN}/c1/workers/earnings/${evereeTenantId}`;
  if (issue === 'missing_tin') {
    return lang === 'es'
      ? `C1 Staffing: un pago reciente no se pudo procesar porque tu configuración de nómina no está terminada. Termínala aquí para recibir tu pago: ${setupUrl}`
      : `C1 Staffing: a recent payment couldn't be processed because your payroll setup isn't finished. Finish it here to get paid: ${setupUrl}`;
  }
  return lang === 'es'
    ? `C1 Staffing: tu pago no se pudo depositar. Verifica tu número de ruta y de cuenta aquí; una vez corregidos, el depósito se reintenta automáticamente: ${depositUrl}`
    : `C1 Staffing: your payment couldn't be deposited. Double-check your routing and account number here — once fixed, the deposit retries automatically: ${depositUrl}`;
}

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function errMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/** Scan one entity's payments: fresh worker-fixable issues (lookback-bound)
 *  and payments whose deposit went to the funding account (any age — returns
 *  land ~30–45 days after payDate, right around the lookback edge). */
async function scanEntity(run: EntityRun): Promise<{
  open: OpenIssue[];
  scannedPaymentIds: Set<string>;
  returnedPaymentIds: Set<string>;
}> {
  const open: OpenIssue[] = [];
  const scannedPaymentIds = new Set<string>();
  const returnedPaymentIds = new Set<string>();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  for (let page = 0; page < MAX_PAGES; page++) {
    // Newest first. With `id,asc` the page cap kept the OLDEST payments, so
    // an entity past MAX_PAGES × 500 payments would stop seeing new failures.
    const raw = (await evereeRequest<Record<string, unknown>>(
      run.config,
      'GET',
      `/api/v2/payments?page=${page}&size=500&include-workers-on-regular-pay-cycle=true&sort=id,desc`,
    )) as { items?: unknown[]; totalPages?: number };
    const items = Array.isArray(raw?.items) ? raw.items : [];
    let fresh = 0;
    for (const item of items) {
      const p = sanitizePaymentForDetection(item);
      if (!p.id || scannedPaymentIds.has(p.id)) continue;
      scannedPaymentIds.add(p.id);
      fresh += 1;
      if (classifyDepositOutcome(p, run.fundingAccounts).kind === 'funds_returned') {
        returnedPaymentIds.add(p.id);
      }
      if (!p.payDate || p.payDate < cutoff) continue;
      const issue = derivePaymentIssue({ error: { type: p.errorType }, depositStatus: p.depositStatus });
      if (!issue) continue;
      open.push({
        docId: `${run.entityId}__${p.id}`,
        entityId: run.entityId,
        evereeTenantId: run.evereeTenantId,
        paymentId: p.id,
        uid: p.externalWorkerId,
        workerName: p.payeeName,
        issue,
        payDate: p.payDate,
        gross: p.gross.toFixed(2),
      });
    }
    if (fresh === 0 || page + 1 >= Number(raw?.totalPages ?? 1)) break;
  }
  return { open, scannedPaymentIds, returnedPaymentIds };
}

/** GET one payment, sanitized on arrival. null = Everee says it's gone. */
async function fetchPayment(config: EvereeEntityConfig, paymentId: string): Promise<SanitizedPayment | null> {
  try {
    const raw = await evereeRequest<unknown>(config, 'GET', `/api/v2/payments/${encodeURIComponent(paymentId)}`);
    return sanitizePaymentForDetection(raw);
  } catch (e) {
    if (/\b404\b/.test(errMessage(e))) return null;
    throw new Error(`GET payment ${paymentId} failed: ${errMessage(e)}`);
  }
}

/** The payment plus its re-issue ancestors (payables keep the original id). */
async function fetchPaymentChain(
  config: EvereeEntityConfig,
  paymentId: string,
): Promise<{ payment: SanitizedPayment; chainIds: string[] } | null> {
  const payment = await fetchPayment(config, paymentId);
  if (!payment?.id) return null;
  const chainIds = [payment.id];
  let prev = payment.prevPaymentId;
  for (let hop = 0; prev && hop < MAX_PREV_HOPS && !chainIds.includes(prev); hop++) {
    chainIds.push(prev);
    const prior = await fetchPayment(config, prev).catch(() => null);
    prev = prior?.prevPaymentId ?? null;
  }
  return { payment, chainIds };
}

/** The worker's Everee payables that belong to the chain. The
 *  `external-worker-id` filter is honored on GET /api/v2/payables
 *  (`external-ids` is NOT); filtering by paymentId keeps this correct even
 *  if the worker filter were ever ignored. */
async function fetchChainPayables(
  config: EvereeEntityConfig,
  externalWorkerId: string,
  chainIds: string[],
): Promise<EvereePayableLine[]> {
  const chain = new Set(chainIds);
  const out: EvereePayableLine[] = [];
  for (let page = 0; page < MAX_PAYABLE_PAGES; page++) {
    const raw = (await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/payables?external-worker-id=${encodeURIComponent(externalWorkerId)}&size=200&page=${page}`,
    )) as { items?: unknown[]; totalPages?: number };
    for (const item of Array.isArray(raw?.items) ? raw.items : []) {
      const line = sanitizePayableLine(item);
      if (line.paymentId && chain.has(line.paymentId)) out.push(line);
    }
    if (page + 1 >= Number(raw?.totalPages ?? 1)) break;
  }
  return out;
}

/** The worker's submitted payable lines for this entity. Import lines carry
 *  their submitted amount in the `timesheet_import_payables` ledger; grid
 *  lines have no per-line amount and can't be matched. */
async function loadHrxPayableLines(entityId: string, uid: string): Promise<{
  lines: HrxPayableLine[];
  entries: Map<string, { ref: admin.firestore.DocumentReference; returnedPaymentId: string | null }>;
}> {
  const entries = new Map<string, { ref: admin.firestore.DocumentReference; returnedPaymentId: string | null }>();
  const meta: Array<{ entryId: string; externalId: string; workDate: string | null }> = [];
  const snap = await db.collection(`tenants/${TENANT_ID}/timesheet_entries`).where('workerId', '==', uid).get();
  for (const d of snap.docs) {
    const x = d.data() as Record<string, any>;
    if (x.hiringEntityId !== entityId || !LINKABLE_ENTRY_STATUSES.has(String(x.status ?? ''))) continue;
    const externalIds = (Array.isArray(x.everee?.payableExternalIds) ? x.everee.payableExternalIds : []).filter(
      (v: unknown): v is string => typeof v === 'string' && v.length > 0,
    );
    if (externalIds.length === 0) continue;
    entries.set(d.id, {
      ref: d.ref,
      returnedPaymentId: x.everee?.returnedPaymentId ? String(x.everee.returnedPaymentId) : null,
    });
    for (const externalId of externalIds) {
      meta.push({ entryId: d.id, externalId, workDate: typeof x.workDate === 'string' ? x.workDate : null });
    }
  }
  const importMeta = meta.filter((m) => m.externalId.includes('::import-'));
  const amountByExternalId = new Map<string, number>();
  if (importMeta.length > 0) {
    const ledger = await db.getAll(
      ...importMeta.map((m) =>
        db.doc(`tenants/${TENANT_ID}/timesheet_import_payables/${payableStatusDocId(m.externalId)}`),
      ),
    );
    ledger.forEach((s, i) => {
      const amount = Number(s.exists ? s.get('amount') : NaN);
      if (Number.isFinite(amount)) amountByExternalId.set(importMeta[i].externalId, amount);
    });
  }
  return {
    lines: meta.map((m) => ({ ...m, amount: amountByExternalId.get(m.externalId) ?? null })),
    entries,
  };
}

async function loadOffCycles(uid: string): Promise<OffCycleSummary[]> {
  const snap = await db
    .collection(`tenants/${TENANT_ID}/offcycle_payments`)
    .where('workerId', '==', uid)
    .limit(50)
    .get()
    .catch(() => null);
  return (snap?.docs ?? []).map((d) => ({
    id: d.id,
    total: Number(d.get('total') ?? 0),
    status: String(d.get('status') ?? ''),
    createdAtMs: (d.get('createdAt') as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? null,
  }));
}

/**
 * Record returned funds on the issue doc (creating it for a return the sweep
 * never saw bounce) and flip the payment's timesheet entries to
 * `error / deposit_returned` — the same shape as the 2026-09-11 manual fix.
 * Never texts the worker.
 */
async function recordFundsReturned(
  run: EntityRun,
  chain: { payment: SanitizedPayment; chainIds: string[] },
  outcome: FundsReturned,
  existing: admin.firestore.DocumentSnapshot,
): Promise<void> {
  const { payment } = chain;
  const docId = `${run.entityId}__${payment.id}`;
  const uid = String((existing.exists ? existing.get('uid') : '') || payment.externalWorkerId || '');

  let entryLinkStatus = 'unmatched:no_worker';
  let linkedEntryIds: string[] = [];
  let linkedWorkDates: string[] = [];
  let toMark: admin.firestore.DocumentReference[] = [];
  if (uid) {
    const hrx = await loadHrxPayableLines(run.entityId, uid);
    const payables = hrx.lines.length > 0 ? await fetchChainPayables(run.config, uid, chain.chainIds) : [];
    const match = matchReturnedPayables({
      paymentGross: payment.gross,
      chainPaymentIds: chain.chainIds,
      evereePayables: payables,
      hrxLines: hrx.lines,
    });
    if (match.ok) {
      linkedEntryIds = match.entryIds;
      linkedWorkDates = match.workDates;
      toMark = match.entryIds
        .map((id) => hrx.entries.get(id))
        .filter((e): e is { ref: admin.firestore.DocumentReference; returnedPaymentId: string | null } => !!e)
        .filter((e) => e.returnedPaymentId !== payment.id)
        .map((e) => e.ref);
      entryLinkStatus = toMark.length > 0 ? 'linked' : 'already_linked';
    } else if (hrx.lines.length === 0) {
      // A one-off payment made directly in Everee — no HRX rows to flag.
      entryLinkStatus = 'no_hrx_entries';
    } else {
      entryLinkStatus = `unmatched:${'reason' in match ? match.reason : 'unknown'}`;
    }
  }
  const possible = uid
    ? findPossibleRepayment({ amount: outcome.amount, payDate: payment.payDate, offCycles: await loadOffCycles(uid) })
    : null;

  const fromStatus = existing.exists ? String(existing.get('status') ?? '') : 'new';
  run.plan.push(
    `${docId}: ${fromStatus} → funds_returned ($${outcome.amount.toFixed(2)}; entries ${entryLinkStatus}` +
      ` [${linkedEntryIds.length}, ${toMark.length} to flag]${possible ? `; possible repayment offcycle ${possible.id}` : ''})`,
  );
  if (run.dryRun) return;

  const fundsReturnedAt = outcome.returnedAt
    ? admin.firestore.Timestamp.fromDate(outcome.returnedAt)
    : FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(
    db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/${docId}`),
    {
      tenantId: TENANT_ID,
      entityId: run.entityId,
      evereeTenantId: run.evereeTenantId,
      paymentId: payment.id,
      ...(existing.exists
        ? {}
        : {
            uid: uid || null,
            workerName: payment.payeeName,
            issue: 'deposit_returned',
            payDate: payment.payDate,
            grossAmount: payment.gross.toFixed(2),
            firstSeenAt: FieldValue.serverTimestamp(),
          }),
      status: 'funds_returned',
      stillOwed: true,
      fundsReturnedAt,
      fundsReturnedAmount: outcome.amount,
      fundsReturnedSource:
        `Everee payment ${payment.id}: deposit re-routed to the ${run.entityName} funding account` +
        `${outcome.bankName ? ` (${outcome.bankName})` : ''} — detected by the payroll payment-issue sweep`,
      fundsReturnedNote:
        `Everee gave up on the deposit and sent the money back to ${run.entityName}. Worker is STILL OWED ` +
        'this amount: repay with an off-cycle payment once their bank info is fixed.',
      fundsReturnedDetectedAt: FieldValue.serverTimestamp(),
      evereePaymentChain: chain.chainIds,
      entryLinkStatus,
      linkedEntryIds,
      linkedWorkDates,
      possibleRepayment: possible
        ? {
            offcycleId: possible.id,
            total: possible.total,
            createdAt: possible.createdAtMs ? admin.firestore.Timestamp.fromMillis(possible.createdAtMs) : null,
          }
        : FieldValue.delete(),
      resolvedAt: FieldValue.delete(),
      unconfirmedReason: FieldValue.delete(),
      unconfirmedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  const errorMessage = fundsReturnedEntryMessage({
    amount: outcome.amount,
    paymentId: payment.id,
    entityName: run.entityName,
    returnedAt: outcome.returnedAt,
  });
  for (const ref of toMark) {
    // update() — dotted paths address the nested everee map.
    batch.update(ref, {
      status: 'error',
      'everee.status': 'DEPOSIT_RETURNED',
      'everee.errorCode': 'deposit_returned',
      'everee.errorMessage': errorMessage,
      'everee.fundsReturnedAt': fundsReturnedAt,
      'everee.returnedPaymentId': payment.id,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'payroll_payment_issue_sweep',
    });
  }
  await batch.commit();
  logger.info('[payrollIssueSweep] funds returned', {
    docId,
    amount: outcome.amount,
    entryLinkStatus,
    flaggedEntries: toMark.length,
    possibleRepayment: Boolean(possible),
  });
}

async function markUnconfirmed(
  run: EntityRun,
  d: admin.firestore.QueryDocumentSnapshot,
  reason: UnconfirmedReason,
): Promise<boolean> {
  if (d.get('status') === 'deposit_unconfirmed' && d.get('unconfirmedReason') === reason) return false;
  run.plan.push(`${d.id}: ${d.get('status')} → deposit_unconfirmed (${reason})`);
  if (run.dryRun) return true;
  await d.ref.set(
    {
      status: 'deposit_unconfirmed',
      unconfirmedReason: reason,
      unconfirmedAt: FieldValue.serverTimestamp(),
      resolvedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  logger.info('[payrollIssueSweep] deposit unconfirmed', { docId: d.id, reason });
  return true;
}

/** A deposit_returned issue stopped reproducing: find out where the money went
 *  before calling it resolved. */
async function settleClearedDepositIssue(
  run: EntityRun,
  d: admin.firestore.QueryDocumentSnapshot,
): Promise<'resolved' | 'funds_returned' | 'deposit_unconfirmed' | 'unchanged'> {
  const chain = await fetchPaymentChain(run.config, String(d.get('paymentId')));
  if (!chain) {
    return (await markUnconfirmed(run, d, 'payment_not_found')) ? 'deposit_unconfirmed' : 'unchanged';
  }
  const outcome = classifyDepositOutcome(chain.payment, run.fundingAccounts);
  switch (outcome.kind) {
    case 'still_failing':
      return 'unchanged';
    case 'funds_returned':
      await recordFundsReturned(run, chain, outcome, d);
      return 'funds_returned';
    case 'worker_deposited':
      run.plan.push(`${d.id}: ${d.get('status')} → resolved (worker deposit $${outcome.amount.toFixed(2)})`);
      if (!run.dryRun) {
        await d.ref.set(
          {
            status: 'resolved',
            resolvedAt: FieldValue.serverTimestamp(),
            resolvedEvidence: 'worker_deposit',
            unconfirmedReason: FieldValue.delete(),
            unconfirmedAt: FieldValue.delete(),
          },
          { merge: true },
        );
        logger.info('[payrollIssueSweep] resolved', { docId: d.id, evidence: 'worker_deposit' });
      }
      return 'resolved';
    case 'in_flight': {
      const lastSeenMs = (d.get('lastSeenAt') as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
      if (d.get('status') === 'open' && Date.now() - lastSeenMs < IN_FLIGHT_MAX_DAYS * DAY_MS) return 'unchanged';
      return (await markUnconfirmed(run, d, 'deposit_in_flight')) ? 'deposit_unconfirmed' : 'unchanged';
    }
    case 'unconfirmed':
      return (await markUnconfirmed(run, d, outcome.reason)) ? 'deposit_unconfirmed' : 'unchanged';
  }
}

/** Orchestrator entry point (takes no arguments on purpose). */
export function runPayrollPaymentIssueSweep(): Promise<SweepResult> {
  return runPayrollPaymentIssueSweepCore();
}

export async function runPayrollPaymentIssueSweepCore(opts: SweepOptions = {}): Promise<SweepResult> {
  const start = Date.now();
  const dryRun = opts.dryRun === true;
  const plan: string[] = [];
  const gateRef = db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/_sweep_meta`);
  if (!opts.ignoreGate) {
    const gateSnap = await gateRef.get().catch(() => null);
    const lastRunAtMs = Number(gateSnap?.get('lastRunAtMs') ?? 0);
    if (Date.now() - lastRunAtMs < MIN_RUN_INTERVAL_MS) {
      return { success: true, durationMs: Date.now() - start, message: 'gated (ran recently)' };
    }
  }
  if (!dryRun) await gateRef.set({ lastRunAtMs: Date.now() }, { merge: true });

  let notified = 0;
  let errors = 0;
  const transitions = { resolved: 0, funds_returned: 0, deposit_unconfirmed: 0 };
  const openNow = new Set<string>();

  for (const entity of ENTITIES) {
    let run: EntityRun;
    let scan: Awaited<ReturnType<typeof scanEntity>>;
    try {
      const config = await getEvereeConfigForEntity(TENANT_ID, entity.entityId);
      if (!config) continue;
      const entitySnap = await db.doc(`tenants/${TENANT_ID}/entities/${entity.entityId}`).get();
      run = {
        ...entity,
        entityName: String(entitySnap.get('name') ?? '').trim() || entity.entityId,
        config,
        fundingAccounts: parseFundingAccounts(
          dryRun && opts.fundingAccountsOverride?.[entity.entityId] !== undefined
            ? opts.fundingAccountsOverride[entity.entityId]
            : entitySnap.get('evereeFundingAccounts'),
        ),
        dryRun,
        plan,
      };
      if (run.fundingAccounts.length === 0) {
        logger.warn('[payrollIssueSweep] no evereeFundingAccounts on entity — returned funds undetectable; cleared deposit issues go to deposit_unconfirmed', {
          entityId: entity.entityId,
        });
      }
      scan = await scanEntity(run);
    } catch (e: unknown) {
      errors += 1;
      logger.warn('[payrollIssueSweep] scan failed', { entityId: entity.entityId, message: errMessage(e) });
      continue;
    }

    for (const issue of scan.open) {
      const ref = db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/${issue.docId}`);
      const snap = await ref.get().catch(() => null);
      const data = (snap?.data() ?? {}) as Record<string, unknown>;
      // Returned funds belong to people now — never re-open or re-text.
      if (isFrozenIssueStatus(data.status)) continue;
      openNow.add(issue.docId);
      const notifyCount = Number(data.notifyCount ?? 0);
      const lastNotifiedAtMs = Number(data.lastNotifiedAtMs ?? 0);
      const isNew = !snap?.exists;

      if (dryRun) {
        if (data.status !== 'open') plan.push(`${issue.docId}: ${String(data.status ?? 'new')} → open (${issue.issue})`);
        continue;
      }

      await ref.set(
        {
          tenantId: TENANT_ID,
          entityId: issue.entityId,
          evereeTenantId: issue.evereeTenantId,
          paymentId: issue.paymentId,
          uid: issue.uid || null,
          workerName: issue.workerName,
          issue: issue.issue,
          payDate: issue.payDate,
          grossAmount: issue.gross,
          status: 'open',
          lastSeenAt: FieldValue.serverTimestamp(),
          ...(isNew ? { firstSeenAt: FieldValue.serverTimestamp() } : {}),
          resolvedAt: FieldValue.delete(),
          unconfirmedReason: FieldValue.delete(),
          unconfirmedAt: FieldValue.delete(),
        },
        { merge: true },
      );

      const remindWindowMs = REMIND_AFTER_DAYS * DAY_MS;
      const due =
        notifyCount === 0 ||
        (notifyCount < MAX_NOTIFY && Date.now() - lastNotifiedAtMs > remindWindowMs);
      if (!due || !issue.uid) continue;

      // One worker, one cadence: a worker with several stuck payments (all
      // fixed by the same action) must not get a text per payment. Skip if
      // ANY of their issue docs was notified inside the reminder window.
      const uidDocs = await db
        .collection(`tenants/${TENANT_ID}/payroll_payment_issues`)
        .where('uid', '==', issue.uid)
        .limit(20)
        .get()
        .catch(() => null);
      const uidNotifiedRecently = (uidDocs?.docs ?? []).some(
        (d) => Number(d.get('lastNotifiedAtMs') ?? 0) > Date.now() - remindWindowMs,
      );
      if (uidNotifiedRecently) continue;

      try {
        const userSnap = await db.doc(`users/${issue.uid}`).get();
        if (!userSnap.exists) {
          await ref.set({ notifySkipReason: 'no_user_doc' }, { merge: true });
          continue;
        }
        const userData = userSnap.data() as Record<string, unknown>;
        const phone = phoneE164FromUser(userData);
        if (!phone) {
          await ref.set({ notifySkipReason: 'no_phone' }, { merge: true });
          continue;
        }
        const lang = String(userData.preferredLanguage ?? '').toLowerCase() === 'es' ? 'es' : 'en';
        const messageTypeId =
          issue.issue === 'missing_tin' ? 'payroll_setup_blocking_pay' : 'payroll_payment_returned';
        const slotOk = await claimTypeDailySlot(TENANT_ID, issue.uid, messageTypeId, 1);
        if (!slotOk) continue;
        const result = await sendWorkerMessageInternal(
          phone,
          smsBody(issue.issue, lang, issue.evereeTenantId),
          {
            systemContext: true,
            tenantId: TENANT_ID,
            userId: issue.uid,
            messageTypeId,
            source: 'payroll_payment_issue_sweep',
            sourceId: issue.docId,
          },
        );
        if (result.success) {
          notified += 1;
          await ref.set(
            {
              notifyCount: notifyCount + 1,
              lastNotifiedAtMs: Date.now(),
              lastNotifiedAt: FieldValue.serverTimestamp(),
              notifySkipReason: FieldValue.delete(),
            },
            { merge: true },
          );
        } else {
          errors += 1;
          await ref.set({ notifySkipReason: `send_failed:${result.status}` }, { merge: true });
        }
      } catch (e: unknown) {
        errors += 1;
        logger.warn('[payrollIssueSweep] notify failed', { docId: issue.docId, message: errMessage(e) });
      }
    }

    // Returned funds: any scanned payment whose deposit landed in the
    // funding account — whether or not the sweep ever saw it bounce.
    const settled = new Set<string>();
    for (const paymentId of scan.returnedPaymentIds) {
      const docId = `${entity.entityId}__${paymentId}`;
      try {
        const snap = await db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/${docId}`).get();
        if (isFrozenIssueStatus(snap.get('status'))) continue;
        // The list row said so; the payment GET decides.
        const chain = await fetchPaymentChain(run.config, paymentId);
        const outcome = chain ? classifyDepositOutcome(chain.payment, run.fundingAccounts) : null;
        if (!chain || outcome?.kind !== 'funds_returned') continue;
        await recordFundsReturned(run, chain, outcome, snap);
        transitions.funds_returned += 1;
        settled.add(docId);
      } catch (e: unknown) {
        errors += 1;
        logger.warn('[payrollIssueSweep] funds-returned check failed', { docId, message: errMessage(e) });
      }
    }

    // Issues that no longer reproduce — only when the payment was actually
    // rescanned this run (a payment that aged past MAX_PAGES must not be
    // "resolved" just because we stopped looking at it).
    for (const status of ['open', 'deposit_unconfirmed'] as const) {
      const docs = await db
        .collection(`tenants/${TENANT_ID}/payroll_payment_issues`)
        .where('status', '==', status)
        .where('entityId', '==', entity.entityId)
        .get()
        .catch(() => null);
      for (const d of docs?.docs ?? []) {
        if (d.id === '_sweep_meta' || openNow.has(d.id) || settled.has(d.id)) continue;
        const pid = String(d.get('paymentId') ?? '');
        if (!pid || !scan.scannedPaymentIds.has(pid)) continue;
        if (d.get('issue') !== 'deposit_returned') {
          // bank_invalid / missing_tin never deposited, so nothing can have
          // been returned: cleared means resolved.
          if (status !== 'open') continue;
          plan.push(`${d.id}: open → resolved (${String(d.get('issue'))} cleared)`);
          transitions.resolved += 1;
          if (dryRun) continue;
          await d.ref.set({ status: 'resolved', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
          logger.info('[payrollIssueSweep] resolved', { docId: d.id });
          continue;
        }
        try {
          const result = await settleClearedDepositIssue(run, d);
          if (result !== 'unchanged') transitions[result] += 1;
        } catch (e: unknown) {
          errors += 1;
          logger.warn('[payrollIssueSweep] settle failed', { docId: d.id, message: errMessage(e) });
        }
      }
    }
  }

  const summary =
    `${openNow.size} open issues, ${notified} texted, ${transitions.funds_returned} funds returned, ` +
    `${transitions.deposit_unconfirmed} unconfirmed, ${transitions.resolved} resolved`;
  logger.info('[payrollIssueSweep] done', {
    openCount: openNow.size,
    notified,
    ...transitions,
    errors,
    dryRun,
    durationMs: Date.now() - start,
  });
  return {
    success: errors === 0,
    durationMs: Date.now() - start,
    itemsProcessed: openNow.size,
    errors,
    message: dryRun ? `DRY RUN — ${summary}` : summary,
    ...(dryRun ? { plan } : {}),
  };
}
