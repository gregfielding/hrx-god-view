/**
 * Revenue-account rule (Greg 2026-09-01): 4200 Staffing Revenue —
 * Recurring is ONLY Sodexo and the Indeed Flex family; every other class
 * is 4100 Staffing Revenue — Events & Venue. Nearly every QBO item maps
 * income to 4200, so events-family invoice lines mispost there (~$2.2M
 * YTD). Items are shared by the Sodexo/Flex mirrors, so instead of
 * repointing items we post one monthly reclass JE per month:
 *
 *   debit  4200 (classed, per class)   — removes the misposted revenue
 *   credit 4100 (classed, same class)  — lands it where the rule says
 *
 * P&L by class reads correctly for history and future alike; the entry
 * is idempotent per month ([revrc:YYYY-MM] tag) and only posts months
 * that ended ≥3 days ago. Unclassed lines are skipped (they are already
 * flagged by the classification audit — moving them blind would guess).
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';

if (!admin.apps.length) {
  admin.initializeApp();
}
const trim = (v: unknown): string => String(v ?? '').trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function pushRevenueAccountReclass(
  tenantId: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name FROM Account WHERE AccountType = 'Income' MAXRESULTS 1000")) as Record<string, any>;
  const accts: Array<Record<string, any>> = acctRes.QueryResponse?.Account ?? acctRes.Account ?? [];
  const a4200 = accts.find((a) => /recurring/i.test(String(a.Name)));
  const a4100 = accts.find((a) => /events\s*&\s*venue/i.test(String(a.Name)));
  if (!a4200 || !a4100) throw new Error('4100/4200 income accounts not found');

  const itRes = (await qboQuery(tenantId, 'SELECT Id, Name, IncomeAccountRef FROM Item MAXRESULTS 1000')) as Record<string, any>;
  const items: Array<Record<string, any>> = itRes.QueryResponse?.Item ?? itRes.Item ?? [];
  const itemPostsTo4200 = new Set(
    items.filter((x) => String(x.IncomeAccountRef?.value ?? '') === String(a4200.Id)).map((x) => String(x.Id)),
  );

  const clRes = (await qboQuery(tenantId, 'SELECT Id, FullyQualifiedName FROM Class MAXRESULTS 1000')) as Record<string, any>;
  const classes: Array<Record<string, any>> = clRes.QueryResponse?.Class ?? clRes.Class ?? [];
  const clsById = new Map(classes.map((c) => [String(c.Id), String(c.FullyQualifiedName)]));
  const isRecurringFamily = (fqn: string): boolean => /^sodexo$|^indeed flex/i.test(fqn);

  // events-family dollars posted via 4200-mapped items, bucketed by month + class
  const byMonth = new Map<string, Map<string, number>>();
  let start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Invoice WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Invoice ?? r.Invoice ?? [];
    for (const inv of rows) {
      const month = String(inv.TxnDate).slice(0, 7);
      for (const l of (inv.Line ?? []) as Array<Record<string, any>>) {
        const d = l.SalesItemLineDetail;
        if (!d) continue;
        const clsId = String(d.ClassRef?.value ?? '');
        if (!clsId) continue; // unclassed: leave for the audit queue
        const fqn = clsById.get(clsId) ?? '';
        if (!fqn || isRecurringFamily(fqn)) continue;
        if (!itemPostsTo4200.has(String(d.ItemRef?.value ?? ''))) continue;
        const amt = Number(l.Amount) || 0;
        if (Math.abs(amt) < 0.005) continue;
        if (!byMonth.has(month)) byMonth.set(month, new Map());
        const m = byMonth.get(month)!;
        m.set(clsId, (m.get(clsId) ?? 0) + amt);
      }
    }
    if (rows.length < 1000) break;
    start += 1000;
  }

  // existing reclass tags -> their JE docs (so amounts can be trued up)
  const existing = new Map<string, Record<string, any>>();
  start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of rows) {
      for (const m of trim(je.PrivateNote).matchAll(/\[revrc:([^\]]+)\]/g)) existing.set(trim(m[1]), je);
    }
    if (rows.length < 1000) break;
    start += 1000;
  }

  // Self-truing (Greg 2026-09-03: mid-month P&L must always show the
  // 4100/4200 split — waiting for month+3d left August unsplit): every
  // month with data gets a JE immediately, and existing JEs are
  // REWRITTEN whenever the recomputed amount drifts > $1 (late
  // invoices, edits). Idempotent per month via the [revrc:] tag.
  const results: Array<Record<string, unknown>> = [];
  for (const [month, m] of [...byMonth.entries()].sort()) {
    const total = round2([...m.values()].reduce((s, v) => s + v, 0));
    const prior = existing.get(month);
    if (prior) {
      let net = 0;
      for (const l of (prior.Line ?? []) as Array<Record<string, any>>) {
        const d = l.JournalEntryLineDetail;
        if (!d || String(d.AccountRef?.value) !== String(a4200.Id)) continue;
        net += (d.PostingType === 'Debit' ? 1 : -1) * (Number(l.Amount) || 0);
      }
      if (Math.abs(round2(net) - total) <= 1) {
        results.push({ month, amount: total, status: 'already_reclassed' });
        continue;
      }
    }
    if (Math.abs(total) < 0.01) continue;
    const splits = [...m.entries()]
      .map(([clsId, amt]) => ({ clsId, fqn: clsById.get(clsId) ?? clsId, amount: round2(amt) }))
      .filter((s) => Math.abs(s.amount) >= 0.01)
      .sort((a, b) => b.amount - a.amount);
    const action = existing.get(month) ? 'true_up' : 'create';
    results.push({ month, amount: total, status: dryRun ? `would_${action}` : `${action}d`, classes: splits.length, splits: splits.slice(0, 50) });
    if (dryRun) continue;
    const lines: Array<Record<string, unknown>> = [];
    for (const s of splits) {
      // negative buckets (refund-heavy classes) flip sides to stay balanced
      const debitSide = s.amount >= 0;
      lines.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: Math.abs(s.amount),
        Description: `Revenue reclass 4200→4100 — ${s.fqn} (${month})`,
        JournalEntryLineDetail: {
          PostingType: debitSide ? 'Debit' : 'Credit',
          AccountRef: { value: String(a4200.Id) },
          ClassRef: { value: s.clsId, name: s.fqn },
        },
      });
      lines.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: Math.abs(s.amount),
        Description: `Revenue reclass 4200→4100 — ${s.fqn} (${month})`,
        JournalEntryLineDetail: {
          PostingType: debitSide ? 'Credit' : 'Debit',
          AccountRef: { value: String(a4100.Id) },
          ClassRef: { value: s.clsId, name: s.fqn },
        },
      });
    }
    const prior2 = existing.get(month);
    if (prior2) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior2, Line: lines, sparse: false });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await qboEntityCreate(tenantId, 'JournalEntry', {
      DocNumber: `Rev Reclass ${month.slice(2).replace('-', '')}`,
      TxnDate: `${month}-28` > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : `${month}-28`,
      PrivateNote:
        `Events-family revenue posted to 4200 via item mapping, moved to 4100 per rule ` +
        `(4200 = Sodexo + Indeed Flex family only — Greg 2026-09-01). [revrc:${month}]`,
      Line: lines,
    });
  }
  return { ok: true, dryRun, months: results };
}
