/**
 * Overhead allocation by revenue ratio (Greg 2026-09-08 — automating
 * Tabitha's month-end "Rev Allocation" entry).
 *
 * Every overhead line posted to `Corp / Unalloc.` (or left untagged) is
 * spread to Event-based / Recurring in the ratio of that period's revenue
 * by Division (invoice header Division; Sodexo + Indeed Flex = Recurring).
 * One JE per segment (calendar month ∩ fiscal block, fiscalBlocks.ts):
 *   credit <same account> @ source Division   (removes it from Corp)
 *   debit  <same account> @ Event-based       × ratio
 *   debit  <same account> @ Recurring         × (1 − ratio)
 * Same account both sides — sub-accounts included — so account totals never
 * move; only the Division columns do.
 *
 * Eligible: every Expense-type account (7140's NET Corp balance — internal
 * WC after the accrual and payment clearing — included), plus COGS overhead (5200 platform fees, 5210
 * ConnectTeam, 5300 recruiting, 5400 supplies…) except 5010 / 5100 / 5310
 * which have their own writers, plus Other Income (9xxx — credits, so the
 * legs flip) and Other Expense (6xxx). Nothing stays in Corp except what
 * the dedicated writers own. Our own allocation JEs and Tabitha's
 * hand-keyed `Rev Allocation` JEs are excluded from the base; a surviving
 * `Rev Allocation` is reported so it can be deleted (it would double-count).
 *
 * Self-truing: the JE is rewritten whenever the recomputed leg set differs
 * (late postings, re-accounting to a sub-account, ratio moved). Idempotent
 * per segment via [ovh:YYYY-MM/B<n>] in PrivateNote.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { resolvePriors, segmentDocSuffix, segmentFor, segmentTxnDate, type ReportSegment } from './fiscalBlocks';
import { fetchQboDivisions } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const trim = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => Number(v) || 0;
const round2 = (n: number): number => Math.round(n * 100) / 100;
// Only THIS writer's own entries and the hand-keyed Rev Allocation are left
// out of the base. Other automation JEs are part of the real balance — e.g.
// the WC accrual/clearing lines ARE what 7140 Corp holds after the field
// share leaves (Greg 2026-09-08: allocate 7140 by revenue too).
const OUR_DOCS = /^(Ovh Alloc)/i;
const MANUAL_ALLOC = /^Rev Allocation/i;

export async function pushOverheadAllocations(
  tenantId: string,
  dryRun: boolean,
  opts?: { since?: string },
): Promise<Record<string, unknown>> {
  const since = opts?.since ?? '2026-05-01';
  const today = new Date().toISOString().slice(0, 10);
  const divisions = await fetchQboDivisions(tenantId);
  if (!divisions.corp) throw new Error('Corp / Unalloc. division not found');
  const CORP = divisions.corp.Id;

  const acctRes = (await qboQuery(tenantId, 'SELECT Id, Name, AcctNum, FullyQualifiedName, AccountType FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const accts: Array<Record<string, any>> = acctRes.QueryResponse?.Account ?? acctRes.Account ?? [];
  const acctById = new Map(accts.map((a) => [String(a.Id), a]));
  const eligible = (id: string): boolean => {
    const a = acctById.get(id);
    if (!a) return false;
    const n = String(a.AcctNum ?? '');
    const name = String(a.Name ?? '');
    if (/uncategorized|ask my accountant/i.test(name)) return false; // not yet booked anywhere real
    if (a.AccountType === 'Expense') return true; // 7140 included: its net Corp balance (internal WC after accrual + clearing) spreads by revenue
    if (a.AccountType === 'Other Income') return true; // 9010 card rewards / 9020 interest — by revenue too (Greg 2026-09-08); credits flip sides below
    if (a.AccountType === 'Other Expense') return true; // 6xxx financing / misc — by revenue too (Greg 2026-09-08, later)
    if (a.AccountType === 'Cost of Goods Sold') return !(['5010', '5100', '5310'].includes(n) || /direct labor|workers'? comp|background.*screening/i.test(name));
    return false;
  };
  const label = (id: string): string => { const a = acctById.get(id); return a ? `${a.AcctNum ? a.AcctNum + ' ' : ''}${a.FullyQualifiedName}` : `#${id}`; };
  const itemRes = (await qboQuery(tenantId, 'SELECT Id, ExpenseAccountRef FROM Item MAXRESULTS 1000')) as Record<string, any>;
  const itemExp = new Map<string, string>(((itemRes.QueryResponse?.Item ?? itemRes.Item ?? []) as Array<Record<string, any>>).map((i) => [String(i.Id), String(i.ExpenseAccountRef?.value ?? '')]));

  // ── revenue by segment × Division (invoice header) ──
  const rev = new Map<string, { event: number; recurring: number }>();
  const segByKey = new Map<string, ReportSegment>();
  const addRev = (date: string, deptId: string, amt: number): void => {
    const seg = segmentFor(date.slice(0, 10));
    segByKey.set(seg.key, seg);
    const r = rev.get(seg.key) ?? { event: 0, recurring: 0 };
    if (deptId === divisions.recurring.Id) r.recurring += amt; else if (deptId === divisions.event.Id) r.event += amt;
    rev.set(seg.key, r);
  };
  for (const [ent, sign] of [['Invoice', 1], ['SalesReceipt', 1], ['CreditMemo', -1], ['RefundReceipt', -1]] as Array<[string, number]>) {
    let start = 1;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const r = (await qboQuery(tenantId, `SELECT * FROM ${ent} WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
      const rows: Array<Record<string, any>> = r.QueryResponse?.[ent] ?? r[ent] ?? [];
      for (const d of rows) addRev(String(d.TxnDate), trim(d.DepartmentRef?.value), sign * num(d.TotalAmt));
      if (rows.length < 1000) break;
      start += 1000;
    }
  }

  // ── overhead base: eligible-account lines in Corp or untagged, by segment ──
  // key = seg|acctId|srcDept ('' = untagged)
  const base = new Map<string, { seg: string; acctId: string; srcDept: string; amt: number; n: number }>();
  const manualAllocs = new Set<string>();
  const existing = new Map<string, Record<string, any>>();
  const addBase = (date: string, acctId: string, deptId: string, debit: number): void => {
    if (!eligible(acctId)) return;
    if (deptId && deptId !== CORP) return; // already in a client Division
    const seg = segmentFor(date.slice(0, 10));
    segByKey.set(seg.key, seg);
    const k = `${seg.key}|${acctId}|${deptId}`;
    const e = base.get(k) ?? { seg: seg.key, acctId, srcDept: deptId, amt: 0, n: 0 };
    e.amt += debit; e.n += 1; base.set(k, e);
  };
  for (const ent of ['Purchase', 'Bill', 'VendorCredit', 'Deposit', 'JournalEntry']) {
    let start = 1;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const r = (await qboQuery(tenantId, `SELECT * FROM ${ent} WHERE TxnDate >= '${ent === 'JournalEntry' ? '2026-01-01' : since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
      const rows: Array<Record<string, any>> = r.QueryResponse?.[ent] ?? r[ent] ?? [];
      for (const t of rows) {
        const date = String(t.TxnDate);
        if (ent === 'JournalEntry') {
          const doc = trim(t.DocNumber);
          for (const m of trim(t.PrivateNote).matchAll(/\[ovh:([^\]]+)\]/g)) existing.set(trim(m[1]), t);
          if (OUR_DOCS.test(doc)) continue;
          if (MANUAL_ALLOC.test(doc)) { if (date >= since) manualAllocs.add(`${doc} #${t.Id} (${date})`); continue; }
          if (date < since) continue;
          for (const l of (t.Line ?? []) as Array<Record<string, any>>) {
            const d = l.JournalEntryLineDetail;
            if (!d) continue;
            addBase(date, trim(d.AccountRef?.value), trim(d.DepartmentRef?.value), d.PostingType === 'Credit' ? -num(l.Amount) : num(l.Amount));
          }
          continue;
        }
        const hdrDept = trim(t.DepartmentRef?.value);
        // A card REFUND is a Purchase with Credit:true — negative on the P&L.
        // (2026-09-08: a 43.00 Southwest return was read as +43 and credited
        // again → −86 in Not Specified on 8810.)
        const sign = ent === 'VendorCredit' || ent === 'Deposit' || (ent === 'Purchase' && t.Credit === true) ? -1 : 1;
        for (const l of (t.Line ?? []) as Array<Record<string, any>>) {
          const ab = l.AccountBasedExpenseLineDetail ?? l.DepositLineDetail;
          if (ab) { addBase(date, trim(ab.AccountRef?.value), hdrDept, sign * num(l.Amount)); continue; }
          const ib = l.ItemBasedExpenseLineDetail;
          if (ib) addBase(date, itemExp.get(trim(ib.ItemRef?.value)) ?? '', hdrDept, sign * num(l.Amount));
        }
      }
      if (rows.length < 1000) break;
      start += 1000;
    }
  }

  // ── build per-segment plans ──
  const results: Array<Record<string, unknown>> = [];
  const { priors, orphans } = resolvePriors(existing, segByKey.values());
  for (const o of orphans) results.push({ month: o.tag, amount: 0, status: 'stale_prior_delete_manually', docNumber: (o.je as Record<string, any>).DocNumber });
  // Tabitha's method is MONTHLY ("80% of the month's revenue is Event-based →
  // 80% of the line"), so every segment of a month uses the calendar month's
  // ratio; a month with no revenue yet falls back to the segment, then 100%.
  const ratioFor = (segKey: string): { event: number; recurring: number; ratio: number; basis: string } => {
    const ym = segKey.slice(0, 7);
    let e = 0; let q = 0;
    for (const [k, v] of rev) if (k.startsWith(ym)) { e += v.event; q += v.recurring; }
    if (e + q > 0) return { event: e, recurring: q, ratio: e / (e + q), basis: 'month' };
    const r = rev.get(segKey) ?? { event: 0, recurring: 0 };
    const tot = r.event + r.recurring;
    return { ...r, ratio: tot > 0 ? r.event / tot : 1, basis: tot > 0 ? 'segment' : 'default_100_event' };
  };
  const legKey = (acct: string, dept: string, side: string, cents: number): string => `${acct}|${dept}|${side}|${cents}`;
  const bySeg = new Map<string, Array<{ acctId: string; srcDept: string; amt: number; n: number }>>();
  for (const e of base.values()) {
    if (Math.abs(e.amt) < 0.005) continue;
    if (!bySeg.has(e.seg)) bySeg.set(e.seg, []);
    bySeg.get(e.seg)!.push(e);
  }
  for (const [segKey, items] of [...bySeg.entries()].sort()) {
    const seg = segByKey.get(segKey)!;
    if (seg.end > today && seg.start > today) continue;
    const rt = ratioFor(segKey);
    const lines: Array<Record<string, unknown>> = [];
    const want = new Set<string>();
    const detail: Array<Record<string, unknown>> = [];
    let total = 0;
    for (const it of items.sort((a, b) => label(a.acctId).localeCompare(label(b.acctId)))) {
      const cents = Math.round(Math.abs(it.amt) * 100);
      if (!cents) continue;
      const debitSide = it.amt > 0; // positive overhead → credit source, debit divisions
      const evCents = Math.round(cents * rt.ratio);
      const rcCents = cents - evCents;
      total += it.amt;
      const srcRef = it.srcDept ? { DepartmentRef: { value: it.srcDept, name: it.srcDept === CORP ? divisions.corp!.Name : it.srcDept } } : {};
      const push = (dept: { Id: string; Name: string } | null, side: 'Debit' | 'Credit', c: number, desc: string): void => {
        if (!c) return;
        lines.push({ DetailType: 'JournalEntryLineDetail', Amount: c / 100, Description: desc, JournalEntryLineDetail: { PostingType: side, AccountRef: { value: it.acctId }, ...(dept ? { DepartmentRef: { value: dept.Id, name: dept.Name } } : srcRef) } });
        want.add(legKey(it.acctId, dept ? dept.Id : it.srcDept, side, c));
      };
      const lbl = label(it.acctId);
      push(null, debitSide ? 'Credit' : 'Debit', cents, `Overhead allocation — ${lbl} out of ${it.srcDept ? 'Corp' : 'untagged'} (${segKey})`);
      push(divisions.event, debitSide ? 'Debit' : 'Credit', evCents, `Overhead allocation — ${lbl} ${(rt.ratio * 100).toFixed(2)}% Event-based (${segKey})`);
      push(divisions.recurring, debitSide ? 'Debit' : 'Credit', rcCents, `Overhead allocation — ${lbl} ${((1 - rt.ratio) * 100).toFixed(2)}% Recurring (${segKey})`);
      detail.push({ account: lbl, source: it.srcDept ? 'Corp' : 'untagged', amount: round2(it.amt), event: evCents / 100, recurring: rcCents / 100, lines: it.n });
    }
    if (!lines.length) continue;
    const prior = priors.get(segKey);
    if (prior) {
      const have = new Set<string>();
      for (const l of (prior.Line ?? []) as Array<Record<string, any>>) {
        const d = l.JournalEntryLineDetail; if (!d) continue;
        have.add(legKey(trim(d.AccountRef?.value), trim(d.DepartmentRef?.value), trim(d.PostingType), Math.round(num(l.Amount) * 100)));
      }
      if (have.size === want.size && [...want].every((k) => have.has(k)) && trim(prior.DocNumber) === `Ovh Alloc ${segmentDocSuffix(seg)}`) {
        results.push({ month: segKey, dates: `${seg.start}..${seg.end}`, amount: round2(total), status: 'already_allocated', ratioEvent: round2(rt.ratio * 100), accounts: detail.length });
        continue;
      }
    }
    const action = prior ? 'true_up' : 'create';
    results.push({ month: segKey, dates: `${seg.start}..${seg.end}`, amount: round2(total), status: dryRun ? `would_${action}` : `${action}d`, ratioEvent: round2(rt.ratio * 100), ratioBasis: rt.basis, revenue: { event: round2(rt.event), recurring: round2(rt.recurring) }, accounts: detail.length, detail });
    if (dryRun) continue;
    const header = {
      DocNumber: `Ovh Alloc ${segmentDocSuffix(seg)}`,
      TxnDate: segmentTxnDate(seg, today),
      PrivateNote:
        `Overhead allocated by revenue ratio (Event-based ${(rt.ratio * 100).toFixed(2)}% / Recurring ${((1 - rt.ratio) * 100).toFixed(2)}%, ${rt.basis} revenue by invoice Division). ` +
        `Same account both sides; Corp / untagged overhead moved to the client Divisions. Excludes 5010/5100/5310 (own writers). ` +
        `Segment ${seg.start}..${seg.end} (month ∩ block). [ovh:${seg.key}]`,
    };
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, ...header, Line: lines, sparse: false });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', { ...header, Line: lines });
    }
  }
  return { ok: true, dryRun, since, months: results, manualAllocationsToDelete: [...manualAllocs].sort() };
}
