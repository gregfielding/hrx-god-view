#!/usr/bin/env node
'use strict';

/**
 * R.0c — CLI wrapper for the workerAttestations backfill.
 *
 * Mirrors the loop, query, and report shape of
 * `functions/src/backfillWorkerAttestationsCallable.ts`, but runs server-side
 * with admin SDK creds (matching the existing `scripts/backfill*.{ts,js}`
 * pattern). The profile-wins-once-set (D2) filter is kept single-sourced —
 * we import `buildAttestationsSyncPatchFromApplication` from the compiled
 * functions output so the script and the callable share patch logic byte for
 * byte.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * Service-account creds via `GOOGLE_APPLICATION_CREDENTIALS` (the existing
 * scratch workflow shell export). Bypasses the callable's `securityLevel >= 7`
 * gate by design — that gate is for end-user invocations from the UI; an
 * operator running this script with SA creds is the offline equivalent.
 *
 * --------------------------------------------------------------------------
 * Prerequisites
 * --------------------------------------------------------------------------
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` exported (~/.config/gcloud-claude/service-account.json).
 *   2. Functions built so that `functions/lib/triggers/onApplicationSubmittedSyncProfile.js` exists:
 *        cd functions && npm run build
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/backfillWorkerAttestations.js \
 *     --tenant=<tenantId> \
 *     [--dry-run | --no-dry-run] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>]
 *
 * Defaults: dry-run = TRUE, limit = 1000 (max 5000).
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object (machine-parseable).
 *   stderr — one-line summary (`tenant=… dryRun=… scanned=…`).
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0` (real failures during processing).
 *   exit 2 — bad invocation (missing tenant, can't load helpers, etc.).
 *
 * --------------------------------------------------------------------------
 * Idempotency check (re-run #3 after a successful `--no-dry-run`)
 * --------------------------------------------------------------------------
 *   Expect: written === 0 AND
 *           skipped_profile_already_set ≈ candidates from prior run AND
 *           errors === [].
 *   If a follow-up `--no-dry-run` ever shows `written > 0`, the D2 filter let
 *   something through twice — flag immediately.
 */

const admin = require('firebase-admin');

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WRITE_CONCURRENCY = 10;

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing — supports `--key=value`, `--key value`, `--flag`.
// ───────────────────────────────────────────────────────────────────────────

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

    if (tok === '--help' || tok === '-h') {
      out.help = true;
      continue;
    }
    if (tok === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (tok === '--no-dry-run') {
      out.dryRun = false;
      continue;
    }

    // `--key=value`
    const eqMatch = /^--([a-zA-Z][a-zA-Z0-9-]*)=(.*)$/.exec(tok);
    if (eqMatch) {
      assignKv(out, eqMatch[1], eqMatch[2]);
      continue;
    }

    // `--key value`
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        assignKv(out, key, next);
        consumed.add(i + 1);
        continue;
      }
      // Unknown bare flag — flag it.
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
      // Allow `--dry-run=false` style as well.
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
      '  node scripts/backfillWorkerAttestations.js \\',
      '    --tenant=<tenantId> \\',
      '    [--dry-run | --no-dry-run] \\',
      '    [--limit=1000] \\',
      '    [--page-token=<from-prior-response>]',
      '',
      'Defaults: --dry-run (true), --limit=1000 (max 5000).',
      '',
      'Required env:',
      '  GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json',
      '',
      'Prereq: build functions so the helper module exists:',
      '  cd functions && npm run build',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Application-doc helpers — duplicated from the callable (small, internal,
// not currently exported). Keep behavior in lock-step with the callable.
// ───────────────────────────────────────────────────────────────────────────

function pickUidFromApplication(app) {
  if (typeof app.userId === 'string' && app.userId.trim().length > 0) return app.userId;
  if (typeof app.workerId === 'string' && app.workerId.trim().length > 0) return app.workerId;
  if (typeof app.uid === 'string' && app.uid.trim().length > 0) return app.uid;
  return null;
}

function appHasBeenSubmitted(app) {
  return app.submittedAt !== undefined && app.submittedAt !== null;
}

function pickAttestedAtFromApplication(app) {
  const candidates = ['submittedAt', 'appliedAt', 'createdAt'];
  for (const key of candidates) {
    const value = app[key];
    if (value instanceof admin.firestore.Timestamp) return value;
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return admin.firestore.FieldValue.serverTimestamp();
}

// ───────────────────────────────────────────────────────────────────────────
// Per-application processor — mirrors the callable's `processOneApplication`.
// ───────────────────────────────────────────────────────────────────────────

async function processOne({ db, appId, appData, dryRun, buildPatch }) {
  if (!appHasBeenSubmitted(appData)) {
    return { outcome: 'skipped_unsubmitted', fieldsWritten: 0 };
  }

  const uid = pickUidFromApplication(appData);
  if (!uid) return { outcome: 'skipped_no_uid', fieldsWritten: 0 };

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return { outcome: 'skipped_user_doc_missing', fieldsWritten: 0 };
  }

  const existingAttestations =
    ((userSnap.data() || {}).workerAttestations) || {};
  const attestedAt = pickAttestedAtFromApplication(appData);

  const patch = buildPatch({
    applicationDoc: appData,
    existingAttestations,
    source: 'application_backfill',
    attestedAt,
  });

  if (Object.keys(patch).length === 0) {
    return { outcome: 'skipped_profile_already_set', fieldsWritten: 0 };
  }

  if (!dryRun) {
    // CRITICAL: Use `update()`, NOT `set(..., { merge: true })`.
    //
    // The Admin SDK does NOT interpret dotted-string keys as field paths
    // under set/merge — it writes them as LITERAL top-level field names with
    // embedded dots. Only `update()` treats dotted strings as field paths.
    // (The Web Client SDK has the opposite semantic, hence the original
    // pattern-match bug.) `userSnap.exists` was confirmed above so `update()`
    // is safe.
    //
    // See: docs/READINESS_R0_HANDOFF.md (post-mortem, Apr 26 2026).
    await userRef.update(patch);
    return { outcome: 'wrote', fieldsWritten: Object.keys(patch).length };
  }
  return { outcome: 'would_write', fieldsWritten: Object.keys(patch).length };
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n`);
    printUsage(process.stderr);
    process.exit(2);
  }

  if (args.help) {
    printUsage(process.stdout);
    process.exit(0);
  }

  if (!args.tenant) {
    process.stderr.write('Error: --tenant is required.\n\n');
    printUsage(process.stderr);
    process.exit(2);
  }

  // Lazy-load compiled functions helper — single source of truth for the D2 filter.
  let buildPatch;
  try {
    const mod = require('../functions/lib/triggers/onApplicationSubmittedSyncProfile');
    buildPatch = mod && mod.buildAttestationsSyncPatchFromApplication;
    if (typeof buildPatch !== 'function') {
      throw new Error('buildAttestationsSyncPatchFromApplication not exported');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/triggers/onApplicationSubmittedSyncProfile — ${err.message}\n` +
        'Run `cd functions && npm run build` first.\n',
    );
    process.exit(2);
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let appsQuery = db
    .collection(`tenants/${args.tenant}/applications`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(args.limit);
  if (args.pageToken) {
    appsQuery = appsQuery.startAfter(args.pageToken);
  }

  const apps = await appsQuery.get();

  const report = {
    tenantId: args.tenant,
    dryRun: args.dryRun,
    limit: args.limit,
    scanned: apps.size,
    candidates: 0,
    written: 0,
    wouldWrite: 0,
    skipped_no_uid: 0,
    skipped_unsubmitted: 0,
    skipped_user_doc_missing: 0,
    skipped_profile_already_set: 0,
    fieldsWritten: 0,
    errors: [],
    truncated: apps.size === args.limit,
    nextPageToken:
      apps.size === args.limit ? apps.docs[apps.docs.length - 1].id : null,
  };

  // Chunked concurrency so we don't fan out 1000 user-doc reads at once.
  for (let i = 0; i < apps.docs.length; i += WRITE_CONCURRENCY) {
    const chunk = apps.docs.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (appDoc) => {
        try {
          const result = await processOne({
            db,
            appId: appDoc.id,
            appData: appDoc.data() || {},
            dryRun: args.dryRun,
            buildPatch,
          });
          return { ok: true, appId: appDoc.id, result };
        } catch (err) {
          return {
            ok: false,
            appId: appDoc.id,
            error: err && err.message ? err.message : String(err),
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ appId: item.appId, error: item.error });
        continue;
      }
      const { outcome, fieldsWritten } = item.result;
      switch (outcome) {
        case 'skipped_no_uid':
          report.skipped_no_uid += 1;
          break;
        case 'skipped_unsubmitted':
          report.skipped_unsubmitted += 1;
          break;
        case 'skipped_user_doc_missing':
          report.skipped_user_doc_missing += 1;
          break;
        case 'skipped_profile_already_set':
          report.candidates += 1;
          report.skipped_profile_already_set += 1;
          break;
        case 'wrote':
          report.candidates += 1;
          report.written += 1;
          report.fieldsWritten += fieldsWritten;
          break;
        case 'would_write':
          report.candidates += 1;
          report.wouldWrite += 1;
          report.fieldsWritten += fieldsWritten;
          break;
        default:
          // Defensive — unknown outcome label.
          report.errors.push({
            appId: item.appId,
            error: `unknown outcome: ${String(outcome)}`,
          });
      }
    }
  }

  // Full report → stdout (newline-terminated, single line, machine-parseable).
  process.stdout.write(`${JSON.stringify(report)}\n`);

  // Scannable summary → stderr.
  const summary =
    `tenant=${report.tenantId} dryRun=${report.dryRun}` +
    ` scanned=${report.scanned} candidates=${report.candidates}` +
    ` wouldWrite=${report.wouldWrite} written=${report.written}` +
    ` skipped_profile_already_set=${report.skipped_profile_already_set}` +
    ` skipped_unsubmitted=${report.skipped_unsubmitted}` +
    ` skipped_no_uid=${report.skipped_no_uid}` +
    ` skipped_user_doc_missing=${report.skipped_user_doc_missing}` +
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
