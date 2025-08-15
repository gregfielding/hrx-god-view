/*
  backfillCompanyEnrichment.ts
  - Batch-enriches companies for a tenant using the callable enrichCompanyOnDemand
  - Supports modes: full | metadata; use --force to bypass staleness
  Usage examples:
    ts-node scripts/migrations/backfillCompanyEnrichment.ts --tenant <tenantId> --limit 200 --mode full --force
*/

/* eslint-disable no-console */
import * as admin from 'firebase-admin';

function getArg(name: string, def?: string) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}
function hasFlag(name: string) { return process.argv.includes('--' + name); }

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const tenantId = getArg('tenant');
  const limit = parseInt(getArg('limit', '200') || '200', 10);
  const mode = (getArg('mode', 'full') || 'full') as 'full' | 'metadata';
  const force = hasFlag('force');

  if (!tenantId) { console.error('Missing --tenant <tenantId>'); process.exit(1); }

  const companiesRef = db.collection('tenants').doc(tenantId).collection('crm_companies');
  // Prioritize active accounts: hasActiveDeals or hasOpenJobOrders true; fall back to recent updates
  let snap = await companiesRef.where('hasActiveDeals', '==', true).limit(limit).get();
  if (snap.empty) snap = await companiesRef.where('hasOpenJobOrders', '==', true).limit(limit).get();
  if (snap.empty) snap = await companiesRef.orderBy('updatedAt', 'desc').limit(limit).get();

  console.log(`Enriching ${snap.size} companies in tenant ${tenantId} (mode=${mode}, force=${force})`);

  const perMinuteCap = 20; // throttle
  let processed = 0;
  for (const doc of snap.docs) {
    const companyId = doc.id;
    try {
      await admin
        .app()
        .functions('us-central1')
        .httpsCallable('enrichCompanyOnDemand')({ tenantId, companyId, mode, force });
      processed++;
      console.log(`[${processed}/${snap.size}] queued ${companyId}`);
      if (processed % perMinuteCap === 0) {
        console.log('Throttling for 60s to control cost...');
        await new Promise((r) => setTimeout(r, 60_000));
      }
    } catch (e: any) {
      console.error('Failed to enqueue enrichment', { companyId, message: e?.message });
    }
  }

  console.log('Backfill complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });


