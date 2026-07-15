/**
 * Expensify company-card CSV export (EXP-5, 2026-07-15).
 *
 * WHY THIS EXISTS — read before "simplifying" it:
 * Expensify's API cannot create an expense for anyone but the credential
 * owner (confirmed by Concierge 2026-07-15: "only the user can create their
 * own expenses ... aside from when a company card is assigned and the bank
 * feed imports a company card expense"). So the API push (expensifyPush.ts)
 * can only ever serve Greg. The ONLY way an expense lands in Danny's account
 * is an assigned company card + a feed importing onto it. Relay won't supply
 * a commercial feed, and a self-hosted feed URL isn't a thing — Expensify's
 * commercial feeds are provisioned bank-side. That leaves the CSV import,
 * which is proven: card-number column creates the cards, you assign each to a
 * member ONCE, assignments survive re-uploads, and the resulting expenses are
 * OWNED by the cardholder.
 *
 * This module emits that CSV from QBO (the only source carrying card-level
 * detail, via Relay's QBO sync writing "**0009 Paid by Danny Rodriguez" into
 * the bank descriptor).
 *
 * TWO HARD-WON CONSTRAINTS:
 *  1. NEVER filter by transaction date. QBO's TxnDate has no relationship to
 *     when a row becomes API-visible — a Jul 5 charge surfaced Jul 15 when it
 *     finally cleared the Pending queue. A date window drops those forever.
 *     Hence the ledger: "everything not yet exported", date-blind.
 *  2. Expensify does NOT dedupe imports. Upload overlapping rows and you get
 *     duplicate expenses, every time. The ledger is the only guard, and it's
 *     stamped on CONFIRM (after the human uploads), never on download — a
 *     download that never reaches Expensify must not mark anything sent.
 *
 * Dates go out as MM/DD/YYYY: ISO dates are read as UTC and land a day early
 * (2026-07-14 imported as Jul 13 in testing). String-sliced, never Date().
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { qboQuery } from '../quickbooks/qboAuth';
import { parsePurchase, ParsedCardPurchase } from './expensifyPush';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const DEFAULT_SINCE = '2026-06-01';
const MAX_PURCHASES = 1000;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function cfgRef(tenantId: string) {
  return db.doc(`tenants/${tenantId}/integrations/expensify`);
}

function exportLedger(tenantId: string) {
  return cfgRef(tenantId).collection('exportedTransactions');
}

/** QBO gives YYYY-MM-DD. Expensify wants MM/DD/YYYY — and Date() would shift
 *  the day across timezones, so slice the string instead. */
function toUsDate(iso: string): string {
  const [y, m, d] = trim(iso).split('-');
  return y && m && d ? `${m}/${d}/${y}` : trim(iso);
}

function csvCell(v: string): string {
  const s = trim(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function assertAdmin(request: CallableRequest, tenantId: string): Promise<void> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const cfg = (await cfgRef(tenantId).get()).data() ?? {};
  const adminUids = (cfg.adminUids ?? []) as string[];
  if (adminUids.includes(uid)) return;
  const user = (await db.doc(`users/${uid}`).get()).data() ?? {};
  const level = String(user.securityLevel ?? '').toLowerCase();
  if (level === 'admin' || level === '7' || user.role === 'hrx_admin') return;
  throw new HttpsError('permission-denied', 'Admin only.');
}

export interface ExportRow {
  purchaseId: string;
  last4: string;
  date: string; // MM/DD/YYYY
  merchant: string;
  amount: number;
  cardholderName: string | null;
  email: string; // '' when the card isn't mapped yet
}

/** Everything with a card that we have NOT already exported. Date-blind by
 *  design — see constraint 1 in the header. */
async function collectUnexported(
  tenantId: string,
  since: string,
): Promise<{ rows: ExportRow[]; skippedNoCard: number; skippedPaused: number; alreadyExported: number }> {
  const res = await qboQuery(
    tenantId,
    `SELECT * FROM Purchase WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC MAXRESULTS ${MAX_PURCHASES}`,
  );
  const purchases = ((res.Purchase ?? []) as Array<Record<string, any>>).map(parsePurchase);

  const mapSnap = await db.collection(`tenants/${tenantId}/expensify_card_map`).get();
  const cardMap = new Map(mapSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));

  const withCard = purchases.filter((p: ParsedCardPurchase) => !!p.last4);
  const skippedNoCard = purchases.length - withCard.length;

  // Chunked existence check against the ledger (getAll caps at 100/‑ish).
  const seen = new Set<string>();
  const ids = withCard.map((p) => p.purchaseId);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => exportLedger(tenantId).doc(id)));
    snaps.forEach((s, j) => {
      if (s.exists) seen.add(chunk[j]);
    });
  }

  const rows: ExportRow[] = [];
  let skippedPaused = 0;
  for (const p of withCard) {
    if (seen.has(p.purchaseId)) continue;
    const mapping = cardMap.get(p.last4 as string);
    // Deliberately paused (e.g. Maria — Greg reconciles her card by hand).
    if (mapping?.active === false) {
      skippedPaused += 1;
      continue;
    }
    // Unmapped cards ARE included: the import creates the card in Expensify
    // and an admin assigns it there. That's the intended discovery path.
    rows.push({
      purchaseId: p.purchaseId,
      last4: p.last4 as string,
      date: toUsDate(p.txnDate),
      merchant: p.merchant,
      amount: p.amount,
      cardholderName: p.cardholderName,
      email: trim(mapping?.email),
    });
  }
  return { rows, skippedNoCard, skippedPaused, alreadyExported: seen.size };
}

/** Preview + CSV text for the next upload. Read-only: stamps nothing. */
export const previewExpensifyCardExport = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required.');
    await assertAdmin(request, tenantId);

    const cfg = (await cfgRef(tenantId).get()).data() ?? {};
    const since = trim(request.data?.since) || trim(cfg.exportSince) || DEFAULT_SINCE;

    const { rows, skippedNoCard, skippedPaused, alreadyExported } = await collectUnexported(tenantId, since);

    const header = 'Card Number,Posted Date,Merchant,Amount,Currency';
    const csv = [
      header,
      ...rows.map((r) =>
        [csvCell(r.last4), csvCell(r.date), csvCell(r.merchant), r.amount.toFixed(2), 'USD'].join(','),
      ),
    ].join('\n');

    const byCard: Record<string, { count: number; total: number; cardholderName: string | null; email: string }> = {};
    for (const r of rows) {
      const e = byCard[r.last4] ?? { count: 0, total: 0, cardholderName: r.cardholderName, email: r.email };
      e.count += 1;
      e.total = Number((e.total + r.amount).toFixed(2));
      byCard[r.last4] = e;
    }

    return {
      since,
      count: rows.length,
      total: Number(rows.reduce((s, r) => s + r.amount, 0).toFixed(2)),
      byCard,
      purchaseIds: rows.map((r) => r.purchaseId),
      csv,
      skippedNoCard,
      skippedPaused,
      alreadyExported,
      unmappedCards: Object.entries(byCard)
        .filter(([, v]) => !v.email)
        .map(([last4, v]) => ({ last4, cardholderName: v.cardholderName, count: v.count })),
    };
  },
);

/** Stamp the ledger AFTER the human confirms the file reached Expensify.
 *  Never call this from the download path — an unuploaded download must not
 *  mark anything sent, or those transactions are lost silently. */
export const confirmExpensifyCardExport = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const purchaseIds = (request.data?.purchaseIds ?? []) as string[];
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required.');
    if (!Array.isArray(purchaseIds) || purchaseIds.length === 0) {
      throw new HttpsError('invalid-argument', 'purchaseIds required.');
    }
    await assertAdmin(request, tenantId);

    const uid = request.auth?.uid ?? null;
    const batchId = `exp_${Date.now()}`;
    let written = 0;
    for (let i = 0; i < purchaseIds.length; i += 450) {
      const chunk = purchaseIds.slice(i, i + 450);
      const batch = db.batch();
      for (const id of chunk) {
        batch.set(
          exportLedger(tenantId).doc(trim(id)),
          {
            outcome: 'exported',
            batchId,
            confirmedBy: uid,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        written += 1;
      }
      await batch.commit();
    }

    await cfgRef(tenantId).set(
      {
        lastExportAt: admin.firestore.FieldValue.serverTimestamp(),
        lastExportCount: written,
        lastExportBatchId: batchId,
        lastExportBy: uid,
      },
      { merge: true },
    );

    return { confirmed: written, batchId };
  },
);
