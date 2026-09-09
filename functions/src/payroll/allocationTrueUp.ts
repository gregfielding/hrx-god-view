/**
 * Allocation JE true-up (Greg 2026-09-01: "once we match everything, do
 * we push again?" — no: pushed wires are tag-idempotent and skip). This
 * is the missing link: it rewrites each posted allocation JE's DEBIT
 * lines to the CURRENT attribution (overrides, ledger, resolver), scaled
 * to the JE's own credit so totals never move. Runs weekly after the
 * health check and on demand from the callable — flag fixes made on the
 * verification page flow into QuickBooks without re-pushing anything.
 *
 * Everee Funding Balance model (Greg 2026-09-09): each entry debits 5010
 * per class at what Everee FUNDED, credits 5010 (Corp) for the BANK debit
 * (wireBankMatch), and books the difference to 1250 Everee Funding Balance
 * (over-wire → asset up; Everee netting a later wire → asset down). Human
 * "EV Pay Alloc" entries get a companion "EV Hold" entry for their bank
 * difference instead of being edited.
 *
 * Safety: only OUR JEs (DocNumber "EV Alloc"/"TW Alloc") carrying
 * [wire:...] tags are touched — human "EV Pay Alloc" entries are reported
 * as skippedHuman and never rewritten; a JE whose
 * credit no longer matches its wire total (Everee drift) is skipped and
 * reported; lines are compared before writing so unchanged JEs are
 * untouched.
 */
import * as admin from 'firebase-admin';

import { qboQuery, qboEntityCreate, qboEntityUpdate } from '../integrations/quickbooks/qboAuth';
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
  const { matches: bankMatch, unmatchedDebits } = matchWiresToBank(
    ((journal.wires ?? []) as Array<Record<string, any>>).map((w) => ({ fundingId: trim(w.fundingId), fundingDate: String(w.fundingDate), entityName: String(w.entityName), amount: Number(w.amount) || 0 })),
    bankDebits,
  );
  const bankTied: Array<Record<string, unknown>> = [];
  const humanDrift: Array<Record<string, unknown>> = [];
  const holdWanted = new Map<string, { doc: string; date: string; delta: number }>();
  const holdHave = new Map<string, Record<string, any>>();
  const holds: Array<Record<string, unknown>> = [];
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
  // 1250 Everee Funding Balance (Other Current Asset) — bank − funded lives here.
  const acctRes = (await qboQuery(tenantId, "SELECT Id, Name, AcctNum FROM Account WHERE AccountType = 'Other Current Asset' MAXRESULTS 200")) as Record<string, any>;
  const acct1250 = ((acctRes.QueryResponse?.Account ?? acctRes.Account ?? []) as Array<Record<string, any>>).find((a) => String(a.AcctNum) === '1260' || /everee funding balance/i.test(String(a.Name)));
  const ACCT_1250 = acct1250 ? String(acct1250.Id) : '';
  if (!ACCT_1250) console.warn('[trueUpAllocationJes] 1250 Everee Funding Balance not found — bank/funded differences will stay on 5010');
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
        const delta = round2(hBank - hCredit);
        if (Math.abs(delta) > 0.005) {
          humanDrift.push({ doc, id: String(je.Id), credit: round2(hCredit), bank: hBank, delta, how: hm.map((m) => m!.how).join('+') });
          // Companion `EV Hold` entry keyed to her JE: moves the bank/credit
          // difference to 1250 without touching her lines.
          if (ACCT_1250) holdWanted.set(String(je.Id), { doc, date: trim(je.TxnDate), delta });
        }
      }
      continue;
    }
    if (/^EV Hold\b/i.test(doc)) {
      const m = trim(je.PrivateNote).match(/\[wirehold:je(\d+)\]/);
      if (m) holdHave.set(m[1], je);
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
    // ── Everee Funding Balance model (Greg 2026-09-09) ──
    //   debit  5010 per class   = what Everee actually FUNDED (the labor)
    //   debit/credit 1250       = bank − funded (over-wire → asset up; Everee
    //                             netting a later wire → asset down)
    //   credit 5010 (Corp)      = the BANK debit (so Corp nets to zero)
    const everee = round2(wireTotal);
    const bm = wires.map((w) => bankMatch.get(trim(w.fundingId)));
    const allBankMatched = bm.length > 0 && bm.every((m) => m && m.how !== 'unmatched');
    const bankHow = bm.map((m) => m?.how ?? 'unmatched').join('+');
    // matched: credit 5010 (Corp) = bank; 1260 = bank − funded.
    // unmatched (no bank line yet / ever): funded from the Everee balance →
    // credit 1260 for the funded amount, no 5010 credit.
    const bank = allBankMatched ? round2(bm.reduce((s2, m) => s2 + m!.bankCents / 100, 0)) : 0;
    const held = allBankMatched ? round2(bank - everee) : round2(-everee);
    if (allBankMatched && Math.abs(held) > 0.005) bankTied.push({ doc, everee, bank, held, how: bankHow, bankDates: [...new Set(bm.flatMap((m) => m!.bankDates))] });
    // Pro-rata shares depend on which wires were left over in THIS Everee
    // read, so they must pass the two-read guard; exact/split/near are
    // anchored to a specific bank line and may fix the credit immediately.
    const bankStable = allBankMatched && !bankHow.includes('prorata');
    // class debits at the FUNDED amount, penny-exact
    const splitSum = [...combined.values()].reduce((s2, x) => s2 + x.amt, 0);
    const scale = splitSum > 0 ? everee / splitSum : 1;
    const floored = [...combined.values()].map((x) => ({ ...x, cents: Math.floor(x.amt * scale * 100), frac: x.amt * scale * 100 - Math.floor(x.amt * scale * 100) }));
    let rem = Math.round(everee * 100) - floored.reduce((s, x) => s + x.cents, 0);
    for (const x of [...floored].sort((a, b) => b.frac - a.frac)) {
      if (rem <= 0) break;
      x.cents += 1;
      rem -= 1;
    }
    if (rem > 0 && floored.length) floored.sort((a, b) => b.cents - a.cents)[0].cents += rem;
    const want = floored.filter((x) => x.cents > 0).map((x) => ({ cls: x.cls, amt: x.cents / 100 }));
    const allLines = (je.Line ?? []) as Array<Record<string, any>>;
    const is5010 = (l: Record<string, any>): boolean => String(l.JournalEntryLineDetail?.AccountRef?.value) === ACCT_5010;
    const is1250 = (l: Record<string, any>): boolean => Boolean(ACCT_1250) && String(l.JournalEntryLineDetail?.AccountRef?.value) === ACCT_1250;
    const haveLines = allLines.filter((l) => l.JournalEntryLineDetail?.PostingType === 'Debit' && is5010(l));
    const have = haveLines.map((l) => ({ cls: l.JournalEntryLineDetail.ClassRef?.name ?? null, amt: Number(l.Amount) || 0 }));
    const haveHeld = round2(allLines.filter(is1250).reduce((s2, l) => s2 + (l.JournalEntryLineDetail.PostingType === 'Debit' ? 1 : -1) * (Number(l.Amount) || 0), 0));
    const jeCredits = allLines.filter((l) => l.JournalEntryLineDetail?.PostingType === 'Credit' && is5010(l));
    const haveCredit = round2(jeCredits.reduce((s2, l) => s2 + (Number(l.Amount) || 0), 0));
    const missingDivision =
      haveLines.some((l) => l.JournalEntryLineDetail.ClassRef?.value && !l.JournalEntryLineDetail.DepartmentRef?.value) ||
      (Boolean(divisions.corp) &&
        [...haveLines.filter((l) => !l.JournalEntryLineDetail.ClassRef?.value), ...jeCredits].some(
          (l) => String(l.JournalEntryLineDetail.DepartmentRef?.value ?? '') !== String(divisions.corp!.Id),
        ));
    const key = (arr: Array<{ cls: string | null; amt: number }>): string =>
      arr.map((x) => `${x.cls}|${x.amt.toFixed(2)}`).sort().join(';');
    const fingerprint = `${bank.toFixed(2)}|${everee.toFixed(2)}|${key(want)}`;
    const sameDebits = key(want) === key(have);
    const sameHeld = Math.abs(haveHeld - (ACCT_1250 ? held : 0)) < 0.005;
    const sameCredit = Math.abs(haveCredit - (ACCT_1250 ? bank : everee)) < 0.005;
    if (sameDebits && sameHeld && sameCredit && !missingDivision) {
      unchanged += 1;
      if (lastObs.has(doc) && lastObs.get(doc) !== fingerprint) {
        // eslint-disable-next-line no-await-in-loop
        await obsCol.doc(doc).set({ fingerprint, wireTotal: everee, bank, held, credit: haveCredit, observedAt: admin.firestore.FieldValue.serverTimestamp(), dryRun, unchanged: true }, { merge: true });
      }
      continue;
    }
    // A bank-anchored correction (credit or held line off, bank line fixed) is
    // not subject to the read-stability guard; a changed class split is.
    const urgent = bankStable && (!sameCredit || !sameHeld);
    const prev = lastObs.get(doc);
    if (prev !== fingerprint && !urgent) {
      deferredUnstable.push({ doc, reason: prev ? 'read differs from previous run' : 'first observation', wireTotal: everee });
      // eslint-disable-next-line no-await-in-loop
      await obsCol.doc(doc).set({ fingerprint, wireTotal: everee, bank, held, credit: haveCredit, observedAt: admin.firestore.FieldValue.serverTimestamp(), dryRun }, { merge: true });
      continue;
    }
    if (lastPatched.get(doc) === fingerprint && !urgent) {
      deferredUnstable.push({ doc, reason: 'already written with this exact split but still compares as different — comparison bug, investigate', wireTotal: everee });
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
    if (ACCT_1250 && Math.abs(held) > 0.005) {
      newLines.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: Math.abs(held),
        Description: !allBankMatched ? `Funded from Everee balance — no bank debit matched yet (funded ${everee.toFixed(2)})` : held > 0 ? `Over-wired to Everee (bank ${bank.toFixed(2)} vs funded ${everee.toFixed(2)}) — held at Everee` : `Funded from Everee balance (bank ${bank.toFixed(2)} vs funded ${everee.toFixed(2)})`,
        JournalEntryLineDetail: { PostingType: held > 0 ? 'Debit' : 'Credit', AccountRef: { value: ACCT_1250 } },
      });
    }
    const creditAmt = ACCT_1250 ? bank : everee;
    if (creditAmt > 0.005) {
      newLines.push({
        DetailType: 'JournalEntryLineDetail',
        Amount: creditAmt,
        Description: `Everee wire — bank debit ${allBankMatched ? [...new Set(bm.flatMap((m) => m!.bankDates))].join('/') : '(unmatched, Everee total)'} — reallocation`,
        JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: ACCT_5010 }, ...corpRef },
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await qboEntityUpdate(tenantId, 'JournalEntry', { ...je, Line: newLines, sparse: false });
    // eslint-disable-next-line no-await-in-loop
    await obsCol.doc(doc).set({ patchedFingerprint: fingerprint, patchedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  // Everee bank lines themselves: a debit with NO funding behind it (older
  // than 5 days) is cash sitting at Everee → 1260; one on 1260 that now
  // matches a funding goes back to 5010 so the JE credit nets it in Corp.
  const bankLineMoves: Array<Record<string, unknown>> = [];
  if (ACCT_1250) {
    const matchedDebitIds = new Set<string>([...bankMatch.values()].flatMap((m) => m.debitIds));
    const stale = (d: string): boolean => Math.floor(Date.parse(today) / 86400000) - Math.floor(Date.parse(d) / 86400000) > 5;
    const moves: Array<{ id: string; to: '5010' | '1260'; date: string; cents: number; memo: string }> = [];
    // May is out of scope (transition month; the 5/14 19,161.07 wire pre-funded
    // the May 15 batch Everee still shows as APPROVED_FOR_FUNDING).
    for (const d of unmatchedDebits) if (d.acct === '5010' && d.date >= '2026-06-01' && stale(d.date)) moves.push({ id: d.id, to: '1260', date: d.date, cents: d.cents, memo: d.memo });
    for (const d of bankDebits) if (d.acct === '1260' && matchedDebitIds.has(d.id)) moves.push({ id: d.id, to: '5010', date: d.date, cents: d.cents, memo: d.memo });
    for (const mv of moves) {
      bankLineMoves.push({ id: mv.id, date: mv.date, amount: mv.cents / 100, to: mv.to, memo: mv.memo, status: dryRun ? 'would_move' : 'moved' });
      if (dryRun) continue;
      // eslint-disable-next-line no-await-in-loop
      const pr = (await qboQuery(tenantId, `SELECT * FROM Purchase WHERE Id = '${mv.id}'`)) as Record<string, any>;
      const p = (pr.QueryResponse?.Purchase ?? pr.Purchase ?? [])[0];
      if (!p) continue;
      const from = mv.to === '1260' ? ACCT_5010 : ACCT_1250; const to = mv.to === '1260' ? ACCT_1250 : ACCT_5010;
      const lines = ((p.Line ?? []) as Array<Record<string, any>>).map((l) => String(l.AccountBasedExpenseLineDetail?.AccountRef?.value) === from ? { ...l, AccountBasedExpenseLineDetail: { ...l.AccountBasedExpenseLineDetail, AccountRef: { value: to } } } : l);
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'Purchase', { ...p, Line: lines, sparse: false });
    }
  }
  // Companion entries for human JEs (bank ≠ her credit): create / true up.
  for (const [jeId, h] of holdWanted) {
    const prior = holdHave.get(jeId);
    const lines = [
      { DetailType: 'JournalEntryLineDetail', Amount: Math.abs(h.delta), Description: h.delta > 0 ? `Over-wired to Everee vs ${h.doc} — held at Everee` : `Funded from Everee balance vs ${h.doc}`, JournalEntryLineDetail: { PostingType: h.delta > 0 ? 'Debit' : 'Credit', AccountRef: { value: ACCT_1250 } } },
      { DetailType: 'JournalEntryLineDetail', Amount: Math.abs(h.delta), Description: `Bank debit vs ${h.doc} credit — moved to 1250`, JournalEntryLineDetail: { PostingType: h.delta > 0 ? 'Credit' : 'Debit', AccountRef: { value: ACCT_5010 }, ...corpRef } },
    ];
    const priorAmt = prior ? round2(((prior.Line ?? []) as Array<Record<string, any>>).filter((l) => String(l.JournalEntryLineDetail?.AccountRef?.value) === ACCT_1250).reduce((s2, l) => s2 + (l.JournalEntryLineDetail.PostingType === 'Debit' ? 1 : -1) * (Number(l.Amount) || 0), 0)) : null;
    if (prior && priorAmt !== null && Math.abs(priorAmt - h.delta) < 0.005) { holds.push({ for: h.doc, delta: h.delta, status: 'already' }); continue; }
    holds.push({ for: h.doc, delta: h.delta, status: dryRun ? (prior ? 'would_true_up' : 'would_create') : (prior ? 'true_upd' : 'created') });
    if (dryRun) continue;
    const header = { DocNumber: `EV Hold ${h.doc.replace(/^EV Pay Alloc\s*/i, '').slice(0, 12)}`, TxnDate: h.date, PrivateNote: `Bank debit vs ${h.doc} credit: difference booked to 1250 Everee Funding Balance (over-wire / netting). Companion to a hand-keyed entry — never edits it. [wirehold:je${jeId}]` };
    if (prior) {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityUpdate(tenantId, 'JournalEntry', { ...prior, ...header, Line: lines, sparse: false });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await qboEntityCreate(tenantId, 'JournalEntry', { ...header, Line: lines });
    }
  }
  return { ok: true, dryRun, patched, unchanged, skippedDrift, skippedHuman, deferredUnstable, bankTied, humanDrift, holds, bankLineMoves, patchedDocs: patchedDocs.slice(0, 50) };
}
