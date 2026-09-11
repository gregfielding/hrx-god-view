/**
 * Direct worker payments → class allocation (Greg 2026-09-09, "do May the
 * same way"). In the Lone Oak → Everee transition (May 2026) workers Everee
 * could not yet pay were paid straight from the bank: Purchases on 5010
 * with memo "<Worker> - C1 Payment Sent By …", no Everee behind them.
 *
 * Per segment (month ∩ block) one JE, same shape as the wire entries:
 *   credit 5010 (Corp) = the bank debits;  debit 5010 per class (Division by
 *   family);  unattributed remainder stays in Corp (honest) and is listed
 *   in `punchList` for Mark to name the event.
 * Attribution chain per payment: worker-kind override (name, either
 * "First Last" or "Last, First") → HRX timesheets Apr 27–month end for the
 * worker (users by name) → JO's account mapping / ACCOUNT_CLASS_RULES / JO
 * name → QBO class; else Unattributed. Tag [dpay:YYYY-MM/B<n>], DocNumber
 * `DP Alloc MMYY B<n>`; self-truing on the leg set.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { resolvePriors, segmentDocSuffix, segmentFor, segmentTxnDate, type ReportSegment } from './fiscalBlocks';
import { ACCOUNT_CLASS_RULES, WIRE_LABEL_ALIASES, divisionKindForClassFqn, fetchQboDivisions } from './payrollCostReport';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const trim = (v: unknown): string => String(v ?? '').trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const ACCT_5010 = '73';

export async function pushDirectPaymentAllocations(
  tenantId: string,
  dryRun: boolean,
  opts?: { start?: string; end?: string },
): Promise<Record<string, unknown>> {
  const start = opts?.start ?? '2026-05-01';
  const end = opts?.end ?? new Date().toISOString().slice(0, 10);
  const divisions = await fetchQboDivisions(tenantId);
  const corpRef = divisions.corp ? { DepartmentRef: { value: divisions.corp.Id, name: divisions.corp.Name } } : {};
  const clRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classes: Array<Record<string, any>> = clRes.QueryResponse?.Class ?? clRes.Class ?? [];
  const squash = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const classFor = (leaf: string): Record<string, any> | undefined => {
    const k = squash(leaf);
    return classes.find((c) => squash(String(c.Name)) === k || squash(String(c.FullyQualifiedName)) === k)
      ?? classes.find((c) => { const ck = squash(String(c.Name)); return ck.length >= 4 && k.length >= 4 && (ck.includes(k) || k.includes(ck)); });
  };

  // ── direct payments ──
  type DP = { id: string; date: string; worker: string; amount: number; cls?: Record<string, any>; how: string };
  const dps: DP[] = [];
  const existing = new Map<string, Record<string, any>>();
  for (let pos = 1; ; pos += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Purchase ?? r.Purchase ?? [];
    for (const p of rows) {
      const memo = trim(p.PrivateNote);
      if (/everee|accusource|insource|gusto/i.test(memo) || p.Credit === true) continue;
      const m = memo.match(/^(.+?)\s*-\s*C1 Payment/i);
      if (!m) continue;
      const amt = ((p.Line ?? []) as Array<Record<string, any>>).filter((l) => String(l.AccountBasedExpenseLineDetail?.AccountRef?.value) === ACCT_5010).reduce((s, l) => s + (Number(l.Amount) || 0), 0);
      if (amt <= 0) continue;
      const dept = trim(p.DepartmentRef?.value);
      if (dept && divisions.corp && dept !== divisions.corp.Id) continue; // already in a client Division by hand
      dps.push({ id: String(p.Id), date: String(p.TxnDate).slice(0, 10), worker: trim(m[1]), amount: round2(amt), how: 'unattributed' });
    }
    if (rows.length < 1000) break;
  }
  // Same-day cancellations (duplicate payment returned by the bank) land as
  // Deposits on 5010 "<Worker> - Cancellation of: …" — net them per worker.
  for (let pos = 1; ; pos += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM Deposit WHERE TxnDate >= '${start}' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.Deposit ?? r.Deposit ?? [];
    for (const p of rows) {
      const date = String(p.TxnDate).slice(0, 10);
      if (date > end) continue;
      const dept = trim(p.DepartmentRef?.value);
      if (dept && divisions.corp && dept !== divisions.corp.Id) continue;
      for (const l of (p.Line ?? []) as Array<Record<string, any>>) {
        const dd = l.DepositLineDetail;
        if (String(dd?.AccountRef?.value) !== ACCT_5010) continue;
        const text = `${trim(l.Description)} ${trim(p.PrivateNote)} ${trim(dd?.Entity?.name)}`;
        const m = text.match(/^\s*(.+?)\s*-\s*Cancellation of/i);
        if (!m) continue;
        dps.push({ id: `dep${p.Id}`, date, worker: trim(m[1]), amount: -round2(Number(l.Amount) || 0), how: 'unattributed' });
      }
    }
    if (rows.length < 1000) break;
  }
  for (let pos = 1; ; pos += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const r = (await qboQuery(tenantId, `SELECT * FROM JournalEntry WHERE TxnDate >= '2026-01-01' STARTPOSITION ${pos} MAXRESULTS 1000`)) as Record<string, any>;
    const rows: Array<Record<string, any>> = r.QueryResponse?.JournalEntry ?? r.JournalEntry ?? [];
    for (const je of rows) for (const m of trim(je.PrivateNote).matchAll(/\[dpay:([^\]]+)\]/g)) existing.set(trim(m[1]), je);
    if (rows.length < 1000) break;
  }
  if (!dps.length) return { ok: true, dryRun, payments: 0, months: [], punchList: [] };

  // ── attribution sources ──
  const ov = await db.collection(`tenants/${tenantId}/payroll_class_overrides`).get();
  const overrideByName = new Map<string, string>();
  ov.forEach((d) => { const v = d.data() as Record<string, any>; if (trim(v.kind) !== 'worker') return; const n = trim(v.workerName) || trim(v.worker); if (n && trim(v.class)) overrideByName.set(norm(n), trim(v.class)); });
  const lastFirst = (n: string): string => { const p = n.split(' '); return p.length >= 2 ? norm(`${p.slice(-1)[0]} ${p.slice(0, -1).join(' ')}`) : norm(n); };
  const jos = await db.collection(`tenants/${tenantId}/job_orders`).get();
  const joById = new Map<string, { accountId: string; accountName: string; name: string }>();
  jos.forEach((d) => { const j = d.data(); joById.set(d.id, { accountId: trim(j.accountId), accountName: trim(j.accountName), name: trim(j.jobOrderName) || trim(j.title) }); });
  const maps = await db.collection(`tenants/${tenantId}/qbo_class_mappings`).get();
  const acctMap = new Map<string, string>(); const acctMapCount = new Map<string, number>();
  maps.forEach((d) => { const m = d.data(); const a = trim(m.accountId); if (trim(m.targetKind) !== 'account' || !a) return; acctMapCount.set(a, (acctMapCount.get(a) ?? 0) + 1); acctMap.set(a, trim(m.fqn) || trim(m.className)); });
  for (const [a, n] of acctMapCount) if (n > 1) acctMap.delete(a);
  const leafForJo = (joId: string): string | null => {
    const jo = joById.get(joId); if (!jo) return null;
    const mapped = jo.accountId ? acctMap.get(jo.accountId) : undefined; if (mapped) return mapped;
    const rule = jo.accountName ? ACCOUNT_CLASS_RULES.find((r) => r.re.test(jo.accountName)) : undefined;
    if (rule) return rule.leaf;
    const alias = jo.name ? WIRE_LABEL_ALIASES.find((a) => a.re.test(jo.name)) : undefined;
    return alias ? alias.leaf : jo.name || null;
  };
  const tsStart = new Date(Date.parse(start) - 14 * 86400000).toISOString().slice(0, 10);
  const es = await db.collection(`tenants/${tenantId}/timesheet_entries`).where('workDate', '>=', tsStart).where('workDate', '<=', end).get();
  const joByWorker = new Map<string, Map<string, number>>(); const wids = new Set<string>();
  es.forEach((d) => { const e = d.data(); const uid = trim(e.workerId) || trim(e.userId); const jo = trim(e.jobOrderId); if (!uid || !jo) return; wids.add(uid); const m = joByWorker.get(uid) ?? new Map(); m.set(jo, (m.get(jo) ?? 0) + 1); joByWorker.set(uid, m); });
  const uidByName = new Map<string, string>();
  const addUser = (id: string, u: Record<string, any>): void => { const n = norm(`${trim(u.firstName)} ${trim(u.lastName)}`) || norm(trim(u.displayName)); if (n && (!uidByName.has(n) || joByWorker.has(id))) uidByName.set(n, id); };
  const tenantUsers = await db.collection('users').where('tenantId', '==', tenantId).get().catch(() => null);
  tenantUsers?.forEach((s) => addUser(s.id, s.data() as Record<string, any>));
  const ids = [...wids].filter((id) => !tenantUsers?.docs.some((d) => d.id === id));
  for (let i = 0; i < ids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...ids.slice(i, i + 100).map((id) => db.doc(`users/${id}`)));
    snaps.forEach((s) => { if (s.exists) addUser(s.id, s.data() as Record<string, any>); });
  }
  for (const dp of dps) {
    const o = overrideByName.get(norm(dp.worker)) ?? overrideByName.get(lastFirst(dp.worker));
    if (o) { dp.cls = classFor(o); dp.how = dp.cls ? 'worker_override' : 'override_class_missing'; if (dp.cls) continue; }
    const uid = uidByName.get(norm(dp.worker));
    const m = uid ? joByWorker.get(uid) : undefined;
    if (m) {
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const leaf = leafForJo(top); const cls = leaf ? classFor(leaf) : undefined;
      if (cls) { dp.cls = cls; dp.how = 'timesheet_jo'; continue; }
    }
    dp.how = 'unattributed';
  }

  // ── plan per segment ──
  const segByKey = new Map<string, ReportSegment>(); const bySeg = new Map<string, DP[]>();
  for (const dp of dps) { const seg = segmentFor(dp.date); segByKey.set(seg.key, seg); const a = bySeg.get(seg.key) ?? []; a.push(dp); bySeg.set(seg.key, a); }
  const { priors, orphans } = resolvePriors(existing, segByKey.values());
  const results: Array<Record<string, unknown>> = [];
  for (const o of orphans) results.push({ month: o.tag, status: 'stale_prior_delete_manually', docNumber: (o.je as Record<string, any>).DocNumber });
  const today = new Date().toISOString().slice(0, 10);
  const legKey = (acct: string, cls: string, dept: string, side: string, cents: number): string => `${acct}|${cls}|${dept}|${side}|${cents}`;
  for (const [segKey, list] of [...bySeg.entries()].sort()) {
    const seg = segByKey.get(segKey)!;
    const byCls = new Map<string, { cls?: Record<string, any>; cents: number }>();
    for (const dp of list) { const k = dp.cls ? String(dp.cls.Id) : ''; const e = byCls.get(k) ?? { cls: dp.cls, cents: 0 }; e.cents += Math.round(dp.amount * 100); byCls.set(k, e); }
    const totalCents = [...byCls.values()].reduce((s, x) => s + x.cents, 0);
    const lines: Array<Record<string, unknown>> = []; const want = new Set<string>();
    for (const [k, x] of byCls) {
      const fqn = x.cls ? String(x.cls.FullyQualifiedName) : '';
      const div = x.cls ? (divisionKindForClassFqn(fqn) === 'recurring' ? divisions.recurring : divisions.event) : null;
      if (x.cents === 0) continue;
      const side = x.cents > 0 ? 'Debit' : 'Credit';
      lines.push({ DetailType: 'JournalEntryLineDetail', Amount: Math.abs(x.cents) / 100, Description: x.cls ? `Direct worker payments — ${fqn} (${segKey})` : `Direct worker payments — unattributed (${segKey})`, JournalEntryLineDetail: { PostingType: side, AccountRef: { value: ACCT_5010 }, ...(x.cls ? { ClassRef: { value: k, name: fqn }, DepartmentRef: { value: div!.Id, name: div!.Name } } : corpRef) } });
      want.add(legKey(ACCT_5010, k, x.cls ? div!.Id : (divisions.corp?.Id ?? ''), side, Math.abs(x.cents)));
    }
    lines.push({ DetailType: 'JournalEntryLineDetail', Amount: totalCents / 100, Description: `Direct worker payments — bank debits (${list.length} payments, ${segKey})`, JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: ACCT_5010 }, ...corpRef } });
    want.add(legKey(ACCT_5010, '', divisions.corp?.Id ?? '', 'Credit', totalCents));
    const prior = priors.get(segKey);
    if (prior) {
      const have = new Set<string>();
      for (const l of (prior.Line ?? []) as Array<Record<string, any>>) { const d = l.JournalEntryLineDetail; if (d) have.add(legKey(trim(d.AccountRef?.value), trim(d.ClassRef?.value), trim(d.DepartmentRef?.value), trim(d.PostingType), Math.round((Number(l.Amount) || 0) * 100))); }
      if (have.size === want.size && [...want].every((k) => have.has(k))) { results.push({ month: segKey, dates: `${seg.start}..${seg.end}`, amount: totalCents / 100, payments: list.length, status: 'already_allocated' }); continue; }
    }
    const unattr = (byCls.get('')?.cents ?? 0) / 100;
    results.push({ month: segKey, dates: `${seg.start}..${seg.end}`, amount: totalCents / 100, payments: list.length, unattributed: unattr, status: dryRun ? (prior ? 'would_true_up' : 'would_create') : (prior ? 'true_upd' : 'created'), splits: [...byCls.values()].map((x) => ({ cls: x.cls ? String(x.cls.FullyQualifiedName) : 'Unattributed', amount: x.cents / 100 })) });
    if (dryRun) continue;
    const header = { DocNumber: `DP Alloc ${segmentDocSuffix(seg)}`, TxnDate: segmentTxnDate(seg, today), PrivateNote: `Direct worker payments (bank, not Everee) allocated to client classes: worker override → HRX timesheets → JO account; unattributed stays Corp. Segment ${seg.start}..${seg.end}. [dpay:${seg.key}]` };
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, ...header, Line: lines, sparse: false });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', { ...header, Line: lines });
    }
  }
  // Users whose doc carries only the tenantIds map (no flat tenantId) are
  // missed by the tenant query — look the punch-list names up by lastName.
  for (const dp of dps) {
    if (dp.cls || uidByName.has(norm(dp.worker))) continue;
    const parts = dp.worker.trim().split(/\s+/); if (parts.length < 2) continue;
    const last = parts[parts.length - 1]; const first = parts.slice(0, -1).join(' ');
    for (const variant of [...new Set([last, last[0].toUpperCase() + last.slice(1).toLowerCase(), last.toUpperCase()])]) {
      // eslint-disable-next-line no-await-in-loop
      const q = await db.collection('users').where('lastName', '==', variant).get().catch(() => null);
      const hit = q?.docs.find((d) => norm(trim(d.data().firstName)) === norm(first));
      if (hit) { uidByName.set(norm(dp.worker), hit.id); break; }
    }
  }
  const punch = new Map<string, { amount: number; dates: Set<string>; n: number; hrx: string }>();
  for (const dp of dps) if (!dp.cls) {
    const e = punch.get(dp.worker) ?? { amount: 0, dates: new Set(), n: 0, hrx: '' };
    e.amount = round2(e.amount + dp.amount); e.dates.add(dp.date); e.n++;
    if (!e.hrx) {
      const uid = uidByName.get(norm(dp.worker)); const m = uid ? joByWorker.get(uid) : undefined;
      if (dp.how === 'override_class_missing') e.hrx = 'override class not found in QBO';
      else if (!uid) e.hrx = 'no HRX user by this name';
      else if (!m) e.hrx = 'HRX user, no timesheets in window';
      else { const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; const jo = joById.get(top); e.hrx = `timesheets on JO "${jo?.name ?? top}" (${jo?.accountName ?? 'no account'}) — no class rule`; }
    }
    punch.set(dp.worker, e);
  }
  const how = new Map<string, number>(); for (const dp of dps) how.set(dp.how, round2((how.get(dp.how) ?? 0) + dp.amount));
  return { ok: true, dryRun, payments: dps.length, total: round2(dps.reduce((s, x) => s + x.amount, 0)), byMethod: [...how], months: results, punchList: [...punch.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([worker, e]) => ({ worker, amount: e.amount, payments: e.n, dates: [...e.dates].sort().join(' '), hrx: e.hrx })) };
}
