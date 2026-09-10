/**
 * Expense Division from the CLASS (Greg 2026-09-08): a DIRECT client cost —
 * travel, client meals, client-facing COGS — usually class-tagged in
 * Expensify, belongs to that client's Division: Sodexo + the Indeed Flex
 * family (Cort, Domino's…) → Recurring, every other client → Event-based.
 * G&A and every other overhead account is spread by REVENUE RATIO whatever
 * class it carries (overheadAllocations runs after this); a G&A purchase
 * found parked in a client Division is put back in Corp for that pass.
 *
 * QBO's Division (Department) is a transaction-header field, so a purchase
 * whose lines mix families takes the family of the larger classed amount
 * and is reported. `National` (overhead class) and lines with no class
 * leave the header alone. Idempotent; full-entity update.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { RECURRING_DIVISION_RE, fetchQboDivisions } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const trim = (v: unknown): string => String(v ?? '').trim();
const OVERHEAD_CLASS_RE = /^(national|corp|overhead)$/i;

export async function pushExpenseDivisions(
  tenantId: string,
  dryRun: boolean,
  opts?: { since?: string },
): Promise<Record<string, unknown>> {
  const since = opts?.since ?? '2026-01-01';
  const divisions = await fetchQboDivisions(tenantId);
  const clRes = (await qboQuery(tenantId, 'SELECT Id, FullyQualifiedName FROM Class MAXRESULTS 1000')) as Record<string, any>;
  const clsById = new Map<string, string>(((clRes.QueryResponse?.Class ?? clRes.Class ?? []) as Array<Record<string, any>>).map((c) => [String(c.Id), String(c.FullyQualifiedName)]));
  const acctRes = (await qboQuery(tenantId, 'SELECT Id, Name, AcctNum, FullyQualifiedName, AccountType FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const accts = (acctRes.QueryResponse?.Account ?? acctRes.Account ?? []) as Array<Record<string, any>>;
  const plAcct = new Set<string>(accts.filter((a) => /Expense|Cost of Goods Sold/.test(String(a.AccountType))).map((a) => String(a.Id)));
  // CLASS-DRIVEN accounts (Greg 2026-09-08): direct client spend — 5500
  // Travel for Events family (2026-09-10; travelRouting.ts moves client-
  // classed travel there first — 8800 Travel for Sales is overhead and goes
  // by REVENUE RATIO like G&A), client meals (8400), client-facing COGS (5210 ConnectTeam,
  // 5300 recruiting, 5400 event supplies). Everything else — G&A, occupancy,
  // software, insurance, professional services, internal payroll — is
  // allocated by REVENUE RATIO even when a line carries a client class, so
  // those purchases are kept in Corp / Unalloc. for the ratio pass.
  const classDriven = new Set<string>(accts.filter((a) => {
    const n = String(a.AcctNum ?? ''); const f = String(a.FullyQualifiedName ?? a.Name ?? '');
    return /^55\d\d$/.test(n) || /^8400$/.test(n) || /^(5210|5300|5400)$/.test(n) || /^Travel for Events(:|$)/i.test(f) || /meals & entertainment/i.test(f);
  }).map((a) => String(a.Id)));
  // Travel for Sales (8800 family) — Division by class like event travel
  // (Greg 2026-09-10, final): Sodexo / Indeed Flex → Recurring, else
  // Event-based. Unclassed lines count as Event-based only from the split
  // date; Jan–Apr keep the legacy behaviour (unclassed leaves the header).
  const TRAVEL_SPLIT_FROM = '2026-05-01';
  const salesTravel = new Set<string>(accts.filter((a) => /^88\d\d$/.test(String(a.AcctNum ?? '')) || /^Travel for Sales(:|$)/i.test(String(a.FullyQualifiedName ?? ''))).map((a) => String(a.Id)));
  // Travel for Events is ALWAYS event delivery (Greg 2026-09-10): a 55xx line
  // with no client class (or National / retired Austin) counts as Event-based
  // — never Corp, never the revenue ratio.
  const eventsTravel = new Set<string>(accts.filter((a) => /^55\d\d$/.test(String(a.AcctNum ?? '')) || /^Travel for Events(:|$)/i.test(String(a.FullyQualifiedName ?? ''))).map((a) => String(a.Id)));
  const ownWriter = new Set<string>(accts.filter((a) => /^(5010|5100|5310)$/.test(String(a.AcctNum ?? ''))).map((a) => String(a.Id)));
  const itemRes = (await qboQuery(tenantId, 'SELECT Id, ExpenseAccountRef FROM Item MAXRESULTS 1000')) as Record<string, any>;
  const itemExp = new Map<string, string>(((itemRes.QueryResponse?.Item ?? itemRes.Item ?? []) as Array<Record<string, any>>).map((i) => [String(i.Id), String(i.ExpenseAccountRef?.value ?? '')]));

  const changes: Array<Record<string, unknown>> = [];
  const mixed: Array<Record<string, unknown>> = [];
  const byMonth = new Map<string, { checked: number; changed: number; amount: number }>();
  for (const ent of ['Purchase', 'Bill']) {
    let start = 1;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const r = (await qboQuery(tenantId, `SELECT * FROM ${ent} WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
      const rows: Array<Record<string, any>> = r.QueryResponse?.[ent] ?? r[ent] ?? [];
      for (const t of rows) {
        const fam = { event: 0, recurring: 0 };
        let ratioAmt = 0; let ownAmt = 0;
        for (const l of (t.Line ?? []) as Array<Record<string, any>>) {
          const ab = l.AccountBasedExpenseLineDetail; const ib = l.ItemBasedExpenseLineDetail;
          const acct = ab ? trim(ab.AccountRef?.value) : ib ? itemExp.get(trim(ib.ItemRef?.value)) ?? '' : '';
          if (!plAcct.has(acct)) continue;
          const amt = Math.abs(Number(l.Amount) || 0);
          if (ownWriter.has(acct)) { ownAmt += amt; continue; }
          // All travel (5500 Events + 8800 Sales) is class-driven; from the
          // split date an unclassed line counts as Event-based (Greg 2026-09-10:
          // Sodexo / Indeed Flex family → Recurring, everything else Event-based).
          if (!classDriven.has(acct) && !salesTravel.has(acct)) { ratioAmt += amt; continue; }
          const fqn = clsById.get(trim((ab ?? ib)?.ClassRef?.value)) ?? '';
          if (!fqn || OVERHEAD_CLASS_RE.test(fqn)) {
            if (eventsTravel.has(acct) || (salesTravel.has(acct) && String(t.TxnDate) >= TRAVEL_SPLIT_FROM)) fam.event += amt; // unclassed travel → Event-based
            continue; // other unclassed class-driven lines → ratio fallback
          }
          if (RECURRING_DIVISION_RE.test(fqn)) fam.recurring += amt; else fam.event += amt;
        }
        const classed = fam.event + fam.recurring;
        let want: { Id: string; Name: string } | null = null;
        if (classed > 0 && classed >= ratioAmt) want = fam.recurring > fam.event ? divisions.recurring : divisions.event;
        else if (ratioAmt > 0 && ownAmt === 0 && divisions.corp && [divisions.event.Id, divisions.recurring.Id].includes(trim(t.DepartmentRef?.value))) want = divisions.corp; // ratio account wrongly parked in a client Division → back to Corp
        if (!want) continue;
        const month = String(t.TxnDate).slice(0, 7);
        const m = byMonth.get(month) ?? { checked: 0, changed: 0, amount: 0 };
        m.checked += 1;
        if (fam.event > 0 && fam.recurring > 0) mixed.push({ type: ent, id: String(t.Id), date: t.TxnDate, event: fam.event, recurring: fam.recurring, chosen: want.Name });
        if (trim(t.DepartmentRef?.value) === want.Id) { byMonth.set(month, m); continue; }
        m.changed += 1; m.amount += Number(t.TotalAmt) || 0; byMonth.set(month, m);
        changes.push({ type: ent, id: String(t.Id), date: t.TxnDate, payee: trim(t.EntityRef?.name ?? t.VendorRef?.name), amount: Number(t.TotalAmt) || 0, from: trim(t.DepartmentRef?.name) || '(none)', to: want.Name, status: dryRun ? 'would_update' : 'updated' });
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        await qboEntityUpdate(tenantId, ent, { ...t, DepartmentRef: { value: want.Id, name: want.Name }, sparse: false });
      }
      if (rows.length < 1000) break;
      start += 1000;
    }
  }
  // Everee refund DEPOSITS on 5010 (voided/returned payments): Division by
  // the paying entity — C1 Select → Recurring, C1 Events / generic → Event-
  // based — so the refund nets against the labor it reverses, not in Corp.
  const a5010 = accts.find((a) => String(a.AcctNum) === '5010');
  const a1250 = accts.find((a) => String(a.AcctNum) === '1260' || /everee funding balance/i.test(String(a.Name ?? '')));
  const refunds: Array<Record<string, unknown>> = [];
  if (a5010) {
    let start = 1;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const r = (await qboQuery(tenantId, `SELECT * FROM Deposit WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
      const rows: Array<Record<string, any>> = r.QueryResponse?.Deposit ?? r.Deposit ?? [];
      for (const dep of rows) {
        const evLines = ((dep.Line ?? []) as Array<Record<string, any>>).filter((l) => String(l.DepositLineDetail?.AccountRef?.value) === String(a5010.Id) || (a1250 && String(l.DepositLineDetail?.AccountRef?.value) === String(a1250.Id)));
        if (!evLines.length) continue;
        const memo = `${trim(dep.PrivateNote)} ${evLines.map((l) => `${trim(l.Description)} ${trim(l.DepositLineDetail?.Entity?.name)}`).join(' ')}`;
        if (!/everee|epay|c1 (events|select|payment)/i.test(memo)) continue;
        // Two kinds of Everee money coming back (Greg 2026-09-09):
        //  • "Everee Inc - ePay0001" = an over-wire refunded → the held balance
        //    returning → 1260 Everee Funding Balance, no Division.
        //  • a worker-named "C1 Payment" or "C1 Events/Select LLC - ePay0001"
        //    = a worker payment RETURNED (bad bank details; Everee still counts
        //    the funding) → labor reversal on 5010 in the entity's Division.
        const isBalanceRefund = /^\s*everee inc\b.*epay/i.test(memo);
        const lines = (dep.Line ?? []) as Array<Record<string, any>>;
        const on5010 = (l: Record<string, any>): boolean => String(l.DepositLineDetail?.AccountRef?.value) === String(a5010.Id);
        const on1260 = (l: Record<string, any>): boolean => Boolean(a1250) && String(l.DepositLineDetail?.AccountRef?.value) === String(a1250!.Id);
        if (isBalanceRefund) {
          if (!a1250 || !lines.some(on5010)) continue;
          refunds.push({ id: String(dep.Id), date: dep.TxnDate, amount: Number(dep.TotalAmt) || 0, from: '5010', to: `${a1250.Name}`, memo: memo.trim().slice(0, 50), status: dryRun ? 'would_update' : 'updated' });
          if (dryRun) continue;
          const newLines = lines.map((l) => on5010(l) ? { ...l, DepositLineDetail: { ...l.DepositLineDetail, AccountRef: { value: String(a1250.Id), name: String(a1250.Name) } } } : l);
          // eslint-disable-next-line no-await-in-loop
          await qboEntityUpdate(tenantId, 'Deposit', { ...dep, Line: newLines, sparse: false });
          continue;
        }
        const want = /c1 select/i.test(memo) ? divisions.recurring : divisions.event;
        const needsAcct = lines.some(on1260);
        if (!needsAcct && trim(dep.DepartmentRef?.value) === want.Id) continue;
        refunds.push({ id: String(dep.Id), date: dep.TxnDate, amount: Number(dep.TotalAmt) || 0, from: needsAcct ? '1260' : (trim(dep.DepartmentRef?.name) || '(none)'), to: `5010 ${want.Name}`, memo: memo.trim().slice(0, 50), status: dryRun ? 'would_update' : 'updated' });
        if (dryRun) continue;
        const newLines = lines.map((l) => on1260(l) ? { ...l, DepositLineDetail: { ...l.DepositLineDetail, AccountRef: { value: String(a5010.Id), name: String(a5010.Name) } } } : l);
        // eslint-disable-next-line no-await-in-loop
        await qboEntityUpdate(tenantId, 'Deposit', { ...dep, Line: newLines, DepartmentRef: { value: want.Id, name: want.Name }, sparse: false });
      }
      if (rows.length < 1000) break;
      start += 1000;
    }
  }
  return { ok: true, dryRun, since, refunds, months: [...byMonth.entries()].sort().map(([month, m]) => ({ month, ...m, amount: Math.round(m.amount * 100) / 100 })), changed: changes.length + refunds.length, changes: changes.slice(0, 500), mixed: mixed.slice(0, 100) };
}
