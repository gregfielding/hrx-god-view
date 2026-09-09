/**
 * Allocation JE true-up (Greg 2026-09-01: "once we match everything, do
 * we push again?" — no: pushed wires are tag-idempotent and skip). This
 * is the missing link: it rewrites each posted allocation JE's DEBIT
 * lines to the CURRENT attribution (overrides, ledger, resolver), scaled
 * to the JE's own credit so totals never move. Runs weekly after the
 * health check and on demand from the callable — flag fixes made on the
 * verification page flow into QuickBooks without re-pushing anything.
 *
 * Safety: only OUR JEs (DocNumber "EV Alloc"/"TW Alloc") carrying
 * [wire:...] tags are touched — human "EV Pay Alloc" entries are reported
 * as skippedHuman and never rewritten; a JE whose
 * credit no longer matches its wire total (Everee drift) is skipped and
 * reported; lines are compared before writing so unchanged JEs are
 * untouched.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
import { buildWireJournal, divisionKindForClassFqn, fetchQboDivisions } from './payrollCostReport';
import { fetchEvereeBankDebits, matchWiresToBank } from './wireBankMatch';

if (!admin.apps.length) {
  admin.initializeApp();
}
const trim = (v: unknown): string => String(v ?? '').trim();
const db = admin.firestore();
const round2 = (n: number): number => Math.round(n * 100) / 100;
const ACCT_5010 = '73';

export async function trueUpAllocationJes(
  tenantId: string,
  dryRun: boolean,
  opts?: { fixCreditDocs?: string[] },
): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);
  const journal = (await buildWireJournal(tenantId, '2026-05-01', today, null)) as Record<string, any>;
  const wireByTag = new Map<string, Record<string, any>>();
  // buildWireJournal swallows a failed QBO class query ("classes just
  // unresolved") — for the true-up that would mean rewriting every JE as
  // unattributed. Refuse instead (Greg 2026-09-08, after the 0813/0730 flap).
  const anyClassed = ((journal.wires ?? []) as Array<Record<string, any>>).some((w) =>
    ((w.splits ?? []) as Array<Record<string, any>>).some((s) => s.qboClassExists === true),
  );
  if (!anyClassed) {
    throw new Error('[trueUpAllocationJes] wire journal has no QBO-resolved classes (class query failed?) — refusing to true up');
  }
  for (const w of (journal.wires ?? []) as Array<Record<string, any>>) {
    const ent = /events/i.test(String(w.entityName)) ? 'EVT' : /select/i.test(String(w.entityName)) ? 'SEL' : /workforce/i.test(String(w.entityName)) ? 'WF' : 'C1';
    const fid = trim(w.fundingId);
    wireByTag.set(`${fid === 'none' ? `none-${String(w.fundingDate).slice(0, 7)}` : fid}@${ent}`, w);
    // legacy un-qualified aggregate tags
    if (fid === 'none') wireByTag.set(`none@${ent}`, w);
  }
  // Bank tie-out (Greg 2026-09-08): the JE credit must equal the BANK debit
  // that paid the wire, not Everee's moving read. Wires matched to a bank
  // line (exact, bundled, split, or near-pair drift) get that amount as
  // their target credit; unmatched wires keep the Everee total.
  const bankDebits = await fetchEvereeBankDebits(tenantId, '2026-05-01', today);
  const { matches: bankMatch } = matchWiresToBank(
    ((journal.wires ?? []) as Array<Record<string, any>>).map((w) => ({ fundingId: trim(w.fundingId), fundingDate: String(w.fundingDate), entityName: String(w.entityName), amount: Number(w.amount) || 0 })),
    bankDebits,
  );
  const bankTied: Array<Record<string, unknown>> = [];
  const humanDrift: Array<Record<string, unknown>> = [];
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class WHERE Active = true MAXRESULTS 1000')) as Record<string, any>;
  const classIdByFqn = new Map<string, string>(
    ((clsRes.QueryResponse?.Class ?? clsRes.Class ?? []) as Array<Record<string, any>>).map((c) => [String(c.FullyQualifiedName), String(c.Id)]),
  );
  // Divisions per class family (Tabitha matrix, Greg 2026-09-06); a JE
  // whose classed debit lines are missing divisions is rewritten even
  // when the split itself is unchanged (one-time backfill rides here).
  const divisions = await fetchQboDivisions(tenantId);
  const divRefForFqn = (fqn: string): Record<string, string> => {
    const d = divisionKindForClassFqn(fqn) === 'recurring' ? divisions.recurring : divisions.event;
    return { value: d.Id, name: d.Name };
  };
  // Credit + unattributed-remainder lines carry `Corp / Unalloc.` — the
  // Division the bank-feed wire sits in — so the wire nets to zero there
  // (Greg 2026-09-08; untagged credits were piling into Not Specified).
  const corpRef = divisions.corp ? { DepartmentRef: { value: divisions.corp.Id, name: divisions.corp.Name } } : {};
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
  // Everee's /payments pages shift while it syncs, so a wire's total or
  // split can differ read-to-read (2026-08-31 and 2026-09-08 incidents:
  // EV Alloc 0813/0730/0806 re-patched on every run). A JE is only
  // rewritten when the CURRENT read matches the PREVIOUS run's read for
  // that doc (tenants/{t}/qbo_trueup_observations/{doc}); otherwise the
  // read is recorded and the write deferred to the next run.
  const obsCol = db.collection(`tenants/${tenantId}/qbo_trueup_observations`);
  const obsSnap = await obsCol.get();
  const lastObs = new Map<string, string>();
  const lastPatched = new Map<string, string>();
  obsSnap.forEach((d) => {
    lastObs.set(d.id, trim(d.get('fingerprint')));
    lastPatched.set(d.id, trim(d.get('patchedFingerprint')));
  });
  const deferredUnstable: Array<Record<string, unknown>> = [];
  const skippedDrift: Array<Record<string, unknown>> = [];
  const skippedHuman: string[] = [];
  const patchedDocs: string[] = [];
  for (const je of jes) {
    const doc = trim(je.DocNumber);
    // Only OUR JEs ("EV Alloc MMDD ENT" / "TW Alloc …") are ever rewritten.
    // Tabitha's month-end "EV Pay Alloc …" entries carry [wire:] tags for
    // idempotency only — the 2026-09-06 division backfill overwrote her
    // hand splits (Greg 2026-09-08: never again).
    if (/^EV Pay Alloc/i.test(doc)) {
      skippedHuman.push(doc);
      // Report (never rewrite): her credit vs the bank amount of her wires.
      const hTags = [...trim(je.PrivateNote).matchAll(/\[wire:([^\]]+)\]/g)].map((m) => trim(m[1]));
      const hWires = [...new Set(hTags.map((t) => wireByTag.get(t)).filter(Boolean))] as Array<Record<string, any>>;
      const hCredit = ((je.Line ?? []) as Array<Record<string, any>>).filter((l) => l.JournalEntryLineDetail?.PostingType === 'Credit').reduce((s2, l) => s2 + (Number(l.Amount) || 0), 0);
      const hm = hWires.map((w) => bankMatch.get(trim(w.fundingId)));
      if (hWires.length && hm.every((m) => m && m.how !== 'unmatched')) {
        const hBank = round2(hm.reduce((s2, m) => s2 + (m!.bankCents / 100), 0));
        if (Math.abs(hBank - hCredit) > 1) humanDrift.push({ doc, id: String(je.Id), credit: round2(hCredit), bank: hBank, delta: round2(hBank - hCredit), how: hm.map((m) => m!.how).join('+') });
      }
      continue;
    }
    if (!/^(EV|TW) Alloc\b/i.test(doc)) continue;
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
    // Bank-tied target: when every wire behind this JE matched a bank line,
    // the credit target is the bank amount (drift after the pull is real cost).
    const bm = wires.map((w) => bankMatch.get(trim(w.fundingId)));
    const allBankMatched = bm.length > 0 && bm.every((m) => m && m.how !== 'unmatched');
    const bankHow = bm.map((m) => m?.how ?? 'unmatched').join('+');
    if (allBankMatched) {
      const bankTotal = round2(bm.reduce((s2, m) => s2 + (m!.bankCents / 100), 0));
      if (Math.abs(bankTotal - wireTotal) > 0.005) {
        bankTied.push({ doc, everee: round2(wireTotal), bank: bankTotal, how: bankHow, bankDates: [...new Set(bm.flatMap((m) => m!.bankDates))] });
        wireTotal = bankTotal;
      }
    }
    // Pro-rata shares depend on which wires were left over in THIS Everee
    // read, so they must pass the two-read guard; exact/split/near are
    // anchored to a specific bank line and may fix the credit immediately.
    const bankStable = allBankMatched && !bankHow.includes('prorata');
    const fixCredit = Math.abs(credit - wireTotal) > 0.005 && (allBankMatched || opts?.fixCreditDocs?.includes(doc));
    if (Math.abs(credit - wireTotal) > Math.max(1, credit * 0.02) || (fixCredit && Math.abs(credit - wireTotal) > 0.005)) {
      if (!fixCredit) {
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
    // Scale the splits to the CREDIT by their own sum (not Everee's wire
    // total — after a bank tie-out those differ, and the one-cent loop below
    // cannot absorb a multi-dollar gap → "debits not equal to credits").
    const splitSum = [...combined.values()].reduce((s2, x) => s2 + x.amt, 0);
    const scale = splitSum > 0 ? credit / splitSum : 1;
    const floored = [...combined.values()].map((x) => ({ ...x, cents: Math.floor(x.amt * scale * 100), frac: x.amt * scale * 100 - Math.floor(x.amt * scale * 100) }));
    let rem = Math.round(credit * 100) - floored.reduce((s, x) => s + x.cents, 0);
    for (const x of [...floored].sort((a, b) => b.frac - a.frac)) {
      if (rem <= 0) break;
      x.cents += 1;
      rem -= 1;
    }
    if (rem > 0 && floored.length) floored.sort((a, b) => b.cents - a.cents)[0].cents += rem; // any residue onto the largest line
    const want = floored.filter((x) => x.cents > 0).map((x) => ({ cls: x.cls, amt: x.cents / 100 }));
    const haveLines = ((je.Line ?? []) as Array<Record<string, any>>)
      .filter((l) => l.JournalEntryLineDetail?.PostingType === 'Debit');
    const have = haveLines
      .map((l) => ({ cls: l.JournalEntryLineDetail.ClassRef?.name ?? null, amt: Number(l.Amount) || 0 }));
    const jeCredits = ((je.Line ?? []) as Array<Record<string, any>>)
      .filter((l) => l.JournalEntryLineDetail?.PostingType === 'Credit');
    const missingDivision =
      haveLines.some((l) => l.JournalEntryLineDetail.ClassRef?.value && !l.JournalEntryLineDetail.DepartmentRef?.value) ||
      (Boolean(divisions.corp) &&
        [...haveLines.filter((l) => !l.JournalEntryLineDetail.ClassRef?.value), ...jeCredits].some(
          (l) => String(l.JournalEntryLineDetail.DepartmentRef?.value ?? '') !== String(divisions.corp!.Id),
        ));
    const key = (arr: Array<{ cls: string | null; amt: number }>): string =>
      arr.map((x) => `${x.cls}|${x.amt.toFixed(2)}`).sort().join(';');
    const fingerprint = allBankMatched ? `${credit.toFixed(2)}|${wireTotal.toFixed(2)}|${bankHow}` : `${credit.toFixed(2)}|${wireTotal.toFixed(2)}|${key(want)}`;
    if (key(want) === key(have) && !missingDivision) {
      unchanged += 1;
      // An unchanged read must still supersede the last observation —
      // otherwise reads that alternate A, B, A would pair the two A's as
      // "consecutive" (EV Alloc 0622, 2026-09-08) and patch on stale data.
      if (lastObs.has(doc) && lastObs.get(doc) !== fingerprint) {
        // eslint-disable-next-line no-await-in-loop
        await obsCol.doc(doc).set({ fingerprint, wireTotal: round2(wireTotal), credit: round2(credit), observedAt: admin.firestore.FieldValue.serverTimestamp(), dryRun, unchanged: true }, { merge: true });
      }
      continue;
    }
    const prev = lastObs.get(doc);
    // A bank-anchored CREDIT correction is not subject to the read-stability
    // guard (the guard exists for Everee's flapping class splits; the credit
    // target here comes from the bank line and does not move).
    if (prev !== fingerprint && !(fixCredit && (bankStable || opts?.fixCreditDocs?.includes(doc)))) {
      deferredUnstable.push({ doc, reason: prev ? 'read differs from previous run' : 'first observation', wireTotal: round2(wireTotal) });
      // eslint-disable-next-line no-await-in-loop
      await obsCol.doc(doc).set({ fingerprint, wireTotal: round2(wireTotal), credit: round2(credit), observedAt: admin.firestore.FieldValue.serverTimestamp(), dryRun }, { merge: true });
      continue;
    }
    if (lastPatched.get(doc) === fingerprint) {
      // We already wrote exactly this split and QBO still reads back as
      // different → the have/want comparison is wrong for this doc, not the
      // data. Never loop on it; surface it.
      deferredUnstable.push({ doc, reason: 'already written with this exact split but still compares as different — comparison bug, investigate', wireTotal: round2(wireTotal) });
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
        ? {
            PostingType: 'Debit',
            AccountRef: { value: ACCT_5010 },
            ClassRef: { value: classIdByFqn.get(x.cls), name: x.cls },
            DepartmentRef: divRefForFqn(x.cls),
          }
        : { PostingType: 'Debit', AccountRef: { value: ACCT_5010 }, ...corpRef },
    }));
    for (const l of jeCredits) {
      newLines.push({ ...l, JournalEntryLineDetail: { ...l.JournalEntryLineDetail, ...corpRef } });
    }
    // eslint-disable-next-line no-await-in-loop
    await qboEntityUpdate(tenantId, 'JournalEntry', { ...je, Line: newLines, sparse: false });
    // eslint-disable-next-line no-await-in-loop
    await obsCol.doc(doc).set({ patchedFingerprint: fingerprint, patchedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  return { ok: true, dryRun, patched, unchanged, skippedDrift, skippedHuman, deferredUnstable, bankTied, humanDrift, patchedDocs: patchedDocs.slice(0, 50) };
}
