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
  console.log(`accounts: ${wanted.map((a) => `${a.AcctNum ?? ''} ${a.Name} (#${a.Id})`).join(' | ')}`);
  const rep = await qboGet('reports/GeneralLedger', {
    start_date: start,
    end_date: end,
    accounting_method: 'Accrual',
    account: wanted.map((a) => String(a.Id)).join(','),
    columns: 'tx_date,txn_type,doc_num,name,memo,klass_name,dept_name,split_acc,subt_nat_amount',
  });
  const cols: string[] = ((rep.Columns?.Column ?? []) as Row[]).map((c) => String(c.ColType || c.ColTitle));
  const lines: Row[] = [];
  const walk = (rows: Row[], acct: string): void => {
    for (const r of rows) {
      const here = r.Header?.ColData ? String(r.Header.ColData[0]?.value ?? acct) : acct;
      if (r.ColData && !r.Header && r.type !== 'Section') {
        const o: Row = { account: here };
        (r.ColData as Row[]).forEach((c, i) => { o[cols[i] ?? `c${i}`] = c.value ?? ''; if (c.id) o[`${cols[i]}_id`] = c.id; });
        if (o.tx_date) lines.push(o);
      }
      if (r.Rows?.Row) walk(r.Rows.Row, here);
    }
  };
  walk(rep.Rows?.Row ?? [], '');
  const amt = (l: Row): number => Number(l.subt_nat_amount ?? l.nat_amount ?? 0) || 0;

  const dir = path.join(process.cwd(), '.scratch');
  fs.mkdirSync(dir, { recursive: true });
  const csvPath = path.join(dir, `qbo_gl_${start}_${end}.csv`);
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const hdr = ['account', 'tx_date', 'txn_type', 'doc_num', 'name', 'memo', 'klass_name', 'dept_name', 'split_acc', 'amount', 'txn_id'];
  fs.writeFileSync(csvPath, [hdr.join(','), ...lines.map((l) => [l.account, l.tx_date, l.txn_type, l.doc_num, l.name, l.memo, l.klass_name, l.dept_name, l.split_acc, amt(l), l.txn_type_id ?? l.doc_num_id ?? ''].map(esc).join(','))].join('\n'));
  console.log(`\n${lines.length} GL lines → ${csvPath}`);

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
    const src = OUR_DOC_RE.test(doc) ? `JE ${doc.replace(/\s+\d.*$/, '')} (automation)` : `${l.txn_type}${l.name ? ' / ' + l.name : ''}`;
    return `${l.account} | ${src}`;
  }));
  const ours = lines.filter((l) => OUR_DOC_RE.test(String(l.doc_num ?? '')));
  console.log(`\n--- automation lines hitting these accounts: ${ours.length} (${money(ours.reduce((s, l) => s + amt(l), 0))}) ---`);
  for (const l of ours.slice(0, 40)) console.log(`${l.tx_date}\t${l.account}\t${l.doc_num}\t${l.klass_name ?? ''}\t${money(amt(l))}`);
  const seen = new Map<string, Row[]>();
  for (const l of lines) { const k = `${l.account}|${l.tx_date}|${amt(l).toFixed(2)}`; (seen.get(k) ?? seen.set(k, []).get(k)!).push(l); }
  const dups = [...seen.entries()].filter(([, v]) => v.length > 1 && Math.abs(amt(v[0])) >= 100);
  console.log(`\n--- same account + date + amount more than once (possible double post): ${dups.length} ---`);
  for (const [k, v] of dups.slice(0, 40)) console.log(`${k}\t×${v.length}\t${v.map((l) => `${l.txn_type}${l.doc_num ? ' ' + l.doc_num : ''}${l.name ? ' / ' + l.name : ''}`).join(' ; ')}`);
  const neg = lines.filter((l) => amt(l) < -100);
  console.log(`\n--- credits ≥ $100 (reversals / reclass out): ${neg.length} ---`);
  for (const l of neg.slice(0, 40)) console.log(`${l.tx_date}\t${l.account}\t${l.txn_type} ${l.doc_num ?? ''}\t${l.name ?? ''}\t${money(amt(l))}\t${String(l.memo ?? '').slice(0, 60)}`);
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
  console.log('\n--- transactions (newest first) ---');
  for (const h of hits.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 150)) {
    const ours = OUR_DOC_RE.test(h.doc) ? ' [automation]' : '';
    console.log(`${h.updated.slice(0, 16)}\t${h.isNew ? 'NEW ' : 'EDIT'}\t${h.type}\t${h.date}\t${h.doc}${ours}\t${h.name}\t${h.lines.map((l) => `${l.acct.slice(0, 28)} ${money(l.amt)}`).join(' | ').slice(0, 160)}`);
  }
}

async function main(): Promise<void> {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'blocks') {
    await cmdBlocks(Number(a ?? new Date().getUTCFullYear()));
  } else if (cmd === 'detail' && a && b && c) {
    await cmdDetail(a.split(',').map((s) => s.trim()).filter(Boolean), b, c);
  } else if (cmd === 'changes' && a) {
    await cmdChanges(a, b ?? '2026-01-01', c ?? '2026-12-31');
  } else {
    console.error('usage: qboReports.ts blocks [year] | detail <acct-prefixes> <start> <end> | changes <since YYYY-MM-DD> [periodStart] [periodEnd]');
    process.exit(2);
  }
}

if (require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
