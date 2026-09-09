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
  if ((mode !== 'dry' && mode !== 'write') || !['both', 'invdiv', 'reclass', 'trueup', 'wc'].includes(phase)) {
    console.error('usage: qboReclassRerun.ts <dry|write> [invdiv|reclass|trueup|wc]');
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
    console.log('carrier months (wc_carrier_invoices):', (w.carrierMonths ?? []).join(', '));
    console.log('reconciliation — InSource bank lines on 7140 by premium month vs portal (events+select+resources):');
    for (const r of (w.reconciliation ?? []) as Array<Record<string, any>>) {
      console.log(`  ${r.month}  portal ${r.portalTotal === null ? '   (none)' : Number(r.portalTotal).toFixed(2).padStart(9)}  bank premium ${Number(r.bankPremium).toFixed(2).padStart(9)}  other ${Number(r.bankOther).toFixed(2).padStart(8)}  diff ${r.diff === null ? '' : Number(r.diff).toFixed(2)}${(r.lines ?? []).filter((l: Record<string, any>) => /ASSESS|WOS/i.test(l.memo)).length ? '  (incl. ' + r.lines.filter((l: Record<string, any>) => /ASSESS|WOS/i.test(l.memo)).map((l: Record<string, any>) => `${l.amount} ${l.memo.replace(/INSOURCE - /,'').slice(0,22)}`).join(', ') + ')' : ''}`);
    }
    const x = (w.excluded8040 ?? {}) as Record<string, number>;
    console.log(`8040 placeholder class EXCLUDED (no premium paid yet): ${x.entries ?? 0} entries, gross ${Number(x.gross ?? 0).toFixed(2)}, would-have-been premium ${Number(x.premium ?? 0).toFixed(2)}`);
  }
  if (phase === 'both' || phase === 'trueup') {
    const { trueUpAllocationJes } = await import('../src/payroll/allocationTrueUp');
    const t = (await trueUpAllocationJes(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== allocation true-up (${mode}) ===`);
    console.log(`patched ${t.patched}  unchanged ${t.unchanged}  deferred ${(t.deferredUnstable ?? []).length}  skippedHuman ${(t.skippedHuman ?? []).length}  skippedDrift ${(t.skippedDrift ?? []).length}`);
    console.log('deferred (read must match the previous run before a write):', JSON.stringify(t.deferredUnstable ?? []));
    console.log('skippedHuman (Tabitha, never rewritten):', (t.skippedHuman ?? []).join(', '));
    console.log('patched docs:', (t.patchedDocs ?? []).join(', '));
    if ((t.skippedDrift ?? []).length) console.log('drift (credit ≠ wire, left alone):', JSON.stringify(t.skippedDrift));
  }
  console.log('\nWeekly writers switch: scripts/qboJeWriters.ts status|on|off (currently controlled by tenants/{t}/settings/qbo_automation.jeWritersEnabled).');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
