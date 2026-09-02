/**
 * Screening cost allocation (Greg 2026-09-01): background checks & drug
 * screens are ordered per worker (AccuSource, ~$8/screen), billed monthly
 * by card, and land in QBO as one lump on 5010 Direct Labor — wrong
 * account, no per-client class. This module matches each screen to its
 * class and posts one reallocation JE per AccuSource charge:
 *
 *   credit  5010 (mirroring the original card line's class)
 *   debit   5300 Field Staff Recruitment split per class
 *
 * Class per screen: the order's own jobOrderId / client account when it
 * has one (~10%), else the worker's FIRST assignment starting on/after
 * the order date (−7d grace) — Greg's rule. Screens whose worker never
 * got an assignment (~74% — the real conversion rate of screening) are
 * recruiting-pipeline overhead and go to the National class.
 *
 * Idempotent per charge via a [screen:{purchaseId}] tag in the JE's
 * PrivateNote. Charges newer than 35 days are skipped — screens ordered
 * near the statement date may still earn their class when the worker's
 * assignment starts (same maturity idea as the payroll ledger freeze).
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate } from '../integrations/quickbooks/qboAuth';
import { ACCOUNT_CLASS_RULES } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;

const ACCUSOURCE_VENDOR_ID = '191';
const OVERHEAD_CLASS = 'National';

export async function pushScreeningAllocations(
  tenantId: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  // ── live QBO classes + target accounts ──
  const clRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classes: Array<Record<string, any>> = clRes.QueryResponse?.Class ?? clRes.Class ?? [];
  const squash = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const classFor = (leaf: string): Record<string, any> | undefined => {
    const k = squash(leaf);
    return (
      classes.find((c) => squash(String(c.Name)) === k || squash(String(c.FullyQualifiedName)) === k) ??
      classes.find((c) => {
        const ck = squash(String(c.Name));
        return ck.length >= 4 && k.length >= 4 && (ck.includes(k) || k.includes(ck));
      })
    );
  };
  const acctRes = (await qboQuery(tenantId, "SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' MAXRESULTS 1000")) as Record<string, any>;
  const accts: Array<Record<string, any>> = acctRes.QueryResponse?.Account ?? acctRes.Account ?? [];
  const recruitAcct = accts.find((a) => /recruitment/i.test(String(a.Name)));
  if (!recruitAcct) throw new Error('5300 Field Staff Recruitment account not found');
  const RECRUIT = String(recruitAcct.Id);

  // ── screens + assignment index ──
  const bcSnap = await db.collection('backgroundChecks').get();
  const asnSnap = await db.collection(`tenants/${tenantId}/assignments`).get();
  const byWorker = new Map<string, Array<{ start: string; accountId: string; companyName: string }>>();
  asnSnap.forEach((d) => {
    const a = d.data();
    const uid = trim(a.userId) || trim(a.workerId) || trim(a.candidateId);
    const sd = trim(a.startDate);
    if (!uid || !sd) return;
    const arr = byWorker.get(uid) ?? [];
    arr.push({ start: sd, accountId: trim(a.accountId), companyName: trim(a.companyName) });
    byWorker.set(uid, arr);
  });
  byWorker.forEach((arr) => arr.sort((a, b) => (a.start < b.start ? -1 : 1)));
  // account-kind mappings (accountId -> class fqn, unique only)
  const mapSnap = await db.collection(`tenants/${tenantId}/qbo_class_mappings`).get().catch(() => null);
  const acctMapCount = new Map<string, number>();
  const acctMap = new Map<string, string>();
  if (mapSnap) {
    mapSnap.forEach((d) => {
      const m = d.data();
      const aid = trim(m.accountId);
      if (trim(m.targetKind) !== 'account' || !aid) return;
      acctMapCount.set(aid, (acctMapCount.get(aid) ?? 0) + 1);
      acctMap.set(aid, trim(m.className) || trim(m.fqn));
    });
    for (const [aid, n] of acctMapCount) if (n > 1) acctMap.delete(aid);
  }
  const leafForAccount = (accountId: string, accountName: string): string | null => {
    const mapped = accountId ? acctMap.get(accountId) : undefined;
    if (mapped) return mapped;
    const rule = accountName ? ACCOUNT_CLASS_RULES.find((r) => r.re.test(accountName)) : undefined;
    return rule ? rule.leaf : null;
  };
  const joSnap = await db.collection(`tenants/${tenantId}/job_orders`).get();
  const joById = new Map<string, { accountId: string; accountName: string; name: string }>();
  joSnap.forEach((d) => {
    const j = d.data();
    joById.set(d.id, {
      accountId: trim(j.accountId),
      accountName: trim(j.accountName),
      name: trim(j.jobOrderName) || trim(j.title),
    });
  });

  interface Screen { ordered: string; leaf: string | null }
  const screens: Screen[] = [];
  bcSnap.forEach((d) => {
    const x = d.data();
    const ordered = x.createdAt?.toDate ? x.createdAt.toDate().toISOString().slice(0, 10) : '';
    if (!ordered) return;
    let leaf: string | null = null;
    const jo = trim(x.jobOrderId) ? joById.get(trim(x.jobOrderId)) : undefined;
    if (jo) leaf = leafForAccount(jo.accountId, jo.accountName) ?? jo.name;
    if (!leaf) {
      const acctName = trim(x.accountName);
      // the order's "account" is often the hiring entity, not a client
      if (acctName && !/^c1 |select llc|events llc|workforce/i.test(acctName)) {
        leaf = leafForAccount(trim(x.accountId), acctName) ?? acctName;
      }
    }
    if (!leaf) {
      const cand = trim(x.candidateId) || trim(x.applicantId);
      const grace = new Date(Date.parse(ordered) - 7 * 86400000).toISOString().slice(0, 10);
      const hit = (byWorker.get(cand) ?? []).find((a) => a.start >= grace);
      if (hit) leaf = leafForAccount(hit.accountId, hit.companyName) ?? (hit.companyName || null);
    }
    screens.push({ ordered, leaf });
  });

  // ── AccuSource charges ──
  const charges: Array<Record<string, any>> = [];
  let start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of rows) {
      // Vendor 191 when set — but bank-feed purchases arrive with NO vendor
      // (Greg's 2026-07-15 $154.50 charge), so match the descriptor too.
      const hay = [p.EntityRef?.name, p.PrivateNote, ...((p.Line ?? []) as Array<Record<string, any>>).map((l) => l.Description)]
        .map((x) => String(x ?? '')).join(' ').toLowerCase();
      if (String(p.EntityRef?.value ?? '') === ACCUSOURCE_VENDOR_ID || hay.includes('accusource')) charges.push(p);
    }
    if (rows.length < 1000) break;
    start += 1000;
  }
  // existing allocation tags
  const existingTags = new Set<string>();
  start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of rows) {
      for (const m of trim(je.PrivateNote).matchAll(/\[screen:([^\]]+)\]/g)) existingTags.add(trim(m[1]));
    }
    if (rows.length < 1000) break;
    start += 1000;
  }

  const matureCutoff = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
  const results: Array<Record<string, unknown>> = [];
  for (const p of charges.sort((a, b) => String(a.TxnDate).localeCompare(String(b.TxnDate)))) {
    const pid = String(p.Id);
    const txnDate = String(p.TxnDate);
    const total = Number(p.TotalAmt) || 0;
    if (existingTags.has(pid)) {
      results.push({ purchaseId: pid, date: txnDate, amount: total, status: 'already_allocated' });
      continue;
    }
    if (txnDate > matureCutoff) {
      results.push({ purchaseId: pid, date: txnDate, amount: total, status: 'not_mature_yet' });
      continue;
    }
    // screens in the charge's window: [txnDate−35d, txnDate]
    const winStart = new Date(Date.parse(txnDate) - 35 * 86400000).toISOString().slice(0, 10);
    const inWindow = screens.filter((sc) => sc.ordered >= winStart && sc.ordered <= txnDate);
    const perScreen = inWindow.length > 0 ? total / inWindow.length : 0;
    const splitByLeaf = new Map<string, number>();
    for (const sc of inWindow) {
      const leaf = sc.leaf && classFor(sc.leaf) ? sc.leaf : OVERHEAD_CLASS;
      splitByLeaf.set(leaf, (splitByLeaf.get(leaf) ?? 0) + perScreen);
    }
    if (inWindow.length === 0) splitByLeaf.set(OVERHEAD_CLASS, total);
    // largest-remainder to the penny
    const entries = [...splitByLeaf.entries()].map(([leaf, amt]) => ({ leaf, cents: Math.floor(amt * 100), frac: amt * 100 - Math.floor(amt * 100) }));
    let rem = Math.round(total * 100) - entries.reduce((s, e) => s + e.cents, 0);
    for (const e of [...entries].sort((a, b) => b.frac - a.frac)) {
      if (rem <= 0) break;
      e.cents += 1;
      rem -= 1;
    }
    const splits = entries.filter((e) => e.cents > 0).map((e) => ({ leaf: e.leaf, amount: e.cents / 100 }));
    results.push({
      purchaseId: pid, date: txnDate, amount: total, status: dryRun ? 'would_create' : 'created',
      screens: inWindow.length, splits,
    });
    if (dryRun) continue;
    // original card line: account + class to mirror on the credit side
    const origLine = ((p.Line ?? []) as Array<Record<string, any>>).find((l) => l.AccountBasedExpenseLineDetail);
    const origAcct = String(origLine?.AccountBasedExpenseLineDetail?.AccountRef?.value ?? '');
    const origCls = origLine?.AccountBasedExpenseLineDetail?.ClassRef;
    const lines: Array<Record<string, unknown>> = splits.map((sp) => {
      const cls = classFor(sp.leaf);
      return {
        DetailType: 'JournalEntryLineDetail',
        Amount: sp.amount,
        Description: `Screening costs — ${sp.leaf} (${txnDate} AccuSource charge)`,
        JournalEntryLineDetail: {
          PostingType: 'Debit',
          AccountRef: { value: RECRUIT },
          ...(cls ? { ClassRef: { value: String(cls.Id), name: String(cls.FullyQualifiedName) } } : {}),
        },
      };
    });
    lines.push({
      DetailType: 'JournalEntryLineDetail',
      Amount: round2(total),
      Description: `AccuSource ${txnDate} reclass from 5010 — background/drug screens`,
      JournalEntryLineDetail: {
        PostingType: 'Credit',
        AccountRef: { value: origAcct || RECRUIT },
        ...(origCls ? { ClassRef: origCls } : {}),
      },
    });
    // eslint-disable-next-line no-await-in-loop
    await qboEntityCreate(tenantId, 'JournalEntry', {
      DocNumber: `Scrn Alloc ${txnDate.slice(5).replace('-', '')}`,
      TxnDate: txnDate,
      PrivateNote:
        `Screening allocation: AccuSource charge $${total.toFixed(2)} split across ${inWindow.length} screens ` +
        `(order's JO/client, else worker's first assignment, else ${OVERHEAD_CLASS} — Greg 2026-09-01). [screen:${pid}]`,
      Line: lines,
    });
    existingTags.add(pid);
  }
  return { ok: true, dryRun, charges: results };
}
