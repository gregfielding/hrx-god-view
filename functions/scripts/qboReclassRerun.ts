/**
 * Revenue-reclass + allocation true-up rerun (Greg 2026-09-08).
 *
 * Run from functions/ on a machine with Firebase ADC + the QBO tokens:
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts dry
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts write
 * Optional 3rd arg: reclass | trueup | wc   (default: both = reclass, wc, trueup)
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
  if ((mode !== 'dry' && mode !== 'write') || !['both', 'reclass', 'trueup', 'wc'].includes(phase)) {
    console.error('usage: qboReclassRerun.ts <dry|write> [reclass|trueup|wc]');
    process.exit(2);
  }
  const dryRun = mode === 'dry';
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
      console.log(`${String(m.month).padEnd(12)} ${String(m.dates ?? '').padEnd(24)} ${String(m.status).padEnd(20)} total ${Number(m.amount ?? 0).toFixed(2)}`);
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
