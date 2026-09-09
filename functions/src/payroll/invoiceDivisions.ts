/**
 * Invoice Division (QBO Department) true-up (Greg 2026-09-08, after
 * Tabitha's P&L by Division review).
 *
 * The Division on a revenue transaction is decided by the CLIENT, with the
 * same family rule that drives 4100/4200: Sodexo + the Indeed Flex family
 * are `Recurring`; every other client is `Event-based`
 * (RECURRING_DIVISION_RE in payrollCostReport.ts — single source). Nothing
 * revenue ever sits in `Corp / Unalloc.` or untagged.
 *
 * Before this ran, June 2026 carried $294,580 of Venue Smart / RS3 / Black
 * Caviar invoice revenue under the Recurring column and $5,943 of Sodexo
 * under Event-based, because the header Location on hand-keyed invoices
 * followed Tabitha's 9/4 matrix (or nothing at all — Jan–Apr and Aug–Sep
 * were largely untagged). The revenue reclass JEs mirror the invoice's
 * Division, so fixing the invoice header fixes both 4200 and 4100 columns
 * once pushRevenueAccountReclass re-trues its legs.
 *
 * Idempotent: an invoice whose header already matches is untouched. Full-
 * entity update (Id + SyncToken + all lines), the same pattern as the
 * class reclasses — header Location edits never touch payment linkage.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { RECURRING_DIVISION_RE, fetchQboDivisions } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const trim = (v: unknown): string => String(v ?? '').trim();

export async function pushInvoiceDivisions(
  tenantId: string,
  dryRun: boolean,
  opts?: { since?: string },
): Promise<Record<string, unknown>> {
  const since = opts?.since ?? '2026-01-01';
  const divisions = await fetchQboDivisions(tenantId);
  const clRes = (await qboQuery(tenantId, 'SELECT Id, FullyQualifiedName FROM Class MAXRESULTS 1000')) as Record<string, any>;
  const clsById = new Map<string, string>(
    ((clRes.QueryResponse?.Class ?? clRes.Class ?? []) as Array<Record<string, any>>).map((c) => [String(c.Id), String(c.FullyQualifiedName)]),
  );

  const wantFor = (customerName: string): { Id: string; Name: string } =>
    RECURRING_DIVISION_RE.test(customerName.trim()) ? divisions.recurring : divisions.event;

  const results: Array<Record<string, unknown>> = [];
  const byMonth = new Map<string, { checked: number; changed: number; amount: number }>();
  const classMismatch: Array<Record<string, unknown>> = [];
  for (const ent of ['Invoice', 'CreditMemo']) {
    let start = 1;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const r = (await qboQuery(tenantId, `SELECT * FROM ${ent} WHERE TxnDate >= '${since}' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
      const rows: Array<Record<string, any>> = r.QueryResponse?.[ent] ?? r[ent] ?? [];
      for (const doc of rows) {
        const month = String(doc.TxnDate).slice(0, 7);
        const m = byMonth.get(month) ?? { checked: 0, changed: 0, amount: 0 };
        m.checked += 1;
        const customer = trim(doc.CustomerRef?.name);
        const want = wantFor(customer);
        const have = trim(doc.DepartmentRef?.value);
        // Sanity: a line classed to the OTHER family than the customer says
        // (e.g. a Venue Smart class on a Sodexo invoice) is reported, never
        // guessed — the customer rule still wins for the header.
        for (const l of (doc.Line ?? []) as Array<Record<string, any>>) {
          const cid = trim(l.SalesItemLineDetail?.ClassRef?.value);
          if (!cid) continue;
          const fqn = clsById.get(cid) ?? '';
          const clsRec = RECURRING_DIVISION_RE.test(fqn);
          if (fqn && clsRec !== (want.Id === divisions.recurring.Id)) {
            classMismatch.push({ type: ent, id: String(doc.Id), docNumber: trim(doc.DocNumber), date: doc.TxnDate, customer, class: fqn, amount: Number(l.Amount) || 0 });
          }
        }
        if (have === want.Id) {
          byMonth.set(month, m);
          continue;
        }
        m.changed += 1;
        m.amount += Number(doc.TotalAmt) || 0;
        byMonth.set(month, m);
        results.push({
          type: ent, id: String(doc.Id), docNumber: trim(doc.DocNumber), date: doc.TxnDate, customer,
          from: trim(doc.DepartmentRef?.name) || '(none)', to: want.Name, amount: Number(doc.TotalAmt) || 0,
          status: dryRun ? 'would_update' : 'updated',
        });
        if (dryRun) continue;
        // eslint-disable-next-line no-await-in-loop
        await qboEntityUpdate(tenantId, ent, { ...doc, DepartmentRef: { value: want.Id, name: want.Name }, sparse: false });
      }
      if (rows.length < 1000) break;
      start += 1000;
    }
  }
  return {
    ok: true, dryRun, since,
    months: [...byMonth.entries()].sort().map(([month, m]) => ({ month, ...m, amount: Math.round(m.amount * 100) / 100 })),
    changed: results.length,
    changes: results.slice(0, 400),
    classMismatch: classMismatch.slice(0, 100),
  };
}
