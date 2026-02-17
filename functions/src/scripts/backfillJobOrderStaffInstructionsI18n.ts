#!/usr/bin/env node
/**
 * One-time backfill: copy staffInstructions.<section>.text → staffInstructions_i18n.<section>.en
 * for every job order where .en is missing. Makes existing job orders eligible for ES translation
 * (trigger will enqueue when TRANSLATION_ENABLED is true).
 *
 * Run from repo root:
 *   cd functions && npm run build && node lib/scripts/backfillJobOrderStaffInstructionsI18n.js
 *
 * Or with ts-node (from functions dir):
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillJobOrderStaffInstructionsI18n.ts
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or default gcloud application credentials.
 */

import 'dotenv/config';
import { loadEnvForScripts } from './loadEnv';
loadEnvForScripts();

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const STAFF_SECTIONS = ['firstDay', 'parking', 'checkIn', 'uniform', 'credentials', 'other'];

async function main() {
  const db = admin.firestore();
  const tenantsSnap = await db.collection('tenants').get();
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const t of tenantsSnap.docs) {
    const tenantId = t.id;
    const jobOrdersRef = db.collection('tenants').doc(tenantId).collection('job_orders');
    const jobOrdersSnap = await jobOrdersRef.get();

    for (const docSnap of jobOrdersSnap.docs) {
      const data = docSnap.data();
      const staff = data.staffInstructions as Record<string, { text?: string }> | undefined;
      const i18n = (data.staffInstructions_i18n ?? {}) as Record<string, { en?: string; es?: string }>;
      if (!staff) {
        totalSkipped++;
        continue;
      }

      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      for (const section of STAFF_SECTIONS) {
        const text = staff[section]?.text?.trim();
        if (!text) continue;
        if (i18n[section]?.en != null) continue; // already has .en
        updates[`staffInstructions_i18n.${section}.en`] = text;
        needsUpdate = true;
      }

      if (needsUpdate) {
        updates.updatedAt = FieldValue.serverTimestamp();
        await docSnap.ref.update(updates);
        totalUpdated++;
        console.log(`  ${tenantId}/job_orders/${docSnap.id}: backfilled .en for ${Object.keys(updates).filter((k) => k.startsWith('staffInstructions_i18n')).length} section(s)`);
      } else {
        totalSkipped++;
      }
    }
  }

  console.log(`Done. updated=${totalUpdated}, skipped=${totalSkipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
