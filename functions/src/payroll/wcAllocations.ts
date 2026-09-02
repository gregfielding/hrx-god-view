/**
 * Workers' Comp allocation (Greg 2026-09-03): all carrier payments land
 * on 7140 Workers' Comp — Internal Staff, but most premium is FIELD
 * labor. Monthly JE per month with field entries:
 *
 *   debit  5100 Workers' Comp — Field Staff, split per class
 *   credit 7140 Workers' Comp — Internal Staff
 *
 * Amount = matrix-computed premium (entry gross × workersCompRate) — the
 * residual on 7140 stays visible as internal WC + carrier deposit/
 * catch-up variance until the carrier audit trues it. Self-truing like
 * the revenue reclass: months (including the in-progress one) post
 * immediately and existing JEs are REWRITTEN when the recomputed total
 * drifts > $1 (late entries, rate backfills). Idempotent per month via
 * [wcalloc:YYYY-MM] in PrivateNote.
 *
 * Class per entry: JO → payroll_jo_date_splits window → account-kind
 * mapping/rules → JO name (fuzzy classFor). Known limit: date-splits are
 * JO-wide, so the GB→FIFA crew split follows the split rule, not the
 * per-worker ConnectTeam corrections (~$1.5K between FIFA classes).
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { ACCOUNT_CLASS_RULES } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => (Number(v) || 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// JO names whose fuzzy class match fails (same purpose as the wire
// builder's WIRE_LABEL_ALIASES, kept local).
const WC_LEAF_ALIASES: Array<{ re: RegExp; leaf: string }> = [
  { re: /fifa.*kansas city|kc.*fifa/i, leaf: 'FIFA KC' },
  { re: /women'?s? open/i, leaf: "26 USGA Women's Open" },
  { re: /fifa.*dallas/i, leaf: 'FIFA Dallas' },
  { re: /adidas.*ny|fifa.*ny/i, leaf: 'FIFA NY' },
];

export async function pushWcAllocations(
  tenantId: string,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const clRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classes: Array<Record<string, any>> = clRes.QueryResponse?.Class ?? clRes.Class ?? [];
  const squash = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const classFor = (leaf: string): Record<string, any> | undefined => {
    const k = squash(leaf);
    return (
      classes.find((c) => squash(String(c.Name)) === k || squash(String(c.FullyQualifiedName)) === k) ??
      classes.find((c) => {
        const ck = squash(String(c.Name));
        return ck.length >= 4 && k.length >= 4 && (ck.includes(k) || k.includes(ck));
      })
    );
  };
  const acctRes = (await qboQuery(tenantId, 'SELECT Id, Name, AccountType FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const accts: Array<Record<string, any>> = acctRes.QueryResponse?.Account ?? acctRes.Account ?? [];
  const fieldAcct = accts.find((a) => /workers'? comp.*field/i.test(String(a.Name)));
  const internalAcct = accts.find((a) => /workers'? comp.*internal/i.test(String(a.Name)));
  if (!fieldAcct || !internalAcct) throw new Error('WC field/internal accounts not found');

  // account-kind mappings + JO index + date splits (same shape as screening)
  const mapSnap = await db.collection(`tenants/${tenantId}/qbo_class_mappings`).get().catch(() => null);
  const acctMapCount = new Map<string, number>();
  const acctMap = new Map<string, string>();
  if (mapSnap) {
    mapSnap.forEach((d) => {
      const m = d.data();
      const aid = trim(m.accountId);
      if (trim(m.targetKind) !== 'account' || !aid) return;
      acctMapCount.set(aid, (acctMapCount.get(aid) ?? 0) + 1);
      acctMap.set(aid, trim(m.className) || trim(m.fqn));
    });
    for (const [aid, n] of acctMapCount) if (n > 1) acctMap.delete(aid);
  }
  const joSnap = await db.collection(`tenants/${tenantId}/job_orders`).get();
  const joById = new Map<string, { accountId: string; accountName: string; name: string }>();
  joSnap.forEach((d) => {
    const j = d.data();
    joById.set(d.id, {
      accountId: trim(j.accountId),
      accountName: trim(j.accountName),
      name: trim(j.jobOrderName) || trim(j.title),
    });
  });
  const splitsSnap = await db.collection(`tenants/${tenantId}/payroll_jo_date_splits`).get().catch(() => null);
  const splitsByJo = new Map<string, Array<{ fromDate: string; toDate: string; cls: string }>>();
  if (splitsSnap) {
    splitsSnap.forEach((d) => {
      const m = d.data() as Record<string, unknown>;
      const joId = trim(m.jobOrderId);
      if (!joId) return;
      if (!splitsByJo.has(joId)) splitsByJo.set(joId, []);
      splitsByJo.get(joId)!.push({ fromDate: trim(m.fromDate), toDate: trim(m.toDate), cls: trim(m.class) });
    });
  }
  const leafForEntry = (jobOrderId: string, workDate: string): string | null => {
    const split = (splitsByJo.get(jobOrderId) ?? []).find(
      (sp) => sp.fromDate && workDate >= sp.fromDate && (!sp.toDate || workDate <= sp.toDate),
    );
    if (split?.cls) return split.cls;
    const jo = joById.get(jobOrderId);
    if (!jo) return null;
    const mapped = jo.accountId ? acctMap.get(jo.accountId) : undefined;
    if (mapped) return mapped;
    const rule = jo.accountName ? ACCOUNT_CLASS_RULES.find((r) => r.re.test(jo.accountName)) : undefined;
    return rule ? rule.leaf : jo.name || null;
  };

  // premium per month per leaf from entries
  const PAID = new Set(['sent_to_everee', 'submitted', 'paid']);
  const es = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workDate', '>=', '2026-06-01')
    .get();
  const byMonth = new Map<string, Map<string, number>>();
  es.forEach((d) => {
    const e = d.data();
    if (!PAID.has(trim(e.status))) return;
    const rate = num(e.workersCompRate);
    if (!(rate > 0)) return;
    const gross =
      (num(e.totalRegularHours) + num(e.totalOTHours) + num(e.totalDoubleTimeHours)) * num(e.payRate) +
      num(e.tips) +
      num(e.bonusAmount);
    if (!(gross > 0)) return;
    const wd = trim(e.workDate);
    const month = wd.slice(0, 7);
    const prem = (gross * rate) / 100;
    const rawLeaf = leafForEntry(trim(e.jobOrderId), wd) ?? 'National';
    const leaf = WC_LEAF_ALIASES.find((a) => a.re.test(rawLeaf))?.leaf ?? rawLeaf;
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const m = byMonth.get(month)!;
    m.set(leaf, (m.get(leaf) ?? 0) + prem);
  });

  // existing [wcalloc:] JEs
  const existing = new Map<string, Record<string, any>>();
  let start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of rows) {
      for (const m of trim(je.PrivateNote).matchAll(/\[wcalloc:([^\]]+)\]/g)) existing.set(trim(m[1]), je);
    }
    if (rows.length < 1000) break;
    start += 1000;
  }

  const results: Array<Record<string, unknown>> = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const [month, m] of [...byMonth.entries()].sort()) {
    const entries = [...m.entries()]
      .map(([leaf, amt]) => ({ leaf, cls: classFor(leaf), amt }))
      .filter((x) => x.amt >= 0.005);
    const total = round2(entries.reduce((s, x) => s + x.amt, 0));
    if (total < 0.01) continue;
    const prior = existing.get(month);
    if (prior) {
      let net = 0;
      for (const l of (prior.Line ?? []) as Array<Record<string, any>>) {
        const d = l.JournalEntryLineDetail;
        if (d?.PostingType === 'Debit') net += num(l.Amount);
      }
      if (Math.abs(round2(net) - total) <= 1) {
        results.push({ month, amount: total, status: 'already_allocated' });
        continue;
      }
    }
    // penny-exact split
    const floored = entries.map((x) => ({ ...x, cents: Math.floor(x.amt * 100), frac: x.amt * 100 - Math.floor(x.amt * 100) }));
    let rem = Math.round(total * 100) - floored.reduce((s, x) => s + x.cents, 0);
    for (const x of [...floored].sort((a, b) => b.frac - a.frac)) {
      if (rem <= 0) break;
      x.cents += 1;
      rem -= 1;
    }
    const action = prior ? 'true_up' : 'create';
    results.push({
      month, amount: total, status: dryRun ? `would_${action}` : `${action}d`,
      splits: floored.filter((x) => x.cents > 0).map((x) => ({ leaf: x.leaf, amount: x.cents / 100, hasClass: Boolean(x.cls) })),
    });
    if (dryRun) continue;
    const lines: Array<Record<string, unknown>> = floored
      .filter((x) => x.cents > 0)
      .map((x) => ({
        DetailType: 'JournalEntryLineDetail',
        Amount: x.cents / 100,
        Description: `WC premium — ${x.leaf} (${month}, matrix-computed)`,
        JournalEntryLineDetail: {
          PostingType: 'Debit',
          AccountRef: { value: String(fieldAcct.Id) },
          ...(x.cls ? { ClassRef: { value: String(x.cls.Id), name: String(x.cls.FullyQualifiedName) } } : {}),
        },
      }));
    lines.push({
      DetailType: 'JournalEntryLineDetail',
      Amount: total,
      Description: `WC premium reclass — field share out of 7140 (${month})`,
      JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: String(internalAcct.Id) } },
    });
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, Line: lines, sparse: false });
    } else {
      const txnDate = `${month}-28` > today ? today : `${month}-28`;
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', {
        DocNumber: `WC Alloc ${month.slice(2).replace('-', '')}`,
        TxnDate: txnDate,
        PrivateNote:
          `Workers' comp field premium (entry gross × matrix rate) reclassed 7140 → 5100 per class. ` +
          `Residual on 7140 = internal WC + carrier deposit/catch-up variance. [wcalloc:${month}]`,
        Line: lines,
      });
    }
  }
  return { ok: true, dryRun, months: results };
}
