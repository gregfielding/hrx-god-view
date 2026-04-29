#!/usr/bin/env node
'use strict';

/**
 * **R.4.2 — Legacy Assignment Backfill** — One-shot ops script that
 * fixes pre-R.1 assignments stuck on the `'legacy_review'` chip.
 *
 * Two-stage data-only repair (single-sourced via the compiled Cloud
 * Function bundle — same pattern as `scripts/backfillJoSnapshotFields.js`
 * for R.16.1):
 *
 *   Stage A — stamp `assignment.hiringEntityId`. Resolution path tries
 *             the JO chain first (parity with the read-time chip
 *             helper), then falls back to the worker's
 *             `entity_employments`, then fails as 'unresolved' (which
 *             produces a per-assignment audit row + leaves the chip
 *             on `'legacy_review'` so an operator can investigate).
 *
 *   Stage B — re-run the standard auto-seed pipeline via the shared
 *             `seedReadinessForExistingAssignment` helper. Idempotent
 *             — re-runs of fully-fixed assignments report
 *             `stage_a_only_stage_b_no_op` (renamed from
 *             `skipped_already_complete` per R.4.2-F1, 2026-04-29; pre-
 *             2026-04-29 audit rows in `cascadeAuditLog` may carry the
 *             old label).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CRITICAL GOTCHA — read before copying this script as a template          ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ The repo ships TWO copies of `firebase-admin`:                           ║
 * ║   • root `node_modules/firebase-admin`        — 13.x                     ║
 * ║   • `functions/node_modules/firebase-admin`   — 11.x                     ║
 * ║                                                                          ║
 * ║ The compiled functions code under `functions/lib/...` resolves           ║
 * ║ `require('firebase-admin')` from `functions/node_modules`. If this       ║
 * ║ script naively does `require('firebase-admin')` from the repo root,     ║
 * ║ it gets the 13.x copy, the bundle gets the 11.x copy, and any SDK        ║
 * ║ sentinel created by the bundle (e.g. `FieldValue.serverTimestamp()`) is  ║
 * ║ rejected by the script's Firestore client as a foreign-prototype         ║
 * ║ `ServerTimestampTransform`. The error message is opaque, so this bites   ║
 * ║ silently. See the explicit `path.resolve(...)` import below.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * --------------------------------------------------------------------------
 * Selection rule
 * --------------------------------------------------------------------------
 *   Page driver pre-filter: assignments whose `hiringEntityId` is already
 *   set AND that have at least one `assignmentReadinessItems` row are
 *   counted as `preFilteredFullyHealthy` and skipped. Everything else
 *   enters the Stage A + Stage B pipeline.
 *
 * --------------------------------------------------------------------------
 * Ordering — do NOT skip
 * --------------------------------------------------------------------------
 *   1. Run `node .scratch/bucketR8ComputingChip.js > .scratch/r4_2-preflight-<iso>.json`
 *      to confirm the candidate population matches the brief.
 *   2. `cd functions && npm run build` so the compiled bundle exists.
 *   3. Deploy `backfillLegacyAssignmentsCallable` AND the refactored
 *      `onAssignmentCreatedAutoSeedReadiness` trigger together — the
 *      trigger now delegates to the same shared helper this script
 *      drives, so deploying them out of order leaves a window where
 *      the trigger fires the OLD inline pipeline while the script
 *      drives the NEW shared one (functionally identical, but ops
 *      will see a brief log-shape inconsistency).
 *   4. THEN run this script — dry-run first, eyeball the report,
 *      then `--write`, then re-run dry-run to confirm idempotency.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * `GOOGLE_APPLICATION_CREDENTIALS` (scratch workflow). Bypasses the
 * callable's security-level gate by design — that gate is for end-user
 * UI invocations.
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/backfillLegacyAssignmentsR4_2.js \
 *     --tenant=<tenantId> \
 *     [--dry-run | --no-dry-run | --write] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>]
 *
 * Defaults: --dry-run (true), --limit=1000 (max 5000).
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object.
 *   stderr — one-line summary.
 *   .scratch/ — full report copy at
 *     `.scratch/backfillLegacyR4_2-<tenant>-<ISO timestamp>.txt`.
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0`.
 *   exit 2 — bad invocation.
 *
 * --------------------------------------------------------------------------
 * Idempotency check (re-run after a successful `--write`)
 * --------------------------------------------------------------------------
 *   Expect:
 *     buckets.stamped_and_seeded === 0 AND
 *     buckets.stamped_only === 0 AND
 *     buckets.stage_a_only_stage_b_no_op ≈ candidatesProcessed - manualQueue.length AND
 *     errors === [].
 *   If a follow-up `--write` shows `stamped_and_seeded > 0`, something is
 *   re-clearing `hiringEntityId` after the backfill. Flag immediately.
 *
 * --------------------------------------------------------------------------
 * Manual queue
 * --------------------------------------------------------------------------
 *   `report.manualQueue` lists every assignment that hit
 *   `skipped_unresolvable_hiring_entity_id`. The R.4.3 `'legacy_review'`
 *   chip is the operator-facing surface — these entries stay gray until
 *   their underlying data is fixed (worker enrolled in an entity, JO
 *   linked to an account with a hiringEntityId, etc.).
 *
 * --------------------------------------------------------------------------
 * Pagination contract
 * --------------------------------------------------------------------------
 *   The script processes ONE page per invocation. When the report's
 *   `truncated` is `true`, re-invoke with the returned `nextPageToken`.
 *   For the BCiP one-shot the default 1000-row limit covers the entire
 *   ~29-row population in a single call.
 */

const path = require('path');
const fs = require('fs');

// firebase-admin instance pinning — see the gotcha block above.
const admin = require(
  path.resolve(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'),
);

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

function parseArgs(argv) {
  const out = {
    tenant: null,
    dryRun: true,
    limit: DEFAULT_LIMIT,
    pageToken: null,
    help: false,
  };

  const consumed = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    if (consumed.has(i)) continue;
    const tok = argv[i];

    if (tok === '--help' || tok === '-h') { out.help = true; continue; }
    if (tok === '--dry-run') { out.dryRun = true; continue; }
    if (tok === '--no-dry-run') { out.dryRun = false; continue; }
    if (tok === '--write') { out.dryRun = false; continue; }

    const eqMatch = /^--([a-zA-Z][a-zA-Z0-9-]*)=(.*)$/.exec(tok);
    if (eqMatch) { assignKv(out, eqMatch[1], eqMatch[2]); continue; }

    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        assignKv(out, key, next);
        consumed.add(i + 1);
        continue;
      }
      throw new Error(`Unknown flag: ${tok}`);
    }
    throw new Error(`Unexpected positional argument: ${tok}`);
  }
  return out;
}

function assignKv(out, key, value) {
  switch (key) {
    case 'tenant':
    case 'tenant-id':
    case 'tenantId':
      out.tenant = value.trim();
      return;
    case 'limit': {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit must be a positive integer (got ${value})`);
      }
      out.limit = Math.min(n, MAX_LIMIT);
      return;
    }
    case 'page-token':
    case 'pageToken':
      out.pageToken = value.trim() || null;
      return;
    case 'dry-run':
      out.dryRun = !/^(false|0|no)$/i.test(value.trim());
      return;
    default:
      throw new Error(`Unknown flag: --${key}`);
  }
}

function printUsage(stream) {
  stream.write(
    [
      'Usage:',
      '  node scripts/backfillLegacyAssignmentsR4_2.js \\',
      '    --tenant=<tenantId> \\',
      '    [--dry-run | --no-dry-run | --write] \\',
      '    [--limit=1000] \\',
      '    [--page-token=<from-prior-response>]',
      '',
      'Defaults: --dry-run (true), --limit=1000 (max 5000).',
      '',
      'Required env:',
      '  GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json',
      '',
      'Prereqs:',
      '  1. cd functions && npm run build',
      '  2. R.4.2 Cloud Functions deployed (backfillLegacyAssignmentsCallable',
      '     + the refactored onAssignmentCreatedAutoSeedReadiness trigger).',
      '',
    ].join('\n'),
  );
}

function writeScratchReport(tenantId, report) {
  try {
    const scratchDir = path.resolve(__dirname, '..', '.scratch');
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backfillLegacyR4_2-${tenantId}-${stamp}.txt`;
    const filepath = path.join(scratchDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    process.stderr.write(`Report written to ${filepath}\n`);
  } catch (err) {
    process.stderr.write(
      `Warning: failed to write .scratch report — ${err && err.message ? err.message : err}\n`,
    );
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n`);
    printUsage(process.stderr);
    process.exit(2);
  }
  if (args.help) { printUsage(process.stdout); process.exit(0); }

  if (!args.tenant) {
    process.stderr.write('Error: --tenant is required.\n\n');
    printUsage(process.stderr);
    process.exit(2);
  }

  let runBackfillLegacyAssignmentsPage;
  try {
    const bundlePath = path.resolve(
      __dirname,
      '..',
      'functions',
      'lib',
      'jobOrders',
      'backfillLegacyAssignmentsCallable.js',
    );
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`compiled file not found at ${bundlePath}`);
    }
    const mod = require(bundlePath);
    runBackfillLegacyAssignmentsPage = mod && mod.runBackfillLegacyAssignmentsPage;
    if (typeof runBackfillLegacyAssignmentsPage !== 'function') {
      throw new Error('runBackfillLegacyAssignmentsPage not exported from compiled output');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/jobOrders/backfillLegacyAssignmentsCallable.js — ${err.message}\n` +
        'Run `cd functions && npm run build` first.\n',
    );
    process.exit(2);
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const fdb = admin.firestore();

  const report = await runBackfillLegacyAssignmentsPage({
    tenantId: args.tenant,
    dryRun: args.dryRun,
    limit: args.limit,
    pageToken: args.pageToken,
    fdb,
  });

  writeScratchReport(args.tenant, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);

  const b = report.buckets;
  const summary =
    `tenant=${report.tenantId} dryRun=${report.dryRun}` +
    ` scanned=${report.scanned}` +
    ` candidatesProcessed=${report.candidatesProcessed}` +
    ` preFilteredFullyHealthy=${report.preFilteredFullyHealthy}` +
    ` would_stamp_and_seed=${b.would_stamp_and_seed}` +
    ` would_stamp_only=${b.would_stamp_only}` +
    ` would_skip_already_complete=${b.would_skip_already_complete}` +
    ` would_skip_unresolvable=${b.would_skip_unresolvable_hiring_entity_id}` +
    ` stamped_and_seeded=${b.stamped_and_seeded}` +
    ` stamped_only=${b.stamped_only}` +
    ` stamped_only_seed_failed=${b.stamped_only_seed_failed}` +
    ` stage_a_only_stage_b_no_op=${b.stage_a_only_stage_b_no_op}` +
    ` skipped_unresolvable=${b.skipped_unresolvable_hiring_entity_id}` +
    ` errors=${report.errors.length} truncated=${report.truncated}` +
    ` durationMs=${report.durationMs}` +
    ` nextPageToken=${report.nextPageToken || ''}\n`;
  process.stderr.write(summary);

  if (report.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `Fatal: ${(err && err.stack) || (err && err.message) || String(err)}\n`,
  );
  process.exit(1);
});
