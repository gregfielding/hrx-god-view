/**
 * Diagnose (and optionally patch) per-tenant quiet hours configuration.
 *
 * Background: `functions/src/messaging/quietHours.ts` reads
 *   tenants/{tenantId}/messagingConfig/quietHours
 * and falls back to an in-code default if the doc is missing. Hamadi's worker_hired
 * SMS was suppressed with reason `suppressed_quiet_hours`. We just fixed two bugs:
 *   1. The default `allowedMessageTypes` now includes `worker_hired`.
 *   2. Time-of-day is now read in the tenant's timezone instead of UTC.
 *
 * Any tenant that WROTE their own quietHours doc still overrides the defaults, so
 * we need to inspect those docs and — if they exist and omit worker_hired — add it.
 *
 * Usage:
 *   # read-only: show each tenant's current quiet hours config (or "uses default")
 *   GCLOUD_PROJECT=hrx1-d3beb npx ts-node scripts/diagnoseQuietHoursConfig.ts
 *
 *   # patch mode: for every tenant-override doc that omits worker_hired (or the other
 *   # onboarding lifecycle types listed in MISSING_TYPES below), add them.
 *   # Tenants with no override doc are left alone — they pick up the new code default.
 *   GCLOUD_PROJECT=hrx1-d3beb APPLY=1 npx ts-node scripts/diagnoseQuietHoursConfig.ts
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const APPLY = process.env.APPLY === '1';

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// Message types that should always be allowed during quiet hours (celebratory/critical lifecycle).
// Keep in sync with DEFAULT_QUIET_HOURS.allowedMessageTypes in functions/src/messaging/quietHours.ts.
const MUST_ALLOW_TYPES = [
  'worker_hired',
  'worker_onboarding_pipeline_started',
  'on_call_employment_started',
  'payroll_onboarding_invite_needed',
  'onboarding_reminder',
];

function fmtList(arr: unknown): string {
  if (!Array.isArray(arr)) return `(not array: ${typeof arr})`;
  if (arr.length === 0) return '[]';
  return `[${arr.map((x) => String(x)).join(', ')}]`;
}

async function main(): Promise<void> {
  console.log(
    `\n=== quiet hours config diagnosis (project=${PROJECT_ID}, apply=${APPLY}) ===\n`,
  );

  const tenantsSnap = await db.collection('tenants').get();
  let tenantsWithOverride = 0;
  let tenantsPatched = 0;

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const tenantName = String(tenantDoc.get('name') ?? '(no name)');
    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messagingConfig')
      .doc('quietHours');
    const snap = await ref.get();

    console.log(`---- tenant ${tenantId} (${tenantName}) ----`);
    if (!snap.exists) {
      console.log(`  messagingConfig/quietHours: DOES NOT EXIST — uses code default`);
      console.log(
        `  (code default already has worker_hired + onboarding lifecycle in allowedMessageTypes)\n`,
      );
      continue;
    }

    tenantsWithOverride += 1;
    const d = snap.data() as Record<string, unknown>;
    const enabled = d.enabled;
    const tz = d.timezone;
    const startLocal = d.startLocal;
    const endLocal = d.endLocal;
    const allowed = Array.isArray(d.allowedMessageTypes)
      ? (d.allowedMessageTypes as string[])
      : [];
    const missing = MUST_ALLOW_TYPES.filter((t) => !allowed.includes(t));

    console.log(`  messagingConfig/quietHours: exists (override)`);
    console.log(`      enabled:  ${enabled}`);
    console.log(`      timezone: ${tz}`);
    console.log(`      window:   ${startLocal} → ${endLocal}`);
    console.log(`      allowed:  ${fmtList(allowed)}`);
    if (missing.length === 0) {
      console.log(`      >>> OK: already allows worker_hired + onboarding lifecycle <<<\n`);
      continue;
    }

    console.log(`      >>> MISSING from allowedMessageTypes: ${missing.join(', ')} <<<`);

    if (!APPLY) {
      console.log(`      (dry run — re-run with APPLY=1 to add them)\n`);
      continue;
    }

    const next = Array.from(new Set([...allowed, ...MUST_ALLOW_TYPES]));
    await ref.update({
      allowedMessageTypes: next,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tenantsPatched += 1;
    console.log(`      PATCHED — allowedMessageTypes now has ${next.length} entries\n`);
  }

  console.log(
    `=== summary: ${tenantsSnap.size} tenants, ${tenantsWithOverride} with override docs, ${tenantsPatched} patched ===\n`,
  );
  if (!APPLY && tenantsWithOverride > 0) {
    console.log(`(Re-run with APPLY=1 to write fixes; unchanged docs are left alone.)\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
