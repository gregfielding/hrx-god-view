/**
 * QBO merchant rules (Greg 2026-09-02: "can you create rules in QBO?").
 * Intuit's API exposes no bank-rule endpoints and Expensify rules are
 * per-member UI, so the rules live HERE — a Firestore table applied by
 * the daily Expensify cron AFTER the write-back has had its chance:
 *
 *   tenants/{t}/qbo_merchant_rules/{id}:
 *     { pattern: string,        // lowercase substring of the parsed merchant
 *       account: string,        // QBO expense account Name or FQN
 *       class?: string,         // optional class FQN
 *       minAgeDays?: number }   // default 7 — give Expensify flow first shot
 *
 * Guards: only lines still on Uncategorized Expense are touched (a human's
 * or the write-back's categorization always wins); purchases younger than
 * minAgeDays are skipped so a worker's explicit Expensify category isn't
 * pre-empted. Rules seeded from ≥80%-consistent categorization history.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityUpdate } from './qboAuth';
import { parsePurchase } from '../expensify/expensifyPush';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();
const wordMatch = (pattern: string, hay: string): boolean => {
  const pat = trim(pattern).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${pat}([^a-z0-9]|$)`).test(hay);
};

export async function applyQboMerchantRules(
  tenantId: string,
  dryRun: boolean,
  opts?: { pattern?: string; ignoreMinAge?: boolean; recategorize?: boolean },
): Promise<Record<string, unknown>> {
  const rulesSnap = await db.collection(`tenants/${tenantId}/qbo_merchant_rules`).get();
  let rules = rulesSnap.docs
    .map((d) => ({ ...(d.data() as Record<string, any>), id: d.id }) as Record<string, any>)
    .filter((r) => trim(r.pattern) && trim(r.account));
  if (trim(opts?.pattern)) rules = rules.filter((r) => trim(r.pattern).toLowerCase() === trim(opts?.pattern).toLowerCase());
  if (rules.length === 0) return { ok: true, dryRun, applied: 0, rules: 0 };

  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000")) as Record<string, any>;
  const accounts = ((acctRes.Account ?? []) as Array<Record<string, any>>);
  const byName = new Map<string, { id: string; name: string }>();
  for (const a of accounts) {
    const entry = { id: trim(a.Id), name: trim(a.FullyQualifiedName) || trim(a.Name) };
    byName.set(trim(a.Name).toLowerCase(), entry);
    byName.set((trim(a.FullyQualifiedName) || trim(a.Name)).toLowerCase(), entry);
  }
  const unc = accounts.find((a) => trim(a.Name) === 'Uncategorized Expense');
  if (!unc) return { ok: false, error: 'Uncategorized Expense account not found' };
  const UNC = trim(unc.Id);
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classByFqn = new Map<string, { id: string; name: string }>(
    ((clsRes.Class ?? clsRes.QueryResponse?.Class ?? []) as Array<Record<string, any>>).map((c) => [
      (trim(c.FullyQualifiedName) || trim(c.Name)).toLowerCase(),
      { id: trim(c.Id), name: trim(c.FullyQualifiedName) || trim(c.Name) },
    ]),
  );

  const since = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10);
  let start = 1;
  let applied = 0;
  const appliedRows: Array<Record<string, unknown>> = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of rows) {
      const hasUnc = ((p.Line ?? []) as Array<Record<string, any>>).some(
        (l) => trim(l.AccountBasedExpenseLineDetail?.AccountRef?.value) === UNC,
      );
      // recategorize (human-initiated only, never the cron): matched
      // purchases are rewritten even when already categorized (Greg
      // 2026-09-03: anthropic rule must reach categorized expenses).
      if (!hasUnc && !opts?.recategorize) continue;
      const parsed = parsePurchase(p) as Record<string, any>;
      const merchant = trim(parsed?.merchant).toLowerCase();
      // Word-boundary match on the MERCHANT only — plain substring matched
      // "apple" against Applebee's, and descriptors mention "Apple Pay"
      // (caught in the first dry run, 2026-09-02). Rules with
      // matchDescriptor=true ALSO test the full bank descriptor — the only
      // way to split merchants that parse identically ("Google" =
      // Workspace + Cloud, Greg 2026-09-02).
      const descriptor = [p.EntityRef?.name, p.PrivateNote, ...((p.Line ?? []) as Array<Record<string, any>>).map((l) => l.Description)]
        .map((x) => trim(x)).join(' ').toLowerCase();
      const rule = rules.find((ru) => wordMatch(ru.pattern, merchant) || (ru.matchDescriptor === true && wordMatch(ru.pattern, descriptor)));
      if (!rule) continue;
      const minAge = opts?.ignoreMinAge ? 0 : Number(rule.minAgeDays ?? 7);
      const ageDays = (Date.now() - Date.parse(String(p.TxnDate))) / 86400000;
      if (ageDays < minAge) continue;
      const acct = byName.get(trim(rule.account).toLowerCase());
      if (!acct || acct.id === UNC) continue;
      const cls = trim(rule.class) ? classByFqn.get(trim(rule.class).toLowerCase()) : undefined;
      let changed = 0;
      for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
        const d = l.AccountBasedExpenseLineDetail;
        if (!d) continue;
        const cur = trim(d.AccountRef?.value);
        if (cur !== UNC && !opts?.recategorize) continue;
        if (cur === acct.id) continue;
        d.AccountRef = { value: acct.id, name: acct.name };
        if (cls && !d.ClassRef) d.ClassRef = { value: cls.id, name: cls.name };
        changed += 1;
      }
      if (!changed) continue;
      applied += 1;
      appliedRows.push({ date: p.TxnDate, merchant: parsed?.merchant, amount: p.TotalAmt, account: acct.name, rule: rule.id });
      if (dryRun) continue;
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'Purchase', { ...p, sparse: false });
    }
    if (rows.length < 1000) break;
    start += 1000;
  }
  // Journal entries too — the recon page lists them (merchant "JE {DocNumber}"),
  // so a rule created from a JE row must be able to fire (Greg 2026-09-02:
  // "je gusto" rule saved but nothing updated).
  start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of rows) {
      const merchant = (trim(je.DocNumber) ? `JE ${trim(je.DocNumber)}` : `Journal Entry ${trim(je.Id)}`).toLowerCase();
      const descriptor = [je.DocNumber, je.PrivateNote, ...((je.Line ?? []) as Array<Record<string, any>>).map((l) => l.Description)]
        .map((x) => trim(x)).join(' ').toLowerCase();
      const rule = rules.find((ru) => wordMatch(ru.pattern, merchant) || (ru.matchDescriptor === true && wordMatch(ru.pattern, descriptor)));
      if (!rule) continue;
      const minAge = opts?.ignoreMinAge ? 0 : Number(rule.minAgeDays ?? 7);
      const ageDays = (Date.now() - Date.parse(String(je.TxnDate))) / 86400000;
      if (ageDays < minAge) continue;
      const acct = byName.get(trim(rule.account).toLowerCase());
      if (!acct || acct.id === UNC) continue;
      const cls = trim(rule.class) ? classByFqn.get(trim(rule.class).toLowerCase()) : undefined;
      let changed = 0;
      for (const l of (je.Line ?? []) as Array<Record<string, any>>) {
        const d = l.JournalEntryLineDetail;
        if (!d || d.PostingType !== 'Debit') continue;
        const cur = trim(d.AccountRef?.value);
        if (cur !== UNC && !opts?.recategorize) continue;
        if (cur === acct.id) continue;
        d.AccountRef = { value: acct.id, name: acct.name };
        if (cls && !d.ClassRef) d.ClassRef = { value: cls.id, name: cls.name };
        changed += 1;
      }
      if (!changed) continue;
      applied += 1;
      appliedRows.push({ date: je.TxnDate, merchant, amount: je.TotalAmt, account: acct.name, rule: rule.id, source: 'journal' });
      if (dryRun) continue;
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...je, sparse: false });
    }
    if (rows.length < 1000) break;
    start += 1000;
  }
  return { ok: true, dryRun, rules: rules.length, applied, appliedRows: appliedRows.slice(0, 60) };
}

/** Report for /reports/expense-recon: every uncategorized purchase with a
 *  history-mined suggestion, plus the rule table and account list. */
export async function buildExpenseReconReport(
  tenantId: string,
  startDate?: string,
  endDate?: string,
): Promise<Record<string, unknown>> {
  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000")) as Record<string, any>;
  const accounts = ((acctRes.Account ?? []) as Array<Record<string, any>>);
  const unc = accounts.find((a) => trim(a.Name) === 'Uncategorized Expense');
  const UNC = unc ? trim(unc.Id) : '';
  const expenseAccounts = accounts
    .filter((a) => ['Expense', 'Cost of Goods Sold', 'Other Expense'].includes(trim(a.AccountType)))
    .map((a) => trim(a.FullyQualifiedName) || trim(a.Name))
    .sort();
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classes = ((clsRes.Class ?? clsRes.QueryResponse?.Class ?? []) as Array<Record<string, any>>)
    .map((c) => trim(c.FullyQualifiedName) || trim(c.Name))
    .sort();
  const since = new Date(Date.now() - 240 * 86400000).toISOString().slice(0, 10);
  const hist = new Map<string, Map<string, number>>();
  const rows: Array<Record<string, unknown>> = [];
  const categorized: Array<Record<string, unknown>> = [];
  let start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const page: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of page) {
      const parsed = parsePurchase(p) as Record<string, any>;
      const merchant = trim(parsed?.merchant);
      const mkey = merchant.toLowerCase();
      let uncAmt = 0;
      const uncClasses = new Set<string>();
      for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
        const d = l.AccountBasedExpenseLineDetail;
        if (!d) continue;
        const acct = trim(d.AccountRef?.name);
        if (trim(d.AccountRef?.value) === UNC) {
          uncAmt += Number(l.Amount) || 0;
          if (trim(d.ClassRef?.name)) uncClasses.add(trim(d.ClassRef?.name));
        } else if (mkey && acct) {
          if (!hist.has(mkey)) hist.set(mkey, new Map());
          const m = hist.get(mkey)!;
          m.set(acct, (m.get(acct) ?? 0) + 1);
        }
      }
      const inRange =
        (!startDate || String(p.TxnDate) >= startDate) && (!endDate || String(p.TxnDate) <= endDate);
      if (uncAmt > 0.005 && inRange) {
        rows.push({
          purchaseId: trim(p.Id), date: String(p.TxnDate), merchant: merchant || trim(p.EntityRef?.name) || '(unknown)',
          amount: Math.round(uncAmt * 100) / 100, cls: [...uncClasses].join(', '),
          cardholder: trim(parsed?.cardholderName), last4: trim(parsed?.last4),
          source: String(p.PaymentType) === 'CreditCard' ? 'card' : 'bank',
          descriptor: [p.EntityRef?.name, p.PrivateNote, ...((p.Line ?? []) as Array<Record<string, any>>).map((l) => l.Description)]
            .map((x) => trim(x)).join(' ').toLowerCase().slice(0, 300),
        });
      }
      if (inRange) {
        for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
          const d = l.AccountBasedExpenseLineDetail;
          if (!d || trim(d.AccountRef?.value) === UNC) continue;
          categorized.push({
            purchaseId: trim(p.Id), lineId: trim(l.Id),
            descriptor: [p.EntityRef?.name, p.PrivateNote, ...((p.Line ?? []) as Array<Record<string, any>>).map((x) => x.Description)]
              .map((x) => trim(x)).join(' ').toLowerCase().slice(0, 200),
            date: String(p.TxnDate), merchant: merchant || trim(p.EntityRef?.name) || '(unknown)',
            amount: Math.round((Number(l.Amount) || 0) * 100) / 100,
            account: trim(d.AccountRef?.name), cls: trim(d.ClassRef?.name),
            cardholder: trim(parsed?.cardholderName),
            source: String(p.PaymentType) === 'CreditCard' ? 'card' : 'bank',
          });
        }
      }
    }
    if (page.length < 1000) break;
    start += 1000;
  }
  // Journal-entry lines on Uncategorized too (the Gusto reimbursement JE
  // was invisible when only Purchases were scanned — Greg 2026-09-02).
  start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const page: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of page) {
      const inRange =
        (!startDate || String(je.TxnDate) >= startDate) && (!endDate || String(je.TxnDate) <= endDate);
      if (!inRange) continue;
      let uncAmt = 0;
      const uncClasses = new Set<string>();
      for (const l of (je.Line ?? []) as Array<Record<string, any>>) {
        const d = l.JournalEntryLineDetail;
        if (d?.PostingType === 'Debit' && trim(d.AccountRef?.value) === UNC) {
          uncAmt += Number(l.Amount) || 0;
          if (trim(d.ClassRef?.name)) uncClasses.add(trim(d.ClassRef?.name));
        }
      }
      if (uncAmt > 0.005) {
        rows.push({
          purchaseId: `je_${trim(je.Id)}`, date: String(je.TxnDate),
          merchant: trim(je.DocNumber) ? `JE ${trim(je.DocNumber)}` : `Journal Entry ${trim(je.Id)}`,
          amount: Math.round(uncAmt * 100) / 100, cls: [...uncClasses].join(', '),
          cardholder: '', last4: '', source: 'journal',
          descriptor: [je.DocNumber, je.PrivateNote, ...((je.Line ?? []) as Array<Record<string, any>>).map((l) => l.Description)]
            .map((x) => trim(x)).join(' ').toLowerCase().slice(0, 300),
        });
      }
    }
    if (page.length < 1000) break;
    start += 1000;
  }
  for (const row of rows) {
    const h = hist.get(String(row.merchant).toLowerCase());
    if (!h) continue;
    const sorted = [...h.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, c]) => s + c, 0);
    const [top, n] = sorted[0];
    row.suggestedAccount = top;
    row.suggestionPct = Math.round((100 * n) / total);
    row.suggestionUses = total;
  }
  rows.sort((a, b) => Number(b.amount) - Number(a.amount));
  categorized.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const rulesSnap = await db.collection(`tenants/${tenantId}/qbo_merchant_rules`).get();
  const rules = rulesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
  return {
    ok: true, rows: rows.slice(0, 500), categorized: categorized.slice(0, 800), rules, expenseAccounts, classes,
    uncategorizedTotal: Math.round(rows.reduce((s, x) => s + Number(x.amount), 0) * 100) / 100,
  };
}

/** One-off inline categorization from the recon page. Only flips lines
 *  still on Uncategorized Expense. */
export async function categorizePurchase(
  tenantId: string,
  purchaseId: string,
  accountName: string,
  className?: string,
): Promise<Record<string, unknown>> {
  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000")) as Record<string, any>;
  const accounts = ((acctRes.Account ?? []) as Array<Record<string, any>>);
  const target = accounts.find(
    (a) => (trim(a.FullyQualifiedName) || trim(a.Name)).toLowerCase() === accountName.toLowerCase() || trim(a.Name).toLowerCase() === accountName.toLowerCase(),
  );
  if (!target) throw new Error(`Account "${accountName}" not found`);
  const unc = accounts.find((a) => trim(a.Name) === 'Uncategorized Expense');
  const UNC = unc ? trim(unc.Id) : '';
  const isJe = purchaseId.startsWith('je_');
  const rawId = (isJe ? purchaseId.slice(3) : purchaseId).replace(/'/g, '');
  const entity = isJe ? 'JournalEntry' : 'Purchase';
  const pr = (await qboQuery(tenantId, `SELECT * FROM ${entity} WHERE Id = '${rawId}'`)) as Record<string, any>;
  const p = ((pr.QueryResponse?.[entity] ?? pr[entity] ?? []) as Array<Record<string, any>>)[0];
  if (!p) throw new Error(`${entity} not found`);
  let cls: { id: string; name: string } | undefined;
  if (trim(className)) {
    const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
    const c = ((clsRes.Class ?? clsRes.QueryResponse?.Class ?? []) as Array<Record<string, any>>).find(
      (x) => (trim(x.FullyQualifiedName) || trim(x.Name)).toLowerCase() === trim(className).toLowerCase(),
    );
    if (c) cls = { id: trim(c.Id), name: trim(c.FullyQualifiedName) || trim(c.Name) };
  }
  let changed = 0;
  for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
    const d = isJe ? l.JournalEntryLineDetail : l.AccountBasedExpenseLineDetail;
    if (!d || trim(d.AccountRef?.value) !== UNC) continue;
    if (isJe && d.PostingType !== 'Debit') continue;
    d.AccountRef = { value: trim(target.Id), name: trim(target.FullyQualifiedName) || trim(target.Name) };
    if (cls && !d.ClassRef) d.ClassRef = { value: cls.id, name: cls.name };
    changed += 1;
  }
  if (changed === 0) return { ok: true, changed: 0, note: 'no uncategorized lines left on this transaction' };
  await qboEntityUpdate(tenantId, entity, { ...p, sparse: false });
  return { ok: true, changed };
}

/** Class-only edit from the recon page (Greg 2026-09-02: "category and
 *  class are two different things... an admin area to edit it").
 *  With lineId: that one line. Without: the still-Uncategorized lines,
 *  falling back to every expense line. Overwrites any existing ClassRef. */
export async function setExpenseClass(
  tenantId: string,
  purchaseId: string,
  className: string,
  lineId?: string,
): Promise<Record<string, unknown>> {
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const cls = ((clsRes.Class ?? clsRes.QueryResponse?.Class ?? []) as Array<Record<string, any>>).find(
    (x) => (trim(x.FullyQualifiedName) || trim(x.Name)).toLowerCase() === trim(className).toLowerCase() || trim(x.Name).toLowerCase() === trim(className).toLowerCase(),
  );
  if (!cls) throw new Error(`Class "${className}" not found`);
  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name FROM Account WHERE Name = 'Uncategorized Expense'")) as Record<string, any>;
  const UNC = trim(((acctRes.Account ?? acctRes.QueryResponse?.Account ?? []) as Array<Record<string, any>>)[0]?.Id);
  const isJe = purchaseId.startsWith('je_');
  const rawId = (isJe ? purchaseId.slice(3) : purchaseId).replace(/'/g, '');
  const entity = isJe ? 'JournalEntry' : 'Purchase';
  const pr = (await qboQuery(tenantId, `SELECT * FROM ${entity} WHERE Id = '${rawId}'`)) as Record<string, any>;
  const p = ((pr.QueryResponse?.[entity] ?? pr[entity] ?? []) as Array<Record<string, any>>)[0];
  if (!p) throw new Error(`${entity} not found`);
  const lines = ((p.Line ?? []) as Array<Record<string, any>>).filter((l) => {
    const d = isJe ? l.JournalEntryLineDetail : l.AccountBasedExpenseLineDetail;
    if (!d) return false;
    if (isJe && d.PostingType !== 'Debit') return false;
    return trim(lineId) ? trim(l.Id) === trim(lineId) : true;
  });
  const uncLines = lines.filter((l) => {
    const d = isJe ? l.JournalEntryLineDetail : l.AccountBasedExpenseLineDetail;
    return trim(d.AccountRef?.value) === UNC;
  });
  const targets = trim(lineId) ? lines : uncLines.length > 0 ? uncLines : lines;
  let changed = 0;
  for (const l of targets) {
    const d = isJe ? l.JournalEntryLineDetail : l.AccountBasedExpenseLineDetail;
    d.ClassRef = { value: trim(cls.Id), name: trim(cls.FullyQualifiedName) || trim(cls.Name) };
    changed += 1;
  }
  if (changed === 0) return { ok: true, changed: 0 };
  await qboEntityUpdate(tenantId, entity, { ...p, sparse: false });
  return { ok: true, changed, class: trim(cls.FullyQualifiedName) || trim(cls.Name) };
}

/** Account edit on an already-categorized line (Categorized tab admin
 *  area). Same targeting as setExpenseClass; overwrites AccountRef. */
export async function setExpenseAccount(
  tenantId: string,
  purchaseId: string,
  accountName: string,
  lineId?: string,
): Promise<Record<string, unknown>> {
  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000")) as Record<string, any>;
  const accounts = ((acctRes.Account ?? []) as Array<Record<string, any>>);
  const target = accounts.find(
    (a) => (trim(a.FullyQualifiedName) || trim(a.Name)).toLowerCase() === trim(accountName).toLowerCase() || trim(a.Name).toLowerCase() === trim(accountName).toLowerCase(),
  );
  if (!target) throw new Error(`Account "${accountName}" not found`);
  const isJe = purchaseId.startsWith('je_');
  const rawId = (isJe ? purchaseId.slice(3) : purchaseId).replace(/'/g, '');
  const entity = isJe ? 'JournalEntry' : 'Purchase';
  const pr = (await qboQuery(tenantId, `SELECT * FROM ${entity} WHERE Id = '${rawId}'`)) as Record<string, any>;
  const p = ((pr.QueryResponse?.[entity] ?? pr[entity] ?? []) as Array<Record<string, any>>)[0];
  if (!p) throw new Error(`${entity} not found`);
  let changed = 0;
  for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
    const d = isJe ? l.JournalEntryLineDetail : l.AccountBasedExpenseLineDetail;
    if (!d) continue;
    if (isJe && d.PostingType !== 'Debit') continue;
    if (trim(lineId) && trim(l.Id) !== trim(lineId)) continue;
    d.AccountRef = { value: trim(target.Id), name: trim(target.FullyQualifiedName) || trim(target.Name) };
    changed += 1;
  }
  if (changed === 0) return { ok: true, changed: 0 };
  await qboEntityUpdate(tenantId, entity, { ...p, sparse: false });
  return { ok: true, changed, account: trim(target.FullyQualifiedName) || trim(target.Name) };
}
