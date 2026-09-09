/**
 * Revenue-reclass + allocation true-up rerun (Greg 2026-09-08).
 *
 * Run from functions/ on a machine with Firebase ADC + the QBO tokens:
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts dry
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts write
 * Optional 3rd arg: invdiv | reclass | trueup | wc   (default: both = invdiv, reclass, wc, trueup)
 *
 * invdiv (Greg 2026-09-08) re-tags every 2026 invoice/credit memo header
 * Division to the client's family (Sodexo/Flex → Recurring, else Event-
 * based) so the reclass legs mirror corrected invoices.
 *
 * Entries are posted per SEGMENT (calendar month ∩ fiscal block, e.g.
 * 2026-06/B7) so the monthly AND the block P&L both foot — fiscalBlocks.ts.
 *
 * dry   → prints what each month / JE would change; touches nothing.
 * write → rewrites the 9 [revrc:] JEs to the official rule (Recurring =
 *         Sodexo + Indeed Flex only, Division mirrors the invoice) and
 *         re-splits OUR wire JEs; Tabitha's "EV Pay Alloc" JEs are reported
 *         under skippedHuman and never touched.
 * Expected after write: Jun–Aug P&L 4100 $1,641,271.24 / 4200 $126,622.68
 * (Greg's 9/2 baseline), all 9 months already_reclassed on a second dry run.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';

async function main(): Promise<void> {
  const mode = process.argv[2];
  const phase = process.argv[3] ?? 'both';
  if ((mode !== 'dry' && mode !== 'write') || !['both', 'invdiv', 'expdiv', 'reclass', 'trueup', 'wc', 'scrn', 'ovh'].includes(phase)) {
    console.error('usage: qboReclassRerun.ts <dry|write> [invdiv|expdiv|reclass|trueup|wc|scrn|ovh]');
    process.exit(2);
  }
  const dryRun = mode === 'dry';
  if (phase === 'both' || phase === 'invdiv') {
    const { pushInvoiceDivisions } = await import('../src/payroll/invoiceDivisions');
    const d = (await pushInvoiceDivisions(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== invoice divisions (${mode}) — header Location = client family ===`);
    for (const m of (d.months ?? []) as Array<Record<string, any>>) {
      console.log(`${String(m.month).padEnd(10)} checked ${String(m.checked).padStart(4)}  ${dryRun ? 'would change' : 'changed'} ${String(m.changed).padStart(4)}  $${Number(m.amount ?? 0).toFixed(2)}`);
    }
    const flips = new Map<string, number>();
    for (const c of (d.changes ?? []) as Array<Record<string, any>>) flips.set(`${c.from} → ${c.to}`, (flips.get(`${c.from} → ${c.to}`) ?? 0) + 1);
    console.log('by flip:', JSON.stringify([...flips.entries()]));
    if ((d.classMismatch ?? []).length) console.log(`class/customer family mismatches (header follows the CUSTOMER; review the line class): ${JSON.stringify(d.classMismatch)}`);
    if (!dryRun && Number(d.changed) > 0 && phase === 'both') {
      // QBO's query index lags updates (~1 min): a reclass read right after
      // the re-tags sees stale headers (2026-09-08 — half of June's legs
      // landed on the old Division). Stop here; rerun `write reclass` after.
      console.log(`\n${d.changed} invoice(s) re-tagged. STOPPING before the reclass — QBO's query index lags updates. Wait a minute, then run: qboReclassRerun.ts write reclass`);
      return;
    }
  }
  if (phase === 'both' || phase === 'reclass') {
    const { pushRevenueAccountReclass } = await import('../src/payroll/revenueAccountReclass');
    const r = (await pushRevenueAccountReclass(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== revenue reclass (${mode}) ===`);
    for (const m of (r.months ?? []) as Array<Record<string, any>>) {
      console.log(`${String(m.month).padEnd(12)} ${String(m.dates ?? '').padEnd(24)} ${String(m.status).padEnd(26)} total ${Number(m.amount ?? 0).toFixed(2)}  classes ${m.classes ?? ''}${m.docNumber ? '  doc ' + m.docNumber : ''}`);
    }
  }
  if (phase === 'both' || phase === 'wc') {
    const { pushWcAllocations } = await import('../src/payroll/wcAllocations');
    const w = (await pushWcAllocations(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== workers' comp allocation (${mode}) ===`);
    for (const m of (w.months ?? []) as Array<Record<string, any>>) {
      const fam = (m.splits ?? []).reduce((a: Record<string, number>, x: Record<string, any>) => { a[x.family] = (a[x.family] ?? 0) + Number(x.amount); return a; }, {});
      console.log(`${String(m.month).padEnd(12)} ${String(m.dates ?? '').padEnd(24)} ${String(m.status).padEnd(20)} total ${Number(m.amount ?? 0).toFixed(2).padStart(10)}  ${String(m.source ?? '').padEnd(17)} ${m.splits ? `event ${(fam.event ?? 0).toFixed(2)} / recurring ${(fam.recurring ?? 0).toFixed(2)}` : ''}`);
    }
    if (w.accountNote) console.log('accrual account:', w.accountNote);
    console.log('payment clearing (WC Pay — debit 2410 / credit 7140 Corp on the bank date):');
    for (const p of (w.payments ?? []) as Array<Record<string, any>>) console.log(`  ${p.month}  paid ${p.date}  ${String(p.status).padEnd(16)} ${Number(p.amount).toFixed(2).padStart(10)}${p.unmatchedOn7140 !== undefined ? `  stays on 7140: ${Number(p.unmatchedOn7140).toFixed(2)}` : ''}`);
    console.log('carrier months (wc_carrier_invoices):', (w.carrierMonths ?? []).join(', '));
    console.log('reconciliation — InSource bank lines on 7140 by premium month vs portal (events+select+resources):');
    for (const r of (w.reconciliation ?? []) as Array<Record<string, any>>) {
      console.log(`  ${r.month}  portal ${r.portalTotal === null ? '   (none)' : Number(r.portalTotal).toFixed(2).padStart(9)}  bank premium ${Number(r.bankPremium).toFixed(2).padStart(9)}  other ${Number(r.bankOther).toFixed(2).padStart(8)}  diff ${r.diff === null ? '' : Number(r.diff).toFixed(2)}${(r.lines ?? []).filter((l: Record<string, any>) => /ASSESS|WOS/i.test(l.memo)).length ? '  (incl. ' + r.lines.filter((l: Record<string, any>) => /ASSESS|WOS/i.test(l.memo)).map((l: Record<string, any>) => `${l.amount} ${l.memo.replace(/INSOURCE - /,'').slice(0,22)}`).join(', ') + ')' : ''}`);
    }
    const x = (w.excluded8040 ?? {}) as Record<string, number>;
    console.log(`8040 placeholder class EXCLUDED (no premium paid yet): ${x.entries ?? 0} entries, gross ${Number(x.gross ?? 0).toFixed(2)}, would-have-been premium ${Number(x.premium ?? 0).toFixed(2)}`);
  }
  if (phase === 'both' || phase === 'scrn') {
    const { pushScreeningAllocations } = await import('../src/payroll/screeningAllocations');
    const sc = (await pushScreeningAllocations(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== screening allocation (${mode}) — AccuSource charges → 5310 per client class ===`);
    for (const c of (sc.charges ?? []) as Array<Record<string, any>>) {
      console.log(`${String(c.date).padEnd(12)} purchase #${String(c.purchaseId).padEnd(6)} ${String(c.status).padEnd(20)} ${Number(c.amount ?? 0).toFixed(2).padStart(9)}  ${c.screens ?? ''} screens  ${(c.splits ?? []).map((x: Record<string, any>) => `${x.leaf} ${Number(x.amount).toFixed(2)}`).join(', ')}`);
    }
    for (const f of (sc.divisionFixes ?? []) as Array<Record<string, any>>) console.log(`  ${f.docNumber} #${f.id}: ${f.status} (${f.lines} debit line(s) → Recurring)`);
  }
  if (phase === 'both' || phase === 'expdiv') {
    const { pushExpenseDivisions } = await import('../src/payroll/expenseDivisions');
    const e = (await pushExpenseDivisions(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== expense divisions (${mode}) — classed purchases/bills → client family Division ===`);
    for (const m of (e.months ?? []) as Array<Record<string, any>>) console.log(`${String(m.month).padEnd(10)} classed ${String(m.checked).padStart(4)}  ${dryRun ? 'would change' : 'changed'} ${String(m.changed).padStart(4)}  $${Number(m.amount ?? 0).toFixed(2)}`);
    const flips = new Map<string, number>(); for (const c of (e.changes ?? []) as Array<Record<string, any>>) flips.set(`${c.from} → ${c.to}`, (flips.get(`${c.from} → ${c.to}`) ?? 0) + 1);
    console.log('by flip:', JSON.stringify([...flips.entries()]));
    if ((e.mixed ?? []).length) console.log(`mixed-family purchases (header took the larger side): ${JSON.stringify(e.mixed)}`);
    for (const rf of (e.refunds ?? []) as Array<Record<string, any>>) console.log(`  refund deposit ${rf.date} #${rf.id} ${Number(rf.amount).toFixed(2).padStart(9)}  ${rf.from} → ${rf.to}  (${rf.memo})`);
    if (!dryRun && Number(e.changed) > 0 && phase === 'both') { console.log(`\n${e.changed} purchase(s) re-tagged. STOPPING before the ratio pass — rerun: qboReclassRerun.ts write ovh`); return; }
  }
  if (phase === 'both' || phase === 'ovh') {
    const { pushOverheadAllocations } = await import('../src/payroll/overheadAllocations');
    const o = (await pushOverheadAllocations(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== overhead allocation by revenue ratio (${mode}) — Corp/untagged overhead → Event-based / Recurring ===`);
    for (const m of (o.months ?? []) as Array<Record<string, any>>) {
      console.log(`${String(m.month).padEnd(12)} ${String(m.dates ?? '').padEnd(24)} ${String(m.status).padEnd(20)} overhead ${Number(m.amount ?? 0).toFixed(2).padStart(10)}  event ${String(m.ratioEvent ?? '')}% (${m.ratioBasis ?? ''})  ${m.accounts ?? 0} accounts`);
      for (const d of (m.detail ?? []) as Array<Record<string, any>>) console.log(`      ${String(d.account).slice(0, 60).padEnd(60)} ${String(d.source).padEnd(9)} ${Number(d.amount).toFixed(2).padStart(10)} → E ${Number(d.event).toFixed(2).padStart(10)} / R ${Number(d.recurring).toFixed(2).padStart(9)}  (${d.lines} lines)`);
    }
    if ((o.manualAllocationsToDelete ?? []).length) console.log(`⚠️ hand-keyed allocation JEs still present (double-count until deleted): ${(o.manualAllocationsToDelete as string[]).join('; ')}`);
  }
  if (phase === 'both' || phase === 'trueup') {
    const { trueUpAllocationJes } = await import('../src/payroll/allocationTrueUp');
    // 4th arg `fixcredit`: rewrite the CREDIT of drifted JEs to the current
    // Everee wire total (aggregate no-id groups shrink as Everee reconciles)
    let fixCreditDocs: string[] | undefined;
    // `fixcredit` = every drifted doc; `fixcredit=EV Alloc 0625 EVT2,…` = only
    // those (a drifted credit that still matches the BANK debit must be left).
    const fc = process.argv[4] ?? '';
    if (fc === 'fixcredit') {
      const probe = (await trueUpAllocationJes(TENANT, true)) as Record<string, any>;
      fixCreditDocs = ((probe.skippedDrift ?? []) as Array<Record<string, any>>).map((d) => String(d.doc));
    } else if (fc.startsWith('fixcredit=')) {
      fixCreditDocs = fc.slice('fixcredit='.length).split(',').map((x) => x.trim()).filter(Boolean);
    }
    if (fixCreditDocs) console.log('fixcredit: will rewrite credits of', fixCreditDocs.join(', ') || '(none)');
    const t = (await trueUpAllocationJes(TENANT, dryRun, fixCreditDocs ? { fixCreditDocs } : undefined)) as Record<string, any>;
    console.log(`\n=== allocation true-up (${mode}) ===`);
    console.log(`patched ${t.patched}  unchanged ${t.unchanged}  deferred ${(t.deferredUnstable ?? []).length}  skippedHuman ${(t.skippedHuman ?? []).length}  skippedDrift ${(t.skippedDrift ?? []).length}`);
    console.log('deferred (read must match the previous run before a write):', JSON.stringify(t.deferredUnstable ?? []));
    console.log('skippedHuman (Tabitha, never rewritten):', (t.skippedHuman ?? []).join(', '));
    console.log('patched docs:', (t.patchedDocs ?? []).join(', '));
    for (const h of (t.humanDrift ?? []) as Array<Record<string, any>>) console.log(`  TABITHA (not rewritten): ${String(h.doc).padEnd(20)} #${h.id} credit ${Number(h.credit).toFixed(2).padStart(11)} vs bank ${Number(h.bank).toFixed(2).padStart(11)}  delta ${Number(h.delta).toFixed(2).padStart(10)}  (${h.how})`);
    for (const b of (t.bankLineMoves ?? []) as Array<Record<string, any>>) console.log(`  bank line ${b.date} #${b.id} ${Number(b.amount).toFixed(2).padStart(10)} → ${b.to} ${String(b.status).padEnd(10)} ${b.memo}`);
    for (const h of (t.holds ?? []) as Array<Record<string, any>>) console.log(`  EV Hold for ${String(h.for).padEnd(20)} ${String(h.status).padEnd(14)} 1250 ${Number(h.delta) > 0 ? '+' : ''}${Number(h.delta).toFixed(2)}`);
    for (const b of (t.bankTied ?? []) as Array<Record<string, any>>) console.log(`  bank-tied: ${String(b.doc).padEnd(20)} funded ${Number(b.everee).toFixed(2).padStart(11)}  bank ${Number(b.bank).toFixed(2).padStart(11)}  1250 ${Number(b.held) > 0 ? '+' : ''}${Number(b.held).toFixed(2).padStart(9)}  (${b.how}, ${(b.bankDates as string[]).join('/')})`);
    if ((t.skippedDrift ?? []).length) console.log('drift (credit ≠ wire, left alone):', JSON.stringify(t.skippedDrift));
  }
  console.log('\nWeekly writers switch: scripts/qboJeWriters.ts status|on|off (currently controlled by tenants/{t}/settings/qbo_automation.jeWritersEnabled).');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
