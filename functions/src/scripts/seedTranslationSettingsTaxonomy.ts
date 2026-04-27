#!/usr/bin/env node
/**
 * Seed or merge taxonomy.es into tenants/{tenantId}/translation_settings/default.
 * Run once (or when adding new terms) so chip array translation has a dictionary.
 * Preserves existing translation_settings (glossary, doNotTranslate, tone); merges taxonomy.es.
 *
 * Usage (all tenants):
 *   cd functions && npm run build && node lib/scripts/seedTranslationSettingsTaxonomy.js
 *
 * Usage (single tenant - set TENANT_ID):
 *   TENANT_ID=BCiP2bQ9CgVOCTfV6MhD node lib/scripts/seedTranslationSettingsTaxonomy.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or default gcloud application credentials.
 */

import 'dotenv/config';
import { loadEnvForScripts } from './loadEnv';
loadEnvForScripts();

import * as admin from 'firebase-admin';
import { DEFAULT_TAXONOMY_ES } from '../translation/taxonomy';

if (!admin.apps.length) {
  admin.initializeApp();
}

async function main() {
  const db = admin.firestore();
  const tenantIdEnv = process.env.TENANT_ID;
  const defaultTaxonomy = { es: DEFAULT_TAXONOMY_ES };

  const tenantIds: string[] = tenantIdEnv
    ? [tenantIdEnv]
    : (await db.collection('tenants').get()).docs.map((d) => d.id);

  if (tenantIds.length === 0) {
    console.log('No tenants found.');
    process.exit(0);
    return;
  }

  for (const tenantId of tenantIds) {
    const ref = db.doc(`tenants/${tenantId}/translation_settings/default`);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() ?? {} : {};

    const mergedTaxonomy = {
      ...(existing.taxonomy as Record<string, unknown> | undefined),
      es: { ...DEFAULT_TAXONOMY_ES, ...(existing.taxonomy as { es?: Record<string, string> })?.es },
    };

    await ref.set(
      {
        ...existing,
        taxonomy: mergedTaxonomy,
      },
      { merge: true }
    );
    console.log(`  ${tenantId}: taxonomy.es seeded/merged (${Object.keys(mergedTaxonomy.es).length} terms)`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
