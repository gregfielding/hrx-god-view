/**
 * Expense Division from the CLASS (Greg 2026-09-08): a purchase/bill line
 * that carries a client class — travel, meals, supplies… usually tagged in
 * Expensify — belongs to that client's Division: Sodexo + the Indeed Flex
 * family (Cort, Domino's…) → Recurring, every other client → Event-based.
 * Only UNCLASSED overhead is spread by revenue ratio (overheadAllocations,
 * which runs after this and therefore no longer sees these lines).
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
  const acctRes = (await qboQuery(tenantId, 'SELECT Id, AccountType FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const plAcct = new Set<string>(((acctRes.QueryResponse?.Account ?? acctRes.Account ?? []) as Array<Record<string, any>>).filter((a) => /Expense|Cost of Goods Sold/.test(String(a.AccountType))).map((a) => String(a.Id)));
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
        for (const l of (t.Line ?? []) as Array<Record<string, any>>) {
          const ab = l.AccountBasedExpenseLineDetail; const ib = l.ItemBasedExpenseLineDetail;
          const acct = ab ? trim(ab.AccountRef?.value) : ib ? itemExp.get(trim(ib.ItemRef?.value)) ?? '' : '';
          if (!plAcct.has(acct)) continue;
          const fqn = clsById.get(trim((ab ?? ib)?.ClassRef?.value)) ?? '';
          if (!fqn || OVERHEAD_CLASS_RE.test(fqn)) continue;
          const amt = Math.abs(Number(l.Amount) || 0);
          if (RECURRING_DIVISION_RE.test(fqn)) fam.recurring += amt; else fam.event += amt;
        }
        if (fam.event === 0 && fam.recurring === 0) continue;
        const month = String(t.TxnDate).slice(0, 7);
        const m = byMonth.get(month) ?? { checked: 0, changed: 0, amount: 0 };
        m.checked += 1;
        const want = fam.recurring > fam.event ? divisions.recurring : divisions.event;
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
  return { ok: true, dryRun, since, months: [...byMonth.entries()].sort().map(([month, m]) => ({ month, ...m, amount: Math.round(m.amount * 100) / 100 })), changed: changes.length, changes: changes.slice(0, 500), mixed: mixed.slice(0, 100) };
}
