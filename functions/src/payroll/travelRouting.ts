/**
 * Travel routing (Greg 2026-09-10). Travel is split in two families:
 *   5500 Travel for Events (COGS)  — travel to DELIVER a client/event: the
 *        line carries a client class (Venue Smart:*, Proof of Pudding,
 *        Legends:*, Sodexo, Indeed Flex:* …). Division then follows the
 *        class (expenseDivisions: Sodexo / Indeed Flex → Recurring, else
 *        Event-based).
 *   8800 Travel for Sales (Expense) — everything else: no class, `National`
 *        / Corp / overhead class, or the retired `Austin` geography class.
 * Line-level account move on Purchases and Bills, sub-account to matching
 * sub-account (Airfare 8810↔5510, Hotels 8820↔5520, Travel meals 8830↔5530,
 * Ground Transport 8840↔5540, parent 8800↔5500; Travel Insurance → 5500).
 * Two-way and idempotent: re-classing a line later moves it on the next run.
 * CARDHOLDER RULE (Greg 2026-09-10, supersedes class-only): travel charged
 * by Danny, Rosa or Mark → always Travel for Events; by Greg (incl. the
 * Corporate Card) or Donna → Travel for Sales UNLESS the line is classed to
 * Venue Smart (e.g. Greg's FIFA KC trips for VenueSmart) → Events. EVERYONE
 * else → Events too (Greg 2026-09-10: Maria, unmapped cards, Expensify
 * expense reports with no card, Bills — "anything misc, put as Events"). Cardholder = Relay descriptor "**NNNN Paid
 * by <Name>" (parsePurchase) → expensify_card_map/{last4}.email; unmapped
 * last4 falls back to a unique cardholder-name match.
 */
import * as admin from 'firebase-admin';

import { parsePurchase } from '../integrations/expensify/expensifyPush';
import { qboQuery, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();
// Cardholder email local-parts (expensify_card_map/{last4}.email).
const EVENT_TRAVELERS = new Set(['dr', 'r.govea', 'mk']); // Danny, Rosa, Mark
const SALES_TRAVELERS = new Set(['g.fielding', 'dm']); // Greg (+ Corporate Card), Donna
const TRAVELER_LABEL: Record<string, string> = { dr: 'Danny', 'r.govea': 'Rosa', mk: 'Mark', 'g.fielding': 'Greg', dm: 'Donna' };
const VENUESMART_CLASS_RE = /^venue smart(:|$)/i;
const round2 = (n: number): number => Math.round(n * 100) / 100;
export const SALES_TRAVEL_CLASS_RE = /^(national|corp|overhead)$|^austin\b/i;

export async function pushTravelRouting(
  tenantId: string,
  dryRun: boolean,
  opts?: { since?: string },
): Promise<Record<string, unknown>> {
  const since = opts?.since ?? '2026-05-01';
  const ar = (await qboQuery(tenantId, 'SELECT * FROM Account WHERE Active IN (true, false) MAXRESULTS 1000')) as Record<string, any>;
  const accts = (ar.QueryResponse?.Account ?? ar.Account ?? []) as Array<Record<string, any>>;
  const byNum = (n: string): Record<string, any> | undefined => accts.find((a) => trim(a.AcctNum) === n);
  const toEvents = new Map<string, Record<string, any>>();
  const toSales = new Map<string, Record<string, any>>();
  for (const [s, e] of [['8800', '5500'], ['8810', '5510'], ['8820', '5520'], ['8830', '5530'], ['8840', '5540']]) {
    const sa = byNum(s); const ea = byNum(e);
    if (!sa || !ea) throw new Error(`travel account pair ${s}/${e} missing — run the skeleton first`);
    toEvents.set(trim(sa.Id), ea); toSales.set(trim(ea.Id), sa);
  }
  const salesParent = byNum('8800')!;
  for (const a of accts) {
    if (trim(a.ParentRef?.value) === trim(salesParent.Id) && !toEvents.has(trim(a.Id))) toEvents.set(trim(a.Id), byNum('5500')!); // e.g. Travel Insurance
  }
  // Account merges (Greg 2026-09-10): event-staff recruitment ads are COGS —
  // the 8010 sub "Recruitment (Advertising to recruit Event Staff)" (Indeed /
  // Craigslist) duplicates 5300 Field Staff Recruitment / Advertising, so its
  // lines move there regardless of class.
  const remap = new Map<string, Record<string, any>>();
  const fieldRecruit = byNum('5300');
  const recruitSub = accts.find((a) => /^recruitment \(advertising to recruit event staff\)$/i.test(trim(a.Name)));
  if (fieldRecruit && recruitSub) remap.set(trim(recruitSub.Id), fieldRecruit);
  const cr = (await qboQuery(tenantId, 'SELECT Id, FullyQualifiedName FROM Class WHERE Active IN (true, false) MAXRESULTS 1000')) as Record<string, any>;
  const clsById = new Map<string, string>(((cr.QueryResponse?.Class ?? cr.Class ?? []) as Array<Record<string, any>>).map((c) => [trim(c.Id), trim(c.FullyQualifiedName)]));
  const cardSnap = await db.collection(`tenants/${tenantId}/expensify_card_map`).get();
  const cardOwner = new Map<string, string>();
  const nameOwners = new Map<string, Set<string>>(); // first name → locals
  cardSnap.forEach((d) => {
    const c = d.data();
    const local = trim(c.email).split('@')[0].toLowerCase();
    if (!local) return;
    cardOwner.set(trim(c.last4), local);
    const first = trim(c.cardholderName).toLowerCase().split(/\s+/)[0];
    if (first) nameOwners.set(first, new Set([...(nameOwners.get(first) ?? []), local]));
  });
  const travelerOf = (p: Record<string, any>): string | null => {
    const parsed = parsePurchase(p as never) as unknown as Record<string, any>;
    const byCard = parsed.last4 ? cardOwner.get(String(parsed.last4)) : undefined;
    if (byCard) return byCard;
    const first = trim(parsed.cardholderName).toLowerCase().split(/\s+/)[0];
    const owners = first ? nameOwners.get(first) : undefined;
    return owners && owners.size === 1 ? [...owners][0] : null;
  };
  const wantFamily = (traveler: string | null, fqn: string): 'events' | 'sales' => {
    if (traveler && EVENT_TRAVELERS.has(traveler)) return 'events';
    if (traveler && SALES_TRAVELERS.has(traveler)) return VENUESMART_CLASS_RE.test(fqn) ? 'events' : 'sales';
    return 'events'; // misc travelers, unmapped cards, no-card expense reports, Bills
  };
  const byPerson = new Map<string, number>();

  const moves: Array<Record<string, unknown>> = [];
  const byMonth = new Map<string, { toEvents: number; toSales: number; merged: number; n: number }>();
  const byClass = new Map<string, number>();
  let updatedTxns = 0;
  for (const ent of ['Purchase', 'Bill']) {
    for (let pos = 1; ; pos += 1000) {
      // eslint-disable-next-line no-await-in-loop
      const r = (await qboQuery(tenantId, `SELECT * FROM ${ent} WHERE TxnDate >= '${since}' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Record<string, any>;
      const rows: Array<Record<string, any>> = r.QueryResponse?.[ent] ?? r[ent] ?? [];
      for (const t of rows) {
        const traveler = ent === 'Purchase' ? travelerOf(t) : null;
        const who = traveler ? TRAVELER_LABEL[traveler] ?? traveler : 'class rule';
        let changed = false;
        const lines = ((t.Line ?? []) as Array<Record<string, any>>).map((l) => {
          const d = l.AccountBasedExpenseLineDetail;
          if (!d) return l;
          const acct = trim(d.AccountRef?.value);
          const fqn = clsById.get(trim(d.ClassRef?.value)) ?? '';
          let target: Record<string, any> | undefined;
          let dir: 'toEvents' | 'toSales' | 'merged' = 'toEvents';
          if (remap.has(acct)) { target = remap.get(acct); dir = 'merged'; }
          else if (toEvents.has(acct) || toSales.has(acct)) {
            const want = wantFamily(traveler, fqn);
            if (want === 'events' && toEvents.has(acct)) { target = toEvents.get(acct); dir = 'toEvents'; }
            else if (want === 'sales' && toSales.has(acct)) { target = toSales.get(acct); dir = 'toSales'; }
          }
          if (!target) return l;
          changed = true;
          const amt = (ent === 'Purchase' && t.Credit === true ? -1 : 1) * (Number(l.Amount) || 0);
          const month = trim(t.TxnDate).slice(0, 7);
          const m = byMonth.get(month) ?? { toEvents: 0, toSales: 0, merged: 0, n: 0 };
          m[dir] = round2(m[dir] + amt); m.n += 1; byMonth.set(month, m);
          byPerson.set(`${dir} ${who}`, round2((byPerson.get(`${dir} ${who}`) ?? 0) + amt));
          byClass.set(`${dir} ${fqn || '(no class)'}`, round2((byClass.get(`${dir} ${fqn || '(no class)'}`) ?? 0) + amt));
          moves.push({ type: ent, id: trim(t.Id), date: trim(t.TxnDate), amount: round2(amt), from: trim(d.AccountRef?.name), to: trim(target.FullyQualifiedName), cls: fqn || '(no class)', traveler: who, memo: trim(l.Description ?? t.PrivateNote).replace(/\s+/g, ' ').slice(0, 60) });
          return { ...l, AccountBasedExpenseLineDetail: { ...d, AccountRef: { value: trim(target.Id), name: trim(target.FullyQualifiedName) } } };
        });
        if (!changed) continue;
        updatedTxns += 1;
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        await qboEntityUpdate(tenantId, ent, { ...t, Line: lines, sparse: false });
      }
      if (rows.length < 1000) break;
    }
  }
  return {
    ok: true, dryRun, since, lineMoves: moves.length, transactions: updatedTxns,
    byMonth: [...byMonth.entries()].sort().map(([month, v]) => ({ month, ...v })),
    byPerson: [...byPerson.entries()].sort().map(([k, v]) => ({ key: k, amount: v })),
    byClass: [...byClass.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => ({ key: k, amount: v })),
    sample: moves.slice(0, 25),
  };
}
