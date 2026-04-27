#!/usr/bin/env node
'use strict';

/**
 * R.1 — Audit walker for `tenants/{tid}/assignmentReadinessItems`.
 *
 * Scoped to PR R.1 of the readiness rebuild. Read-only — never writes to
 * Firestore. Produces a JSON report covering:
 *
 *   1. **Status gaps** — items with missing / undefined `status` and items
 *      still on the legacy `'complete'` value (deprecated by §6e in
 *      `shared/assignmentReadinessItemV1.ts`).
 *   2. **Required-field gaps** — items missing `actor` or `blocking` (both
 *      required since the original seeder shipped). Prior failures here
 *      indicate a pre-seeder document or a manual write.
 *   3. **R.1 backfill scope** — items missing `severity` and items missing
 *      `resolutionMethod`. These get populated by
 *      `backfillAssignmentReadinessItemsCallable`; the count here sets the
 *      expectation for that callable's `wouldWrite`.
 *   4. **Q-R1-2 conflicts** — items where `blocking !== (severity === 'hard')`
 *      using the type-default severity for items without an explicit
 *      `severity`. Lists the first 50 conflict ids per direction so the
 *      operator can spot-check before greenlighting backfill writes.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * Service-account creds via `GOOGLE_APPLICATION_CREDENTIALS` (existing
 * scratch workflow). No callable involved — direct admin SDK reads.
 *
 * --------------------------------------------------------------------------
 * Prerequisites
 * --------------------------------------------------------------------------
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` exported.
 *   2. Functions built so the severity-default table is available:
 *        cd functions && npm run build
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/auditAssignmentReadinessStatuses.js \
 *     --tenant=<tenantId> \
 *     [--limit=10000] \
 *     [--page-token=<from-prior-response>] \
 *     [--out=.scratch/assignment-readiness-audit-<tenant>-<date>.json]
 *
 * Defaults: limit = 10000 (max 50000), out = `.scratch/assignment-readiness-audit-<tenant>-<YYYYMMDD>.json`.
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report (single JSON object).
 *   stderr — one-line summary.
 *   <out>  — same JSON as stdout, written for the audit trail.
 *   exit 0 — completed (with or without findings).
 *   exit 2 — bad invocation (missing tenant, can't load helpers).
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 10000;
const MAX_LIMIT = 50000;
const CONFLICT_SAMPLE_CAP = 50;

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing
// ───────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    tenant: null,
    limit: DEFAULT_LIMIT,
    pageToken: null,
    outPath: null,
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

    const eqMatch = /^--([a-zA-Z][a-zA-Z0-9-]*)=(.*)$/.exec(tok);
    if (eqMatch) {
      assignKv(out, eqMatch[1], eqMatch[2]);
      continue;
    }

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
    case 'out':
    case 'output':
      out.outPath = value.trim() || null;
      return;
    default:
      throw new Error(`Unknown flag: --${key}`);
  }
}

function printUsage(stream) {
  stream.write(
    [
      'Usage:',
      '  node scripts/auditAssignmentReadinessStatuses.js \\',
      '    --tenant=<tenantId> \\',
      '    [--limit=10000] \\',
      '    [--page-token=<from-prior-response>] \\',
      '    [--out=.scratch/assignment-readiness-audit-<tenant>-<date>.json]',
      '',
      'Defaults: --limit=10000 (max 50000).',
      '',
      'Required env:',
      '  GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json',
      '',
      'Prereq: build functions so DEFAULT_REQUIREMENT_SEVERITY is loadable:',
      '  cd functions && npm run build',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const LEGACY_STATUS_VALUES = new Set(['complete']);
const KNOWN_STATUS_VALUES = new Set([
  'incomplete',
  'in_progress',
  'complete_pass',
  'complete_fail',
  'needs_review',
  'expired',
  'blocked',
  'not_applicable',
]);

function pickStatusBucket(item) {
  const s = item.status;
  if (s === undefined || s === null || s === '') return 'missing';
  if (LEGACY_STATUS_VALUES.has(s)) return 'legacy_complete';
  if (!KNOWN_STATUS_VALUES.has(s)) return 'unknown';
  return 'ok';
}

function defaultIso() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
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

  // Load DEFAULT_REQUIREMENT_SEVERITY from compiled functions output.
  let DEFAULT_REQUIREMENT_SEVERITY;
  try {
    const mod = require('../functions/lib/shared/seedAssignmentReadinessItems');
    DEFAULT_REQUIREMENT_SEVERITY = mod && mod.DEFAULT_REQUIREMENT_SEVERITY;
    if (!DEFAULT_REQUIREMENT_SEVERITY || typeof DEFAULT_REQUIREMENT_SEVERITY !== 'object') {
      throw new Error('DEFAULT_REQUIREMENT_SEVERITY not exported');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/shared/seedAssignmentReadinessItems — ${err.message}\n` +
        'Run `cd functions && npm run build` first.\n',
    );
    process.exit(2);
  }

  const outPath =
    args.outPath ||
    path.join(
      process.cwd(),
      '.scratch',
      `assignment-readiness-audit-${args.tenant}-${defaultIso()}.json`,
    );

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let q = db
    .collection(`tenants/${args.tenant}/assignmentReadinessItems`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(args.limit);
  if (args.pageToken) q = q.startAfter(args.pageToken);

  const snap = await q.get();

  const report = {
    tenantId: args.tenant,
    scanned: snap.size,
    truncated: snap.size === args.limit,
    nextPageToken:
      snap.size === args.limit ? snap.docs[snap.docs.length - 1].id : null,
    statusBuckets: {
      ok: 0,
      missing: 0,
      legacy_complete: 0,
      unknown: 0,
    },
    requiredFieldGaps: {
      missingActor: 0,
      missingBlocking: 0,
    },
    r1FieldGaps: {
      missingSeverity: 0,
      missingResolutionMethod: 0,
    },
    severityByType: {},
    resolutionMethodCounts: {
      auto: 0,
      external: 0,
      self_attest: 0,
      csa_confirmed: 0,
      csa_waived: 0,
      null_explicit: 0,
      undefined_legacy: 0,
    },
    severityBlockingConflicts: {
      // blocking:true but severity-default is soft (legacy item that should
      // probably flip to non-blocking once the operator confirms).
      blockingTrueButSoft: 0,
      // blocking:false but severity-default is hard (legacy item that's
      // probably under-blocking — would resurface as red on the new chip).
      blockingFalseButHard: 0,
      blockingTrueButSoftSamples: [],
      blockingFalseButHardSamples: [],
    },
    unknownStatusSamples: [],
    legacyCompleteSamples: [],
  };

  for (const doc of snap.docs) {
    const item = doc.data() || {};
    const itemId = doc.id;

    // 1. Status bucket.
    const bucket = pickStatusBucket(item);
    report.statusBuckets[bucket] += 1;
    if (bucket === 'unknown' && report.unknownStatusSamples.length < CONFLICT_SAMPLE_CAP) {
      report.unknownStatusSamples.push({ id: itemId, status: item.status });
    }
    if (
      bucket === 'legacy_complete' &&
      report.legacyCompleteSamples.length < CONFLICT_SAMPLE_CAP
    ) {
      report.legacyCompleteSamples.push({ id: itemId });
    }

    // 2. Required-field gaps.
    if (item.actor === undefined || item.actor === null) {
      report.requiredFieldGaps.missingActor += 1;
    }
    if (typeof item.blocking !== 'boolean') {
      report.requiredFieldGaps.missingBlocking += 1;
    }

    // 3. R.1 backfill scope.
    const hasSeverity = item.severity === 'hard' || item.severity === 'soft';
    if (!hasSeverity) report.r1FieldGaps.missingSeverity += 1;
    if (!('resolutionMethod' in item)) {
      report.r1FieldGaps.missingResolutionMethod += 1;
      report.resolutionMethodCounts.undefined_legacy += 1;
    } else if (item.resolutionMethod === null) {
      report.resolutionMethodCounts.null_explicit += 1;
    } else if (
      ['auto', 'external', 'self_attest', 'csa_confirmed', 'csa_waived'].includes(
        item.resolutionMethod,
      )
    ) {
      report.resolutionMethodCounts[item.resolutionMethod] += 1;
    }

    // 4. Severity / blocking conflict (Q-R1-2). Use the explicit severity if
    // present; otherwise the type-default. Skip items where blocking isn't a
    // boolean (already counted above as a required-field gap).
    const requirementType = item.requirementType;
    if (requirementType && typeof item.blocking === 'boolean') {
      const effectiveSeverity = hasSeverity
        ? item.severity
        : DEFAULT_REQUIREMENT_SEVERITY[requirementType];
      if (effectiveSeverity === 'hard' || effectiveSeverity === 'soft') {
        if (!report.severityByType[requirementType]) {
          report.severityByType[requirementType] = { hard: 0, soft: 0, missing: 0 };
        }
        report.severityByType[requirementType][hasSeverity ? effectiveSeverity : 'missing'] += 1;

        const expectBlocking = effectiveSeverity === 'hard';
        if (item.blocking === true && !expectBlocking) {
          report.severityBlockingConflicts.blockingTrueButSoft += 1;
          if (
            report.severityBlockingConflicts.blockingTrueButSoftSamples.length <
            CONFLICT_SAMPLE_CAP
          ) {
            report.severityBlockingConflicts.blockingTrueButSoftSamples.push({
              id: itemId,
              requirementType,
              severitySource: hasSeverity ? 'item' : 'type_default',
            });
          }
        } else if (item.blocking === false && expectBlocking) {
          report.severityBlockingConflicts.blockingFalseButHard += 1;
          if (
            report.severityBlockingConflicts.blockingFalseButHardSamples.length <
            CONFLICT_SAMPLE_CAP
          ) {
            report.severityBlockingConflicts.blockingFalseButHardSamples.push({
              id: itemId,
              requirementType,
              severitySource: hasSeverity ? 'item' : 'type_default',
            });
          }
        }
      }
    }
  }

  // Write report to .scratch/.
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    // Non-fatal — stdout still gets the report.
    process.stderr.write(`Warning: failed to write ${outPath}: ${err.message}\n`);
  }

  // Full report → stdout.
  process.stdout.write(`${JSON.stringify(report)}\n`);

  // One-line summary → stderr.
  const sb = report.statusBuckets;
  const c = report.severityBlockingConflicts;
  const summary =
    `tenant=${report.tenantId} scanned=${report.scanned}` +
    ` ok=${sb.ok} missingStatus=${sb.missing} legacyComplete=${sb.legacy_complete}` +
    ` unknownStatus=${sb.unknown}` +
    ` missingSeverity=${report.r1FieldGaps.missingSeverity}` +
    ` missingResolutionMethod=${report.r1FieldGaps.missingResolutionMethod}` +
    ` blockingTrueButSoft=${c.blockingTrueButSoft}` +
    ` blockingFalseButHard=${c.blockingFalseButHard}` +
    ` truncated=${report.truncated}` +
    ` nextPageToken=${report.nextPageToken || ''}` +
    ` out=${outPath}\n`;
  process.stderr.write(summary);

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `Fatal: ${(err && err.stack) || (err && err.message) || String(err)}\n`,
  );
  process.exit(1);
});
