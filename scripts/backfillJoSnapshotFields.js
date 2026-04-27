#!/usr/bin/env node
'use strict';

/**
 * **R.16.1 Phase 4** — One-shot backfill of `jo.snapshot.*` for
 * already-active Job Orders that predate the §16.1 snapshot trigger.
 *
 * The deployed `onJobOrderStatusTransitionSnapshot` only fires on
 * draft→active transitions going forward. Every JO that was already
 * `open`/`on_hold`/`filled`/`completed` when §16.1 deployed is
 * missing `jo.snapshot.{...}`, which means downstream snapshot-aware
 * consumers (R.11 drift detection, R.16.2 read-side adopters, the
 * Push-to-Active "affected JO" preview) silently fall back to live
 * cascade reads on those JOs.
 *
 * This script closes that gap. For each active JO, it loads the
 * cascade chain and writes a `jo.snapshot.*` envelope — same code
 * path as the trigger. Idempotent: a JO that already has
 * `snapshot.capturedAt` is skipped (unless `--force`).
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
 *   Touch a JO IFF:
 *     - status NOT in {'draft', 'cancelled'} (status-skipped silently), AND
 *     - `snapshot.capturedAt` is missing OR --force is passed
 *
 * Status-skipped JOs do NOT produce audit entries. Already-snapshotted
 * skips DO produce a `cascadeAuditLog` row with
 * `action='snapshot_skipped'`, `skipKind='skip_already_snapshotted'`
 * so the run is auditable end-to-end.
 *
 * --------------------------------------------------------------------------
 * Ordering — do NOT skip
 * --------------------------------------------------------------------------
 *   1. Deploy the §16.1 functions bundle (`onJobOrderStatusTransitionSnapshot`,
 *      `backfillJoSnapshotFieldsCallable`, R.11 snapshot-aware update).
 *   2. THEN run this script.
 *
 * Running step 2 before step 1 leaves a window where a parallel JO
 * write could fire the (stale) trigger and overwrite the freshly
 * backfilled snapshot. Always confirm step 1 is live before
 * non-dry-run.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * `GOOGLE_APPLICATION_CREDENTIALS` (scratch workflow). Bypasses the
 * callable's security-level gate by design — that gate is for
 * end-user UI invocations.
 *
 * --------------------------------------------------------------------------
 * Prerequisites
 * --------------------------------------------------------------------------
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` exported.
 *   2. Functions built so the compiled output exists:
 *        cd functions && npm run build
 *      (Looks for `functions/lib/jobOrders/backfillJoSnapshotFieldsCallable.js`.)
 *   3. The §16.1 Cloud Functions deployed at the version that matches
 *      this script's compiled bundle. Confirm with a one-off probe
 *      before non-dry-run.
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/backfillJoSnapshotFields.js \
 *     --tenant=<tenantId> \
 *     [--dry-run | --no-dry-run] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>] \
 *     [--force]
 *
 * Defaults: --dry-run (true), --limit=1000 (max 5000), --force=false.
 *
 *   --force  Re-snapshot every JO regardless of whether it already
 *            carries `snapshot.capturedAt`. Use ONLY with explicit
 *            op approval — overwrites frozen financial / compliance
 *            fields. Each forced JO emits a warning log line and an
 *            audit row with `context: '...→... (forced)'`.
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object.
 *   stderr — one-line summary.
 *   .scratch/ — full report copy at
 *     `.scratch/backfillJoSnapshot-<tenant>-<ISO timestamp>.txt`.
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0`.
 *   exit 2 — bad invocation.
 *
 * --------------------------------------------------------------------------
 * Idempotency check (re-run after a successful `--no-dry-run`)
 * --------------------------------------------------------------------------
 *   Expect:
 *     buckets.snapshotted === 0 AND
 *     buckets.skipped_already_snapshotted ≈ scanned − buckets.skipped_status AND
 *     errors === [].
 *   If a follow-up `--no-dry-run` shows `snapshotted > 0` despite the
 *   deployed trigger being §16.1-aware, something is rewriting
 *   snapshots back to a missing-capturedAt shape. Flag immediately.
 *
 * --------------------------------------------------------------------------
 * Pagination contract
 * --------------------------------------------------------------------------
 *   The script processes ONE page per invocation. When the report's
 *   `truncated` is `true`, re-invoke with the returned `nextPageToken`:
 *
 *     # First page
 *     node scripts/backfillJoSnapshotFields.js --tenant=T --no-dry-run
 *     #=> ... nextPageToken=jo_abc123
 *
 *     # Subsequent pages
 *     node scripts/backfillJoSnapshotFields.js --tenant=T --no-dry-run \
 *       --page-token=jo_abc123
 *
 *   Loop until `truncated=false` and `nextPageToken=null`. Same
 *   pattern as `refreshAssignmentReadinessSnapshotV1.js` (R.7).
 */

const path = require('path');
const fs = require('fs');

// ───────────────────────────────────────────────────────────────────────────
// firebase-admin instance pinning
// ───────────────────────────────────────────────────────────────────────────
// The compiled callable resolves `require('firebase-admin')` from
// `functions/node_modules/firebase-admin` (Node walks up from the
// compiled file's location). The repo root has its own copy at a
// different major version. If we don't force the same instance both
// paths use, server-timestamp sentinels created by the bundle are
// rejected by the script's Firestore client. See R.7 for the full
// post-mortem on this gotcha.
const admin = require(
  path.resolve(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'),
);

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing — mirrors refreshAssignmentReadinessSnapshotV1.js (R.7).
// ───────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    tenant: null,
    dryRun: true,
    limit: DEFAULT_LIMIT,
    pageToken: null,
    force: false,
    help: false,
  };

  const consumed = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    if (consumed.has(i)) continue;
    const tok = argv[i];

    if (tok === '--help' || tok === '-h') { out.help = true; continue; }
    if (tok === '--dry-run') { out.dryRun = true; continue; }
    if (tok === '--no-dry-run') { out.dryRun = false; continue; }
    if (tok === '--write') { out.dryRun = false; continue; } // alias
    if (tok === '--force') { out.force = true; continue; }

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
    case 'force':
      out.force = !/^(false|0|no)$/i.test(value.trim());
      return;
    default:
      throw new Error(`Unknown flag: --${key}`);
  }
}

function printUsage(stream) {
  stream.write(
    [
      'Usage:',
      '  node scripts/backfillJoSnapshotFields.js \\',
      '    --tenant=<tenantId> \\',
      '    [--dry-run | --no-dry-run | --write] \\',
      '    [--limit=1000] \\',
      '    [--page-token=<from-prior-response>] \\',
      '    [--force]',
      '',
      'Defaults: --dry-run (true), --limit=1000 (max 5000), --force=false.',
      '',
      'Required env:',
      '  GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json',
      '',
      'Prereqs:',
      '  1. cd functions && npm run build',
      '  2. §16.1 Cloud Functions deployed (onJobOrderStatusTransitionSnapshot etc.)',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// .scratch/ report writer (required by the runbook §3 dry-run review).
// ───────────────────────────────────────────────────────────────────────────

function writeScratchReport(tenantId, report) {
  try {
    const scratchDir = path.resolve(__dirname, '..', '.scratch');
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backfillJoSnapshot-${tenantId}-${stamp}.txt`;
    const filepath = path.join(scratchDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    process.stderr.write(`Report written to ${filepath}\n`);
  } catch (err) {
    process.stderr.write(
      `Warning: failed to write .scratch report — ${err && err.message ? err.message : err}\n`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

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

  if (args.force && args.dryRun === false) {
    process.stderr.write(
      'WARNING: --force --no-dry-run will OVERWRITE frozen jo.snapshot envelopes for already-active JOs.\n' +
        '         This is the §16.1 L7 explicit-override path. Audit rows will be tagged "(forced)".\n',
    );
  }

  // Load the same `runBackfillPage` the deployed callable uses,
  // single-sourced via the compiled functions output. If the bundle
  // is missing, prompt the operator to build first.
  let runBackfillPage;
  try {
    const bundlePath = path.resolve(
      __dirname,
      '..',
      'functions',
      'lib',
      'jobOrders',
      'backfillJoSnapshotFieldsCallable.js',
    );
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`compiled file not found at ${bundlePath}`);
    }
    const mod = require(bundlePath);
    runBackfillPage = mod && mod.runBackfillPage;
    if (typeof runBackfillPage !== 'function') {
      throw new Error('runBackfillPage not exported from compiled output');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/jobOrders/backfillJoSnapshotFieldsCallable.js — ${err.message}\n` +
        'Run `cd functions && npm run build` first.\n',
    );
    process.exit(2);
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const fdb = admin.firestore();

  const report = await runBackfillPage({
    tenantId: args.tenant,
    dryRun: args.dryRun,
    limit: args.limit,
    pageToken: args.pageToken,
    force: args.force,
    fdb,
  });

  // Always write the report to .scratch/ regardless of dry-run vs.
  // write — the runbook §3 step requires eyeballing the dry-run
  // report from the file, and post-write reports are useful for
  // confirming `snapshotted` ≈ `wouldSnapshot` parity.
  writeScratchReport(args.tenant, report);

  process.stdout.write(`${JSON.stringify(report)}\n`);

  const b = report.buckets;
  const summary =
    `tenant=${report.tenantId} dryRun=${report.dryRun} force=${report.force}` +
    ` scanned=${report.scanned}` +
    ` skipped_status=${b.skipped_status}` +
    ` skipped_already_snapshotted=${b.skipped_already_snapshotted}` +
    ` would_snapshot=${b.would_snapshot} would_snapshot_forced=${b.would_snapshot_forced}` +
    ` snapshotted=${b.snapshotted} snapshotted_forced=${b.snapshotted_forced}` +
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
