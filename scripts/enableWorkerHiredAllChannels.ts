/**
 * One-shot admin: ensure every `worker_hired` automation rule delivers on
 *   sms + email + push (Firestore `deliveryChannels` map with all three = true).
 *
 * Runs per tenant. Default is dry run — prints every rule it would touch with
 * the existing `deliveryChannels` and the proposed update. Set `APPLY=1` to
 * actually write.
 *
 * Usage:
 *   # dry run (no writes)
 *   GCLOUD_PROJECT=hrx1-d3beb npx ts-node scripts/enableWorkerHiredAllChannels.ts
 *
 *   # apply
 *   GCLOUD_PROJECT=hrx1-d3beb APPLY=1 npx ts-node scripts/enableWorkerHiredAllChannels.ts
 *
 *   # limit scope to active rules only (skip drafts)
 *   GCLOUD_PROJECT=hrx1-d3beb SCOPE=active npx ts-node scripts/enableWorkerHiredAllChannels.ts
 *
 * Scope notes:
 *   - Collection path: `tenants/{tenantId}/messageAutomationRules`
 *   - Rule identity:   `triggerKey == 'worker_hired'`
 *   - Shape:           `deliveryChannels: { sms: boolean, email: boolean, push: boolean }`
 *   - Enable flag:     `status: 'active' | 'draft'`
 *
 *   Does NOT resend the last hired message — future worker_hired events only.
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const APPLY = process.env.APPLY === '1';
const SCOPE = (process.env.SCOPE || 'all').toLowerCase(); // 'all' | 'active'
const TRIGGER_KEY = 'worker_hired';
const TARGET_CHANNELS = { sms: true, email: true, push: true };

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

type DeliveryChannels = { sms: boolean; email: boolean; push: boolean };

function fmtChannels(dc: Partial<DeliveryChannels> | undefined | null): string {
  if (!dc) return '{ sms:?, email:?, push:? }';
  return `{ sms:${!!dc.sms}, email:${!!dc.email}, push:${!!dc.push} }`;
}

function channelsAlreadyFull(dc: Partial<DeliveryChannels> | undefined | null): boolean {
  return !!(dc && dc.sms === true && dc.email === true && dc.push === true);
}

async function main(): Promise<void> {
  console.log(
    `\n=== enable sms+email+push for trigger="${TRIGGER_KEY}" ` +
      `(project=${PROJECT_ID}, apply=${APPLY}, scope=${SCOPE}) ===\n`,
  );

  const tenantsSnap = await db.collection('tenants').get();
  console.log(`scanning ${tenantsSnap.size} tenant(s)\n`);

  let tenantsWithRule = 0;
  let rulesFound = 0;
  let rulesNeedingUpdate = 0;
  let rulesUpdated = 0;
  let rulesSkippedDraft = 0;

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const tenantName = String(tenantDoc.get('name') ?? '(no name)');

    const rulesSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageAutomationRules')
      .where('triggerKey', '==', TRIGGER_KEY)
      .get();

    if (rulesSnap.empty) continue;
    tenantsWithRule += 1;

    console.log(`tenant ${tenantId} (${tenantName}) — ${rulesSnap.size} worker_hired rule(s)`);

    for (const ruleDoc of rulesSnap.docs) {
      rulesFound += 1;
      const data = ruleDoc.data() as Record<string, unknown>;
      const status = String(data.status ?? '');
      const current = data.deliveryChannels as Partial<DeliveryChannels> | undefined;
      const name = String(data.name ?? '(unnamed)');
      const ruleId = String(data.ruleId ?? ruleDoc.id);
      const templateId = String(data.templateId ?? '');

      const path = `tenants/${tenantId}/messageAutomationRules/${ruleDoc.id}`;
      const prefix = `  - ${path} | status=${status} | name="${name}" | ruleId=${ruleId} | templateId=${templateId || '(none)'}`;

      if (SCOPE === 'active' && status !== 'active') {
        rulesSkippedDraft += 1;
        console.log(`${prefix} | SKIP (status != active and SCOPE=active)`);
        continue;
      }

      console.log(`${prefix}`);
      console.log(`      current:  ${fmtChannels(current)}`);
      console.log(`      target:   ${fmtChannels(TARGET_CHANNELS)}`);

      if (channelsAlreadyFull(current)) {
        console.log(`      noop:     all three channels already enabled`);
        continue;
      }

      rulesNeedingUpdate += 1;
      if (!APPLY) {
        console.log(`      (dry run — would update)`);
        continue;
      }

      try {
        await ruleDoc.ref.set(
          {
            deliveryChannels: TARGET_CHANNELS,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        rulesUpdated += 1;
        console.log(`      UPDATED`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`      ERROR:   ${msg}`);
      }
    }
    console.log('');
  }

  console.log('=== summary ===');
  console.log(`  tenants scanned:            ${tenantsSnap.size}`);
  console.log(`  tenants with worker_hired:  ${tenantsWithRule}`);
  console.log(`  rules found:                ${rulesFound}`);
  console.log(`  rules skipped (not active): ${rulesSkippedDraft}`);
  console.log(`  rules needing update:       ${rulesNeedingUpdate}`);
  console.log(`  rules updated:              ${rulesUpdated} (apply=${APPLY})`);
  console.log('');
  console.log(
    APPLY
      ? 'Done. This only affects FUTURE worker_hired events — it does not resend the last message.'
      : 'Dry run complete. Re-run with APPLY=1 to write changes.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
