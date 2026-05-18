/**
 * **Provision C1's custom Everee pay codes** — one-shot per company
 * instance.
 *
 * Per Everee's 2026-05-07 confirmation (Piers), CA Labor Code §226.7
 * meal and rest break premiums should be paid as **custom taxable
 * wage codes**, not as bonuses. This script creates the two codes on
 * a given Everee company instance:
 *
 *   - `MEAL_PREMIUM` — §226.7 meal break premium pay
 *   - `REST_PREMIUM` — §226.7 rest break premium pay
 *
 * Both are taxable wage codes with the same tax treatment as hourly
 * wages, surfaced as their own pay-stub line items to substantiate
 * §226.7 audit compliance.
 *
 * **Idempotent.** Re-running this script is safe — `ensureCustomPayCode`
 * checks for the code by name first and skips create if present. The
 * server-side `externalId` (set equal to the code name) provides a
 * second layer of dedup if the local check ever races.
 *
 * **Runs against**: each C1 entity that has Everee configured. By
 * default the script discovers all three (Select, Events, Workforce);
 * pass `--entity=c1_select_llc` to scope to one.
 *
 * ## Usage
 *
 * ```sh
 * # Dry-run (default) — lists what would be created, no writes:
 * GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud-claude/service-account.json \
 *   npx ts-node functions/src/integrations/everee/scripts/provisionCustomPayCodes.ts
 *
 * # Apply:
 * GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud-claude/service-account.json \
 *   npx ts-node functions/src/integrations/everee/scripts/provisionCustomPayCodes.ts --write
 *
 * # Single entity:
 * ...provisionCustomPayCodes.ts --write --entity=c1_select_llc
 * ```
 *
 * Output: structured JSON summary to
 * `functions/.scratch/provision-pay-codes-{ts}.json` (gitignored) with
 * per-entity add/skip counts and per-code ids.
 */

'use strict';

import * as fs from 'fs';
import * as path from 'path';

import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity, type EvereeEntityConfig } from '../evereeConfig';
import { ensureCustomPayCode, type CreatePayCodeBody } from '../evereePayCodes';

const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

// Everee's `earningType` is a fixed enum. There is no custom MEAL_PREMIUM
// or REST_PREMIUM enum value — the custom-ness is in `apiKey` (= our
// `code`) and `displayLabel` (= our `label`). For Piers's "taxed like
// regular wages, not bonuses" recommendation, REGULAR_HOURLY is the
// matching enum value.
//
// Caveat: pay-stub display behaviour with this earningType is TBD —
// Everee may aggregate the premium hours with regular hours on the
// stub rather than surfacing as a discrete line. The displayLabel
// should still tag the entry for §226.7 substantiation regardless;
// verify on the first test pay run. If aggregation turns out to defeat
// §226.7 compliance, the alternative is `earningType: 'BONUS'` (right
// pay-stub display but wrong tax treatment per Piers — not recommended)
// or asking Everee to whitelist a custom enum value.
const CUSTOM_PAY_CODES: CreatePayCodeBody[] = [
  {
    code: 'MEAL_PREMIUM',
    label: 'Meal Break Premium (CA §226.7)',
    earningType: 'REGULAR_HOURLY',
    category: 'TAXABLE_WAGE',
    active: true,
    externalId: 'MEAL_PREMIUM',
  },
  {
    code: 'REST_PREMIUM',
    label: 'Rest Break Premium (CA §226.7)',
    earningType: 'REGULAR_HOURLY',
    category: 'TAXABLE_WAGE',
    active: true,
    externalId: 'REST_PREMIUM',
  },
];

interface CliArgs {
  write: boolean;
  entity?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { write: false };
  for (const a of argv) {
    if (a === '--write') out.write = true;
    else if (a.startsWith('--entity=')) out.entity = a.slice('--entity='.length);
    else if (a === '--dry-run') out.write = false;
    else if (a) console.warn('[provisionCustomPayCodes] unknown flag:', a);
  }
  return out;
}

interface EntityResult {
  entityId: string;
  evereeTenantId?: string;
  codes: Array<{
    code: string;
    action: 'created' | 'skipped' | 'error';
    payCodeId?: number;
    error?: string;
  }>;
}

async function listC1EvereeEntities(): Promise<string[]> {
  const db = admin.firestore();
  const snap = await db.collection('tenants').doc(TENANT_ID).collection('entities').get();
  const enabled: string[] = [];
  snap.forEach((d) => {
    const data = d.data() ?? {};
    if (data.payrollProvider === 'everee' && data.evereeEnabled === true && data.evereeTenantId) {
      enabled.push(d.id);
    }
  });
  return enabled;
}

async function provisionForEntity(
  entityId: string,
  dryRun: boolean,
): Promise<EntityResult> {
  const config: EvereeEntityConfig | null = await getEvereeConfigForEntity(TENANT_ID, entityId);
  const result: EntityResult = {
    entityId,
    evereeTenantId: config?.evereeTenantId,
    codes: [],
  };
  if (!config) {
    result.codes.push({
      code: '*',
      action: 'error',
      error: 'getEvereeConfigForEntity returned null (entity missing or Everee disabled)',
    });
    return result;
  }

  for (const body of CUSTOM_PAY_CODES) {
    if (dryRun) {
      result.codes.push({ code: body.code, action: 'skipped' });
      continue;
    }
    try {
      const { payCode, created } = await ensureCustomPayCode(config, body);
      result.codes.push({
        code: body.code,
        action: created ? 'created' : 'skipped',
        payCodeId: payCode.id,
      });
    } catch (err) {
      result.codes.push({
        code: body.code,
        action: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

(async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log('═'.repeat(72));
  console.log('Provision C1 custom Everee pay codes');
  console.log('  tenant      :', TENANT_ID);
  console.log('  mode        :', args.write ? 'WRITE' : 'DRY RUN');
  console.log('  scope       :', args.entity ?? 'all C1 Everee-enabled entities');
  console.log('═'.repeat(72));

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'hrx1-d3beb' });
  }

  const entityIds = args.entity ? [args.entity] : await listC1EvereeEntities();
  if (entityIds.length === 0) {
    console.warn('No Everee-enabled C1 entities found. Nothing to do.');
    process.exit(0);
  }
  console.log(`Provisioning across ${entityIds.length} entity / entities: ${entityIds.join(', ')}\n`);

  const results: EntityResult[] = [];
  for (const eid of entityIds) {
    const r = await provisionForEntity(eid, !args.write);
    results.push(r);
    console.log(`\n[${eid}] evereeTenantId=${r.evereeTenantId ?? '?'}`);
    for (const c of r.codes) {
      const tag = c.action === 'created' ? '✓ CREATED' : c.action === 'skipped' ? '· skipped' : '✗ ERROR';
      console.log(`   ${tag}  ${c.code}  ${c.payCodeId ?? c.error ?? ''}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scratchDir = path.resolve(__dirname, '../../../../.scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const outPath = path.join(scratchDir, `provision-pay-codes-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        tenant: TENANT_ID,
        mode: args.write ? 'write' : 'dry-run',
        scope: args.entity ?? 'all',
        results,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`results → ${outPath}`);
  if (!args.write) console.log('DRY RUN — no API calls were issued. Re-run with --write to apply.');
  process.exit(0);
})().catch((err) => {
  console.error('[provisionCustomPayCodes] fatal:', err);
  process.exit(1);
});
