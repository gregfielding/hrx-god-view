/**
 * Expensify → QBO class write-back (EXP-6, 2026-07-24).
 *
 * Workers (and Greg) classify card expenses in Expensify, but the real
 * accounting transaction is the QBO Purchase the bank feed created —
 * Expensify never touches it (report export is off by design: it would
 * duplicate the auto-posted bank-feed txns). This module closes the loop:
 * read classified expenses back out of Expensify, resolve the class tag
 * against the QBO Class list, and stamp ClassRef onto the matching
 * Purchase's expense lines.
 *
 * Matching (two paths, mirroring the two delivery mechanisms):
 *  1. API-pushed expenses (expensifyPush.ts) carry "QBO #<purchaseId>" in
 *     the comment — direct key.
 *  2. CSV card-import expenses carry no marker, but their date, amount,
 *     and merchant all originated from OUR export of the same QBO
 *     purchase (expensifyCardExport.ts), so an exact
 *     (date, cents, merchant) triple matches. Buckets are consumed
 *     one-to-one so twin charges (two identical Ubers same day) pair off
 *     instead of double-applying.
 *
 * Reads use the documented Integration Server report exporter (file job +
 * download). Only expenses that sit on a report are visible to it — in
 * New Expensify every workspace expense lands on a report chat, so that
 * covers the pipeline's output.
 *
 * Idempotent: the live QBO line ClassRef is compared before writing, so
 * re-runs are no-ops and a reclassified expense (tag changed in
 * Expensify) updates QBO on the next pass. Audit trail per purchase at
 * integrations/expensify/classSync/{purchaseId}.
 *
 * Cadence: once daily (06:30 PT, after the 06:00 push cron) + an
 * on-demand admin callable. NOTE (Intuit app assessment): this adds ~3
 * QBO queries and up to N small update POSTs per day.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { qboQuery, qboEntityUpdate } from '../quickbooks/qboAuth';
import { parsePurchase } from './expensifyPush';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const EXPENSIFY_API = 'https://integrations.expensify.com/Integration-Server/ExpensifyIntegrations';
const DEFAULT_LOOKBACK_DAYS = 60;
const MAX_PURCHASES = 1500;
const QBO_COMMENT_RE = /QBO #(\d+)/;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function cfgRef(tenantId: string) {
  return db.doc(`tenants/${tenantId}/integrations/expensify`);
}

function expensifyCreds(): { partnerUserID: string; partnerUserSecret: string } | null {
  const partnerUserID = trim(process.env.EXPENSIFY_PARTNER_USER_ID);
  const partnerUserSecret = trim(process.env.EXPENSIFY_PARTNER_USER_SECRET);
  return partnerUserID && partnerUserSecret ? { partnerUserID, partnerUserSecret } : null;
}

/* ────────────────────────────────────────────────────────────────────
 * Expensify read-back (report exporter: file job → download)
 * ──────────────────────────────────────────────────────────────────── */

export interface ExpensifyExpense {
  transactionID: string;
  created: string; // yyyy-mm-dd
  amountCents: number;
  merchant: string;
  tag: string;
  category: string;
  comment: string;
  reportID: string;
}

// Freemarker template emitting one tab-separated line per expense. Tabs and
// newlines inside field values are flattened so the line format survives.
const F = (expr: string) => '${' + expr + '}';
const CLEAN = '?replace("\\t"," ")?replace("\\n"," ")?replace("\\r"," ")';
const EXPORT_TEMPLATE =
  '<#list reports as report><#list report.transactionList as expense>' +
  F('expense.transactionID') + '\t' +
  F('(expense.created!"")') + '\t' +
  F('(expense.amount!0)?c') + '\t' +
  F('(expense.merchant!"")' + CLEAN) + '\t' +
  F('(expense.tag!"")' + CLEAN) + '\t' +
  F('(expense.category!"")' + CLEAN) + '\t' +
  F('(expense.comment!"")' + CLEAN) + '\t' +
  F('report.reportID') + '\n' +
  '</#list></#list>';

async function expensifyJob(payload: Record<string, unknown>, template?: string): Promise<string> {
  const params = new URLSearchParams({ requestJobDescription: JSON.stringify(payload) });
  if (template) params.set('template', template);
  const res = await fetch(EXPENSIFY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Expensify API ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

/** All expenses on reports created since `startDate`, tagged or not. */
export async function fetchExpensifyExpenses(startDate: string): Promise<ExpensifyExpense[]> {
  const creds = expensifyCreds();
  if (!creds) throw new Error('Expensify credentials not configured');

  const fileRes = await expensifyJob(
    {
      type: 'file',
      credentials: creds,
      onReceive: { immediateResponse: ['returnRandomFileName'] },
      inputSettings: {
        type: 'combinedReportData',
        // Explicit: OPEN drafts are where auto-reported card expenses live.
        filters: { startDate, reportState: 'OPEN,SUBMITTED,APPROVED,REIMBURSED,ARCHIVED' },
      },
      outputSettings: { fileExtension: 'txt' },
    },
    EXPORT_TEMPLATE,
  );
  // Response is normally the bare generated filename; a JSON body means the
  // job was rejected.
  let fileName = trim(fileRes);
  if (fileName.startsWith('{')) {
    const parsed = JSON.parse(fileName) as Record<string, unknown>;
    if (Number(parsed.responseCode) !== 200 || !trim(parsed.filename)) {
      throw new Error(`Expensify export job failed: ${fileName.slice(0, 300)}`);
    }
    fileName = trim(parsed.filename);
  }

  const content = await expensifyJob({
    type: 'download',
    credentials: creds,
    fileName,
    fileSystem: 'integrationServer',
  });

  const rows: ExpensifyExpense[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length < 8) continue;
    rows.push({
      transactionID: trim(cols[0]),
      created: trim(cols[1]).slice(0, 10),
      amountCents: Math.abs(Math.round(Number(cols[2]) || 0)),
      merchant: trim(cols[3]),
      tag: trim(cols[4]),
      category: trim(cols[5]),
      comment: trim(cols[6]),
      reportID: trim(cols[7]),
    });
  }
  return rows;
}

/* ────────────────────────────────────────────────────────────────────
 * Core sync
 * ──────────────────────────────────────────────────────────────────── */

export interface ClassWritebackStats {
  expensesSeen: number;
  tagged: number;
  updated: number;
  alreadySet: number;
  unmatchedPurchase: number;
  unknownTags: string[];
  errors: number;
  details: Array<{ purchaseId: string; merchant: string; amount: number; tag: string; action: string }>;
}

function tripleKey(dateIso: string, cents: number, merchant: string): string {
  return `${dateIso}|${cents}|${merchant.toLowerCase()}`;
}

export async function runExpensifyClassWriteback(
  tenantId: string,
  opts?: { dryRun?: boolean },
): Promise<ClassWritebackStats> {
  const dryRun = opts?.dryRun === true;
  const cfg = (await cfgRef(tenantId).get()).data() ?? {};
  const lookbackDays = Number(cfg.classLookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const stats: ClassWritebackStats = {
    expensesSeen: 0,
    tagged: 0,
    updated: 0,
    alreadySet: 0,
    unmatchedPurchase: 0,
    unknownTags: [],
    errors: 0,
    details: [],
  };

  const expenses = await fetchExpensifyExpenses(since);
  stats.expensesSeen = expenses.length;
  const tagged = expenses.filter((e) => e.tag);
  stats.tagged = tagged.length;
  if (tagged.length === 0) return stats;

  // QBO class list: tag "Venue Smart:FIFA KC" ↔ Class.FullyQualifiedName.
  const classRes = await qboQuery(
    tenantId,
    "SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000",
  );
  const classes = (classRes.Class ?? []) as Array<Record<string, any>>;
  const byFqn = new Map<string, { id: string; name: string }>();
  const byLeaf = new Map<string, Array<{ id: string; name: string }>>();
  for (const c of classes) {
    const fqn = trim(c.FullyQualifiedName) || trim(c.Name);
    const entry = { id: trim(c.Id), name: fqn };
    byFqn.set(fqn.toLowerCase(), entry);
    const leaf = trim(c.Name).toLowerCase();
    byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), entry]);
  }
  // Tags export as "Parent:Child"; an empty parent level yields a leading
  // colon (":Red Roof Inn"), and a literal colon INSIDE a tag name is
  // backslash-escaped ("Venue Smart\:FIFA KC"). Unescape, then try the
  // normalized FQN, then the last segment as a leaf when unambiguous.
  const resolveClass = (rawTag: string): { id: string; name: string } | null => {
    const tag = rawTag.replace(/\\:/g, ':').replace(/^:+|:+$/g, '').trim();
    if (!tag) return null;
    const exact = byFqn.get(tag.toLowerCase());
    if (exact) return exact;
    const leafName = (tag.split(':').pop() ?? '').trim().toLowerCase();
    const leaf = leafName ? byLeaf.get(leafName) : undefined;
    return leaf && leaf.length === 1 ? leaf[0] : null;
  };

  // Purchases in-window, keyed for both match paths.
  const purchases: Array<Record<string, any>> = [];
  let start = 1;
  for (;;) {
    const page = await qboQuery(
      tenantId,
      `SELECT * FROM Purchase WHERE TxnDate >= '${since}' ORDERBY TxnDate DESC STARTPOSITION ${start} MAXRESULTS 500`,
    );
    const batch = (page.Purchase ?? []) as Array<Record<string, any>>;
    purchases.push(...batch);
    if (batch.length < 500 || purchases.length >= MAX_PURCHASES) break;
    start += 500;
  }
  const byId = new Map<string, Record<string, any>>();
  const byTriple = new Map<string, Array<Record<string, any>>>();
  for (const p of purchases) {
    const id = trim(p.Id);
    if (!id) continue;
    byId.set(id, p);
    const parsed = parsePurchase(p);
    const key = tripleKey(parsed.txnDate, Math.round(parsed.amount * 100), parsed.merchant);
    byTriple.set(key, [...(byTriple.get(key) ?? []), p]);
  }

  const ledger = cfgRef(tenantId).collection('classSync');
  const unknownTags = new Set<string>();

  for (const e of tagged) {
    // Match path 1: purchase id embedded in the pushed expense's comment.
    let purchase: Record<string, any> | undefined;
    let matchedBy = 'comment';
    const idMatch = e.comment.match(QBO_COMMENT_RE);
    if (idMatch) {
      purchase = byId.get(idMatch[1]);
    }
    if (!purchase) {
      // Match path 2: exact (date, cents, merchant) — consume one-to-one.
      const bucket = byTriple.get(tripleKey(e.created, e.amountCents, e.merchant));
      purchase = bucket?.shift();
      matchedBy = 'triple';
    }
    if (!purchase) {
      stats.unmatchedPurchase += 1;
      continue;
    }

    const resolved = resolveClass(e.tag);
    if (!resolved) {
      unknownTags.add(e.tag);
      continue;
    }

    const lines = Array.isArray(purchase.Line) ? (purchase.Line as Array<Record<string, any>>) : [];
    const expenseLines = lines.filter(
      (l) => l.AccountBasedExpenseLineDetail || l.ItemBasedExpenseLineDetail,
    );
    if (expenseLines.length === 0) continue;
    const purchaseId = trim(purchase.Id);
    const already = expenseLines.every(
      (l) =>
        trim((l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail)?.ClassRef?.value) ===
        resolved.id,
    );
    if (already) {
      stats.alreadySet += 1;
      continue;
    }

    if (dryRun) {
      stats.updated += 1;
      stats.details.push({
        purchaseId,
        merchant: parsePurchase(purchase).merchant,
        amount: Number(purchase.TotalAmt ?? 0),
        tag: e.tag,
        action: 'would_update',
      });
      continue;
    }

    try {
      for (const l of expenseLines) {
        const detail = l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail;
        detail.ClassRef = { value: resolved.id, name: resolved.name };
      }
      await qboEntityUpdate(tenantId, 'purchase', purchase);
      await ledger.doc(purchaseId).set(
        {
          tag: e.tag,
          classId: resolved.id,
          className: resolved.name,
          expenseTransactionID: e.transactionID,
          matchedBy,
          merchant: parsePurchase(purchase).merchant,
          amount: Number(purchase.TotalAmt ?? 0),
          txnDate: trim(purchase.TxnDate),
          appliedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      stats.updated += 1;
      stats.details.push({
        purchaseId,
        merchant: parsePurchase(purchase).merchant,
        amount: Number(purchase.TotalAmt ?? 0),
        tag: e.tag,
        action: 'updated',
      });
    } catch (err) {
      stats.errors += 1;
      logger.error('[expensify] class write-back failed', {
        tenantId,
        purchaseId,
        tag: e.tag,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stats.unknownTags = [...unknownTags];
  if (!dryRun) {
    await cfgRef(tenantId).set(
      {
        lastClassSyncAt: admin.firestore.FieldValue.serverTimestamp(),
        lastClassSyncStats: {
          expensesSeen: stats.expensesSeen,
          tagged: stats.tagged,
          updated: stats.updated,
          alreadySet: stats.alreadySet,
          unmatchedPurchase: stats.unmatchedPurchase,
          unknownTags: stats.unknownTags,
          errors: stats.errors,
        },
      },
      { merge: true },
    );
  }
  logger.info('[expensify] class write-back complete', { tenantId, ...stats, details: undefined });
  return stats;
}

/* ────────────────────────────────────────────────────────────────────
 * Triggers
 * ──────────────────────────────────────────────────────────────────── */

/** Same gate as the card-export callables: pipeline admins + level 7. */
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

export const runExpensifyClassWritebackNow = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required.');
    await assertAdmin(request, tenantId);
    return runExpensifyClassWriteback(tenantId, { dryRun: request.data?.dryRun === true });
  },
);

/** Daily, after the 06:00 push cron has delivered any new expenses. */
export const expensifyClassWritebackCron = onSchedule(
  { schedule: 'every day 06:30', timeZone: 'America/Los_Angeles', memory: '512MiB', timeoutSeconds: 300 },
  async () => {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tenantRef of tenants) {
      try {
        const qbo = (await db.doc(`tenants/${tenantRef.id}/integrations/quickbooks`).get()).data();
        if (qbo?.connected !== true) continue;
        if (!(await cfgRef(tenantRef.id).get()).exists) continue;
        await runExpensifyClassWriteback(tenantRef.id);
      } catch (err) {
        logger.error('[expensify] class write-back tenant run failed', {
          tenantId: tenantRef.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
