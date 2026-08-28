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
 * (`{entityId}__{paymentId}`) — the ops-visible record of currently-stuck
 * pay. Re-notify every REMIND_AFTER_DAYS while open, max MAX_NOTIFY sends;
 * marked resolved when the payment stops showing an issue (Everee retries
 * deposits automatically once the account is fixed).
 *
 * Cadence: hosted by `scheduledOrchestrator` (hourly) but self-gated to
 * every 6h via the marker doc — the scan pages the payments API, which is
 * too heavy to run every hour for a signal that changes daily.
 *
 * ☠️ PII: raw payment rows carry the worker's FULL SSN
 * (`employee.taxpayerIdentifier`). Everything here stays server-side and
 * only non-sensitive fields are persisted to the issue docs — never store
 * or log the raw payment/employee objects.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { claimTypeDailySlot } from '../messaging/rateLimiter';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { evereeRequest } from '../integrations/everee/evereeHttp';
import { derivePaymentIssue, type RawPayment } from '../integrations/everee/payHistory/mapPayments';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';
const ENTITIES: Array<{ entityId: string; evereeTenantId: string }> = [
  { entityId: 'c1_select_llc', evereeTenantId: '3133' },
  { entityId: 'c1_events_llc', evereeTenantId: '3138' },
];

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

interface SweepResult {
  success: boolean;
  durationMs: number;
  itemsProcessed?: number;
  errors?: number;
  message?: string;
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

function smsBody(issue: OpenIssue['issue'], lang: 'en' | 'es', evereeTenantId: string): string {
  const depositUrl = 'https://hrxone.com/c1/workers/payroll-settings';
  const setupUrl = `https://hrxone.com/c1/workers/earnings/${evereeTenantId}`;
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

/** Scan one entity's recent payments for worker-fixable issues. */
async function scanEntity(entity: { entityId: string; evereeTenantId: string }): Promise<{
  open: OpenIssue[];
  scannedPaymentIds: Set<string>;
}> {
  const open: OpenIssue[] = [];
  const scannedPaymentIds = new Set<string>();
  const config = await getEvereeConfigForEntity(TENANT_ID, entity.entityId);
  if (!config) return { open, scannedPaymentIds };
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = (await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/payments?page=${page}&size=500&include-workers-on-regular-pay-cycle=true`,
    )) as { items?: unknown[]; totalPages?: number };
    const items = Array.isArray(raw?.items) ? raw.items : [];
    let fresh = 0;
    for (const item of items) {
      const p = item as RawPayment & {
        id?: number | string;
        employee?: Record<string, unknown>;
        payeeDisplayFullName?: string;
        grossEarnings?: { amount?: string };
      };
      const paymentId = String(p.id ?? '');
      if (!paymentId || seen.has(paymentId)) continue;
      seen.add(paymentId);
      fresh += 1;
      scannedPaymentIds.add(paymentId);
      const payDate = String(p.payDate ?? p.forDate ?? '');
      if (!payDate || payDate < cutoff) continue;
      const issue = derivePaymentIssue(p);
      if (!issue) continue;
      const uid = String(p.employee?.externalWorkerId ?? '').trim();
      open.push({
        docId: `${entity.entityId}__${paymentId}`,
        entityId: entity.entityId,
        evereeTenantId: entity.evereeTenantId,
        paymentId,
        uid,
        workerName: String(p.payeeDisplayFullName ?? '').slice(0, 80),
        issue,
        payDate,
        gross: String(p.grossEarnings?.amount ?? ''),
      });
    }
    if (fresh === 0 || page + 1 >= Number(raw?.totalPages ?? 1)) break;
  }
  return { open, scannedPaymentIds };
}

export async function runPayrollPaymentIssueSweep(): Promise<SweepResult> {
  const start = Date.now();
  const gateRef = db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/_sweep_meta`);
  const gateSnap = await gateRef.get().catch(() => null);
  const lastRunAtMs = Number(gateSnap?.get('lastRunAtMs') ?? 0);
  if (Date.now() - lastRunAtMs < MIN_RUN_INTERVAL_MS) {
    return { success: true, durationMs: Date.now() - start, message: 'gated (ran recently)' };
  }
  await gateRef.set({ lastRunAtMs: Date.now() }, { merge: true });

  let notified = 0;
  let errors = 0;
  const openNow = new Set<string>();

  for (const entity of ENTITIES) {
    let scan: Awaited<ReturnType<typeof scanEntity>>;
    try {
      scan = await scanEntity(entity);
    } catch (e: unknown) {
      errors += 1;
      logger.warn('[payrollIssueSweep] scan failed', {
        entityId: entity.entityId,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
      continue;
    }

    for (const issue of scan.open) {
      openNow.add(issue.docId);
      const ref = db.doc(`tenants/${TENANT_ID}/payroll_payment_issues/${issue.docId}`);
      const snap = await ref.get().catch(() => null);
      const data = (snap?.data() ?? {}) as Record<string, unknown>;
      const notifyCount = Number(data.notifyCount ?? 0);
      const lastNotifiedAtMs = Number(data.lastNotifiedAtMs ?? 0);
      const isNew = !snap?.exists;

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
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(isNew ? { firstSeenAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
          resolvedAt: admin.firestore.FieldValue.delete(),
        },
        { merge: true },
      );

      const remindWindowMs = REMIND_AFTER_DAYS * 24 * 60 * 60 * 1000;
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
              lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
              notifySkipReason: admin.firestore.FieldValue.delete(),
            },
            { merge: true },
          );
        } else {
          errors += 1;
          await ref.set({ notifySkipReason: `send_failed:${result.status}` }, { merge: true });
        }
      } catch (e: unknown) {
        errors += 1;
        logger.warn('[payrollIssueSweep] notify failed', {
          docId: issue.docId,
          message: (e instanceof Error ? e.message : String(e)).slice(0, 200),
        });
      }
    }

    // Resolve issues that no longer reproduce — only when the payment was
    // actually rescanned this run (a payment that aged past MAX_PAGES must
    // not be "resolved" just because we stopped looking at it).
    const openDocs = await db
      .collection(`tenants/${TENANT_ID}/payroll_payment_issues`)
      .where('status', '==', 'open')
      .where('entityId', '==', entity.entityId)
      .get()
      .catch(() => null);
    for (const d of openDocs?.docs ?? []) {
      if (d.id === '_sweep_meta') continue;
      const pid = String(d.get('paymentId') ?? '');
      if (!pid || openNow.has(d.id) || !scan.scannedPaymentIds.has(pid)) continue;
      await d.ref.set(
        { status: 'resolved', resolvedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      logger.info('[payrollIssueSweep] resolved', { docId: d.id });
    }
  }

  logger.info('[payrollIssueSweep] done', {
    openCount: openNow.size,
    notified,
    errors,
    durationMs: Date.now() - start,
  });
  return {
    success: errors === 0,
    durationMs: Date.now() - start,
    itemsProcessed: openNow.size,
    errors,
    message: `${openNow.size} open issues, ${notified} texted`,
  };
}
