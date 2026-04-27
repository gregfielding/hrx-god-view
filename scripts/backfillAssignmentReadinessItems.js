#!/usr/bin/env node
'use strict';

/**
 * R.1 — CLI wrapper for the assignmentReadinessItems backfill.
 *
 * Mirrors the loop, query, and report shape of
 * `functions/src/backfillAssignmentReadinessItemsCallable.ts`, but runs
 * server-side with admin SDK creds (matching the R.0c
 * `scripts/backfillWorkerAttestations.js` pattern). The derivation logic
 * (severity defaults + resolutionMethod priority chain) is single-sourced
 * via the compiled functions output so the script and the callable stay in
 * lock-step.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * Service-account creds via `GOOGLE_APPLICATION_CREDENTIALS` (scratch
 * workflow). Bypasses the callable's `securityLevel >= 7` gate by design —
 * that gate is for end-user UI invocations.
 *
 * --------------------------------------------------------------------------
 * Prerequisites
 * --------------------------------------------------------------------------
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` exported.
 *   2. Functions built so `functions/lib/shared/seedAssignmentReadinessItems.js` exists:
 *        cd functions && npm run build
 *   3. **Run the audit script first**:
 *        node scripts/auditAssignmentReadinessStatuses.js --tenant=<tenant>
 *      Confirm `blockingTrueButSoft` and `blockingFalseButHard` counts are
 *      acceptable (or reported back for sign-off) before invoking this CLI
 *      with `--no-dry-run`.
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/backfillAssignmentReadinessItems.js \
 *     --tenant=<tenantId> \
 *     [--dry-run | --no-dry-run] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>]
 *
 * Defaults: dry-run = TRUE, limit = 1000 (max 5000).
 *
 * --------------------------------------------------------------------------
 * Ops note (per Greg, 2026-04-26)
 * --------------------------------------------------------------------------
 * Do NOT run with `--no-dry-run` in production until the dry-run report has
 * been signed off — same pattern as R.0c.
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object.
 *   stderr — one-line summary.
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0`.
 *   exit 2 — bad invocation (missing tenant, can't load helpers, etc.).
 *
 * --------------------------------------------------------------------------
 * Idempotency check (re-run after a successful `--no-dry-run`)
 * --------------------------------------------------------------------------
 *   Expect: written === 0 AND
 *           skipped_already_complete ≈ scanned AND
 *           errors === [].
 *   If a follow-up `--no-dry-run` ever shows `written > 0`, the
 *   already-complete filter let something through twice — flag immediately.
 */

const admin = require('firebase-admin');

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WRITE_CONCURRENCY = 10;

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing
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
      '  node scripts/backfillAssignmentReadinessItems.js \\',
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
      'Prereqs:',
      '  1. cd functions && npm run build',
      '  2. node scripts/auditAssignmentReadinessStatuses.js --tenant=<tenant>',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Derivation — same priority chain as the callable. Imports the severity
// defaults from the compiled functions module so the table is single-sourced.
// ───────────────────────────────────────────────────────────────────────────

const EXTERNAL_TYPES = new Set([
  'background_check',
  'drug_screen',
  'e_verify',
  'screening_package_match',
]);

const AUTO_TYPES = new Set([
  'education_match',
  'language_match',
  'skill_match',
  'license_match',
  'cert_match',
]);

function deriveResolutionMethod(requirementType) {
  if (EXTERNAL_TYPES.has(requirementType)) return 'external';
  if (AUTO_TYPES.has(requirementType)) return 'auto';
  return null;
}

function deriveSeverity(requirementType, defaults) {
  if (requirementType === 'custom') return null;
  return defaults[requirementType] || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-item processor — mirrors the callable's `processOneItem`.
// ───────────────────────────────────────────────────────────────────────────

async function processOne({ itemRef, itemData, dryRun, severityDefaults }) {
  const requirementType = itemData.requirementType;
  if (!requirementType || typeof requirementType !== 'string') {
    return {
      outcome: 'skipped_unknown_type',
      stampedSeverity: false,
      stampedResolutionMethod: false,
      derivedResolutionMethod: null,
    };
  }

  const hasSeverity = itemData.severity === 'hard' || itemData.severity === 'soft';
  const hasResolutionMethod = Object.prototype.hasOwnProperty.call(
    itemData,
    'resolutionMethod',
  );

  if (hasSeverity && hasResolutionMethod) {
    return {
      outcome: 'skipped_already_complete',
      stampedSeverity: false,
      stampedResolutionMethod: false,
      derivedResolutionMethod: null,
    };
  }

  const patch = {};
  let stampedSeverity = false;
  if (!hasSeverity) {
    const severity = deriveSeverity(requirementType, severityDefaults);
    if (severity) {
      patch.severity = severity;
      stampedSeverity = true;
    }
  }

  let stampedResolutionMethod = false;
  let derivedResolutionMethod = null;
  if (!hasResolutionMethod) {
    derivedResolutionMethod = deriveResolutionMethod(requirementType);
    if (derivedResolutionMethod !== null) {
      patch.resolutionMethod = derivedResolutionMethod;
      stampedResolutionMethod = true;
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      outcome: 'skipped_already_complete',
      stampedSeverity: false,
      stampedResolutionMethod: false,
      derivedResolutionMethod: null,
    };
  }

  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  if (!dryRun) {
    await itemRef.set(patch, { merge: true });
    return {
      outcome: 'wrote',
      stampedSeverity,
      stampedResolutionMethod,
      derivedResolutionMethod,
    };
  }
  return {
    outcome: 'would_write',
    stampedSeverity,
    stampedResolutionMethod,
    derivedResolutionMethod,
  };
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

  let severityDefaults;
  try {
    const mod = require('../functions/lib/shared/seedAssignmentReadinessItems');
    severityDefaults = mod && mod.DEFAULT_REQUIREMENT_SEVERITY;
    if (!severityDefaults || typeof severityDefaults !== 'object') {
      throw new Error('DEFAULT_REQUIREMENT_SEVERITY not exported');
    }
  } catch (err) {
    process.stderr.write(
      `Error: failed to load functions/lib/shared/seedAssignmentReadinessItems — ${err.message}\n` +
        'Run `cd functions && npm run build` first.\n',
    );
    process.exit(2);
  }

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let itemsQuery = db
    .collection(`tenants/${args.tenant}/assignmentReadinessItems`)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(args.limit);
  if (args.pageToken) {
    itemsQuery = itemsQuery.startAfter(args.pageToken);
  }

  const items = await itemsQuery.get();

  const report = {
    tenantId: args.tenant,
    dryRun: args.dryRun,
    limit: args.limit,
    scanned: items.size,
    candidates: 0,
    written: 0,
    wouldWrite: 0,
    skipped_already_complete: 0,
    skipped_unknown_type: 0,
    stampedSeverity: 0,
    stampedResolutionMethod: 0,
    resolutionMethodBreakdown: { auto: 0, external: 0, leftUnset: 0 },
    errors: [],
    truncated: items.size === args.limit,
    nextPageToken:
      items.size === args.limit ? items.docs[items.docs.length - 1].id : null,
  };

  for (let i = 0; i < items.docs.length; i += WRITE_CONCURRENCY) {
    const chunk = items.docs.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (itemDoc) => {
        try {
          const result = await processOne({
            itemRef: itemDoc.ref,
            itemData: itemDoc.data() || {},
            dryRun: args.dryRun,
            severityDefaults,
          });
          return { ok: true, itemId: itemDoc.id, result };
        } catch (err) {
          return {
            ok: false,
            itemId: itemDoc.id,
            error: err && err.message ? err.message : String(err),
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ itemId: item.itemId, error: item.error });
        continue;
      }
      const {
        outcome,
        stampedSeverity,
        stampedResolutionMethod,
        derivedResolutionMethod,
      } = item.result;
      switch (outcome) {
        case 'skipped_already_complete':
          report.skipped_already_complete += 1;
          break;
        case 'skipped_unknown_type':
          report.skipped_unknown_type += 1;
          break;
        case 'wrote':
          report.candidates += 1;
          report.written += 1;
          if (stampedSeverity) report.stampedSeverity += 1;
          if (stampedResolutionMethod) {
            report.stampedResolutionMethod += 1;
            if (derivedResolutionMethod === 'auto') report.resolutionMethodBreakdown.auto += 1;
            else if (derivedResolutionMethod === 'external')
              report.resolutionMethodBreakdown.external += 1;
          } else {
            report.resolutionMethodBreakdown.leftUnset += 1;
          }
          break;
        case 'would_write':
          report.candidates += 1;
          report.wouldWrite += 1;
          if (stampedSeverity) report.stampedSeverity += 1;
          if (stampedResolutionMethod) {
            report.stampedResolutionMethod += 1;
            if (derivedResolutionMethod === 'auto') report.resolutionMethodBreakdown.auto += 1;
            else if (derivedResolutionMethod === 'external')
              report.resolutionMethodBreakdown.external += 1;
          } else {
            report.resolutionMethodBreakdown.leftUnset += 1;
          }
          break;
        default:
          report.errors.push({
            itemId: item.itemId,
            error: `unknown outcome: ${String(outcome)}`,
          });
      }
    }
  }

  process.stdout.write(`${JSON.stringify(report)}\n`);

  const summary =
    `tenant=${report.tenantId} dryRun=${report.dryRun}` +
    ` scanned=${report.scanned} candidates=${report.candidates}` +
    ` wouldWrite=${report.wouldWrite} written=${report.written}` +
    ` stampedSeverity=${report.stampedSeverity}` +
    ` stampedResolutionMethod=${report.stampedResolutionMethod}` +
    ` auto=${report.resolutionMethodBreakdown.auto}` +
    ` external=${report.resolutionMethodBreakdown.external}` +
    ` leftUnset=${report.resolutionMethodBreakdown.leftUnset}` +
    ` skipped_already_complete=${report.skipped_already_complete}` +
    ` skipped_unknown_type=${report.skipped_unknown_type}` +
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
