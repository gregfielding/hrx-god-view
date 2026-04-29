#!/usr/bin/env node
'use strict';

/**
 * R.4.2-F3 — CLI wrapper for the assignment status-spelling normalizer.
 *
 * Mirrors the loop, query, and report shape of
 * `functions/src/jobOrders/normalizeAssignmentStatusSpellingCallable.ts`,
 * but runs server-side with admin SDK creds (matching the R.0c / R.1 /
 * R.4.2 CLI pattern). The classifier (`shouldNormalizeAssignmentStatus`)
 * is single-sourced via the compiled functions output so the script
 * and the callable stay in lock-step.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * Service-account creds via `GOOGLE_APPLICATION_CREDENTIALS` (scratch
 * workflow). Bypasses the callable's `securityLevel >= 7` gate by design —
 * that gate is for end-user UI invocations.
 *
 * --------------------------------------------------------------------------
 * firebase-admin instance pinning gotcha (same as R.4.2 backfill script)
 * --------------------------------------------------------------------------
 * Resolve `firebase-admin` from `functions/node_modules` so the singleton
 * the compiled callable used at build time matches the one this script
 * initializes. If the script and the callable end up loading two different
 * `firebase-admin` instances, `admin.firestore()` inside the callable
 * returns an uninitialized stub.
 *
 * --------------------------------------------------------------------------
 * Prerequisites
 * --------------------------------------------------------------------------
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` exported.
 *   2. Functions built so the compiled bundle exists:
 *        cd functions && npm run build
 *   3. (Recommended) Run R.4.2 backfill first if any pre-R.1 legacy
 *      assignments are still in the tenant — that flow stamps
 *      hiringEntityId, this flow only normalizes status spelling.
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/normalizeAssignmentStatusSpelling.js \
 *     --tenant=<tenantId> \
 *     [--dry-run | --no-dry-run | --write] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>]
 *
 * Defaults: dry-run = TRUE, limit = 1000 (max 5000).
 *
 * --------------------------------------------------------------------------
 * Idempotency check (re-run after a successful `--write`)
 * --------------------------------------------------------------------------
 *   Expect: written === 0 AND
 *           skipped_already_canonical ≈ scanned AND
 *           errors === [].
 *   If a follow-up `--write` ever shows `written > 0`, an upstream
 *   write site is regenerating the old spelling — investigate
 *   immediately. As of R.4.2-F3 (2026-04-29) the cascade trigger
 *   (`shiftAssignmentCascades.ts`) was patched to emit `'cancelled'`,
 *   so the only remaining known regenerator is the phase2 UI
 *   `<MenuItem value="canceled">` literal in the assignment-status
 *   dropdown — see `docs/R4_2_FOLLOWUPS.md` §R.4.2-F3 for cleanup.
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object.
 *   stderr — one-line summary.
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0`.
 *   exit 2 — bad invocation (missing tenant, can't load helpers, etc.).
 */

const path = require('path');
const fs = require('fs');

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
      '  node scripts/normalizeAssignmentStatusSpelling.js \\',
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
      '  2. (recommended) Run R.4.2 legacy backfill first if needed.',
      '',
    ].join('\n'),
  );
}

function writeScratchReport(tenantId, report) {
  try {
    const scratchDir = path.resolve(__dirname, '..', '.scratch');
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `normalizeStatusSpelling-${tenantId}-${stamp}.txt`;
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

  let runNormalizeAssignmentStatusSpellingPage;
  try {
    const bundlePath = path.resolve(
      __dirname,
      '..',
      'functions',
      'lib',
      'jobOrders',
      'normalizeAssignmentStatusSpellingCallable.js',
    );
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`compiled file not found at ${bundlePath}`);
    }
    const mod = require(bundlePath);
    runNormalizeAssignmentStatusSpellingPage = mod && mod.runNormalizeAssignmentStatusSpellingPage;
    if (typeof runNormalizeAssignmentStatusSpellingPage !== 'function') {
      throw new Error('runNormalizeAssignmentStatusSpellingPage not exported from compiled output');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/jobOrders/normalizeAssignmentStatusSpellingCallable.js — ${err.message}\n` +
        'Run `cd functions && npm run build` first.\n',
    );
    process.exit(2);
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const fdb = admin.firestore();

  const report = await runNormalizeAssignmentStatusSpellingPage({
    tenantId: args.tenant,
    dryRun: args.dryRun,
    limit: args.limit,
    pageToken: args.pageToken,
    fdb,
  });

  writeScratchReport(args.tenant, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);

  const summary =
    `tenant=${report.tenantId} dryRun=${report.dryRun}` +
    ` scanned=${report.scanned}` +
    ` candidates=${report.candidates}` +
    ` written=${report.written}` +
    ` wouldWrite=${report.wouldWrite}` +
    ` skipped_already_canonical=${report.skipped_already_canonical}` +
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
