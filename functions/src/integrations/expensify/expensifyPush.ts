/**
 * Expensify card-expense pipeline (EXP-3/EXP-4, 2026-07-14).
 *
 * Relay card purchases sync into QuickBooks with the card last-4 and
 * cardholder name embedded in the bank descriptor ("… **9423 Paid by Greg
 * Fielding …" — verified 25/25 on live data). This module pulls new
 * Purchase entities from QBO daily, routes each by the card→worker map,
 * and creates the expense in that worker's Expensify account via the
 * documented Integration Server API. Workers classify + attach receipts
 * in Expensify; HRX guarantees routing, exactly-once delivery, and the
 * paper trail.
 *
 * Config (tenants/{tid}/integrations/expensify):
 *   mode: 'off' | 'test' | 'live'  — 'test' routes EVERY expense to
 *     testEmail (safe first-run against the Test Workspace); 'off' parses
 *     and maps but pushes nothing.
 *   testEmail, policyID (optional workspace pin), lookbackDays (default 14).
 *
 * Card map (tenants/{tid}/expensify_card_map/{last4}):
 *   { last4, cardholderName, email, userId?, active } — email empty means
 *   "needs mapping": the cron auto-creates a stub on first sight of an
 *   unknown card and notifies admins; transactions for it stay queued
 *   (NOT ledgered) and flow automatically once the card is mapped.
 *
 * Ledger (…/integrations/expensify/pushedTransactions/{purchaseId}):
 *   exactly-once — written only on successful push or terminal skip
 *   ('no_card' = not a card purchase, e.g. ACH payroll pulls).
 *
 * NOTE (Intuit app assessment attestations): QBO calls are once daily;
 * QBO data is never sent to generative AI; tokens/credentials stay
 * server-side. Revisit those answers with Intuit before changing any of
 * this.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { qboQuery } from '../quickbooks/qboAuth';
import { sendNotificationAndPush } from '../../messaging/unifiedWorkerNotifications';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const EXPENSIFY_API = 'https://integrations.expensify.com/Integration-Server/ExpensifyIntegrations';
const CARD_RE = /\*\*(\d{4})/;
const PAID_BY_RE = /Paid by ([^|]+?)(?:\s*\(|\s*-\s+[A-Z]|$)/;
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_PURCHASES_PER_RUN = 300;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function expensifyCreds(): { partnerUserID: string; partnerUserSecret: string } | null {
  const partnerUserID = trim(process.env.EXPENSIFY_PARTNER_USER_ID);
  const partnerUserSecret = trim(process.env.EXPENSIFY_PARTNER_USER_SECRET);
  return partnerUserID && partnerUserSecret ? { partnerUserID, partnerUserSecret } : null;
}

function cfgRef(tenantId: string) {
  return db.doc(`tenants/${tenantId}/integrations/expensify`);
}

export interface ParsedCardPurchase {
  purchaseId: string;
  txnDate: string;
  amount: number;
  merchant: string;
  last4: string | null;
  cardholderName: string | null;
  note: string;
}

/** Extract routing info from a QBO Purchase entity's bank descriptor. */
export function parsePurchase(p: Record<string, any>): ParsedCardPurchase {
  const note = trim(p.PrivateNote);
  // Descriptor shape: "<merchant> - Purchase from <RAW> | Address: … | **NNNN Paid by <Name> (…) - <category>"
  const merchant =
    trim(note.split(' - Purchase from ')[0]) ||
    trim(p.EntityRef?.name) ||
    'Card purchase';
  return {
    purchaseId: trim(p.Id),
    txnDate: trim(p.TxnDate),
    amount: Number(p.TotalAmt ?? 0),
    merchant: merchant.slice(0, 100),
    last4: note.match(CARD_RE)?.[1] ?? null,
    cardholderName: note.match(PAID_BY_RE)?.[1]?.trim() ?? null,
    note,
  };
}

/** Create expenses in a worker's Expensify account (documented API). */
async function pushExpensesToExpensify(
  employeeEmail: string,
  policyID: string | null,
  expenses: ParsedCardPurchase[],
): Promise<{ ok: boolean; error?: string }> {
  const creds = expensifyCreds();
  if (!creds) return { ok: false, error: 'Expensify credentials not configured' };
  const job = {
    type: 'create',
    credentials: creds,
    inputSettings: {
      type: 'expenses',
      employeeEmail,
      transactionList: expenses.map((e) => ({
        created: e.txnDate,
        currency: 'USD',
        merchant: e.merchant,
        // Expensify amounts are integer cents.
        amount: Math.round(e.amount * 100),
        comment: `Relay card •${e.last4} — imported by HRX (QBO #${e.purchaseId})`,
        ...(policyID ? { policyID } : {}),
      })),
    },
  };
  try {
    const res = await fetch(EXPENSIFY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ requestJobDescription: JSON.stringify(job) }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (Number(body.responseCode) === 200) return { ok: true };
    return { ok: false, error: `responseCode=${body.responseCode} ${trim(body.responseMessage).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function notifyAdmins(tenantId: string, title: string, body: string): Promise<void> {
  const cfg = (await cfgRef(tenantId).get()).data() ?? {};
  const uids: string[] = Array.isArray(cfg.adminUids) ? (cfg.adminUids as unknown[]).map(String) : [];
  for (const uid of uids) {
    await sendNotificationAndPush({
      uid,
      tenantId,
      title,
      body,
      type: 'system',
      category: 'system',
      deepLink: '/invoicing',
      source: 'automation',
      metadata: { kind: 'expensify_pipeline' },
    }).catch(() => undefined);
  }
}

/** One tenant's pull-route-push cycle. Exported for the scratch test runner. */
export async function runExpensifyCardPush(tenantId: string): Promise<{
  scanned: number;
  pushed: number;
  queuedUnmapped: number;
  skippedNoCard: number;
  errors: number;
}> {
  const cfg = (await cfgRef(tenantId).get()).data() ?? {};
  const mode = trim(cfg.mode) || 'off';
  const stats = { scanned: 0, pushed: 0, queuedUnmapped: 0, skippedNoCard: 0, errors: 0 };
  if (mode === 'off') return stats;
  const testEmail = trim(cfg.testEmail);
  const policyID = trim(cfg.policyID) || null;
  const lookbackDays = Number(cfg.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await qboQuery(
    tenantId,
    `SELECT Id, TxnDate, TotalAmt, PrivateNote, EntityRef FROM Purchase WHERE TxnDate >= '${since}' ORDERBY MetaData.CreateTime DESC MAXRESULTS ${MAX_PURCHASES_PER_RUN}`,
  );
  const purchases = ((res.Purchase ?? []) as Array<Record<string, any>>).map(parsePurchase);
  stats.scanned = purchases.length;

  const ledger = cfgRef(tenantId).collection('pushedTransactions');
  const mapColl = db.collection(`tenants/${tenantId}/expensify_card_map`);
  const mapSnap = await mapColl.get();
  const cardMap = new Map(mapSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));

  // Exactly-once: drop anything already ledgered.
  const ids = purchases.map((p) => p.purchaseId);
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => ledger.doc(id)));
    snaps.forEach((s, j) => {
      if (s.exists) seen.add(chunk[j]);
    });
  }

  const toPush = new Map<string, ParsedCardPurchase[]>(); // employeeEmail -> expenses
  for (const p of purchases) {
    if (seen.has(p.purchaseId)) continue;
    if (!p.last4) {
      // Not a card purchase (ACH, fees, payroll pulls) — terminal skip.
      await ledger.doc(p.purchaseId).set({
        outcome: 'no_card',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      stats.skippedNoCard += 1;
      continue;
    }
    const mapping = cardMap.get(p.last4);
    const email = trim(mapping?.email);
    if (!mapping) {
      // First sight of this card: create the stub + notify. NOT ledgered —
      // the transaction flows automatically once someone fills in the email.
      await mapColl.doc(p.last4).set({
        last4: p.last4,
        cardholderName: p.cardholderName ?? null,
        email: '',
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        firstSeenPurchaseId: p.purchaseId,
      });
      cardMap.set(p.last4, { email: '' });
      await notifyAdmins(
        tenantId,
        'New company card detected',
        `Card •${p.last4}${p.cardholderName ? ` (${p.cardholderName})` : ''} has unrouted expenses — map it to a worker so their Expensify receives them.`,
      );
      stats.queuedUnmapped += 1;
      continue;
    }
    if (!email || mapping.active === false) {
      stats.queuedUnmapped += 1;
      continue;
    }
    const target = mode === 'test' && testEmail ? testEmail : email;
    if (!toPush.has(target)) toPush.set(target, []);
    toPush.get(target)!.push(p);
  }

  for (const [email, expenses] of toPush) {
    const result = await pushExpensesToExpensify(email, policyID, expenses);
    if (result.ok) {
      const batch = db.batch();
      for (const e of expenses) {
        batch.set(ledger.doc(e.purchaseId), {
          outcome: 'pushed',
          employeeEmail: email,
          testMode: mode === 'test',
          merchant: e.merchant,
          amount: e.amount,
          txnDate: e.txnDate,
          last4: e.last4,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      stats.pushed += expenses.length;
    } else {
      // Not ledgered — retried next run; alert so failures never rot silently.
      stats.errors += 1;
      logger.error('[expensify] push failed', { tenantId, email, count: expenses.length, error: result.error });
      await notifyAdmins(
        tenantId,
        'Expensify push failed',
        `${expenses.length} expense(s) for ${email} failed to push (${trim(result.error).slice(0, 120)}). They will retry on the next run.`,
      );
    }
  }

  await cfgRef(tenantId).set(
    {
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      lastRunStats: stats,
    },
    { merge: true },
  );
  logger.info('[expensify] run complete', { tenantId, ...stats });
  return stats;
}

/** Daily (matches the Intuit app-assessment cadence attestation). */
export const expensifyCardPushCron = onSchedule(
  { schedule: 'every day 06:00', timeZone: 'America/Los_Angeles', memory: '512MiB', timeoutSeconds: 300 },
  async () => {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tenantRef of tenants) {
      try {
        const qbo = (await db.doc(`tenants/${tenantRef.id}/integrations/quickbooks`).get()).data();
        if (qbo?.connected !== true) continue;
        await runExpensifyCardPush(tenantRef.id);
      } catch (err) {
        logger.error('[expensify] tenant run failed', {
          tenantId: tenantRef.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
