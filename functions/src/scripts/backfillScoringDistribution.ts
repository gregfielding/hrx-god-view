#!/usr/bin/env node
/**
 * One-off backfill: write tenants/{tenantId}/scoringDistribution/current for every tenant.
 * Run after deploying scheduledScoringDistribution/recomputeScoringDistribution.
 *
 * Usage (from repo root):
 *   cd functions && npm run build && node lib/scripts/backfillScoringDistribution.js
 *
 * Or with ts-node (from functions dir):
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillScoringDistribution.ts
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or default gcloud application credentials.
 */

import * as admin from 'firebase-admin';

// Initialize Admin first so scoringDistribution's db is valid when loaded
if (!admin.apps.length) {
  admin.initializeApp();
}

async function main() {
  const { computeDistributionForTenant } = await import('../scoringDistribution');
  const db = admin.firestore();

  const tenantsSnap = await db.collection('tenants').get();
  console.log(`Backfilling scoring distribution for ${tenantsSnap.size} tenant(s)...`);

  let ok = 0;
  let fail = 0;
  for (const t of tenantsSnap.docs) {
    const tenantId = t.id;
    try {
      const result = await computeDistributionForTenant(tenantId);
      if (result.success) {
        ok++;
        console.log(`  ${tenantId}: ok (userCount=${result.userCount}, usersWithScores=${result.usersWithScores})`);
      } else {
        fail++;
        console.warn(`  ${tenantId}: skip/fail (${result.error ?? 'insufficient users with scores'})`);
      }
    } catch (err) {
      fail++;
      console.error(`  ${tenantId}: error`, err);
    }
  }

  console.log(`Done. ok=${ok}, fail=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
