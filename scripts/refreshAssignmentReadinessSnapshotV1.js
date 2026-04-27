#!/usr/bin/env node
'use strict';

/**
 * R.4 chip-stuck remediation — one-time refresh of `readinessSnapshotV1` for
 * legacy assignments whose snapshots predate R.4 (`jobReadinessChip` field
 * absent or stuck in `'computing'` state).
 *
 * Established pattern for any future `readinessSnapshotV1` field migration —
 * see `docs/READINESS_R7_HANDOFF.md` § "Post-deploy chip-stuck investigation"
 * for the full runbook (Deploy → Backfill → Snapshot-refresh order, gcloud
 * verification step, bucketing helper, follow-up tracking).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CRITICAL GOTCHA — read before copying this script as a template          ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ The repo ships TWO copies of `firebase-admin`:                           ║
 * ║   • root `node_modules/firebase-admin`        — 13.x                     ║
 * ║   • `functions/node_modules/firebase-admin`   — 11.x                     ║
 * ║                                                                          ║
 * ║ The esbuild bundle this script invokes was built with                    ║
 * ║ `--external:firebase-admin`, so at runtime it resolves                   ║
 * ║ `require('firebase-admin')` from `functions/node_modules`. If an ops     ║
 * ║ script naively does `require('firebase-admin')` from the repo root,     ║
 * ║ it gets the 13.x copy, the bundle gets the 11.x copy, and any SDK        ║
 * ║ sentinel created by the bundle (e.g. `FieldValue.serverTimestamp()`) is  ║
 * ║ rejected by the script's Firestore client as a foreign-prototype         ║
 * ║ `ServerTimestampTransform`. The error message is opaque, so this bites   ║
 * ║ silently. See the explicit `path.resolve(...)` import below.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * --------------------------------------------------------------------------
 * Why this exists
 * --------------------------------------------------------------------------
 * `syncHrxReadinessSnapshotV1` only fires when its inputs change. Assignments
 * created before R.4 shipped (and not touched since) never get their snapshot
 * rewritten, so the snapshot doc is missing `jobReadinessChip`. The R.7
 * placement-tile listener falls back to `'computing'` and spins forever.
 *
 * This script invokes the SAME `recomputeHrxReadinessSnapshotForAssignment`
 * function the deployed trigger uses (loaded via the local esbuild bundle at
 * `functions/lib/readiness/syncHrxReadinessSnapshotV1.cjs`), so the rewritten
 * snapshot shape is single-sourced with the trigger.
 *
 * --------------------------------------------------------------------------
 * Ordering — do NOT skip
 * --------------------------------------------------------------------------
 *   1. Deploy the readiness Cloud Function bundle (so the trigger writes the
 *      same shape as this script).
 *   2. Run R.1 backfill (severity / resolutionMethod) — completes the inputs
 *      this script reads back.
 *   3. THEN run this script.
 *
 * Running step 3 before step 1 is wasted work: a subsequent assignment write
 * fires the deployed (stale) trigger and overwrites the good snapshot with
 * the pre-R.4 shape. Always confirm step 1 is live before non-dry-run.
 *
 * --------------------------------------------------------------------------
 * Selection rule
 * --------------------------------------------------------------------------
 *   Touch an assignment IFF any of:
 *     - `readinessSnapshotV1` field is missing on the assignment doc, OR
 *     - `readinessSnapshotV1.jobReadinessChip` is missing, OR
 *     - `readinessSnapshotV1.jobReadinessChip.state === 'computing'`.
 *   Else skip — the assignment is already current.
 *
 * `recomputeHrxReadinessSnapshotForAssignment` is internally idempotent
 * (skips the write when the comparable JSON is unchanged), so accidentally
 * touching an up-to-date assignment is a no-op write — but the read+compute
 * still costs Firestore reads, so we pre-filter.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * `GOOGLE_APPLICATION_CREDENTIALS` (scratch workflow). Bypasses the callable's
 * `assertCanManageAssignmentsForTenant` gate by design — that gate is for
 * end-user UI invocations.
 *
 * --------------------------------------------------------------------------
 * Prerequisites
 * --------------------------------------------------------------------------
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` exported.
 *   2. Functions built so the esbuild bundle exists:
 *        cd functions && npm run build:hrx-readiness-snapshot
 *      (or full `npm run build` — same effect)
 *   3. Cloud Function `syncHrxReadinessSnapshotV1` (and the readiness write
 *      triggers) deployed at the R.4-aware version. Confirm with a one-off
 *      probe before non-dry-run.
 *   4. R.1 backfill (`scripts/backfillAssignmentReadinessItems.js`) run with
 *      `--no-dry-run` for the same tenant.
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/refreshAssignmentReadinessSnapshotV1.js \
 *     --tenant=<tenantId> \
 *     [--dry-run | --no-dry-run] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>] \
 *     [--force]
 *
 * Defaults: --dry-run (true), --limit=1000 (max 5000), --force=false.
 *
 *   --force  Recompute every assignment in the page regardless of whether
 *            the chip looks current. Use only if you suspect the selection
 *            rule is leaving assignments behind. The recompute itself is
 *            still idempotent so the worst case is wasted reads.
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object.
 *   stderr — one-line summary.
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0`.
 *   exit 2 — bad invocation.
 *
 * --------------------------------------------------------------------------
 * Idempotency check (re-run after a successful `--no-dry-run`)
 * --------------------------------------------------------------------------
 *   Expect:
 *     candidates === 0 AND
 *     written === 0 AND
 *     skipped_already_current ≈ scanned AND
 *     errors === [].
 *   If a follow-up `--no-dry-run` shows `written > 0` despite the deployed
 *   trigger being R.4-aware, something is rewriting snapshots back to the
 *   stale shape. Flag immediately.
 */

const path = require('path');

// ───────────────────────────────────────────────────────────────────────────
// firebase-admin instance pinning
// ───────────────────────────────────────────────────────────────────────────
// The esbuild bundle at `functions/lib/readiness/syncHrxReadinessSnapshotV1.cjs`
// was built with `--external:firebase-admin`, so at runtime it resolves
// `require('firebase-admin')` from `functions/node_modules/firebase-admin`
// (Node walks up from the bundle's location). The repo root has its OWN
// `node_modules/firebase-admin` at a different major version (13.x at root,
// 11.x in functions). If the script naively did `require('firebase-admin')`
// it'd get the root copy, the bundle would get the functions copy, and any
// SDK sentinel (e.g. `FieldValue.serverTimestamp()`) created by the bundle
// would be rejected by the script's Firestore client as a foreign-prototype
// `ServerTimestampTransform`.
//
// Force both paths through the SAME `firebase-admin` instance the bundle
// loads. This is the simplest fix; the alternative (deduping the trees) is
// out of scope for an ops script.
const admin = require(
  path.resolve(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'),
);

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const RECOMPUTE_CONCURRENCY = 5;

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing — same shape as backfillAssignmentReadinessItems.js.
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
      '  node scripts/refreshAssignmentReadinessSnapshotV1.js \\',
      '    --tenant=<tenantId> \\',
      '    [--dry-run | --no-dry-run] \\',
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
      '  1. cd functions && npm run build:hrx-readiness-snapshot',
      '  2. Cloud Function syncHrxReadinessSnapshotV1 deployed at R.4 version.',
      '  3. node scripts/backfillAssignmentReadinessItems.js --tenant=<tenant> --no-dry-run',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Selection rule — encoded inline so the dry-run report is fully self-
// describing (no need to compute the next snapshot just to decide).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Inspect the existing `readinessSnapshotV1` and bucket the assignment.
 * Returns one of:
 *   - 'missing_snapshot'
 *   - 'missing_chip'
 *   - 'chip_computing'
 *   - 'current'
 */
function classifyAssignment(assignmentData) {
  const snap = assignmentData && assignmentData.readinessSnapshotV1;
  if (!snap || typeof snap !== 'object') return 'missing_snapshot';
  const chip = snap.jobReadinessChip;
  if (!chip || typeof chip !== 'object') return 'missing_chip';
  if (chip.state === 'computing') return 'chip_computing';
  return 'current';
}

// ───────────────────────────────────────────────────────────────────────────
// Per-assignment processor.
// ───────────────────────────────────────────────────────────────────────────

async function processOne({
  db,
  recompute,
  tenantId,
  assignmentDoc,
  dryRun,
  force,
}) {
  const data = assignmentDoc.data() || {};
  const classification = classifyAssignment(data);

  if (!force && classification === 'current') {
    return { outcome: 'skipped_already_current', classification };
  }

  if (dryRun) {
    return { outcome: 'would_recompute', classification };
  }

  const result = await recompute(db, tenantId, assignmentDoc.id);
  if (result.missingAssignment) {
    return { outcome: 'missing_assignment', classification };
  }
  if (result.skipped) {
    return { outcome: 'recompute_no_change', classification };
  }
  return { outcome: 'recompute_wrote', classification };
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

  // Load the same recompute function the deployed trigger uses. Single-
  // sourced via the esbuild bundle so the rewritten snapshot shape is
  // guaranteed to match.
  let recompute;
  try {
    const bundlePath = path.resolve(
      __dirname,
      '..',
      'functions',
      'lib',
      'readiness',
      'syncHrxReadinessSnapshotV1.cjs',
    );
    const mod = require(bundlePath);
    recompute = mod && mod.recomputeHrxReadinessSnapshotForAssignment;
    if (typeof recompute !== 'function') {
      throw new Error('recomputeHrxReadinessSnapshotForAssignment not exported');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/readiness/syncHrxReadinessSnapshotV1.cjs — ${err.message}\n` +
        'Run `cd functions && npm run build:hrx-readiness-snapshot` first.\n',
    );
    process.exit(2);
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let assignmentsQuery = db
    .collection(`tenants/${args.tenant}/assignments`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(args.limit);
  if (args.pageToken) assignmentsQuery = assignmentsQuery.startAfter(args.pageToken);

  const assignments = await assignmentsQuery.get();

  const report = {
    tenantId: args.tenant,
    dryRun: args.dryRun,
    force: args.force,
    limit: args.limit,
    scanned: assignments.size,
    candidates: 0,
    written: 0,
    wouldWrite: 0,
    skipped_already_current: 0,
    recompute_no_change: 0,
    missing_assignment: 0,
    classificationBreakdown: {
      missing_snapshot: 0,
      missing_chip: 0,
      chip_computing: 0,
      current: 0,
    },
    errors: [],
    truncated: assignments.size === args.limit,
    nextPageToken:
      assignments.size === args.limit
        ? assignments.docs[assignments.docs.length - 1].id
        : null,
  };

  for (let i = 0; i < assignments.docs.length; i += RECOMPUTE_CONCURRENCY) {
    const chunk = assignments.docs.slice(i, i + RECOMPUTE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (assignmentDoc) => {
        try {
          const result = await processOne({
            db,
            recompute,
            tenantId: args.tenant,
            assignmentDoc,
            dryRun: args.dryRun,
            force: args.force,
          });
          return { ok: true, assignmentId: assignmentDoc.id, result };
        } catch (err) {
          return {
            ok: false,
            assignmentId: assignmentDoc.id,
            error: err && err.message ? err.message : String(err),
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ assignmentId: item.assignmentId, error: item.error });
        continue;
      }
      const { outcome, classification } = item.result;
      report.classificationBreakdown[classification] += 1;
      switch (outcome) {
        case 'skipped_already_current':
          report.skipped_already_current += 1;
          break;
        case 'would_recompute':
          report.candidates += 1;
          report.wouldWrite += 1;
          break;
        case 'recompute_wrote':
          report.candidates += 1;
          report.written += 1;
          break;
        case 'recompute_no_change':
          // The script's selection rule said "needs refresh" but the recompute
          // function's idempotency check disagreed — usually because the
          // snapshot's chip-less shape is already JSON-equal to what the
          // R.4 builder produces (e.g. no items at all, no chip emitted).
          // Counted separately so the discrepancy is visible.
          report.candidates += 1;
          report.recompute_no_change += 1;
          break;
        case 'missing_assignment':
          // recompute returned `missingAssignment: true` — the assignment
          // doc is structurally broken (missing workerUid, etc.). Counted
          // separately rather than treated as an error so a noisy tenant
          // doesn't fail the whole run.
          report.missing_assignment += 1;
          break;
        default:
          report.errors.push({
            assignmentId: item.assignmentId,
            error: `unknown outcome: ${String(outcome)}`,
          });
      }
    }
  }

  process.stdout.write(`${JSON.stringify(report)}\n`);

  const cb = report.classificationBreakdown;
  const summary =
    `tenant=${report.tenantId} dryRun=${report.dryRun} force=${report.force}` +
    ` scanned=${report.scanned} candidates=${report.candidates}` +
    ` wouldWrite=${report.wouldWrite} written=${report.written}` +
    ` recompute_no_change=${report.recompute_no_change}` +
    ` skipped_already_current=${report.skipped_already_current}` +
    ` missing_assignment=${report.missing_assignment}` +
    ` cls[missing_snapshot=${cb.missing_snapshot}` +
    ` missing_chip=${cb.missing_chip}` +
    ` chip_computing=${cb.chip_computing}` +
    ` current=${cb.current}]` +
    ` errors=${report.errors.length} truncated=${report.truncated}` +
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
