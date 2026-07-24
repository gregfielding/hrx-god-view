/**
 * QBO deep integration — Phase 1 read spine (2026-07-24).
 *
 * Decisions locked with Greg:
 *   - QBO customers are the source of truth; HRX accounts LINK to them
 *     (no HRX→QBO customer creation in this phase).
 *   - Mapping generally lives at the NATIONAL PARENT (children may map,
 *     with an advisory warning when both levels are mapped).
 *   - One QBO realm serves the whole tenant (both hiring entities).
 *
 * Pieces (see docs/QBO_INVOICING_BUILD_PLAN.md):
 *   1a. syncQboCustomers        — customer directory cache
 *   1b. listQboCustomers, mapAccountToQboCustomer, unmapAccountQboCustomer
 *   1c. syncQboAccountData      — invoices + payments + A/R per account
 *   1d. syncQboCompanyRollup    — AgedReceivables report + recent activity
 *
 * All cache shapes mirror the scaffolded types in
 * src/types/recruiter/account.ts (AccountQuickBooks*Doc) and the path
 * builders in src/data/firestorePaths.ts. Internal `run*` functions are
 * exported for the future CDC cron and for ops scripts; the onCall
 * wrappers just gate + delegate.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { getQboAccessToken, qboQuery } from './qboAuth';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Mirrors qboAuth's module-private constants (not exported there).
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const MINOR_VERSION = '75';

const FieldValue = admin.firestore.FieldValue;
const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/* ────────────────────────────────────────────────────────────────────
 * Access gate — invoicing surfaces are level 5-7 (account tab) and 7
 * (global). hrx staff claim always passes.
 * ──────────────────────────────────────────────────────────────────── */

async function ensureInvoicingAccess(
  uid: string | undefined,
  token: Record<string, unknown> | undefined,
  tenantId: string,
  minLevel: number,
): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= minLevel && level <= 7) return;
  throw new HttpsError(
    'permission-denied',
    `Invoicing access requires tenant security level ${minLevel}+.`,
  );
}

/* ────────────────────────────────────────────────────────────────────
 * QBO helpers on top of qboAuth
 * ──────────────────────────────────────────────────────────────────── */

/** GET a non-query endpoint (reports). Returns parsed JSON. */
async function qboGet(
  tenantId: string,
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const { accessToken, realmId } = await getQboAccessToken(tenantId);
  const qs = new URLSearchParams({ minorversion: MINOR_VERSION, ...params }).toString();
  const url = `${API_BASE}/${realmId}/${path}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const intuitTid = res.headers.get('intuit_tid') ?? 'n/a';
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    logger.error('[qboInvoicing] GET failed', { status: res.status, intuitTid, path });
    throw new Error(`QBO GET ${path} ${res.status} (intuit_tid=${intuitTid})`);
  }
  return json;
}

/** Page a query until a short page comes back. `entityKey` is the
 *  QueryResponse array key (e.g. 'Customer', 'Invoice'). */
async function pagedQuery(
  tenantId: string,
  baseQuery: string,
  entityKey: string,
  pageSize = 1000,
  maxPages = 20,
): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = [];
  for (let page = 0; page < maxPages; page++) {
    const start = page * pageSize + 1;
    const q = `${baseQuery} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    // eslint-disable-next-line no-await-in-loop
    const resp = await qboQuery(tenantId, q);
    const items = (resp[entityKey] ?? []) as Array<Record<string, any>>;
    out.push(...items);
    if (items.length < pageSize) break;
  }
  return out;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/* ────────────────────────────────────────────────────────────────────
 * 1a. Customer directory cache
 *     tenants/{t}/qbo_customers/{realmId}__{customerId}
 * ──────────────────────────────────────────────────────────────────── */

export async function runSyncQboCustomers(
  tenantId: string,
): Promise<{ count: number; realmId: string }> {
  const { realmId } = await getQboAccessToken(tenantId);
  const customers = await pagedQuery(
    tenantId,
    // Include inactive so historical mappings still resolve to a name.
    "SELECT * FROM Customer WHERE Active IN (true, false)",
    'Customer',
  );
  let writer = db.batch();
  let pending = 0;
  for (const c of customers) {
    const id = trim(c.Id);
    if (!id) continue;
    writer.set(
      db.doc(`tenants/${tenantId}/qbo_customers/${realmId}__${id}`),
      {
        realmId,
        customerId: id,
        displayName: trim(c.DisplayName),
        fullyQualifiedName: trim(c.FullyQualifiedName) || trim(c.DisplayName),
        active: c.Active !== false,
        balance: Number(c.Balance ?? 0),
        primaryEmailAddr: trim((c.PrimaryEmailAddr as any)?.Address) || null,
        primaryPhone: trim((c.PrimaryPhone as any)?.FreeFormNumber) || null,
        syncToken: trim(c.SyncToken) || null,
        lastSyncAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    pending += 1;
    if (pending >= 400) {
      // eslint-disable-next-line no-await-in-loop
      await writer.commit();
      writer = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await writer.commit();
  logger.info('[qboInvoicing] customer cache synced', { tenantId, realmId, count: customers.length });
  return { count: customers.length, realmId };
}

export const syncQboCustomers = onCall({ cors: true, timeoutSeconds: 300 }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 6);
  return runSyncQboCustomers(tenantId);
});

/** Full cached directory — small at C1 scale; the client filters locally. */
export const listQboCustomers = onCall({ cors: true }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 5);
  const snap = await db.collection(`tenants/${tenantId}/qbo_customers`).limit(2000).get();
  const customers = snap.docs.map((d) => {
    const c = d.data();
    return {
      customerId: c.customerId,
      displayName: c.displayName,
      fullyQualifiedName: c.fullyQualifiedName,
      active: c.active !== false,
      balance: Number(c.balance ?? 0),
    };
  });
  customers.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  return { customers, needsSync: customers.length === 0 };
});

/* ────────────────────────────────────────────────────────────────────
 * 1b. Mapping
 * ──────────────────────────────────────────────────────────────────── */

export const mapAccountToQboCustomer = onCall({ cors: true }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  const accountId = trim(request.data?.accountId);
  const customerId = trim(request.data?.customerId);
  if (!tenantId || !accountId || !customerId) {
    throw new HttpsError('invalid-argument', 'tenantId, accountId and customerId are required');
  }
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 5);

  const { realmId } = await getQboAccessToken(tenantId);
  const custSnap = await db.doc(`tenants/${tenantId}/qbo_customers/${realmId}__${customerId}`).get();
  if (!custSnap.exists) {
    throw new HttpsError(
      'not-found',
      'That QuickBooks customer is not in the cached directory — run the customer sync first.',
    );
  }
  const cust = custSnap.data() ?? {};

  const accountRef = db.doc(`tenants/${tenantId}/accounts/${accountId}`);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) throw new HttpsError('not-found', 'Account not found');
  const account = accountSnap.data() ?? {};

  // Double-billing advisory (mapping generally lives at the PARENT):
  // warn when this map would put a customer on both a national parent
  // and one of its children.
  let warning: string | null = null;
  try {
    const parentId = trim(account.parentAccountId);
    if (parentId) {
      const parent = (await db.doc(`tenants/${tenantId}/accounts/${parentId}`).get()).data() ?? {};
      if (trim(parent?.integrations?.quickbooks?.customerId)) {
        warning =
          `Heads up: the national parent account is already mapped to QuickBooks customer ` +
          `"${parent.integrations.quickbooks.customerDisplayName ?? parent.integrations.quickbooks.customerId}". ` +
          'Mapping the child too risks double-billing — the standard is to map at the parent.';
      }
    } else {
      const kids = await db
        .collection(`tenants/${tenantId}/accounts`)
        .where('parentAccountId', '==', accountId)
        .limit(50)
        .get();
      const mappedKid = kids.docs.find((d) => trim(d.data()?.integrations?.quickbooks?.customerId));
      if (mappedKid) {
        warning =
          `Heads up: child account "${mappedKid.data().name ?? mappedKid.id}" is already mapped to a ` +
          'QuickBooks customer. Having both parent and child mapped risks double-billing.';
      }
    }
  } catch {
    /* advisory only — never block the map on it */
  }

  await accountRef.set(
    {
      integrations: {
        quickbooks: {
          realmId,
          customerId,
          customerDisplayName: trim(cust.displayName) || customerId,
          status: 'mapped',
          syncError: null,
          mappedAt: FieldValue.serverTimestamp(),
          mappedBy: request.auth!.uid,
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  // Snapshot the customer beside the account cache for the tab header.
  await db.doc(`tenants/${tenantId}/accounts/${accountId}/quickbooks/customer`).set(
    {
      realmId,
      customerId,
      displayName: cust.displayName ?? null,
      fullyQualifiedName: cust.fullyQualifiedName ?? null,
      primaryEmailAddr: cust.primaryEmailAddr ?? null,
      primaryPhone: cust.primaryPhone ?? null,
      active: cust.active !== false,
      syncedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true, warning };
});

export const unmapAccountQboCustomer = onCall({ cors: true }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  const accountId = trim(request.data?.accountId);
  if (!tenantId || !accountId) {
    throw new HttpsError('invalid-argument', 'tenantId and accountId are required');
  }
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 5);
  await db.doc(`tenants/${tenantId}/accounts/${accountId}`).set(
    {
      integrations: {
        quickbooks: {
          customerId: null,
          customerDisplayName: null,
          status: 'connected_unmapped',
          syncError: null,
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
});

/* ────────────────────────────────────────────────────────────────────
 * 1c. Per-account sync — invoices + payments + A/R summary
 * ──────────────────────────────────────────────────────────────────── */

function invoiceStatus(inv: Record<string, any>, today: string): string {
  const balance = Number(inv.Balance ?? 0);
  if (balance <= 0) return 'paid';
  const due = trim(inv.DueDate);
  return due && due < today ? 'overdue' : 'open';
}

function agingBucket(dueDate: string, today: string): keyof ArBuckets {
  if (!dueDate || dueDate >= today) return 'current';
  const days = Math.floor(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${dueDate}T12:00:00`).getTime()) / 86400000,
  );
  if (days <= 30) return 'days1to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'over90';
}

interface ArBuckets {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

export async function runSyncQboAccountData(
  tenantId: string,
  accountId: string,
  ranBy: string,
): Promise<{ invoices: number; payments: number; totalOpenBalance: number }> {
  const accountRef = db.doc(`tenants/${tenantId}/accounts/${accountId}`);
  const account = (await accountRef.get()).data() ?? {};
  const mapping = (account.integrations?.quickbooks ?? {}) as Record<string, any>;
  const customerId = trim(mapping.customerId);
  if (!customerId) {
    throw new HttpsError('failed-precondition', 'Account is not mapped to a QuickBooks customer.');
  }
  const { realmId } = await getQboAccessToken(tenantId);
  const base = `tenants/${tenantId}/accounts/${accountId}/quickbooks`;
  const today = todayIso();
  const logRef = db.collection(`${base}/syncLogs`).doc();

  try {
    const [invoices, payments] = await Promise.all([
      pagedQuery(
        tenantId,
        `SELECT * FROM Invoice WHERE CustomerRef = '${customerId}' ORDERBY TxnDate DESC`,
        'Invoice',
      ),
      pagedQuery(
        tenantId,
        `SELECT * FROM Payment WHERE CustomerRef = '${customerId}' ORDERBY TxnDate DESC`,
        'Payment',
      ),
    ]);

    let writer = db.batch();
    let pending = 0;
    const flush = async () => {
      if (pending > 0) {
        await writer.commit();
        writer = db.batch();
        pending = 0;
      }
    };

    const buckets: ArBuckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
    let totalOpen = 0;

    for (const inv of invoices) {
      const id = trim(inv.Id);
      if (!id) continue;
      const balance = Number(inv.Balance ?? 0);
      if (balance > 0) {
        totalOpen += balance;
        buckets[agingBucket(trim(inv.DueDate), today)] += balance;
      }
      writer.set(
        db.doc(`${base}/invoices/${id}`),
        {
          realmId,
          invoiceId: id,
          docNumber: trim(inv.DocNumber) || null,
          txnDate: trim(inv.TxnDate) || null,
          dueDate: trim(inv.DueDate) || null,
          totalAmt: Number(inv.TotalAmt ?? 0),
          balance,
          status: invoiceStatus(inv, today),
          currencyRef: trim((inv.CurrencyRef as any)?.value) || null,
          customerId,
          customerName: trim((inv.CustomerRef as any)?.name) || null,
          emailStatus: trim(inv.EmailStatus) || null,
          printStatus: trim(inv.PrintStatus) || null,
          syncedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      pending += 1;
      if (pending >= 400) await flush();
    }

    for (const p of payments) {
      const id = trim(p.Id);
      if (!id) continue;
      const linkedInvoiceIds = Array.isArray(p.Line)
        ? (p.Line as Array<Record<string, any>>)
            .flatMap((l) => (Array.isArray(l.LinkedTxn) ? l.LinkedTxn : []))
            .filter((t: Record<string, any>) => t.TxnType === 'Invoice')
            .map((t: Record<string, any>) => trim(t.TxnId))
            .filter(Boolean)
        : [];
      writer.set(
        db.doc(`${base}/payments/${id}`),
        {
          realmId,
          paymentId: id,
          txnDate: trim(p.TxnDate) || null,
          totalAmt: Number(p.TotalAmt ?? 0),
          unappliedAmt: Number(p.UnappliedAmt ?? 0),
          customerId,
          paymentRefNum: trim(p.PaymentRefNum) || null,
          linkedInvoiceIds,
          syncedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      pending += 1;
      if (pending >= 400) await flush();
    }
    await flush();

    await db.doc(`${base}/arSummary/current`).set(
      {
        realmId,
        customerId,
        totalOpenBalance: Math.round(totalOpen * 100) / 100,
        current: Math.round(buckets.current * 100) / 100,
        days1to30: Math.round(buckets.days1to30 * 100) / 100,
        days31to60: Math.round(buckets.days31to60 * 100) / 100,
        days61to90: Math.round(buckets.days61to90 * 100) / 100,
        over90: Math.round(buckets.over90 * 100) / 100,
        asOfDate: today,
        syncedAt: FieldValue.serverTimestamp(),
      },
      { merge: false },
    );

    await accountRef.set(
      {
        integrations: {
          quickbooks: {
            status: 'mapped',
            syncError: null,
            lastSyncAt: FieldValue.serverTimestamp(),
            lastInvoiceSyncAt: FieldValue.serverTimestamp(),
            lastPaymentSyncAt: FieldValue.serverTimestamp(),
            lastArSyncAt: FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true },
    );
    await logRef.set({
      type: 'invoice',
      status: 'success',
      message: `Synced ${invoices.length} invoices, ${payments.length} payments; open balance $${totalOpen.toFixed(2)}.`,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: ranBy,
    });

    return {
      invoices: invoices.length,
      payments: payments.length,
      totalOpenBalance: Math.round(totalOpen * 100) / 100,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await accountRef.set(
      { integrations: { quickbooks: { status: 'sync_error', syncError: message.slice(0, 300) } } },
      { merge: true },
    );
    await logRef.set({
      type: 'invoice',
      status: 'error',
      message: message.slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: ranBy,
    });
    throw err;
  }
}

export const syncQboAccountData = onCall({ cors: true, timeoutSeconds: 300 }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  const accountId = trim(request.data?.accountId);
  if (!tenantId || !accountId) {
    throw new HttpsError('invalid-argument', 'tenantId and accountId are required');
  }
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 5);
  return runSyncQboAccountData(tenantId, accountId, request.auth!.uid);
});

/* ────────────────────────────────────────────────────────────────────
 * 1d. Company rollup — AgedReceivables report + recent activity
 *     tenants/{t}/qbo_reports/agedReceivables
 *     tenants/{t}/qbo_reports/recentActivity
 * ──────────────────────────────────────────────────────────────────── */

export async function runSyncQboCompanyRollup(
  tenantId: string,
): Promise<{ agedRows: number; recentInvoices: number; recentPayments: number }> {
  const { realmId } = await getQboAccessToken(tenantId);

  // Accountant-grade aging — the Reports API is the TRUTH for totals
  // (voids/credit memos included), entity queries are the truth for lists.
  const aged = await qboGet(tenantId, 'reports/AgedReceivables', {});
  const agedRows = Array.isArray((aged.Rows as any)?.Row) ? (aged.Rows as any).Row.length : 0;
  await db.doc(`tenants/${tenantId}/qbo_reports/agedReceivables`).set({
    realmId,
    report: JSON.parse(JSON.stringify(aged)),
    fetchedAt: FieldValue.serverTimestamp(),
  });

  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const today = todayIso();
  const [recentInvoices, recentPayments] = await Promise.all([
    qboQuery(
      tenantId,
      `SELECT Id, DocNumber, TxnDate, DueDate, TotalAmt, Balance, CustomerRef FROM Invoice WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS 200`,
    ),
    qboQuery(
      tenantId,
      `SELECT Id, TxnDate, TotalAmt, UnappliedAmt, CustomerRef, PaymentRefNum FROM Payment WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS 200`,
    ),
  ]);
  const invoices = ((recentInvoices.Invoice ?? []) as Array<Record<string, any>>).map((inv) => ({
    invoiceId: trim(inv.Id),
    docNumber: trim(inv.DocNumber) || null,
    txnDate: trim(inv.TxnDate) || null,
    dueDate: trim(inv.DueDate) || null,
    totalAmt: Number(inv.TotalAmt ?? 0),
    balance: Number(inv.Balance ?? 0),
    status: invoiceStatus(inv, today),
    customerId: trim((inv.CustomerRef as any)?.value) || null,
    customerName: trim((inv.CustomerRef as any)?.name) || null,
  }));
  const payments = ((recentPayments.Payment ?? []) as Array<Record<string, any>>).map((p) => ({
    paymentId: trim(p.Id),
    txnDate: trim(p.TxnDate) || null,
    totalAmt: Number(p.TotalAmt ?? 0),
    unappliedAmt: Number(p.UnappliedAmt ?? 0),
    customerId: trim((p.CustomerRef as any)?.value) || null,
    customerName: trim((p.CustomerRef as any)?.name) || null,
    paymentRefNum: trim(p.PaymentRefNum) || null,
  }));
  await db.doc(`tenants/${tenantId}/qbo_reports/recentActivity`).set({
    realmId,
    invoices,
    payments,
    since,
    fetchedAt: FieldValue.serverTimestamp(),
  });

  logger.info('[qboInvoicing] company rollup synced', {
    tenantId,
    realmId,
    agedRows,
    recentInvoices: invoices.length,
    recentPayments: payments.length,
  });
  return { agedRows, recentInvoices: invoices.length, recentPayments: payments.length };
}

export const syncQboCompanyRollup = onCall({ cors: true, timeoutSeconds: 300 }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 7);
  return runSyncQboCompanyRollup(tenantId);
});
