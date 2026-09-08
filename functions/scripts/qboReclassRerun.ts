/**
 * Revenue-reclass + allocation true-up rerun (Greg 2026-09-08).
 *
 * Run from functions/ on a machine with Firebase ADC + the QBO tokens:
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts dry
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts write
 * Optional 3rd arg: reclass | trueup   (default: both, reclass first)
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
  if (mode !== 'dry' && mode !== 'write') {
    console.error('usage: qboReclassRerun.ts <dry|write> [reclass|trueup]');
    process.exit(2);
  }
  const dryRun = mode === 'dry';
  if (phase === 'both' || phase === 'reclass') {
    const { pushRevenueAccountReclass } = await import('../src/payroll/revenueAccountReclass');
    const r = (await pushRevenueAccountReclass(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== revenue reclass (${mode}) ===`);
    for (const m of (r.months ?? []) as Array<Record<string, any>>) {
      console.log(`${m.month}  ${String(m.status).padEnd(26)} total ${Number(m.amount ?? 0).toFixed(2)}  classes ${m.classes ?? ''}${m.docNumber ? '  doc ' + m.docNumber : ''}`);
    }
  }
  if (phase === 'both' || phase === 'trueup') {
    const { trueUpAllocationJes } = await import('../src/payroll/allocationTrueUp');
    const t = (await trueUpAllocationJes(TENANT, dryRun)) as Record<string, any>;
    console.log(`\n=== allocation true-up (${mode}) ===`);
    console.log(`patched ${t.patched}  unchanged ${t.unchanged}  skippedHuman ${(t.skippedHuman ?? []).length}  skippedDrift ${(t.skippedDrift ?? []).length}`);
    console.log('skippedHuman (Tabitha, never rewritten):', (t.skippedHuman ?? []).join(', '));
    console.log('patched docs:', (t.patchedDocs ?? []).join(', '));
    if ((t.skippedDrift ?? []).length) console.log('drift (credit ≠ wire, left alone):', JSON.stringify(t.skippedDrift));
  }
  console.log('\nRemember: the weekly job stays PAUSED until tenants/{t}/settings/qbo_automation.jeWritersEnabled = true.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
