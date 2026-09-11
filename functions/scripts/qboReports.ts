/**
 * QBO reporting helpers that run from the laptop (Firebase ADC + QBO tokens
 * in Firestore). Two commands:
 *
 *   blocks [year]
 *     P&L per 2026 "block" (Sun–Sat weeks; a week belongs to the month that
 *     holds its Wednesday → 4-4-5-style blocks that hug calendar months).
 *     Prints income, direct labor, labor %, COGS, gross margin, opex, net,
 *     plus the internal payroll lines (7010/7020/7040/7110/7120/7131/7140).
 *
 *   changes <since> [periodStart] [periodEnd]
 *     Every P&L-affecting transaction dated inside the period that was
 *     created or edited on/after <since> (QBO MetaData), with its account
 *     lines — answers "why did the Jun–Aug P&L move since the 9/2 print".
 *
 *   wirecheck <start> <end>
 *     Everee funding wires (API, via buildWireJournal) vs QBO "Everee"
 *     purchases on 5010: unmatched on either side + same-amount pairs
 *     (duplicate wires / missing labor).
 *
 *   detail <acct-prefixes> <start> <end>
 *     General-ledger dump for the accounts whose number/name starts with any
 *     of the comma-separated prefixes (e.g. 7010,7040,7110,7131,7140), for
 *     the date range. Writes functions/.scratch/qbo_gl_<start>_<end>.csv
 *     (gitignored) and prints: totals by account × month, by account ×
 *     source (txn type / doc prefix / payee), our automation's lines, and
 *     same-day duplicate amounts.
 *
 * Run from functions/:
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReports.ts blocks 2026
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReports.ts detail 7010,7020,7040,7110,7120,7131,7140 2026-01-01 2026-09-08
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

if (!admin.apps.length) admin.initializeApp();

const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const MINOR_VERSION = '75';

type Row = Record<string, any>;

async function qboGet(pathPart: string, params: Record<string, string>): Promise<Row> {
  const { getQboAccessToken } = await import('../src/integrations/quickbooks/qboAuth');
  const { accessToken, realmId } = await getQboAccessToken(TENANT);
  const qs = new URLSearchParams({ minorversion: MINOR_VERSION, ...params }).toString();
  const res = await fetch(`${API_BASE}/${realmId}/${pathPart}?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const json = (await res.json().catch(() => ({}))) as Row;
  if (!res.ok) throw new Error(`QBO GET ${pathPart} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

import { blocksForYear } from '../src/payroll/fiscalBlocks';
export { blocksForYear };

/* ── report row flattening ──────────────────────────────────────────── */
function flattenPl(report: Row): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (rows: Row[]): void => {
    for (const r of rows) {
      if (r.Header?.ColData && r.Summary?.ColData) {
        const name = String(r.Header.ColData[0]?.value ?? '');
        const total = Number(r.Summary.ColData[1]?.value ?? 0);
        if (name) out.set(`Σ ${name}`, total);
      }
      if (r.ColData && !r.Header) {
        const name = String(r.ColData[0]?.value ?? '');
        if (name) out.set(name, Number(r.ColData[1]?.value ?? 0));
      }
      if (r.Rows?.Row) walk(r.Rows.Row);
    }
  };
  walk(report.Rows?.Row ?? []);
  return out;
}
const pick = (m: Map<string, number>, re: RegExp): number => {
  for (const [k, v] of m) if (re.test(k)) return v;
  return 0;
};
const money = (n: number): string => (n < 0 ? `(${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (a: number, b: number): string => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

async function cmdBlocks(year: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n=== ${year} block P&L (Sun–Sat weeks, Wednesday rule) — as of ${today} ===`);
  console.log(['blk', 'start', 'end', 'wk', 'income', '5010 labor', 'labor%', 'COGS', 'GP', 'GM%', 'opex', 'NOI', 'net'].join('\t'));
  const payroll: string[] = [];
  for (const b of blocksForYear(year)) {
    if (b.start > today) break;
    const rep = await qboGet('reports/ProfitAndLoss', { start_date: b.start, end_date: b.end, accounting_method: 'Accrual' });
    const m = flattenPl(rep);
    const income = pick(m, /^Σ Income$/) || pick(m, /^Σ Total Income/);
    const cogs = pick(m, /^Σ Cost of Goods Sold/);
    const labor = pick(m, /^5010/);
    const opex = pick(m, /^Σ Expenses$/);
    const noi = pick(m, /^Net Operating Income/);
    const net = pick(m, /^Net Income/);
    const partial = b.end > today ? '*' : '';
    console.log([`${b.n}${partial}`, b.start, b.end, b.weeks, money(income), money(labor), pct(labor, income), money(cogs), money(income - cogs), pct(income - cogs, income), money(opex), money(noi), money(net)].join('\t'));
    payroll.push([`${b.n}${partial}`, money(pick(m, /^7010/)), money(pick(m, /^7020/)), money(pick(m, /^7040/)), money(pick(m, /^7110/)), money(pick(m, /^7120/)), money(pick(m, /^7131/)), money(pick(m, /^7140/)), money(pick(m, /^5100/))].join('\t'));
  }
  console.log('\n--- internal payroll + burden by block ---');
  console.log(['blk', '7010 sal', '7020 admin', '7040 comm', '7110 tax', '7120 401k', '7131 health', '7140 WC int', '5100 WC field'].join('\t'));
  for (const p of payroll) console.log(p);
  console.log('\n* = block still open. Month-end JEs (Rev Reclass, WC Alloc, Screen) are dated the last calendar day, so 4100/4200, 5100/7140 and 5310 shift between adjacent blocks; totals and net are unaffected.');
}

/* ── GL detail ──────────────────────────────────────────────────────── */
const OUR_DOC_RE = /^(EV Alloc|TW Alloc|Rev Reclass|WC Alloc|Screen Alloc|EV Pay Alloc)/i;

async function cmdDetail(prefixes: string[], start: string, end: string): Promise<void> {
  const { qboQuery } = await import('../src/integrations/quickbooks/qboAuth');
  const acctRes = (await qboQuery(TENANT, 'SELECT Id, Name, AcctNum, FullyQualifiedName FROM Account MAXRESULTS 1000')) as Row;
  const accts: Row[] = (acctRes.Account ?? []) as Row[];
  const wanted = accts.filter((a) => prefixes.some((p) => String(a.AcctNum ?? '').startsWith(p) || String(a.Name ?? '').startsWith(p) || String(a.FullyQualifiedName ?? '').startsWith(p)));
  if (!wanted.length) throw new Error(`no accounts match ${prefixes.join(',')}`);
  const wantedIds = new Map<string, string>(wanted.map((a) => [String(a.Id), `${a.AcctNum ? a.AcctNum + ' ' : ''}${a.Name}`]));
  console.log(`accounts: ${[...wantedIds.values()].join(' | ')}`);
  // Read the transactions themselves (the GeneralLedger report ignores the
  // account filter for this company — 2026-09-08). Every entity type that
  // can carry a P&L account line.
  const entities = ['JournalEntry', 'Purchase', 'Bill', 'Deposit', 'VendorCredit', 'CreditCardPayment'];
  const lines: Row[] = [];
  for (const ent of entities) {
    let pos = 1;
    for (;;) {
      let r: Row;
      try {
        // eslint-disable-next-line no-await-in-loop
        r = (await qboQuery(TENANT, `SELECT * FROM ${ent} WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Row;
      } catch (e) { console.error(`  (${ent}: ${String(e).slice(0, 120)})`); break; }
      const rows: Row[] = (r[ent] ?? []) as Row[];
      for (const t of rows) {
        const name = String(t.EntityRef?.name ?? t.VendorRef?.name ?? t.CustomerRef?.name ?? '');
        for (const l of (t.Line ?? []) as Row[]) {
          const je = l.JournalEntryLineDetail;
          const ab = l.AccountBasedExpenseLineDetail ?? l.DepositLineDetail;
          const acctId = String(je?.AccountRef?.value ?? ab?.AccountRef?.value ?? '');
          if (!wantedIds.has(acctId)) continue;
          const raw = Number(l.Amount) || 0;
          const amt = je ? (je.PostingType === 'Credit' ? -raw : raw) : l.DepositLineDetail ? -raw : raw;
          lines.push({
            account: wantedIds.get(acctId), tx_date: String(t.TxnDate ?? ''), txn_type: ent, doc_num: String(t.DocNumber ?? ''),
            name: name || String(je?.Entity?.EntityRef?.name ?? ab?.CustomerRef?.name ?? ''), memo: String(l.Description ?? t.PrivateNote ?? '').slice(0, 80),
            klass_name: String(je?.ClassRef?.name ?? ab?.ClassRef?.name ?? ''), dept_name: String(je?.DepartmentRef?.name ?? t.DepartmentRef?.name ?? ''),
            split_acc: '', amount: amt, txn_id: String(t.Id ?? ''), created: String(t.MetaData?.CreateTime ?? '').slice(0, 16), updated: String(t.MetaData?.LastUpdatedTime ?? '').slice(0, 16),
          });
        }
      }
      if (rows.length < 1000) break;
      pos += 1000;
    }
  }
  const amt = (l: Row): number => Number(l.amount) || 0;

  const dir = path.join(process.cwd(), '.scratch');
  fs.mkdirSync(dir, { recursive: true });
  const csvPath = path.join(dir, `qbo_gl_${start}_${end}.csv`);
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const hdr = ['account', 'tx_date', 'txn_type', 'doc_num', 'name', 'memo', 'klass_name', 'dept_name', 'amount', 'txn_id', 'created', 'updated'];
  fs.writeFileSync(csvPath, [hdr.join(','), ...lines.sort((a, b) => String(a.tx_date).localeCompare(String(b.tx_date))).map((l) => hdr.map((h) => esc(l[h])).join(','))].join('\n'));
  console.log(`\n${lines.length} lines → ${csvPath}`);

  const sum = (key: (l: Row) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(key(l), (m.get(key(l)) ?? 0) + amt(l));
    return m;
  };
  const print = (title: string, m: Map<string, number>): void => {
    console.log(`\n--- ${title} ---`);
    for (const [k, v] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`${k}\t${money(v)}`);
  };
  print('by account × month', sum((l) => `${l.account} | ${String(l.tx_date).slice(0, 7)}`));
  print('by account × source (txn type / doc prefix / payee)', sum((l) => {
    const doc = String(l.doc_num ?? '');
    const src = OUR_DOC_RE.test(doc) ? `JE ${doc.replace(/\s+\d.*$/, '')} (automation)` : `${l.txn_type}${doc ? ' "' + doc.replace(/\d+/g, '#') + '"' : ''}${l.name ? ' / ' + l.name : ''}`;
    return `${l.account} | ${src}`;
  }));
  console.log('\n--- every line ≥ $500 (date, account, type/doc, payee, class, amount, created) ---');
  for (const l of lines.filter((x) => Math.abs(amt(x)) >= 500)) console.log(`${l.tx_date}\t${String(l.account).slice(0, 26)}\t${l.txn_type} ${l.doc_num}\t${String(l.name).slice(0, 24)}\t${String(l.klass_name).slice(0, 22)}\t${money(amt(l))}\t${l.created}`);
  const seen = new Map<string, Row[]>();
  for (const l of lines) { const k = `${l.account}|${l.tx_date}|${amt(l).toFixed(2)}`; (seen.get(k) ?? seen.set(k, []).get(k)!).push(l); }
  const dups = [...seen.entries()].filter(([, v]) => v.length > 1 && Math.abs(amt(v[0])) >= 100);
  console.log(`\n--- same account + date + amount more than once (possible double post): ${dups.length} ---`);
  for (const [k, v] of dups.slice(0, 40)) console.log(`${k}\t×${v.length}\t${v.map((l) => `${l.txn_type}${l.doc_num ? ' ' + l.doc_num : ''}${l.name ? ' / ' + l.name : ''}`).join(' ; ')}`);
  const neg = lines.filter((l) => amt(l) < -100);
  console.log(`\n--- credits ≥ $100 (reversals / reclass out): ${neg.length} ---`);
  for (const l of neg.slice(0, 40)) console.log(`${l.tx_date}\t${l.account}\t${l.txn_type} ${l.doc_num}\t${l.name}\t${money(amt(l))}\t${String(l.memo).slice(0, 60)}`);
}

/* ── what changed since a date ──────────────────────────────────────── */
const PL_ACCT_RE = /^[4-9]\d{3}\b|^(Income|Expenses|Cost of Goods Sold|Uncategorized|Sodexo Rebates|Adjustments)/;

async function cmdChanges(since: string, periodStart: string, periodEnd: string): Promise<void> {
  const { qboQuery } = await import('../src/integrations/quickbooks/qboAuth');
  const acctRes = (await qboQuery(TENANT, 'SELECT Id, Name, AcctNum, FullyQualifiedName, AccountType FROM Account MAXRESULTS 1000')) as Row;
  const acctById = new Map<string, Row>(((acctRes.Account ?? []) as Row[]).map((a) => [String(a.Id), a]));
  const label = (id: string): string => { const a = acctById.get(id); return a ? `${a.AcctNum ? a.AcctNum + ' ' : ''}${a.Name}` : `#${id}`; };
  const isPl = (id: string): boolean => { const a = acctById.get(id); return Boolean(a) && /Income|Expense|Cost of Goods Sold/.test(String(a!.AccountType)); };
  const entities = ['JournalEntry', 'Purchase', 'Bill', 'Deposit', 'Invoice', 'CreditMemo', 'VendorCredit', 'SalesReceipt', 'RefundReceipt'];
  const sinceIso = `${since}T00:00:00-07:00`;
  type Hit = { type: string; id: string; date: string; doc: string; name: string; created: string; updated: string; isNew: boolean; lines: Array<{ acct: string; amt: number }> };
  const hits: Hit[] = [];
  for (const ent of entities) {
    let start = 1;
    for (;;) {
      let r: Row;
      try {
        // eslint-disable-next-line no-await-in-loop
        r = (await qboQuery(TENANT, `SELECT * FROM ${ent} WHERE MetaData.LastUpdatedTime >= '${sinceIso}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Row;
      } catch (e) { console.error(`  (${ent}: ${String(e).slice(0, 120)})`); break; }
      const rows: Row[] = (r[ent] ?? []) as Row[];
      for (const t of rows) {
        const date = String(t.TxnDate ?? '');
        if (date < periodStart || date > periodEnd) continue;
        const lines: Array<{ acct: string; amt: number }> = [];
        for (const l of (t.Line ?? []) as Row[]) {
          const amt = Number(l.Amount) || 0;
          const je = l.JournalEntryLineDetail;
          if (je) { const id = String(je.AccountRef?.value ?? ''); if (isPl(id)) lines.push({ acct: label(id), amt: je.PostingType === 'Credit' ? -amt : amt }); continue; }
          const ab = l.AccountBasedExpenseLineDetail ?? l.DepositLineDetail;
          if (ab) { const id = String(ab.AccountRef?.value ?? ''); if (isPl(id)) lines.push({ acct: label(id), amt: l.DepositLineDetail ? -amt : amt }); continue; }
          if (l.SalesItemLineDetail && /Invoice|SalesReceipt/.test(ent)) lines.push({ acct: 'revenue (item-mapped)', amt: -amt });
          if (l.SalesItemLineDetail && /CreditMemo|RefundReceipt/.test(ent)) lines.push({ acct: 'revenue (item-mapped)', amt: amt });
        }
        if (!lines.length) continue;
        const created = String(t.MetaData?.CreateTime ?? '');
        hits.push({ type: ent, id: String(t.Id), date, doc: String(t.DocNumber ?? ''), name: String(t.EntityRef?.name ?? t.CustomerRef?.name ?? t.VendorRef?.name ?? ''), created, updated: String(t.MetaData?.LastUpdatedTime ?? ''), isNew: created.slice(0, 10) >= since, lines });
      }
      if (rows.length < 1000) break;
      start += 1000;
    }
  }
  console.log(`\n=== P&L-affecting transactions dated ${periodStart}..${periodEnd} that were CREATED or EDITED since ${since}: ${hits.length} ===`);
  console.log('(expense + / income − as P&L effect: positive = reduces profit)');
  const byAcct = new Map<string, { created: number; edited: number; n: number }>();
  for (const h of hits) for (const l of h.lines) {
    const e = byAcct.get(l.acct) ?? { created: 0, edited: 0, n: 0 };
    if (h.isNew) e.created += l.amt; else e.edited += l.amt;
    e.n += 1; byAcct.set(l.acct, e);
  }
  console.log('\n--- by account: amount on NEW transactions | amount on EDITED transactions (current values; the pre-edit value is in the QBO audit log) ---');
  for (const [k, v] of [...byAcct.entries()].sort()) console.log(`${k}\t${money(v.created)}\t${money(v.edited)}\t(${v.n} lines)`);
  const bySrc = new Map<string, { amt: number; n: number }>();
  for (const h of hits) for (const l of h.lines) {
    const doc = h.doc;
    const src = OUR_DOC_RE.test(doc) ? `JE ${doc.replace(/\s+\d.*$/, '')} (automation)` : `${h.type}${doc ? ' "' + doc.replace(/\d+/g, '#') + '"' : ''}${h.name ? ' / ' + h.name : ''}`;
    const k = `${l.acct} | ${h.isNew ? 'NEW ' : 'EDIT'} | ${src}`;
    const e = bySrc.get(k) ?? { amt: 0, n: 0 };
    e.amt += l.amt; e.n += 1; bySrc.set(k, e);
  }
  console.log('\n--- by account × NEW/EDIT × source (txn type / doc pattern / payee) ---');
  for (const [k, v] of [...bySrc.entries()].sort()) console.log(`${k}\t${money(v.amt)}\t(${v.n} lines)`);
  const dir = path.join(process.cwd(), '.scratch');
  fs.mkdirSync(dir, { recursive: true });
  const csvPath = path.join(dir, `qbo_changes_since_${since}_${periodStart}_${periodEnd}.csv`);
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, ['updated,new_or_edit,type,txn_date,doc,name,account,amount,txn_id', ...hits.flatMap((h) => h.lines.map((l) => [h.updated, h.isNew ? 'NEW' : 'EDIT', h.type, h.date, h.doc, h.name, l.acct, l.amt, h.id].map(esc).join(',')))].join('\n'));
  console.log(`full list → ${csvPath}`);
  console.log('\n--- transactions (newest first, first 150) ---');
  for (const h of hits.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 150)) {
    const ours = OUR_DOC_RE.test(h.doc) ? ' [automation]' : '';
    console.log(`${h.updated.slice(0, 16)}\t${h.isNew ? 'NEW ' : 'EDIT'}\t${h.type}\t${h.date}\t${h.doc}${ours}\t${h.name}\t${h.lines.map((l) => `${l.acct.slice(0, 28)} ${money(l.amt)}`).join(' | ').slice(0, 160)}`);
  }
}

/* ── Everee wires vs QBO Everee purchases ───────────────────────────── */
async function cmdWirecheck(start: string, end: string): Promise<void> {
  const { qboQuery } = await import('../src/integrations/quickbooks/qboAuth');
  const { buildWireJournal } = await import('../src/payroll/payrollCostReport');
  const journal = (await buildWireJournal(TENANT, start, end, null)) as Row;
  const wires = ((journal.wires ?? []) as Row[]).map((w) => ({ id: String(w.fundingId ?? ''), date: String(w.fundingDate ?? '').slice(0, 10), entity: String(w.entityName ?? ''), amount: Number(w.amount) || 0, matched: false }));
  const acctRes = (await qboQuery(TENANT, 'SELECT Id, Name, AcctNum FROM Account MAXRESULTS 1000')) as Row;
  const acct5010 = ((acctRes.Account ?? []) as Row[]).find((a) => String(a.AcctNum ?? '') === '5010' || /^5010/.test(String(a.Name ?? '')));
  if (!acct5010) throw new Error('5010 not found');
  const purchases: Array<{ id: string; date: string; doc: string; amount: number; created: string; matched: boolean }> = [];
  let pos = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(TENANT, `SELECT * FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Row;
    const rows: Row[] = (r.Purchase ?? []) as Row[];
    for (const t of rows) {
      if (!/everee/i.test(String(t.EntityRef?.name ?? ''))) continue;
      const amt = ((t.Line ?? []) as Row[]).filter((l) => String(l.AccountBasedExpenseLineDetail?.AccountRef?.value ?? '') === String(acct5010.Id)).reduce((sum, l) => sum + (Number(l.Amount) || 0), 0);
      if (amt <= 0) continue;
      purchases.push({ id: String(t.Id), date: String(t.TxnDate), doc: String(t.DocNumber ?? ''), amount: Math.round(amt * 100) / 100, created: String(t.MetaData?.CreateTime ?? '').slice(0, 16), matched: false });
    }
    if (rows.length < 1000) break;
    pos += 1000;
  }
  const days = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  // exact amount, nearest date within 7 days
  for (const p of purchases.sort((a, b) => a.date.localeCompare(b.date))) {
    const cands = wires.filter((w) => !w.matched && Math.abs(w.amount - p.amount) < 0.011 && days(w.date, p.date) <= 7).sort((a, b) => days(a.date, p.date) - days(b.date, p.date));
    if (cands[0]) { cands[0].matched = true; p.matched = true; }
  }
  const tot = (xs: Array<{ amount: number }>): number => xs.reduce((s2, x) => s2 + x.amount, 0);
  console.log(`\n=== Everee wires (API) vs QBO "Everee" purchases hitting 5010, ${start}..${end} ===`);
  console.log(`Everee wires: ${wires.length} = ${money(tot(wires))}   QBO Everee→5010 purchases: ${purchases.length} = ${money(tot(purchases))}`);
  console.log(`matched (same amount, within 7 days): ${purchases.filter((p) => p.matched).length} = ${money(tot(purchases.filter((p) => p.matched)))}`);
  const up = purchases.filter((p) => !p.matched);
  console.log(`\n--- QBO purchases with NO Everee wire behind them: ${up.length} = ${money(tot(up))} (duplicates or non-wire Everee charges) ---`);
  for (const p of up) console.log(`${p.date}\t${money(p.amount)}\tdoc ${p.doc}\tcreated ${p.created}\tqbo #${p.id}`);
  const uw = wires.filter((w) => !w.matched);
  console.log(`\n--- Everee wires with NO QBO purchase: ${uw.length} = ${money(tot(uw))} (labor missing from 5010) ---`);
  for (const w of uw) console.log(`${w.date}\t${money(w.amount)}\t${w.entity}\tfunding ${w.id}`);
  const dups: string[] = [];
  for (let i = 0; i < purchases.length; i++) for (let j = i + 1; j < purchases.length; j++) {
    if (Math.abs(purchases[i].amount - purchases[j].amount) < 0.011 && days(purchases[i].date, purchases[j].date) <= 7) dups.push(`${purchases[i].date} & ${purchases[j].date}\t${money(purchases[i].amount)}\tqbo #${purchases[i].id} / #${purchases[j].id}`);
  }
  console.log(`\n--- QBO Everee purchases with the same amount within 7 days of each other: ${dups.length} ---`);
  for (const d of dups) console.log(d);
}

async function main(): Promise<void> {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'blocks') {
    await cmdBlocks(Number(a ?? new Date().getUTCFullYear()));
  } else if (cmd === 'detail' && a && b && c) {
    await cmdDetail(a.split(',').map((s) => s.trim()).filter(Boolean), b, c);
  } else if (cmd === 'changes' && a) {
    await cmdChanges(a, b ?? '2026-01-01', c ?? '2026-12-31');
  } else if (cmd === 'wirecheck' && a && b) {
    await cmdWirecheck(a, b);
  } else {
    console.error('usage: qboReports.ts blocks [year] | detail <acct-prefixes> <start> <end> | changes <since YYYY-MM-DD> [periodStart] [periodEnd] | wirecheck <start> <end>');
    process.exit(2);
  }
}

if (require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
