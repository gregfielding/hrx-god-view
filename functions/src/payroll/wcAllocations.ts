/**
 * Workers' Comp allocation (Greg 2026-09-03; ACTUALS since 2026-09-08).
 *
 * InSource bills one premium per legal entity per payroll month, and the
 * bank feed lands each as its own 7140 purchase in `Corp / Unalloc.`:
 *   C1 Events LLC    → field labor, Event-based  → 5100 (per event class)
 *   C1 Select LLC    → field labor, Recurring    → 5100 (Sodexo / Flex classes)
 *   C1 Resources LLC → internal staff            → stays on 7140
 * ACCRUAL model (Greg 2026-09-08, late): the premium for payroll month M is
 * expensed IN M and the carrier's debit (which lands in M+1) clears the
 * accrual, so 7140 shows the month's own internal premium instead of the
 * one-month cash lag. Per premium month (segment-dated, fiscalBlocks.ts):
 *   debit  5100 Workers' Comp — Field Staff, per class, Division per family
 *          (C1 Events actual → Event-based; C1 Select actual → Recurring)
 *   debit  7140 Workers' Comp — Internal Staff, Corp   (C1 Resources actual,
 *          pro-rata by days across the month's segments)
 *   credit 2410 Accrued Workers' Comp (sub of 2400 Accrued Expenses), Corp
 * Per carrier payment (bank lines memo "INSOURCE - <MONTH> 2026 PREMIUM",
 * one line per entity, dated in M+1): `WC Pay` JE dated the bank date —
 *   debit  2410 Accrued Workers' Comp / credit 7140 Corp, for the matched
 *   premium (min(bank premium, portal total + minimum top-up)).
 * ☠️ 7140 is ONLY C1 Resources (Greg 2026-09-10). InSource bills a $5,000
 *   MONTHLY MINIMUM: when Events+Select+Resources premium < $5,000 the
 *   shortfall is invoiced to C1 Workforce LLC (portal shows $0.00 for it;
 *   proof: the Jan/Feb 2026 "ACH Returned — C1 Workforce LLC" emails =
 *   exactly 5,000 − portal). It belongs to no entity, so it is accrued in
 *   its premium month to "Workers Comp Minimum Shortage" (Corp) and the
 *   overhead writer allocates it by revenue (Greg 2026-09-10). Non-premium InSource lines on
 *   7140 (state ASSESSMENTS, UNLIMITED WOS) get a `WC Fee` JE per bank line
 *   moving the Events/Select shares to 5100 [wcfee:<purchaseId>]; only the
 *   Resources share stays on 7140.
 *   Idempotent via [wcpay:YYYY-MM] (premium month).
 *
 * Amounts = the ACTUAL entity premiums from the InSource portal, kept in
 * tenants/{t}/wc_carrier_invoices/{YYYY-MM} ({events, select, resources},
 * seeded from the portal; monthly ritual = add the new month). The matrix
 * (entry gross × workersCompRate) is used only to SPLIT each entity's
 * actual across classes/segments — it no longer sets the total (it ran
 * 10–15% low on Events and high on Recurring every month). A month with no
 * carrier doc yet falls back to the matrix estimate, labelled
 * `estimated_matrix`, and self-trues once the invoice is entered.
 * 7140 keeps: C1 Resources premium and the Resources share of fees. Idempotent per segment via [wcalloc:YYYY-MM/B<n>] in PrivateNote.
 *
 * Class per entry: JO → payroll_jo_date_splits window → account-kind
 * mapping/rules → JO name (fuzzy classFor). Known limit: date-splits are
 * JO-wide, so the GB→FIFA crew split follows the split rule, not the
 * per-worker ConnectTeam corrections (~$1.5K between FIFA classes).
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { resolvePriors, segmentDocSuffix, segmentFor, segmentTxnDate, type ReportSegment } from './fiscalBlocks';
import { ACCOUNT_CLASS_RULES, divisionKindForClassFqn, fetchQboDivisions } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number => (Number(v) || 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// JO names whose fuzzy class match fails (same purpose as the wire
// builder's WIRE_LABEL_ALIASES, kept local).
// InSource pay-as-you-go minimum per payroll month across all C1 entities.
const INSOURCE_MONTHLY_MINIMUM = 5000;
const insourceTopUp = (a: { events: number; select: number; resources: number }): number =>
  round2(Math.max(0, INSOURCE_MONTHLY_MINIMUM - (a.events + a.select + a.resources)));

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
  const acctRes = (await qboQuery(tenantId, 'SELECT * FROM Account MAXRESULTS 1000')) as Record<string, any>;
  const accts: Array<Record<string, any>> = acctRes.QueryResponse?.Account ?? acctRes.Account ?? [];
  const fieldAcct = accts.find((a) => /workers'? comp.*field/i.test(String(a.Name)));
  const internalAcct = accts.find((a) => /workers'? comp.*internal/i.test(String(a.Name)));
  if (!fieldAcct || !internalAcct) throw new Error('WC field/internal accounts not found');
  // Accrual liability: 2410 Accrued Workers' Comp, sub-account of 2400
  // Accrued Expenses (created on the first write run if missing).
  const liabRes = (await qboQuery(tenantId, "SELECT Id, Name, AcctNum, AccountType, SubAccount FROM Account WHERE AccountType = 'Other Current Liability' MAXRESULTS 200")) as Record<string, any>;
  const liabs: Array<Record<string, any>> = liabRes.QueryResponse?.Account ?? liabRes.Account ?? [];
  let accruedWc = liabs.find((a) => /accrued.*work/i.test(String(a.Name)));
  const accruedParent = liabs.find((a) => /^accrued expenses$/i.test(String(a.Name)));
  let accountNote: string | undefined;
  if (!accruedWc) {
    if (dryRun) {
      accountNote = `would create account "Accrued Workers' Comp" (2410) under ${accruedParent ? accruedParent.Name : 'top level'}`;
      accruedWc = { Id: 'NEW', Name: "Accrued Workers' Comp" };
    } else {
      const created = (await qboEntityCreate(tenantId, 'Account', {
        Name: "Accrued Workers' Comp", AcctNum: '2410', AccountType: 'Other Current Liability', AccountSubType: 'OtherCurrentLiabilities',
        ...(accruedParent ? { SubAccount: true, ParentRef: { value: String(accruedParent.Id) } } : {}),
      })) as Record<string, any>;
      accruedWc = created.Account ?? created;
      accountNote = `created account "Accrued Workers' Comp" (2410) Id ${accruedWc.Id}`;
    }
  }
  const LIAB = String(accruedWc.Id);
  // Entity-less InSource charges ($5,000 monthly minimum top-up) → their own
  // account, same type/level as 5100, allocated by revenue downstream.
  let minAcct = accts.find((a) => /minimum shortage/i.test(String(a.Name)));
  if (!minAcct) {
    const used = new Set(accts.map((a) => trim(a.AcctNum)));
    const acctNum = ['5110', '5105', '5120', '5190'].find((n) => !used.has(n)) ?? '';
    if (dryRun) {
      accountNote = `${accountNote ? `${accountNote}; ` : ''}would create account "Workers Comp Minimum Shortage" (${acctNum}, ${fieldAcct.AccountType})`;
      minAcct = { Id: 'NEW', Name: 'Workers Comp Minimum Shortage' };
    } else {
      const created = (await qboEntityCreate(tenantId, 'Account', {
        Name: 'Workers Comp Minimum Shortage', ...(acctNum ? { AcctNum: acctNum } : {}),
        AccountType: fieldAcct.AccountType, ...(fieldAcct.AccountSubType ? { AccountSubType: fieldAcct.AccountSubType } : {}),
        ...(fieldAcct.SubAccount && fieldAcct.ParentRef?.value ? { SubAccount: true, ParentRef: { value: String(fieldAcct.ParentRef.value) } } : {}),
        Description: 'InSource $5,000 monthly WC minimum top-up (billed to C1 Workforce LLC); allocated by revenue',
      })) as Record<string, any>;
      minAcct = created.Account ?? created;
      accountNote = `${accountNote ? `${accountNote}; ` : ''}created account "Workers Comp Minimum Shortage" (${acctNum}) Id ${minAcct!.Id}`;
    }
  }
  const MIN_ACCT = String(minAcct!.Id);
  // Divisions per class family (Tabitha matrix, Greg 2026-09-06); the
  // 7140 credit is the internal-staff side → Corp/Unalloc. when present.
  const divisions = await fetchQboDivisions(tenantId);
  const divForLeaf = (leaf: string, cls?: Record<string, any>): { Id: string; Name: string } =>
    divisionKindForClassFqn(String(cls?.FullyQualifiedName ?? leaf)) === 'recurring'
      ? divisions.recurring
      : divisions.event;

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

  // ACTUAL carrier premiums per payroll month (InSource portal figures).
  const carSnap = await db.collection(`tenants/${tenantId}/wc_carrier_invoices`).get().catch(() => null);
  const carrier = new Map<string, { events: number; select: number; resources: number }>();
  if (carSnap) {
    carSnap.forEach((d) => {
      if (!/^\d{4}-\d{2}$/.test(d.id)) return;
      const m = d.data() as Record<string, unknown>;
      carrier.set(d.id, { events: round2(num(m.events)), select: round2(num(m.select)), resources: round2(num(m.resources)) });
    });
  }
  const familyOf = (leaf: string, cls?: Record<string, any>): 'event' | 'recurring' =>
    divisionKindForClassFqn(String(cls?.FullyQualifiedName ?? leaf));

  // matrix premium per segment per leaf from entries (the SPLIT weights)
  const PAID = new Set(['sent_to_everee', 'submitted', 'paid']);
  const es = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workDate', '>=', '2026-03-01')
    .get();
  // keyed by SEGMENT (calendar month ∩ fiscal block, e.g. 2026-06/B7) so the
  // monthly and the block P&L both foot — see fiscalBlocks.ts
  const byMonth = new Map<string, Map<string, number>>();
  const segByKey = new Map<string, ReportSegment>();
  // 8040 = the tenant's PLACEHOLDER class (carrier code/rate pending, synthetic
  // 2.35). No premium is being paid on it, so it must NOT be allocated into
  // 5100 (Greg 2026-09-08). The carrier report already parks it separately.
  const excluded8040 = { entries: 0, gross: 0, premium: 0 };
  es.forEach((d) => {
    const e = d.data();
    if (!PAID.has(trim(e.status))) return;
    const rate = num(e.workersCompRate);
    if (!(rate > 0)) return;
    const isPlaceholder = trim(e.workersCompCode) === '8040' || /placeholder/i.test(trim(e.workersCompSource));
    const gross =
      (num(e.totalRegularHours) + num(e.totalOTHours) + num(e.totalDoubleTimeHours)) * num(e.payRate) +
      num(e.tips) +
      num(e.bonusAmount);
    if (!(gross > 0)) return;
    if (isPlaceholder) {
      excluded8040.entries += 1;
      excluded8040.gross = round2(excluded8040.gross + gross);
      excluded8040.premium = round2(excluded8040.premium + (gross * rate) / 100);
      return;
    }
    const wd = trim(e.workDate);
    const seg = segmentFor(wd.slice(0, 10));
    const month = seg.key;
    segByKey.set(seg.key, seg);
    const prem = (gross * rate) / 100;
    const rawLeaf = leafForEntry(trim(e.jobOrderId), wd) ?? 'National';
    const leaf = WC_LEAF_ALIASES.find((a) => a.re.test(rawLeaf))?.leaf ?? rawLeaf;
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const m = byMonth.get(month)!;
    m.set(leaf, (m.get(leaf) ?? 0) + prem);
  });

  const results: Array<Record<string, unknown>> = [];
  const today = new Date().toISOString().slice(0, 10);

  // Segments per calendar month: from entries, plus every carrier month
  // (a month with actuals but no entries still needs a segment).
  for (const ym of carrier.keys()) {
    if (ym < '2026-03') continue; // Jan–Feb cash sits on 5100 untagged (Lone Oak era) — Tabitha
    const seg = segmentFor(`${ym}-15`);
    if (!segByKey.has(seg.key)) segByKey.set(seg.key, seg);
  }
  const segsOfMonth = new Map<string, ReportSegment[]>();
  for (const seg of segByKey.values()) {
    const ym = seg.key.slice(0, 7);
    if (!segsOfMonth.has(ym)) segsOfMonth.set(ym, []);
    segsOfMonth.get(ym)!.push(seg);
  }

  // Per segment: leaf → cents, built from actuals where a carrier doc exists,
  // else from the matrix estimate.
  type Split = { leaf: string; cls?: Record<string, any>; cents: number; family: 'event' | 'recurring' };
  const planBySeg = new Map<string, { splits: Split[]; resourcesCents: number; topUpCents: number; source: 'actual_insource' | 'estimated_matrix'; note: string }>();
  const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  const splitPennies = (total: number, weights: Array<{ leaf: string; cls?: Record<string, any>; w: number; family: 'event' | 'recurring' }>): Split[] => {
    const wsum = weights.reduce((a, x) => a + x.w, 0);
    const cents = Math.round(total * 100);
    if (!weights.length || wsum <= 0) return [];
    const floored = weights.map((x) => { const raw = (cents * x.w) / wsum; return { ...x, cents: Math.floor(raw), frac: raw - Math.floor(raw) }; });
    let rem = cents - floored.reduce((a, x) => a + x.cents, 0);
    for (const x of [...floored].sort((a, b) => b.frac - a.frac)) { if (rem <= 0) break; x.cents += 1; rem -= 1; }
    return floored.filter((x) => x.cents > 0).map((x) => ({ leaf: x.leaf, cls: x.cls, cents: x.cents, family: x.family }));
  };
  for (const [ym, segs] of [...segsOfMonth.entries()].sort()) {
    const act = carrier.get(ym);
    // matrix weights per segment per leaf, tagged by family
    const wBySeg = new Map<string, Array<{ leaf: string; cls?: Record<string, any>; w: number; family: 'event' | 'recurring' }>>();
    for (const seg of segs) {
      const m = byMonth.get(seg.key) ?? new Map<string, number>();
      wBySeg.set(seg.key, [...m.entries()].filter(([, amt]) => amt > 0).map(([leaf, amt]) => { const cls = classFor(leaf); return { leaf, cls, w: amt, family: familyOf(leaf, cls) }; }));
    }
    if (!act) {
      for (const seg of segs) {
        const ws = wBySeg.get(seg.key) ?? [];
        const total = round2(ws.reduce((a, x) => a + x.w, 0));
        if (total < 0.01) continue;
        planBySeg.set(seg.key, { splits: splitPennies(total, ws), resourcesCents: 0, topUpCents: 0, source: 'estimated_matrix', note: `no wc_carrier_invoices/${ym} yet — matrix estimate (field only)` });
      }
      continue;
    }
    // C1 Resources (internal) actual → 7140 Corp, pro-rata by segment days
    if (act.resources >= 0.01) {
      const perSeg = splitPennies(act.resources, segs.map((seg) => ({ leaf: seg.key, w: daysBetween(seg.start, seg.end), family: 'event' as const })));
      for (const ps of perSeg) {
        const plan = planBySeg.get(ps.leaf) ?? { splits: [], resourcesCents: 0, topUpCents: 0, source: 'actual_insource' as const, note: `InSource ${ym}: Events ${act.events.toFixed(2)} / Select ${act.select.toFixed(2)} / Resources ${act.resources.toFixed(2)}` };
        plan.resourcesCents += ps.cents;
        planBySeg.set(ps.leaf, plan);
      }
    }
    // $5,000 monthly minimum top-up (billed to C1 Workforce LLC) — no entity,
    // pro-rata by segment days onto Workers Comp Minimum Shortage (Corp).
    const topUp = insourceTopUp(act);
    if (topUp >= 0.01) {
      const perSeg = splitPennies(topUp, segs.map((seg) => ({ leaf: seg.key, w: daysBetween(seg.start, seg.end), family: 'event' as const })));
      for (const ps of perSeg) {
        const plan = planBySeg.get(ps.leaf) ?? { splits: [], resourcesCents: 0, topUpCents: 0, source: 'actual_insource' as const, note: `InSource ${ym}: Events ${act.events.toFixed(2)} / Select ${act.select.toFixed(2)} / Resources ${act.resources.toFixed(2)}` };
        plan.topUpCents += ps.cents;
        planBySeg.set(ps.leaf, plan);
      }
    }
    for (const family of ['event', 'recurring'] as const) {
      const actual = family === 'event' ? act.events : act.select;
      if (actual < 0.01) continue;
      // distribute the entity actual across the month's segments by that
      // family's matrix weight; no weights anywhere → the segment holding the 15th
      const segWeight = segs.map((seg) => ({ seg, w: (wBySeg.get(seg.key) ?? []).filter((x) => x.family === family).reduce((a, x) => a + x.w, 0) }));
      const wsum = segWeight.reduce((a, x) => a + x.w, 0);
      const perSeg = wsum > 0
        ? splitPennies(actual, segWeight.map((x) => ({ leaf: x.seg.key, w: x.w, family })))
        : [{ leaf: segmentFor(`${ym}-15`).key, cents: Math.round(actual * 100), family }];
      for (const ps of perSeg) {
        const seg = segByKey.get(ps.leaf)!;
        const ws = (wBySeg.get(seg.key) ?? []).filter((x) => x.family === family);
        const splits = ws.length
          ? splitPennies(ps.cents / 100, ws)
          : [{ leaf: family === 'event' ? '(unclassed — no matrix weights)' : 'Sodexo', cls: family === 'event' ? undefined : classFor('Sodexo'), cents: ps.cents, family }];
        const plan = planBySeg.get(seg.key) ?? { splits: [], resourcesCents: 0, topUpCents: 0, source: 'actual_insource' as const, note: `InSource ${ym}: Events ${act.events.toFixed(2)} / Select ${act.select.toFixed(2)} / Resources ${act.resources.toFixed(2)}` };
        plan.splits.push(...splits);
        planBySeg.set(seg.key, plan);
      }
    }
  }

  // existing [wcalloc:] JEs
  const existing = new Map<string, Record<string, any>>();
  const existingPay = new Map<string, Record<string, any>>();
  const existingFee = new Map<string, Record<string, any>>();
  let start = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of rows) {
      for (const m of trim(je.PrivateNote).matchAll(/\[wcalloc:([^\]]+)\]/g)) existing.set(trim(m[1]), je);
      for (const m of trim(je.PrivateNote).matchAll(/\[wcpay:([^\]]+)\]/g)) existingPay.set(trim(m[1]), je);
      for (const m of trim(je.PrivateNote).matchAll(/\[wcfee:([^\]]+)\]/g)) existingFee.set(trim(m[1]), je);
    }
    if (rows.length < 1000) break;
    start += 1000;
  }
  const { priors, orphans } = resolvePriors(existing, segByKey.values());
  for (const o of orphans) {
    results.push({ month: o.tag, amount: 0, status: 'stale_prior_delete_manually', docNumber: (o.je as Record<string, any>).DocNumber });
  }

  // Reconciliation: InSource bank lines on 7140 by premium month (memo
  // "INSOURCE - MAY 2026 PREMIUM") vs the carrier docs.
  const MONTHS: Record<string, string> = { JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04', MAY: '05', JUNE: '06', JULY: '07', AUGUST: '08', SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12' };
  const bankByMonth = new Map<string, { premium: number; other: number; lines: Array<{ date: string; amount: number; memo: string }> }>();
  const feeLines: Array<{ id: string; date: string; amount: number; memo: string; memoMonth: string | null }> = [];
  let pstart = 1;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '2026-01-01' STARTPOSITION ${pstart} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of rows) {
      const memo = trim(p.PrivateNote);
      if (!/insource/i.test(String(p.EntityRef?.name ?? '')) && !/insource/i.test(memo)) continue;
      const amt = ((p.Line ?? []) as Array<Record<string, any>>)
        .filter((l) => String(l.AccountBasedExpenseLineDetail?.AccountRef?.value ?? '') === String(internalAcct.Id))
        .reduce((a, l) => a + num(l.Amount), 0);
      if (amt <= 0) continue;
      const mm = memo.toUpperCase().match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(20\d\d)\s+(PREMIUM|ASSESSMENTS?)/);
      const ym = mm ? `${mm[2]}-${MONTHS[mm[1]]}` : String(p.TxnDate).slice(0, 7);
      const b = bankByMonth.get(ym) ?? { premium: 0, other: 0, lines: [] };
      if (mm && mm[3] === 'PREMIUM') b.premium = round2(b.premium + amt); else b.other = round2(b.other + amt);
      if (!(mm && mm[3] === 'PREMIUM') && String(p.TxnDate) >= '2026-03-01') {
        feeLines.push({ id: String(p.Id), date: String(p.TxnDate).slice(0, 10), amount: round2(amt), memo: memo.replace(/\\.*$/, '').trim(), memoMonth: mm ? ym : null });
      }
      b.lines.push({ date: String(p.TxnDate), amount: round2(amt), memo: memo.slice(0, 60) });
      bankByMonth.set(ym, b);
    }
    if (rows.length < 1000) break;
    pstart += 1000;
  }
  const reconciliation = [...new Set([...carrier.keys(), ...bankByMonth.keys()])].sort().map((ym) => {
    const a = carrier.get(ym); const b = bankByMonth.get(ym);
    const portal = a ? round2(a.events + a.select + a.resources) : null;
    return { month: ym, portalTotal: portal, bankPremium: b?.premium ?? 0, bankOther: b?.other ?? 0, diff: portal === null ? null : round2((b?.premium ?? 0) - portal), lines: b?.lines ?? [] };
  });

  const corpDept = divisions.corp ? { DepartmentRef: { value: divisions.corp.Id, name: divisions.corp.Name } } : {};
  const legKey = (acct: string, cls: string, dept: string, side: string, cents: number): string => `${acct}|${cls}|${dept}|${side}|${cents}`;
  const jeLegs = (je: Record<string, any>): string[] =>
    ((je.Line ?? []) as Array<Record<string, any>>).filter((l) => l.JournalEntryLineDetail)
      .map((l) => { const d = l.JournalEntryLineDetail; return legKey(trim(d.AccountRef?.value), trim(d.ClassRef?.value), trim(d.DepartmentRef?.value), trim(d.PostingType), Math.round(num(l.Amount) * 100)); });
  for (const [segKey, plan] of [...planBySeg.entries()].sort()) {
    const seg = segByKey.get(segKey)!;
    const month = segKey;
    const fieldCents = plan.splits.reduce((a, x) => a + x.cents, 0);
    const topUpCents = plan.topUpCents;
    const totalCents = fieldCents + plan.resourcesCents + topUpCents;
    const total = totalCents / 100;
    if (totalCents < 1) continue;
    const prior = priors.get(month);
    const wantLines: Array<Record<string, any>> = plan.splits.map((x) => {
      const div = x.family === 'recurring' ? divisions.recurring : divisions.event;
      return {
        DetailType: 'JournalEntryLineDetail',
        Amount: x.cents / 100,
        Description: `WC premium — ${x.leaf} (${month}, ${plan.source === 'actual_insource' ? 'InSource actual, matrix split' : 'matrix estimate'})`,
        JournalEntryLineDetail: {
          PostingType: 'Debit',
          AccountRef: { value: String(fieldAcct.Id) },
          ...(x.cls ? { ClassRef: { value: String(x.cls.Id), name: String(x.cls.FullyQualifiedName) } } : {}),
          DepartmentRef: { value: div.Id, name: div.Name },
        },
      };
    });
    if (plan.resourcesCents > 0) {
      wantLines.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: plan.resourcesCents / 100,
        Description: `WC premium — C1 Resources (internal staff) accrued (${month}, InSource actual)`,
        JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: String(internalAcct.Id) }, ...corpDept },
      });
    }
    if (topUpCents > 0) {
      wantLines.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: topUpCents / 100,
        Description: `InSource $5,000 monthly minimum top-up (${month}; billed to C1 Workforce LLC) — allocated by revenue`,
        JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: MIN_ACCT }, ...corpDept },
      });
    }
    wantLines.push({
      DetailType: 'JournalEntryLineDetail',
      Amount: total,
      Description: `Accrued workers' comp premium (${month}) — cleared by the InSource debit next month`,
      JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: LIAB }, ...corpDept },
    });
    const want = wantLines.map((l) => { const d = l.JournalEntryLineDetail as Record<string, any>; return legKey(trim(d.AccountRef?.value), trim(d.ClassRef?.value), trim(d.DepartmentRef?.value), trim(d.PostingType), Math.round(num(l.Amount) * 100)); }).sort().join(';');
    if (prior && jeLegs(prior).sort().join(';') === want && trim(prior.DocNumber) === `WC Alloc ${segmentDocSuffix(seg)}`) {
      results.push({ month, dates: `${seg.start}..${seg.end}`, amount: total, status: 'already_allocated', source: plan.source });
      continue;
    }
    const action = prior ? 'true_up' : 'create';
    results.push({
      month, dates: `${seg.start}..${seg.end}`, amount: total, status: dryRun ? `would_${action}` : `${action}d`, source: plan.source, note: plan.note,
      resources: plan.resourcesCents / 100,
      topUp: topUpCents / 100,
      splits: plan.splits.map((x) => ({ leaf: x.leaf, family: x.family, amount: x.cents / 100, hasClass: Boolean(x.cls) })),
    });
    if (dryRun) continue;
    const header = {
      DocNumber: `WC Alloc ${segmentDocSuffix(seg)}`,
      TxnDate: segmentTxnDate(seg, today),
      PrivateNote:
        `Workers' comp premium accrued for the payroll month: field share to 5100 per class ` +
        `(C1 Events → Event-based, C1 Select → Recurring), C1 Resources to 7140 (internal), InSource $5,000 minimum top-up to Workers Comp Minimum Shortage (Corp, allocated by revenue), credit 2410 Accrued Workers' Comp. ` +
        `${plan.note}. Cleared by the InSource bank debit next month (WC Pay). ` +
        `Segment ${seg.start}..${seg.end} (month ∩ block). [wcalloc:${seg.key}]`,
    };
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, ...header, Line: wantLines, sparse: false });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', { ...header, Line: wantLines });
    }
  }

  // Payment clearing: one `WC Pay` JE per premium month whose InSource bank
  // debit has landed — debit 2410 / credit 7140 Corp for the matched premium.
  const payments: Array<Record<string, unknown>> = [];
  for (const r of reconciliation) {
    if (r.month < '2026-03' || r.portalTotal === null || r.bankPremium <= 0) continue;
    const car = carrier.get(r.month);
    const amount = round2(Math.min(r.bankPremium, r.portalTotal + (car ? insourceTopUp(car) : 0)));
    const premLines = r.lines.filter((l) => /PREMIUM/i.test(l.memo));
    const txnDate = premLines.map((l) => l.date).sort().slice(-1)[0] ?? r.lines.map((l) => l.date).sort().slice(-1)[0];
    const lines = [
      { DetailType: 'JournalEntryLineDetail', Amount: amount, Description: `InSource premium paid for ${r.month} — clears accrual`, JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: LIAB }, ...corpDept } },
      { DetailType: 'JournalEntryLineDetail', Amount: amount, Description: `InSource premium paid for ${r.month} — bank debit moved off 7140 (accrued in ${r.month})`, JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: String(internalAcct.Id) }, ...corpDept } },
    ];
    const want = lines.map((l) => { const d = l.JournalEntryLineDetail as Record<string, any>; return legKey(trim(d.AccountRef?.value), '', trim(d.DepartmentRef?.value), trim(d.PostingType), Math.round(num(l.Amount) * 100)); }).sort().join(';');
    const prior = existingPay.get(r.month);
    const docNumber = `WC Pay ${r.month.slice(5)}${r.month.slice(2, 4)}`;
    if (prior && jeLegs(prior).sort().join(';') === want && trim(prior.TxnDate) === txnDate) {
      payments.push({ month: r.month, date: txnDate, amount, status: 'already_cleared' });
      continue;
    }
    const action = prior ? 'true_up' : 'create';
    payments.push({ month: r.month, date: txnDate, amount, status: dryRun ? `would_${action}` : `${action}d`, bankPremium: r.bankPremium, unmatchedOn7140: round2(r.bankPremium - amount) });
    if (dryRun) continue;
    const header = {
      DocNumber: docNumber,
      TxnDate: txnDate,
      PrivateNote: `InSource workers' comp premium for ${r.month} (bank debit ${txnDate}) applied against 2410 Accrued Workers' Comp; the bank line stays on 7140 and this credit offsets it. [wcpay:${r.month}]`,
    };
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, ...header, Line: lines, sparse: false });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', { ...header, Line: lines });
    }
  }

  // Non-premium InSource charges on 7140 (state ASSESSMENTS, UNLIMITED WOS):
  // only C1 Resources' share is internal (Greg 2026-09-10). One `WC Fee` JE
  // per bank line moves the Events / Select shares to 5100 by the entity
  // premium mix of the memo month (else the latest carrier month before it).
  const fees: Array<Record<string, unknown>> = [];
  const carrierMonths = [...carrier.keys()].sort();
  for (const f of feeLines.sort((a, b) => a.date.localeCompare(b.date))) {
    const d0 = new Date(`${f.date.slice(0, 7)}-01T00:00:00Z`);
    d0.setUTCMonth(d0.getUTCMonth() - 1);
    const prevYm = d0.toISOString().slice(0, 7);
    const basis = f.memoMonth ?? carrierMonths.filter((m) => m <= prevYm).slice(-1)[0];
    const act = basis ? carrier.get(basis) : undefined;
    if (!act) { fees.push({ id: f.id, date: f.date, amount: f.amount, memo: f.memo, status: 'no_carrier_month' }); continue; }
    const parts = splitPennies(f.amount, [
      { leaf: 'event', w: act.events, family: 'event' as const },
      { leaf: 'recurring', w: act.select, family: 'recurring' as const },
      { leaf: 'resources', w: act.resources, family: 'event' as const },
    ]);
    const c = (k: string): number => parts.find((x) => x.leaf === k)?.cents ?? 0;
    const evC = c('event'); const reC = c('recurring'); const moved = evC + reC;
    const info = { id: f.id, date: f.date, amount: f.amount, memo: f.memo, basis, event: evC / 100, recurring: reC / 100, resources: c('resources') / 100 };
    if (moved <= 0) { fees.push({ ...info, status: 'all_resources' }); continue; }
    const lines: Array<Record<string, any>> = [];
    if (evC > 0) lines.push({ DetailType: 'JournalEntryLineDetail', Amount: evC / 100, Description: `${f.memo} — C1 Events share (${basis} premium mix)`, JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: String(fieldAcct.Id) }, DepartmentRef: { value: divisions.event.Id, name: divisions.event.Name } } });
    if (reC > 0) lines.push({ DetailType: 'JournalEntryLineDetail', Amount: reC / 100, Description: `${f.memo} — C1 Select share (${basis} premium mix)`, JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: String(fieldAcct.Id) }, DepartmentRef: { value: divisions.recurring.Id, name: divisions.recurring.Name } } });
    lines.push({ DetailType: 'JournalEntryLineDetail', Amount: moved / 100, Description: `${f.memo} — non-Resources share moved off 7140 (Resources ${(c('resources') / 100).toFixed(2)} stays)`, JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: String(internalAcct.Id) }, ...corpDept } });
    const want = lines.map((l) => { const d = l.JournalEntryLineDetail as Record<string, any>; return legKey(trim(d.AccountRef?.value), '', trim(d.DepartmentRef?.value), trim(d.PostingType), Math.round(num(l.Amount) * 100)); }).sort().join(';');
    const prior = existingFee.get(f.id);
    if (prior && jeLegs(prior).sort().join(';') === want && trim(prior.TxnDate) === f.date) { fees.push({ ...info, status: 'already_moved' }); continue; }
    const action = prior ? 'true_up' : 'create';
    fees.push({ ...info, status: dryRun ? `would_${action}` : `${action}d` });
    if (dryRun) continue;
    const header = {
      DocNumber: `WC Fee ${f.date.slice(5, 7)}${f.date.slice(8, 10)} ${f.id}`.slice(0, 21),
      TxnDate: f.date,
      PrivateNote: `InSource ${f.memo} (bank ${f.date}, purchase #${f.id}): 7140 is only C1 Resources (Greg 2026-09-10) — Events share → 5100 Event-based, Select share → 5100 Recurring by the ${basis} entity premium mix. [wcfee:${f.id}]`,
    };
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, ...header, Line: lines, sparse: false });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', { ...header, Line: lines });
    }
  }
  return { ok: true, dryRun, months: results, payments, fees, accountNote, excluded8040, carrierMonths, reconciliation };

}
