/**
 * Diagnose why worker_hired SMS + push are being dropped for real users.
 *
 * Dumps, per tenant:
 *   1. `tenants/{tenantId}/messageAutomationRules` entries for triggerKey=worker_hired
 *      (already confirmed empty, but prints for completeness)
 *   2. `tenants/{tenantId}/messageTypes/worker_hired` — specifically `defaultChannels`
 *      and `enabled`. If this doc exists with email-only channels, it OVERRIDES the
 *      code default of ['sms', 'email', 'push'] defined in messageTypesRegistry.ts.
 *   3. (Optional) for a specific user, their `tenants/{tenantId}/notificationSettings/{userId}`
 *      `channelsAllowedPerType.worker_hired` and global `smsEnabled` / `pushEnabled`.
 *
 * Usage:
 *   # scan all tenants, no user-specific check
 *   GCLOUD_PROJECT=hrx1-d3beb npx ts-node scripts/diagnoseWorkerHiredChannels.ts
 *
 *   # also inspect one user's per-type notification settings (e.g. Hamadi)
 *   GCLOUD_PROJECT=hrx1-d3beb USER_ID=<hamadi_user_id> npx ts-node scripts/diagnoseWorkerHiredChannels.ts
 *
 * This is read-only. After inspection, use enableWorkerHiredAllChannels.ts (+future
 * fixWorkerHiredMessageType.ts if the issue is messageType defaultChannels) to write.
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const USER_ID = process.env.USER_ID || '';

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

type Channel = 'sms' | 'email' | 'push';

function fmtList(arr: unknown): string {
  if (!Array.isArray(arr)) return `(not an array: ${typeof arr}) ${JSON.stringify(arr)}`;
  return `[${arr.map((x) => String(x)).join(', ')}]`;
}

function fmtBoolMap(m: unknown): string {
  if (!m || typeof m !== 'object') return '—';
  const o = m as Record<string, unknown>;
  return `{ sms:${o.sms}, email:${o.email}, push:${o.push} }`;
}

async function main(): Promise<void> {
  console.log(`\n=== worker_hired channel diagnosis (project=${PROJECT_ID}) ===\n`);

  const tenantsSnap = await db.collection('tenants').get();
  console.log(`scanning ${tenantsSnap.size} tenant(s)${USER_ID ? `, userId=${USER_ID}` : ''}\n`);

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const tenantName = String(tenantDoc.get('name') ?? '(no name)');
    console.log(`---- tenant ${tenantId} (${tenantName}) ----`);

    // 1. Automation rules for worker_hired
    const rulesSnap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageAutomationRules')
      .where('triggerKey', '==', 'worker_hired')
      .get();
    console.log(`  messageAutomationRules[triggerKey=worker_hired]: ${rulesSnap.size} doc(s)`);
    for (const r of rulesSnap.docs) {
      const d = r.data() as Record<string, unknown>;
      console.log(
        `    - ${r.id} | status=${d.status} | templateId=${d.templateId} | deliveryChannels=${fmtBoolMap(d.deliveryChannels)}`,
      );
    }

    // 2. Per-tenant messageType doc for worker_hired
    const mtRef = db.collection('tenants').doc(tenantId).collection('messageTypes').doc('worker_hired');
    const mtSnap = await mtRef.get();
    if (!mtSnap.exists) {
      console.log(`  messageTypes/worker_hired: DOES NOT EXIST — falls back to code defaults:`);
      console.log(`      defaultChannels: ['sms', 'email', 'push']`);
      console.log(`      enabled: true, critical: true`);
    } else {
      const d = mtSnap.data() as Record<string, unknown>;
      const channels = d.defaultChannels;
      const missing: Channel[] = [];
      if (Array.isArray(channels)) {
        for (const c of ['sms', 'email', 'push'] as const) {
          if (!channels.includes(c)) missing.push(c);
        }
      }
      console.log(`  messageTypes/worker_hired: exists`);
      console.log(`      defaultChannels: ${fmtList(channels)}`);
      console.log(`      enabled: ${d.enabled} | critical: ${d.critical}`);
      if (missing.length > 0) {
        console.log(`      >>> MISSING CHANNELS: ${missing.join(', ')} — this is likely the culprit <<<`);
      }
    }

    // 3. (Optional) per-user notification settings
    if (USER_ID) {
      const nsRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('notificationSettings')
        .doc(USER_ID);
      const nsSnap = await nsRef.get();
      if (!nsSnap.exists) {
        console.log(`  notificationSettings/${USER_ID}: DOES NOT EXIST (defaults apply, all channels on)`);
      } else {
        const d = nsSnap.data() as Record<string, unknown>;
        const perType =
          (d.channelsAllowedPerType as Record<string, Record<string, unknown>> | undefined) ?? {};
        console.log(`  notificationSettings/${USER_ID}: exists`);
        console.log(
          `      global: emailEnabled=${d.emailEnabled}, smsEnabled=${d.smsEnabled}, pushEnabled=${d.pushEnabled}`,
        );
        const pt = perType['worker_hired'];
        if (pt) {
          console.log(
            `      channelsAllowedPerType.worker_hired: ${fmtBoolMap(pt)}`,
          );
        } else {
          console.log(`      channelsAllowedPerType.worker_hired: (not set — inherits globals)`);
        }
      }
    }

    console.log('');
  }

  console.log('=== done ===');
  console.log('');
  console.log('Interpretation:');
  console.log(
    '  - If any tenant shows "MISSING CHANNELS" on messageTypes/worker_hired, that Firestore doc is',
  );
  console.log(
    '    overriding the code default and dropping sms/push. Fix by updating defaultChannels to',
  );
  console.log(
    "    ['sms','email','push'] on that doc. (Can script this — ask Claude for fixWorkerHiredMessageType.ts.)",
  );
  console.log(
    '  - If everything looks correct but SMS/push still did not fire, check Cloud Logging around the',
  );
  console.log('    hired dispatch timestamp for the "sendMessage" info log and any skippedChannels reasons.');
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
