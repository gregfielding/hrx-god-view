/**
 * Expensify → QBO write-back: classes (EXP-6, 2026-07-24) + notes and
 * receipts (EXP-7, 2026-08-14 — Greg: "sync/send the details of each
 * transaction that were entered in Expensify").
 *
 * Workers (and Greg) classify card expenses in Expensify, but the real
 * accounting transaction is the QBO Purchase the bank feed created —
 * Expensify never touches it (report export is off by design: it would
 * duplicate the auto-posted bank-feed txns). This module closes the loop:
 * read expenses back out of Expensify and, per matched Purchase,
 *   - resolve the class tag against the QBO Class list → line ClassRef;
 *   - append the expense comment to the Purchase's PrivateNote (memo);
 *   - download the receipt image and attach it via the QBO Attachable
 *     upload (once per purchase, ledger-deduped — attachments are
 *     additive on the QBO side and there is no safe overwrite).
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
 * QBO queries, up to N small update POSTs, and up to RECEIPT_CAP
 * attachment uploads per day.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { qboQuery, qboEntityUpdate, qboUploadAttachment } from '../quickbooks/qboAuth';
import { parsePurchase } from './expensifyPush';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const EXPENSIFY_API = 'https://integrations.expensify.com/Integration-Server/ExpensifyIntegrations';
const DEFAULT_LOOKBACK_DAYS = 60;
const MAX_PURCHASES = 1500;
const QBO_COMMENT_RE = /QBO #(\d+)/;
/** Receipt uploads per run — keeps a big backlog inside the function
 *  timeout; the daily cron drains the remainder. */
const RECEIPT_CAP = 60;
/** Stop retrying a receipt whose report PDF keeps failing. */
const RECEIPT_MAX_ATTEMPTS = 5;
/** QBO upload limit is 20MB; leave headroom for multi-receipt reports. */
const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;
const QBO_NOTE_LIMIT = 3900;

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
  receiptUrl: string;
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
  F('report.reportID') + '\t' +
  // Whole-path guard: receiptObject itself is absent when no receipt.
  F('(expense.receiptObject.url)!""') + '\n' +
  '</#list></#list>';

async function expensifyJobRaw(
  payload: Record<string, unknown>,
  template?: string,
): Promise<Buffer> {
  const params = new URLSearchParams({ requestJobDescription: JSON.stringify(payload) });
  if (template) params.set('template', template);
  const res = await fetch(EXPENSIFY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`Expensify API ${res.status}: ${buf.toString('utf8').slice(0, 300)}`);
  return buf;
}

async function expensifyJob(payload: Record<string, unknown>, template?: string): Promise<string> {
  return (await expensifyJobRaw(payload, template)).toString('utf8');
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
      receiptUrl: trim(cols[8] ?? ''),
    });
  }
  return rows;
}

/**
 * Receipt vehicle: direct receipt URLs are login-gated (verifyReceipt.php
 * and the /receipts/w_*.jpg S3 forms all 403 server-side — probed
 * 2026-08-14), but a PDF file job with includeFullPageReceiptsPdf renders
 * the report as a PDF WITH its receipt images, under the integration's own
 * permissions. Filtering the job to a single reportIDList entry (R-form
 * ids accepted) returns exactly one filename — no id-format mapping
 * needed (bulk runs name files by a numeric id the TSV never exposes).
 */
export async function fetchReportReceiptsPdf(reportID: string): Promise<Buffer> {
  const creds = expensifyCreds();
  if (!creds) throw new Error('Expensify credentials not configured');
  const TPL =
    '<#list reports as report><html><body><h3>Expensify report ' +
    F('report.reportID') +
    '</h3><#list report.transactionList as expense><p>' +
    F('(expense.created!"")') + ' ' + F('(expense.merchant!"")' + CLEAN) + ' ' + F('(expense.amount!0)?c') +
    '</p></#list></body></html></#list>';
  const fileRes = await expensifyJob(
    {
      type: 'file',
      credentials: creds,
      onReceive: { immediateResponse: ['returnRandomFileName'] },
      inputSettings: { type: 'combinedReportData', filters: { reportIDList: reportID } },
      outputSettings: { fileExtension: 'pdf', includeFullPageReceiptsPdf: true },
    },
    TPL,
  );
  let fileName = trim(fileRes);
  if (fileName.startsWith('{')) {
    const parsed = JSON.parse(fileName) as Record<string, unknown>;
    fileName = trim(parsed.filename);
  }
  fileName = fileName.split(',')[0]?.trim() ?? '';
  if (!fileName) throw new Error(`no PDF generated for report ${reportID}`);
  const buf = await expensifyJobRaw({
    type: 'download',
    credentials: creds,
    fileName,
    fileSystem: 'integrationServer',
  });
  if (!buf.subarray(0, 5).toString('utf8').startsWith('%PDF')) {
    throw new Error(`not a PDF: ${buf.toString('utf8').slice(0, 120)}`);
  }
  return buf;
}

/* ────────────────────────────────────────────────────────────────────
 * Core sync
 * ──────────────────────────────────────────────────────────────────── */

export interface ClassWritebackStats {
  expensesSeen: number;
  tagged: number;
  /** Expenses carrying any payload (class, note, or receipt) that matched a QBO purchase. */
  matched: number;
  updated: number;
  alreadySet: number;
  notesUpdated: number;
  notesAlready: number;
  receiptsAttached: number;
  receiptsAlready: number;
  receiptsFailed: number;
  receiptsDeferred: number;
  unmatchedPurchase: number;
  unknownTags: string[];
  errors: number;
  details: Array<{ purchaseId: string; merchant: string; amount: number; tag: string; action: string }>;
}

function tripleKey(dateIso: string, cents: number, merchant: string): string {
  return `${dateIso}|${cents}|${merchant.toLowerCase()}`;
}

/**
 * Push the live QBO class tree into the Expensify workspace as its TAG
 * list (Greg 2026-08-31, after the class restructure): workers can only
 * classify correctly if the dropdown mirrors the books. Tags are the
 * FullyQualifiedNames of ACTIVE classes, so the write-back's tag→class
 * resolution is exact by construction. `action: 'replace'` keeps the list
 * canonical — retired classes (RS3, Austin, AEG…) disappear from the
 * picker while historical expenses keep their old tag strings.
 */
export async function pushQboClassesAsExpensifyTags(tenantId: string): Promise<{ pushed: number }> {
  const creds = expensifyCreds();
  if (!creds) throw new Error('Expensify credentials not configured');
  const cfg = (await cfgRef(tenantId).get()).data() ?? {};
  const policyID = trim(cfg.policyID);
  if (!policyID) throw new Error('No Expensify policyID configured');

  const classRes = await qboQuery(
    tenantId,
    'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000',
  );
  const classes = (classRes.Class ?? []) as Array<Record<string, any>>;
  const tags = classes
    .map((c) => trim(c.FullyQualifiedName) || trim(c.Name))
    .filter(Boolean)
    .sort()
    .map((name) => ({ name }));

  const body = new URLSearchParams({
    requestJobDescription: JSON.stringify({
      type: 'update',
      credentials: creds,
      inputSettings: { type: 'policy', policyID },
      tags: { action: 'replace', source: 'inline', data: tags },
    }),
  });
  const res = await fetch(EXPENSIFY_API, { method: 'POST', body });
  const text = await res.text();
  if (!res.ok || /error/i.test(text.slice(0, 200))) {
    throw new Error(`Expensify tag update failed (${res.status}): ${text.slice(0, 300)}`);
  }
  logger.info('[expensify] tag list replaced from QBO classes', { policyID, tags: tags.length });
  return { pushed: tags.length };
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
    matched: 0,
    updated: 0,
    alreadySet: 0,
    notesUpdated: 0,
    notesAlready: 0,
    receiptsAttached: 0,
    receiptsAlready: 0,
    receiptsFailed: 0,
    receiptsDeferred: 0,
    unmatchedPurchase: 0,
    unknownTags: [],
    errors: 0,
    details: [],
  };

  const expenses = await fetchExpensifyExpenses(since);
  stats.expensesSeen = expenses.length;
  // The "QBO #id" marker in pushed comments is plumbing, not a note.
  const noteOf = (e: ExpensifyExpense): string => e.comment.replace(QBO_COMMENT_RE, '').trim();
  const actionable = expenses.filter((e) => e.tag || noteOf(e) || e.receiptUrl);
  stats.tagged = expenses.filter((e) => e.tag).length;
  if (actionable.length === 0) return stats;

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
  // Ledger preload — receipt dedupe must not cost a read per expense.
  const ledgerSnap = await ledger.get();
  const ledgerMap = new Map<string, Record<string, any>>();
  ledgerSnap.forEach((d) => ledgerMap.set(d.id, d.data() as Record<string, any>));
  const unknownTags = new Set<string>();
  let pdfCache: { reportID: string; buf: Buffer } | null = null;

  for (const e of actionable) {
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
    stats.matched += 1;
    const purchaseId = trim(purchase.Id);
    const ledgerEntry = ledgerMap.get(purchaseId) ?? {};
    const ledgerPatch: Record<string, unknown> = {};
    const actions: string[] = [];
    let entityChanged = false;

    try {
      // ── Class → line ClassRef ──
      if (e.tag) {
        const resolved = resolveClass(e.tag);
        if (!resolved) {
          unknownTags.add(e.tag);
        } else {
          const lines = Array.isArray(purchase.Line)
            ? (purchase.Line as Array<Record<string, any>>)
            : [];
          const expenseLines = lines.filter(
            (l) => l.AccountBasedExpenseLineDetail || l.ItemBasedExpenseLineDetail,
          );
          const already =
            expenseLines.length > 0 &&
            expenseLines.every(
              (l) =>
                trim(
                  (l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail)?.ClassRef
                    ?.value,
                ) === resolved.id,
            );
          if (already) {
            stats.alreadySet += 1;
          } else if (expenseLines.length > 0) {
            for (const l of expenseLines) {
              const detail = l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail;
              detail.ClassRef = { value: resolved.id, name: resolved.name };
            }
            entityChanged = true;
            stats.updated += 1;
            actions.push('class');
            Object.assign(ledgerPatch, {
              tag: e.tag,
              classId: resolved.id,
              className: resolved.name,
            });
          }
        }
      }

      // ── Note → Purchase PrivateNote (memo). Append-only: never clobber
      // what a bookkeeper wrote; skip when our text is already in there. ──
      const note = noteOf(e);
      if (note) {
        const current = trim(purchase.PrivateNote);
        if (current.toLowerCase().includes(note.toLowerCase())) {
          stats.notesAlready += 1;
        } else {
          purchase.PrivateNote = (current ? `${current}\n${note}` : note).slice(0, QBO_NOTE_LIMIT);
          entityChanged = true;
          stats.notesUpdated += 1;
          actions.push('note');
          ledgerPatch.note = note;
          ledgerPatch.noteSyncedAt = admin.firestore.FieldValue.serverTimestamp();
        }
      }

      if (entityChanged && !dryRun) {
        await qboEntityUpdate(tenantId, 'purchase', purchase);
      }

      // ── Receipt → QBO Attachable. The vehicle is the report's receipts
      // PDF (see fetchReceiptPdfFilenames); the same PDF serves every
      // purchase on that report. Uploads are additive on the QBO side, so
      // the ledger stamp is the ONLY dedupe — never attach twice. ──
      if (e.receiptUrl) {
        const attempts = Number(ledgerEntry.receiptAttempts ?? 0);
        if (ledgerEntry.receiptAttachedAt) {
          stats.receiptsAlready += 1;
        } else if (attempts >= RECEIPT_MAX_ATTEMPTS) {
          stats.receiptsFailed += 1;
        } else if (stats.receiptsAttached >= RECEIPT_CAP) {
          stats.receiptsDeferred += 1;
        } else if (dryRun) {
          stats.receiptsAttached += 1;
          actions.push('would_attach_receipt');
        } else {
          try {
            // Expenses arrive grouped by report, so a one-slot cache
            // avoids re-fetching without holding every PDF in memory.
            if (!pdfCache || pdfCache.reportID !== e.reportID) {
              const buf = await fetchReportReceiptsPdf(e.reportID);
              if (buf.length > RECEIPT_MAX_BYTES) throw new Error(`PDF too large: ${buf.length}`);
              pdfCache = { reportID: e.reportID, buf };
            }
            await qboUploadAttachment(tenantId, {
              entityType: 'Purchase',
              entityId: purchaseId,
              fileName: `expensify-receipts-report-${e.reportID}.pdf`,
              contentType: 'application/pdf',
              content: pdfCache.buf,
            });
            stats.receiptsAttached += 1;
            actions.push('receipt');
            ledgerPatch.receiptAttachedAt = admin.firestore.FieldValue.serverTimestamp();
            ledgerPatch.receiptReportID = e.reportID;
            ledgerPatch.receiptFileName = `expensify-receipts-report-${e.reportID}.pdf`;
          } catch (err) {
            stats.receiptsFailed += 1;
            ledgerPatch.receiptAttempts = attempts + 1;
            ledgerPatch.receiptLastError = err instanceof Error ? err.message : String(err);
            logger.warn('[expensify] receipt attach failed', {
              tenantId,
              purchaseId,
              reportID: e.reportID,
              attempts: attempts + 1,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      if (actions.length > 0) {
        stats.details.push({
          purchaseId,
          merchant: parsePurchase(purchase).merchant,
          amount: Number(purchase.TotalAmt ?? 0),
          tag: e.tag,
          action: (dryRun ? 'would: ' : '') + actions.join('+'),
        });
      }
      if (!dryRun && Object.keys(ledgerPatch).length > 0) {
        Object.assign(ledgerPatch, {
          expenseTransactionID: e.transactionID,
          matchedBy,
          merchant: parsePurchase(purchase).merchant,
          amount: Number(purchase.TotalAmt ?? 0),
          txnDate: trim(purchase.TxnDate),
          appliedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await ledger.doc(purchaseId).set(ledgerPatch, { merge: true });
      }
    } catch (err) {
      stats.errors += 1;
      logger.error('[expensify] write-back failed', {
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
          matched: stats.matched,
          updated: stats.updated,
          alreadySet: stats.alreadySet,
          notesUpdated: stats.notesUpdated,
          notesAlready: stats.notesAlready,
          receiptsAttached: stats.receiptsAttached,
          receiptsAlready: stats.receiptsAlready,
          receiptsFailed: stats.receiptsFailed,
          receiptsDeferred: stats.receiptsDeferred,
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
  // 540s: a receipt backlog run does up to RECEIPT_CAP downloads+uploads.
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required.');
    await assertAdmin(request, tenantId);
    return runExpensifyClassWriteback(tenantId, { dryRun: request.data?.dryRun === true });
  },
);

/** Daily, after the 06:00 push cron has delivered any new expenses. */
export const expensifyClassWritebackCron = onSchedule(
  { schedule: 'every day 06:30', timeZone: 'America/Los_Angeles', memory: '512MiB', timeoutSeconds: 540 },
  async () => {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tenantRef of tenants) {
      try {
        const qbo = (await db.doc(`tenants/${tenantRef.id}/integrations/quickbooks`).get()).data();
        if (qbo?.connected !== true) continue;
        if (!(await cfgRef(tenantRef.id).get()).exists) continue;
        // Keep the Expensify tag picker mirroring the live class tree
        // (Greg 2026-08-31) — a failed tag push must not block write-back.
        try {
          await pushQboClassesAsExpensifyTags(tenantRef.id);
        } catch (err) {
          logger.error('[expensify] tag sync failed', { tenantId: tenantRef.id, error: String(err) });
        }
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
