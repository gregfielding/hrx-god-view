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
import { onSchedule } from 'firebase-functions/v2/scheduler';
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
        // QBO sub-customer hierarchy (RS3=Proof audit 2026-08-19): a
        // mapped parent's whole family must count as mapped everywhere.
        isSubCustomer: c.Job === true,
        parentCustomerId: trim((c.ParentRef as any)?.value) || null,
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

/**
 * A mapped customer's FAMILY: itself + all QBO sub-customers (any depth),
 * from the qbo_customers cache's parentCustomerId links. QBO books often
 * split one client into per-venue sub-customers ("RS3 Hospitality - Dell
 * Diamond" under "RS3 Hospitality"); every read keyed on a mapped
 * customerId must treat the whole family as that account (RS3=Proof,
 * 2026-08-19).
 */
export async function resolveCustomerFamily(tenantId: string, customerId: string): Promise<string[]> {
  const snap = await db.collection(`tenants/${tenantId}/qbo_customers`).limit(2000).get();
  const childrenByParent = new Map<string, string[]>();
  snap.forEach((d) => {
    const c = d.data();
    const parent = trim(c.parentCustomerId);
    const id = trim(c.customerId);
    if (parent && id) childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), id]);
  });
  const family: string[] = [];
  const queue = [customerId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    family.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return family;
}

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
  // Path shape: `quickbooks` is a subcollection of the account doc, so list
  // data must nest one level deeper (doc → `items` subcollection) to keep an
  // odd component count on collection paths.
  const base = `tenants/${tenantId}/accounts/${accountId}/quickbooks`;
  const today = todayIso();
  const logRef = db.collection(`${base}/syncLogs/items`).doc();

  try {
    // Whole customer family — a mapped parent's sub-customers' invoices
    // belong on this account's Invoicing tab too (RS3=Proof, 2026-08-19).
    const family = await resolveCustomerFamily(tenantId, customerId);
    const invoices: Array<Record<string, any>> = [];
    const payments: Array<Record<string, any>> = [];
    for (const famId of family) {
      // eslint-disable-next-line no-await-in-loop
      const [inv, pay] = await Promise.all([
        pagedQuery(
          tenantId,
          `SELECT * FROM Invoice WHERE CustomerRef = '${famId}' ORDERBY TxnDate DESC`,
          'Invoice',
        ),
        pagedQuery(
          tenantId,
          `SELECT * FROM Payment WHERE CustomerRef = '${famId}' ORDERBY TxnDate DESC`,
          'Payment',
        ),
      ]);
      invoices.push(...inv);
      payments.push(...pay);
    }

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
        db.doc(`${base}/invoices/items/${id}`),
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
          // The invoice's OWN customer (may be a sub-customer of the mapped one).
          customerId: trim((inv.CustomerRef as any)?.value) || customerId,
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
        db.doc(`${base}/payments/items/${id}`),
        {
          realmId,
          paymentId: id,
          txnDate: trim(p.TxnDate) || null,
          totalAmt: Number(p.TotalAmt ?? 0),
          unappliedAmt: Number(p.UnappliedAmt ?? 0),
          customerId: trim((p.CustomerRef as any)?.value) || customerId,
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

    await db.doc(`${base}/arSummary`).set(
      {
        realmId,
        customerId,
        familyCustomerIds: family,
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

/* ────────────────────────────────────────────────────────────────────
 * Read callables — ALL client reads of the financial caches flow
 * through these (the subcollections match no firestore.rules block, so
 * they are default-denied to clients; the level gate lives here).
 * ──────────────────────────────────────────────────────────────────── */

const tsToMillis = (v: unknown): number | null =>
  v && typeof (v as any).toMillis === 'function' ? (v as any).toMillis() : null;

/** Everything the per-account Invoicing tab renders, in one call (L5+). */
export const getQboAccountInvoicing = onCall({ cors: true }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  const accountId = trim(request.data?.accountId);
  if (!tenantId || !accountId) {
    throw new HttpsError('invalid-argument', 'tenantId and accountId are required');
  }
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 5);

  const base = `tenants/${tenantId}/accounts/${accountId}/quickbooks`;
  const [accountSnap, customerSnap, invoicesSnap, paymentsSnap, arSnap, logsSnap, tenantCfgSnap] =
    await Promise.all([
      db.doc(`tenants/${tenantId}/accounts/${accountId}`).get(),
      db.doc(`${base}/customer`).get(),
      db.collection(`${base}/invoices/items`).orderBy('txnDate', 'desc').limit(300).get(),
      db.collection(`${base}/payments/items`).orderBy('txnDate', 'desc').limit(300).get(),
      db.doc(`${base}/arSummary`).get(),
      db.collection(`${base}/syncLogs/items`).orderBy('createdAt', 'desc').limit(10).get(),
      db.doc(`tenants/${tenantId}/integrations/quickbooks`).get(),
    ]);

  const integration = (accountSnap.data()?.integrations?.quickbooks ?? {}) as Record<string, any>;
  return {
    connected: tenantCfgSnap.data()?.connected === true,
    integration: {
      status: integration.status ?? (tenantCfgSnap.data()?.connected === true ? 'connected_unmapped' : 'not_connected'),
      customerId: integration.customerId ?? null,
      customerDisplayName: integration.customerDisplayName ?? null,
      lastSyncAt: tsToMillis(integration.lastSyncAt),
      syncError: integration.syncError ?? null,
    },
    customer: customerSnap.exists ? { ...customerSnap.data(), syncedAt: undefined } : null,
    invoices: invoicesSnap.docs.map((d) => ({ ...d.data(), syncedAt: undefined })),
    payments: paymentsSnap.docs.map((d) => ({ ...d.data(), syncedAt: undefined })),
    arSummary: arSnap.exists ? { ...arSnap.data(), syncedAt: tsToMillis(arSnap.data()?.syncedAt) } : null,
    syncLogs: logsSnap.docs.map((d) => ({
      ...d.data(),
      createdAt: tsToMillis(d.data()?.createdAt),
    })),
  };
});

/** Global Invoicing dashboard payload (L7): aged report + recent
 *  activity + mapping health. */
/**
 * DSO + payment-speed per customer family (A/R report upgrade, Greg
 * 2026-08-19). DSO = open A/R ÷ billed-last-91-days × 91. "Trend" is
 * average days-to-pay for invoices ISSUED in the last 91 days vs the
 * 91 days before that — computable from live data without historical
 * snapshots. Sub-customers roll up to their family root.
 */
async function buildDsoBlock(tenantId: string): Promise<Array<Record<string, unknown>>> {
  const today = todayIso();
  const d91 = new Date(Date.now() - 91 * 86400000).toISOString().slice(0, 10);
  const d182 = new Date(Date.now() - 182 * 86400000).toISOString().slice(0, 10);

  const [invoices, payments, custSnap] = await Promise.all([
    pagedQuery(
      tenantId,
      `SELECT * FROM Invoice WHERE TxnDate >= '${d182}' ORDERBY TxnDate DESC`,
      'Invoice',
    ),
    pagedQuery(
      tenantId,
      `SELECT * FROM Payment WHERE TxnDate >= '${d182}' ORDERBY TxnDate DESC`,
      'Payment',
    ),
    db.collection(`tenants/${tenantId}/qbo_customers`).limit(2000).get(),
  ]);

  const parentOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const balanceOf = new Map<string, number>();
  custSnap.forEach((d) => {
    const c = d.data();
    const id = trim(c.customerId);
    if (!id) return;
    if (c.parentCustomerId) parentOf.set(id, String(c.parentCustomerId));
    nameOf.set(id, trim(c.displayName) || id);
    balanceOf.set(id, Number(c.balance ?? 0));
  });
  const rootOf = (id: string): string => {
    let cur = id;
    for (let hops = 0; hops < 10; hops++) {
      const p = parentOf.get(cur);
      if (!p) return cur;
      cur = p;
    }
    return cur;
  };

  // Latest payment date per invoice (via payment lines' LinkedTxn).
  const paidDateByInvoice = new Map<string, string>();
  for (const p of payments) {
    const pd = trim(p.TxnDate);
    if (!pd) continue;
    const lines = Array.isArray(p.Line) ? (p.Line as Array<Record<string, any>>) : [];
    for (const l of lines) {
      const txns = Array.isArray(l.LinkedTxn) ? (l.LinkedTxn as Array<Record<string, any>>) : [];
      for (const t of txns) {
        if (t.TxnType !== 'Invoice') continue;
        const invId = trim(t.TxnId);
        if (!invId) continue;
        const cur = paidDateByInvoice.get(invId);
        if (!cur || pd > cur) paidDateByInvoice.set(invId, pd);
      }
    }
  }

  interface DsoAgg {
    rootId: string;
    billed91: number;
    daysSumRecent: number;
    paidCountRecent: number;
    daysSumPrior: number;
    paidCountPrior: number;
  }
  const aggs = new Map<string, DsoAgg>();
  for (const inv of invoices) {
    const cid = trim((inv.CustomerRef as any)?.value);
    if (!cid) continue;
    const root = rootOf(cid);
    const a = aggs.get(root) ?? {
      rootId: root,
      billed91: 0,
      daysSumRecent: 0,
      paidCountRecent: 0,
      daysSumPrior: 0,
      paidCountPrior: 0,
    };
    const txnDate = trim(inv.TxnDate);
    const total = Number(inv.TotalAmt ?? 0);
    if (txnDate >= d91) a.billed91 = Math.round((a.billed91 + total) * 100) / 100;
    // Days-to-pay only for fully-paid invoices with a linked payment.
    const paidDate = paidDateByInvoice.get(trim(inv.Id));
    if (Number(inv.Balance ?? 0) === 0 && paidDate && txnDate) {
      const days = Math.max(0, (Date.parse(paidDate) - Date.parse(txnDate)) / 86400000);
      if (txnDate >= d91) {
        a.daysSumRecent += days;
        a.paidCountRecent += 1;
      } else {
        a.daysSumPrior += days;
        a.paidCountPrior += 1;
      }
    }
    aggs.set(root, a);
  }

  // Open A/R per family from the customer cache (includes invoices older
  // than the 182-day query window).
  const openByRoot = new Map<string, number>();
  for (const [id, bal] of balanceOf) {
    if (!bal) continue;
    const root = rootOf(id);
    openByRoot.set(root, Math.round(((openByRoot.get(root) ?? 0) + bal) * 100) / 100);
  }
  for (const root of openByRoot.keys()) {
    if (!aggs.has(root)) {
      aggs.set(root, { rootId: root, billed91: 0, daysSumRecent: 0, paidCountRecent: 0, daysSumPrior: 0, paidCountPrior: 0 });
    }
  }

  return Array.from(aggs.values())
    .map((a) => {
      const open = openByRoot.get(a.rootId) ?? 0;
      const avgRecent = a.paidCountRecent > 0 ? Math.round((a.daysSumRecent / a.paidCountRecent) * 10) / 10 : null;
      const avgPrior = a.paidCountPrior > 0 ? Math.round((a.daysSumPrior / a.paidCountPrior) * 10) / 10 : null;
      return {
        customerId: a.rootId,
        name: nameOf.get(a.rootId) ?? a.rootId,
        openBalance: open,
        billed91: a.billed91,
        dsoDays: a.billed91 > 0 ? Math.round(((open / a.billed91) * 91) * 10) / 10 : null,
        avgDaysToPayRecent: avgRecent,
        paidCountRecent: a.paidCountRecent,
        avgDaysToPayPrior: avgPrior,
        paidCountPrior: a.paidCountPrior,
        trendDays: avgRecent != null && avgPrior != null ? Math.round((avgRecent - avgPrior) * 10) / 10 : null,
        asOfDate: today,
      };
    })
    .filter((r) => (r.openBalance as number) > 0 || (r.billed91 as number) > 0)
    .sort((x, y) => (y.openBalance as number) - (x.openBalance as number));
}

export const getQboDashboard = onCall({ cors: true }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  await ensureInvoicingAccess(request.auth?.uid, request.auth?.token as any, tenantId, 7);

  const [agedSnap, recentSnap, mappedSnap, customersSnap, tenantCfgSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}/qbo_reports/agedReceivables`).get(),
    db.doc(`tenants/${tenantId}/qbo_reports/recentActivity`).get(),
    db
      .collection(`tenants/${tenantId}/accounts`)
      .where('integrations.quickbooks.status', '==', 'mapped')
      .limit(500)
      .get(),
    db.collection(`tenants/${tenantId}/qbo_customers`).limit(2000).get(),
    db.doc(`tenants/${tenantId}/integrations/quickbooks`).get(),
  ]);

  const mappedAccounts = mappedSnap.docs.map((d) => ({
    accountId: d.id,
    name: d.data().name ?? d.id,
    customerId: d.data().integrations?.quickbooks?.customerId ?? null,
    customerDisplayName: d.data().integrations?.quickbooks?.customerDisplayName ?? null,
  }));
  const mappedCustomerIds = new Set(mappedAccounts.map((a) => a.customerId).filter(Boolean));
  // A sub-customer counts as mapped when any ancestor is mapped (QBO
  // parent/sub-customer hierarchy — RS3=Proof, 2026-08-19).
  const parentOf = new Map<string, string>();
  customersSnap.docs.forEach((d) => {
    const c = d.data();
    if (c.customerId && c.parentCustomerId) parentOf.set(String(c.customerId), String(c.parentCustomerId));
  });
  const effectivelyMapped = (customerId: string): boolean => {
    let id: string | undefined = customerId;
    for (let hops = 0; id && hops < 10; hops++) {
      if (mappedCustomerIds.has(id)) return true;
      id = parentOf.get(id);
    }
    return false;
  };
  const unmappedCustomersWithBalance = customersSnap.docs
    .map((d) => d.data())
    .filter((c) => Number(c.balance ?? 0) > 0 && !effectivelyMapped(String(c.customerId)))
    .map((c) => ({
      customerId: c.customerId,
      displayName: c.displayName,
      balance: Number(c.balance ?? 0),
      active: c.active !== false,
    }))
    .sort((a, b) => b.balance - a.balance);

  // DSO block (A/R report upgrade) — opt-in: live QBO queries.
  let dso: Array<Record<string, unknown>> | null = null;
  let dsoError: string | null = null;
  if (request.data?.includeDso === true) {
    try {
      dso = await buildDsoBlock(tenantId);
    } catch (err) {
      dsoError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    connected: tenantCfgSnap.data()?.connected === true,
    dso,
    dsoError,
    agedReceivables: agedSnap.exists
      ? { report: agedSnap.data()?.report ?? null, fetchedAt: tsToMillis(agedSnap.data()?.fetchedAt) }
      : null,
    recentActivity: recentSnap.exists
      ? {
          invoices: recentSnap.data()?.invoices ?? [],
          payments: recentSnap.data()?.payments ?? [],
          fetchedAt: tsToMillis(recentSnap.data()?.fetchedAt),
        }
      : null,
    mappingHealth: {
      mappedAccounts,
      customerCount: customersSnap.size,
      unmappedCustomersWithBalance,
    },
  };
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 2 — freshness cron. Every 30 minutes: for each tenant with a
 * connected realm, refresh the company rollup and re-sync every mapped
 * account. At C1 scale (≤ a few dozen customers) a full re-sync is
 * simpler and just as cheap as CDC; swap in the /cdc endpoint if the
 * customer count ever makes this slow.
 * ──────────────────────────────────────────────────────────────────── */

export const qboRefreshCron = onSchedule(
  { schedule: 'every 30 minutes', timeoutSeconds: 540, memory: '512MiB', retryCount: 0 },
  async () => {
    const tenants = await db.collection('tenants').limit(100).get();
    for (const t of tenants.docs) {
      const tenantId = t.id;
      try {
        const cfg = (await db.doc(`tenants/${tenantId}/integrations/quickbooks`).get()).data();
        if (cfg?.connected !== true) continue;
        await runSyncQboCompanyRollup(tenantId);
        await runSyncQboCustomers(tenantId);
        const mapped = await db
          .collection(`tenants/${tenantId}/accounts`)
          .where('integrations.quickbooks.status', '==', 'mapped')
          .limit(200)
          .get();
        for (const acct of mapped.docs) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await runSyncQboAccountData(tenantId, acct.id, 'qboRefreshCron');
          } catch (err) {
            logger.warn('[qboRefreshCron] account sync failed', {
              tenantId,
              accountId: acct.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        logger.info('[qboRefreshCron] tenant refreshed', { tenantId, mappedAccounts: mapped.size });
      } catch (err) {
        logger.warn('[qboRefreshCron] tenant refresh failed', {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
