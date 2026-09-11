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
 *      max($100, 5%) — the funding total drifted after the bank pulled
 *   4. tolerant bundles (≤5 fundings within the same tolerance; drift on
 *      the largest)
 *   5. month close-out: leftover debits spread pro rata over leftover
 *      wires of the same month when the sides are within ±25%
 * Returns, per wire, the bank amount it should be booked at.
 */
import { qboQuery } from '../integrations/quickbooks/qboAuth';

const trim = (v: unknown): string => String(v ?? '').trim();
const day = (s: string): number => Math.floor(Date.parse(s.slice(0, 10)) / 86400000);

export type WireIn = { fundingId: string; fundingDate: string; entityName: string; amount: number };
export type WireMatch = { fundingId: string; bankCents: number; bankDates: string[]; debitIds: string[]; how: 'exact' | 'split' | 'near' | 'prorata' | 'unmatched' };
export type BankDebit = { id: string; date: string; ent: 'EVT' | 'SEL' | 'ANY'; cents: number; memo: string; acct?: '5010' | '1260' };

/** Everee bank debits on 5010 (labor) AND on 1260 Everee Funding Balance
 *  (cash sent that has no funding yet) — both are candidates for matching. */
export async function fetchEvereeBankDebits(tenantId: string, start: string, end: string): Promise<BankDebit[]> {
  const acctRes = (await qboQuery(tenantId, 'SELECT Id, Name, AcctNum FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const accts = (acctRes.QueryResponse?.Account ?? acctRes.Account ?? []) as Array<Record<string, any>>;
  const a5010 = accts.find((a) => String(a.AcctNum) === '5010' || /^5010/.test(String(a.Name)));
  const a1260 = accts.find((a) => String(a.AcctNum) === '1260' || /everee funding balance/i.test(String(a.Name)));
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
      const on = (id: string | undefined): number => id ? ((p.Line ?? []) as Array<Record<string, any>>).filter((l) => String(l.AccountBasedExpenseLineDetail?.AccountRef?.value) === id).reduce((s, l) => s + (Number(l.Amount) || 0), 0) : 0;
      const amt5010 = on(String(a5010.Id)); const amt1260 = a1260 ? on(String(a1260.Id)) : 0;
      const amt = amt5010 > 0 ? amt5010 : amt1260;
      if (amt <= 0) continue;
      out.push({ id: String(p.Id), date: String(p.TxnDate).slice(0, 10), ent: /C1 Events/i.test(memo) ? 'EVT' : /C1 Select/i.test(memo) ? 'SEL' : 'ANY', cents: Math.round(amt * 100), memo: memo.slice(0, 60), acct: amt5010 > 0 ? '5010' : '1260' });
    }
    if (rows.length < 1000) break;
    pos += 1000;
  }
  // Everee refund DEPOSITS are NOT netted here: they carry the entity's own
  // Division (expenseDivisions) and net against the labor in that column.
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
  // 1. exact subset (≤4 whole wires) per debit (positive debits only; refunds net in pass 5)
  for (const d of debits.filter((d) => d.cents > 0)) {
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
    const ds = debits.filter((d) => d.open && d.cents > 0 && okEnt(w, d) && inWin(w, d));
    outer: for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      if (ds[i].cents + ds[j].cents === w.cents) { take(w, ds[i], ds[i].cents, 'split'); take(w, ds[j], ds[j].cents, 'split'); ds[i].open = false; ds[j].open = false; break outer; }
    }
  }
  // 3. near single pairs (drift after the pull) — closest first, ≤ max($100, 5%)
  const tol = (cents: number): number => Math.max(10000, Math.round(cents * 0.05));
  const pairs: Array<{ w: W; d: BankDebit & { open: boolean }; diff: number }> = [];
  for (const w of wires.filter((w) => w.open)) for (const d of debits.filter((d) => d.open && d.cents > 0 && okEnt(w, d) && inWin(w, d))) {
    const diff = Math.abs(d.cents - w.cents);
    if (diff <= tol(d.cents)) pairs.push({ w, d, diff });
  }
  for (const p of pairs.sort((a, b) => a.diff - b.diff)) { if (!p.w.open || !p.d.open) continue; take(p.w, p.d, p.d.cents, 'near'); p.d.open = false; }
  // 4. tolerant bundles: a debit ≈ sum of ≤5 open wires within tol; the
  //    drift is booked on the largest wire in the bundle (closest bundle first)
  for (const d of debits.filter((d) => d.open && d.cents > 0).sort((a, b) => b.cents - a.cents)) {
    const cands = wires.filter((w) => w.open && okEnt(w, d) && inWin(w, d)).sort((a, b) => b.cents - a.cents).slice(0, 12);
    let best: { picked: W[]; diff: number } | null = null;
    const search = (i: number, sum: number, picked: W[]): void => {
      if (picked.length >= 2) { const diff = Math.abs(sum - d.cents); if (diff <= tol(d.cents) && (!best || diff < best.diff)) best = { picked: [...picked], diff }; }
      if (picked.length >= 5) return;
      for (let j = i; j < cands.length; j++) { if (sum + cands[j].cents > d.cents + tol(d.cents)) continue; search(j + 1, sum + cands[j].cents, [...picked, cands[j]]); }
    };
    search(0, 0, []);
    if (best) {
      const b = best as { picked: W[]; diff: number };
      const sum = b.picked.reduce((s, w) => s + w.cents, 0);
      const drift = d.cents - sum;
      const largest = [...b.picked].sort((a, x) => x.cents - a.cents)[0];
      for (const w of b.picked) take(w, d, w.cents + (w === largest ? drift : 0), 'near');
      d.open = false;
    }
  }
  // 5. month close-out: leftover unmatched debits vs leftover unmatched wires
  //    in the same calendar month (wires older than 3 days) — the bank total
  //    is spread across those wires pro rata when the two sides are within
  //    ±25% of each other (Everee voids/reissues after several pulls). Months
  //    with debits but no wires (or vice versa) stay unmatched and are reported.
  const today = new Date().toISOString().slice(0, 10);
  const fresh = (w: W): boolean => day(today) - day(w.date) <= 3;
  const months = new Set([...wires.filter((w) => w.open).map((w) => w.date.slice(0, 7)), ...debits.filter((d) => d.open).map((d) => d.date.slice(0, 7))]);
  for (const ym of months) {
    const ws = wires.filter((w) => w.open && !fresh(w) && w.date.slice(0, 7) === ym);
    const ds = debits.filter((d) => d.open && d.date.slice(0, 7) === ym);
    const wSum = ws.reduce((s, w) => s + w.cents, 0);
    const dSum = ds.reduce((s, d) => s + d.cents, 0);
    if (!ws.length || !ds.length || wSum <= 0) continue;
    const ratio = dSum / wSum;
    if (ratio < 0.75 || ratio > 1.25) continue;
    let assigned = 0;
    ws.sort((a, b) => b.cents - a.cents);
    ws.forEach((w, i) => {
      const share = i === ws.length - 1 ? dSum - assigned : Math.round(w.cents * ratio);
      assigned += share;
      w.m.bankCents = share; w.m.bankDates = ds.map((d) => d.date); w.m.debitIds = ds.map((d) => d.id); w.m.how = 'prorata'; w.open = false;
    });
    for (const d of ds) d.open = false;
  }
  return { matches: new Map(wires.map((w) => [w.id, w.m])), unmatchedDebits: debits.filter((d) => d.open).map(({ open: _o, ...d }) => d) };
}
