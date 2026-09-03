/**
 * Allocation JE true-up (Greg 2026-09-01: "once we match everything, do
 * we push again?" — no: pushed wires are tag-idempotent and skip). This
 * is the missing link: it rewrites each posted allocation JE's DEBIT
 * lines to the CURRENT attribution (overrides, ledger, resolver), scaled
 * to the JE's own credit so totals never move. Runs weekly after the
 * health check and on demand from the callable — flag fixes made on the
 * verification page flow into QuickBooks without re-pushing anything.
 *
 * Safety: only JEs carrying [wire:...] tags are touched; a JE whose
 * credit no longer matches its wire total (Everee drift) is skipped and
 * reported; lines are compared before writing so unchanged JEs are
 * untouched.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { buildWireJournal } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const trim = (v: unknown): string => String(v ?? '').trim();
const ACCT_5010 = '73';

export async function trueUpAllocationJes(
  tenantId: string,
  dryRun: boolean,
  opts?: { fixCreditDocs?: string[] },
): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);
  const journal = (await buildWireJournal(tenantId, '2026-05-01', today, null)) as Record<string, any>;
  const wireByTag = new Map<string, Record<string, any>>();
  for (const w of (journal.wires ?? []) as Array<Record<string, any>>) {
    const ent = /events/i.test(String(w.entityName)) ? 'EVT' : /select/i.test(String(w.entityName)) ? 'SEL' : /workforce/i.test(String(w.entityName)) ? 'WF' : 'C1';
    const fid = trim(w.fundingId);
    wireByTag.set(`${fid === 'none' ? `none-${String(w.fundingDate).slice(0, 7)}` : fid}@${ent}`, w);
    // legacy un-qualified aggregate tags
    if (fid === 'none') wireByTag.set(`none@${ent}`, w);
  }
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classIdByFqn = new Map<string, string>(
    ((clsRes.QueryResponse?.Class ?? clsRes.Class ?? []) as Array<Record<string, any>>).map((c) => [String(c.FullyQualifiedName), String(c.Id)]),
  );
  let start = 1;
  const jes: Array<Record<string, any>> = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    jes.push(...rows);
    if (rows.length < 1000) break;
    start += 1000;
  }
  let patched = 0;
  let unchanged = 0;
  const skippedDrift: Array<Record<string, unknown>> = [];
  const patchedDocs: string[] = [];
  for (const je of jes) {
    const doc = trim(je.DocNumber);
    if (!/^EV (Pay )?Alloc/i.test(doc)) continue;
    const tags = [...trim(je.PrivateNote).matchAll(/\[wire:([^\]]+)\]/g)].map((m) => trim(m[1]));
    const wires = [...new Set(tags.map((t) => wireByTag.get(t)).filter(Boolean))] as Array<Record<string, any>>;
    if (!wires.length) continue;
    let credit = 0;
    for (const l of (je.Line ?? []) as Array<Record<string, any>>) {
      if (l.JournalEntryLineDetail?.PostingType === 'Credit') credit += Number(l.Amount) || 0;
    }
    const combined = new Map<string, { cls: string | null; amt: number }>();
    let wireTotal = 0;
    for (const w of wires) {
      wireTotal += Number(w.amount) || 0;
      for (const s of (w.splits ?? []) as Array<Record<string, any>>) {
        const ok = s.class !== 'Unattributed' && s.qboClassExists && classIdByFqn.has(String(s.qboClass));
        const key = ok ? String(s.qboClass) : '(unclassed)';
        const e = combined.get(key) ?? { cls: ok ? String(s.qboClass) : null, amt: 0 };
        e.amt += Number(s.amount) || 0;
        combined.set(key, e);
      }
    }
    if (wireTotal <= 0 || credit <= 0) continue;
    if (Math.abs(credit - wireTotal) > Math.max(1, credit * 0.02)) {
      if (!opts?.fixCreditDocs?.includes(doc)) {
        skippedDrift.push({ doc, credit, wireTotal });
        continue;
      }
      // Approved credit true-up (Greg 2026-09-03): rewrite the credit
      // side to the current wire total so the debit split can follow.
      const f = wireTotal / credit;
      const creditLines = ((je.Line ?? []) as Array<Record<string, any>>).filter(
        (l) => l.JournalEntryLineDetail?.PostingType === 'Credit',
      );
      for (const l of creditLines) l.Amount = Math.round((Number(l.Amount) || 0) * f * 100) / 100;
      let newCredit = creditLines.reduce((s2, l) => s2 + (Number(l.Amount) || 0), 0);
      const diffC = Math.round((wireTotal - newCredit) * 100);
      if (diffC !== 0 && creditLines.length) {
        const big = [...creditLines].sort((a, b) => (Number(b.Amount) || 0) - (Number(a.Amount) || 0))[0];
        big.Amount = Math.round(((Number(big.Amount) || 0) + diffC / 100) * 100) / 100;
      }
      credit = wireTotal;
    }
    const scale = credit / wireTotal;
    const floored = [...combined.values()].map((x) => ({ ...x, cents: Math.floor(x.amt * scale * 100), frac: x.amt * scale * 100 - Math.floor(x.amt * scale * 100) }));
    let rem = Math.round(credit * 100) - floored.reduce((s, x) => s + x.cents, 0);
    for (const x of [...floored].sort((a, b) => b.frac - a.frac)) {
      if (rem <= 0) break;
      x.cents += 1;
      rem -= 1;
    }
    const want = floored.filter((x) => x.cents > 0).map((x) => ({ cls: x.cls, amt: x.cents / 100 }));
    const have = ((je.Line ?? []) as Array<Record<string, any>>)
      .filter((l) => l.JournalEntryLineDetail?.PostingType === 'Debit')
      .map((l) => ({ cls: l.JournalEntryLineDetail.ClassRef?.name ?? null, amt: Number(l.Amount) || 0 }));
    const key = (arr: Array<{ cls: string | null; amt: number }>): string =>
      arr.map((x) => `${x.cls}|${x.amt.toFixed(2)}`).sort().join(';');
    if (key(want) === key(have)) {
      unchanged += 1;
      continue;
    }
    patched += 1;
    patchedDocs.push(doc);
    if (dryRun) continue;
    const newLines: Array<Record<string, unknown>> = want.map((x) => ({
      DetailType: 'JournalEntryLineDetail',
      Amount: x.amt,
      Description: x.cls ? `Payroll allocation — ${x.cls}` : 'Payroll allocation — unattributed remainder',
      JournalEntryLineDetail: x.cls
        ? { PostingType: 'Debit', AccountRef: { value: ACCT_5010 }, ClassRef: { value: classIdByFqn.get(x.cls), name: x.cls } }
        : { PostingType: 'Debit', AccountRef: { value: ACCT_5010 } },
    }));
    for (const l of (je.Line ?? []) as Array<Record<string, any>>) {
      if (l.JournalEntryLineDetail?.PostingType === 'Credit') newLines.push(l);
    }
    // eslint-disable-next-line no-await-in-loop
    await qboEntityUpdate(tenantId, 'JournalEntry', { ...je, Line: newLines, sparse: false });
  }
  return { ok: true, dryRun, patched, unchanged, skippedDrift, patchedDocs: patchedDocs.slice(0, 50) };
}
