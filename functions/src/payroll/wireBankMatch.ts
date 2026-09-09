/**
 * Everee funding wires ↔ QBO Everee bank debits on 5010 (Greg 2026-09-08).
 *
 * The bank debit is the truth for what a wire cost; Everee's /payments read
 * keeps moving after the pull (voids, reissues, page shifts). This matcher
 * pairs each funding group from buildWireJournal with the bank line(s) that
 * paid it, handling Everee's bundling:
 *   1. exact: one debit = one funding, or the sum of ≤4 fundings (same
 *      entity family, funded −1..+8 days before the debit)
 *   2. exact: one funding split across 2 debits
 *   3. near: one funding ↔ one debit, same family/window, |diff| ≤
 *      max($50, 3%) — the funding total drifted after the bank pulled
 * Returns, per wire, the bank amount it should be booked at.
 */
import { qboQuery } from '../integrations/quickbooks/qboAuth';

const trim = (v: unknown): string => String(v ?? '').trim();
const day = (s: string): number => Math.floor(Date.parse(s.slice(0, 10)) / 86400000);

export type WireIn = { fundingId: string; fundingDate: string; entityName: string; amount: number };
export type WireMatch = { fundingId: string; bankCents: number; bankDates: string[]; debitIds: string[]; how: 'exact' | 'split' | 'near' | 'unmatched' };
export type BankDebit = { id: string; date: string; ent: 'EVT' | 'SEL' | 'ANY'; cents: number; memo: string };

export async function fetchEvereeBankDebits(tenantId: string, start: string, end: string): Promise<BankDebit[]> {
  const acctRes = (await qboQuery(tenantId, 'SELECT Id, Name, AcctNum FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const a5010 = ((acctRes.QueryResponse?.Account ?? acctRes.Account ?? []) as Array<Record<string, any>>).find((a) => String(a.AcctNum) === '5010' || /^5010/.test(String(a.Name)));
  if (!a5010) throw new Error('5010 not found');
  const out: BankDebit[] = [];
  let pos = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of rows) {
      const memo = trim(p.PrivateNote);
      if (!/everee/i.test(trim(p.EntityRef?.name)) && !/everee/i.test(memo)) continue;
      if (/ePay0001/i.test(memo) || p.Credit === true) continue; // service-fee drafts / refunds
      const amt = ((p.Line ?? []) as Array<Record<string, any>>).filter((l) => String(l.AccountBasedExpenseLineDetail?.AccountRef?.value) === String(a5010.Id)).reduce((s, l) => s + (Number(l.Amount) || 0), 0);
      if (amt <= 0) continue;
      out.push({ id: String(p.Id), date: String(p.TxnDate).slice(0, 10), ent: /C1 Events/i.test(memo) ? 'EVT' : /C1 Select/i.test(memo) ? 'SEL' : 'ANY', cents: Math.round(amt * 100), memo: memo.slice(0, 60) });
    }
    if (rows.length < 1000) break;
    pos += 1000;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function matchWiresToBank(wiresIn: WireIn[], debitsIn: BankDebit[]): { matches: Map<string, WireMatch>; unmatchedDebits: BankDebit[] } {
  type W = { id: string; date: string; ent: 'EVT' | 'SEL' | 'OTHER'; cents: number; open: boolean; m: WireMatch };
  const wires: W[] = wiresIn.map((w) => ({
    id: trim(w.fundingId), date: w.fundingDate.slice(0, 10),
    ent: /events/i.test(w.entityName) ? 'EVT' : /select/i.test(w.entityName) ? 'SEL' : 'OTHER',
    cents: Math.round(w.amount * 100), open: true,
    m: { fundingId: trim(w.fundingId), bankCents: 0, bankDates: [], debitIds: [], how: 'unmatched' },
  }));
  const debits = debitsIn.map((d) => ({ ...d, open: true }));
  const okEnt = (w: W, d: BankDebit): boolean => d.ent === 'ANY' || w.ent === d.ent;
  const inWin = (w: W, d: BankDebit): boolean => { const k = day(d.date) - day(w.date); return k >= -1 && k <= 8; };
  const take = (w: W, d: BankDebit & { open: boolean }, cents: number, how: WireMatch['how']): void => {
    w.m.bankCents += cents; w.m.bankDates.push(d.date); w.m.debitIds.push(d.id); w.m.how = how; w.open = false;
  };
  // 1. exact subset (≤4 whole wires) per debit
  for (const d of debits) {
    const cands = wires.filter((w) => w.open && okEnt(w, d) && inWin(w, d)).sort((a, b) => b.cents - a.cents);
    let found: W[] | null = null;
    const search = (i: number, left: number, picked: W[]): void => {
      if (found || picked.length > 4) return;
      if (left === 0 && picked.length) { found = [...picked]; return; }
      for (let j = i; j < cands.length && !found; j++) if (cands[j].cents <= left) search(j + 1, left - cands[j].cents, [...picked, cands[j]]);
    };
    search(0, d.cents, []);
    if (found) { for (const w of found as W[]) take(w, d, w.cents, 'exact'); d.open = false; }
  }
  // 2. one wire = two debits
  for (const w of wires.filter((w) => w.open)) {
    const ds = debits.filter((d) => d.open && okEnt(w, d) && inWin(w, d));
    outer: for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      if (ds[i].cents + ds[j].cents === w.cents) { take(w, ds[i], ds[i].cents, 'split'); take(w, ds[j], ds[j].cents, 'split'); ds[i].open = false; ds[j].open = false; break outer; }
    }
  }
  // 3. near single pairs (drift after the pull) — closest first
  const pairs: Array<{ w: W; d: BankDebit & { open: boolean }; diff: number }> = [];
  for (const w of wires.filter((w) => w.open)) for (const d of debits.filter((d) => d.open && okEnt(w, d) && inWin(w, d))) {
    const diff = Math.abs(d.cents - w.cents);
    if (diff <= Math.max(5000, Math.round(w.cents * 0.03))) pairs.push({ w, d, diff });
  }
  for (const p of pairs.sort((a, b) => a.diff - b.diff)) { if (!p.w.open || !p.d.open) continue; take(p.w, p.d, p.d.cents, 'near'); p.d.open = false; }
  return { matches: new Map(wires.map((w) => [w.id, w.m])), unmatchedDebits: debits.filter((d) => d.open).map(({ open: _o, ...d }) => d) };
}
