/**
 * Kill switch for the automated QBO journal-entry writers (weekly true-up,
 * revenue reclass, screening, WC allocations in
 * maybeRunWeeklyClassificationHealth). Reads/writes
 * tenants/{t}/settings/qbo_automation.jeWritersEnabled.
 *
 * Run from functions/ on a machine with Firebase ADC:
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboJeWriters.ts status
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboJeWriters.ts on
 *   DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboJeWriters.ts off
 *
 * Rule the writers enforce (Greg, law as of 2026-09-08): Recurring =
 * Sodexo + Indeed Flex family only; everything else is Events (4100 /
 * Event-based). Source of truth: RECURRING_DIVISION_RE in payrollCostReport.ts.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd !== 'on' && cmd !== 'off' && cmd !== 'status') {
    console.error('usage: qboJeWriters.ts <on|off|status>');
    process.exit(2);
  }
  const ref = admin.firestore().doc(`tenants/${TENANT}/settings/qbo_automation`);
  if (cmd !== 'status') {
    await ref.set(
      {
        jeWritersEnabled: cmd === 'on',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: process.env.USER ?? 'scripts/qboJeWriters.ts',
        note: cmd === 'on'
          ? 'Re-enabled after the 2026-09-08 reclass rerun (Recurring = Sodexo + Indeed Flex only).'
          : 'Paused via scripts/qboJeWriters.ts off',
      },
      { merge: true },
    );
  }
  const snap = await ref.get();
  const on = snap.exists && snap.get('jeWritersEnabled') === true;
  console.log(`QBO JE writers: ${on ? 'ENABLED' : 'PAUSED'}  (tenants/${TENANT}/settings/qbo_automation.jeWritersEnabled = ${String(snap.get('jeWritersEnabled'))})`);
  if (on) console.log('Weekly job will run true-up + revenue reclass + screening + WC allocations on its next reconcileTimesheetBatchesCron tick.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
