#!/usr/bin/env node
'use strict';

/**
 * R.0c post-mortem cleanup — deflate literal-dotted `workerAttestations.*`
 * top-level keys back into the nested `workerAttestations` map, then delete
 * the literal-dotted keys.
 *
 * --------------------------------------------------------------------------
 * Why this exists
 * --------------------------------------------------------------------------
 * The R.0b live trigger and the R.0c CLI script previously called
 * `userRef.set(patch, { merge: true })` with patches whose keys were dotted
 * strings (e.g. `workerAttestations.eVerifyWillingness`). The Firebase Admin
 * SDK does NOT interpret dotted keys as field paths under set/merge — it
 * writes them as LITERAL top-level field names with embedded dots. Only
 * `update()` treats dotted strings as field paths.
 *
 * Result: ~1056 users in tenant BCiP2bQ9CgVOCTfV6MhD ended up with garbage
 * literal-dotted top-level keys instead of nested attestations. Both code
 * paths are fixed (Step B); this script cleans up the existing pollution.
 *
 * See: docs/READINESS_R0_HANDOFF.md (post-mortem section, Apr 26 2026).
 *
 * --------------------------------------------------------------------------
 * D2-reverse semantics (from the planning doc)
 * --------------------------------------------------------------------------
 *   For each literal key `workerAttestations.<…>`:
 *     - If the corresponding NESTED slot is already populated (per
 *       `isAttestationSet`) → preserve the nested value, just delete the
 *       literal key. (Client-side wizard writes win.)
 *     - Else → write the literal value into the nested slot, then delete the
 *       literal key.
 *
 *   This preserves the 122 dual-state users' pre-existing nested values
 *   while recovering data for the 934 literal-only users.
 *
 * --------------------------------------------------------------------------
 * Scope
 * --------------------------------------------------------------------------
 * Iterates the top-level `users` collection directly (HRX is single-tenant
 * today; the bug's blast radius is BCiP2bQ9CgVOCTfV6MhD only). No tenant
 * filter — safe across tenants if more get added later. Idempotent: a
 * second run on a clean doc is a no-op.
 *
 * --------------------------------------------------------------------------
 * Auth
 * --------------------------------------------------------------------------
 * `GOOGLE_APPLICATION_CREDENTIALS` (mirrors `scripts/backfillWorkerAttestations.js`).
 *
 * --------------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------------
 *   node scripts/cleanupLiteralDottedAttestationKeys.js \
 *     [--dry-run | --no-dry-run] \
 *     [--limit=1000] \
 *     [--page-token=<from-prior-response>]
 *
 * Defaults: --dry-run (true), --limit=1000 (max 5000).
 *
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 *   stdout — full report as a single JSON object.
 *   stderr — one-line summary + per-user diagnostics on errors.
 *   exit 0 — success, no errors.
 *   exit 1 — completed but `errors.length > 0`.
 *   exit 2 — bad invocation.
 *
 * --------------------------------------------------------------------------
 * Idempotency check
 * --------------------------------------------------------------------------
 *   After a successful `--no-dry-run`, re-run with `--no-dry-run`. Expect:
 *     usersUpdated === 0 (everything already clean) AND
 *     errors === [].
 *   If a follow-up shows usersUpdated > 0, the script let something through
 *   twice — flag immediately.
 */

const admin = require('firebase-admin');

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const WRITE_CONCURRENCY = 10;

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing — same shape as backfillWorkerAttestations.js.
// ───────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
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
      '  node scripts/cleanupLiteralDottedAttestationKeys.js \\',
      '    [--dry-run | --no-dry-run] \\',
      '    [--limit=1000] \\',
      '    [--page-token=<from-prior-response>]',
      '',
      'Defaults: --dry-run (true), --limit=1000 (max 5000).',
      '',
      'Required env:',
      '  GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json',
      '',
    ].join('\n'),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers — mirror the trigger's `isAttestationSet` so D2-reverse uses the
// exact same emptiness rule as the original D2 (any defensible truthy value
// counts as set, but empty strings do NOT).
// ───────────────────────────────────────────────────────────────────────────

function isAttestationSet(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

/**
 * Detect plain JS objects (so we can recurse into them safely without
 * walking into Firestore Timestamp / GeoPoint / Reference / etc. instances
 * or arrays).
 */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  // Plain objects from `.data()` have constructor === Object.
  // Firestore SDK objects (Timestamp, etc.) have a different constructor.
  return v.constructor === Object || Object.getPrototypeOf(v) === null;
}

/**
 * Deep clone a plain object subtree but preserve leaf SDK instances
 * (Timestamps, etc.) by reference. JSON-serialization round-trips would
 * mangle Timestamps so we hand-roll this.
 */
function cloneTree(node) {
  if (!isPlainObject(node)) return node;
  const out = {};
  for (const k of Object.keys(node)) out[k] = cloneTree(node[k]);
  return out;
}

/**
 * Merge one literal-dotted key/value into the in-progress nested target,
 * applying D2-reverse semantics:
 *   - Existing values in `target` always win at every depth.
 *   - Only fill empty/missing slots from the literal value.
 *   - If a parent path conflicts (e.g. literal wants to write into a slot
 *     that already holds a scalar), drop the literal cleanly.
 *
 * Returns counts so the caller can roll up per-user totals.
 */
function mergeLiteralIntoTarget(target, segments, literalValue) {
  let cur = target;
  // Walk down to the parent of the leaf, creating empty maps as needed.
  // Defensive: if any intermediate hop already holds a non-map, the
  // literal key is bogus relative to the nested shape — drop it.
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (cur[seg] === undefined || cur[seg] === null) {
      cur[seg] = {};
    } else if (!isPlainObject(cur[seg])) {
      return { deflated: 0, dropped: 1 };
    }
    cur = cur[seg];
  }
  const leaf = segments[segments.length - 1];

  // If the literal value itself is a map, deep-merge it (D2-reverse: only
  // fill missing leaves; never clobber existing nested data).
  if (isPlainObject(literalValue)) {
    if (cur[leaf] === undefined || cur[leaf] === null) {
      cur[leaf] = {};
    } else if (!isPlainObject(cur[leaf])) {
      // Existing scalar/Timestamp at this slot — preserve, drop literal.
      return { deflated: 0, dropped: 1 };
    }
    let deflated = 0;
    let dropped = 0;
    for (const subKey of Object.keys(literalValue)) {
      const r = mergeLiteralIntoTarget(cur[leaf], [subKey], literalValue[subKey]);
      deflated += r.deflated;
      dropped += r.dropped;
    }
    return { deflated, dropped };
  }

  // Scalar leaf. D2-reverse: existing wins.
  if (isAttestationSet(cur[leaf])) {
    return { deflated: 0, dropped: 1 };
  }
  cur[leaf] = literalValue;
  return { deflated: 1, dropped: 0 };
}

/**
 * For one user, plan the cleanup write.
 *
 * Strategy:
 *   1. Read existing nested `workerAttestations` (may be missing/empty).
 *   2. Deep-merge every literal-dotted `workerAttestations.*` key into a
 *      cloned target tree, applying D2-reverse semantics (existing wins).
 *   3. Write the entire nested `workerAttestations` field in one shot via
 *      the dotted-string field path.
 *   4. Delete every literal-dotted top-level field via `FieldPath`
 *      (single-segment FieldPath addresses the literal field name with
 *      embedded dots instead of being parsed as a nested path).
 *
 * Writing the parent map in a single field-path eliminates parent/child
 * conflicts that would otherwise reject the update (Firestore disallows a
 * single update from specifying both `workerAttestations.X` and
 * `workerAttestations.X.Y` because the parent write would discard the
 * child).
 *
 * The deep-merge preserves any existing nested data the script doesn't
 * explicitly touch — so a user's `workerAttestations._meta.foo.source =
 * 'application'` (legitimate client write) is not clobbered when we
 * deflate `workerAttestations.bar = 'Yes'`.
 */
function planUserCleanup(userData) {
  const literalKeys = Object.keys(userData).filter((k) =>
    k.startsWith('workerAttestations.'),
  );
  if (literalKeys.length === 0) {
    return { needsWrite: false, deflated: 0, droppedOnly: 0, literalKeys: 0 };
  }

  // Seed the merge target with the existing nested map (preserve leaves
  // including Firestore Timestamps).
  const existing =
    userData.workerAttestations && isPlainObject(userData.workerAttestations)
      ? userData.workerAttestations
      : {};
  const target = cloneTree(existing);

  let deflated = 0;
  let droppedOnly = 0;

  for (const literalKey of literalKeys) {
    const segments = literalKey.split('.').slice(1); // drop "workerAttestations"
    if (segments.length === 0) {
      droppedOnly += 1;
      continue;
    }
    const r = mergeLiteralIntoTarget(target, segments, userData[literalKey]);
    deflated += r.deflated;
    droppedOnly += r.dropped;
  }

  // Build update args:
  //   1. write the nested workerAttestations map in a single shot.
  //   2. delete every literal-dotted top-level field via FieldPath.
  const variadicArgs = [];
  variadicArgs.push('workerAttestations');
  variadicArgs.push(target);
  for (const literalKey of literalKeys) {
    variadicArgs.push(new admin.firestore.FieldPath(literalKey));
    variadicArgs.push(admin.firestore.FieldValue.delete());
  }

  return {
    needsWrite: true,
    variadicArgs,
    deflated,
    droppedOnly,
    literalKeys: literalKeys.length,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Per-user processor.
// ───────────────────────────────────────────────────────────────────────────

async function processOne({ db, userDoc, dryRun }) {
  const userData = userDoc.data() || {};
  const plan = planUserCleanup(userData);
  if (!plan.needsWrite) {
    return { outcome: 'skipped_no_literal_keys', deflated: 0, droppedOnly: 0, literalKeys: 0 };
  }
  if (!dryRun) {
    // Variadic-form update so we can mix FieldPath (for literal-dotted
    // deletes) with dotted-string field paths (for nested writes).
    await userDoc.ref.update(...plan.variadicArgs);
  }
  return {
    outcome: dryRun ? 'would_clean' : 'cleaned',
    deflated: plan.deflated,
    droppedOnly: plan.droppedOnly,
    literalKeys: plan.literalKeys,
  };
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

  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let usersQuery = db
    .collection('users')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(args.limit);
  if (args.pageToken) usersQuery = usersQuery.startAfter(args.pageToken);

  const users = await usersQuery.get();

  const report = {
    dryRun: args.dryRun,
    limit: args.limit,
    scanned: users.size,
    usersWithLiteralKeys: 0,
    usersUpdated: 0,
    usersWouldUpdate: 0,
    totalLiteralKeysProcessed: 0,
    totalDeflated: 0,
    totalDroppedOnly: 0,
    errors: [],
    truncated: users.size === args.limit,
    nextPageToken:
      users.size === args.limit ? users.docs[users.docs.length - 1].id : null,
  };

  for (let i = 0; i < users.docs.length; i += WRITE_CONCURRENCY) {
    const chunk = users.docs.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (userDoc) => {
        try {
          const result = await processOne({ db, userDoc, dryRun: args.dryRun });
          return { ok: true, uid: userDoc.id, result };
        } catch (err) {
          return {
            ok: false,
            uid: userDoc.id,
            error: err && err.message ? err.message : String(err),
          };
        }
      }),
    );
    for (const item of results) {
      if (!item.ok) {
        report.errors.push({ uid: item.uid, error: item.error });
        continue;
      }
      const r = item.result;
      switch (r.outcome) {
        case 'skipped_no_literal_keys':
          break;
        case 'would_clean':
          report.usersWithLiteralKeys += 1;
          report.usersWouldUpdate += 1;
          report.totalLiteralKeysProcessed += r.literalKeys;
          report.totalDeflated += r.deflated;
          report.totalDroppedOnly += r.droppedOnly;
          break;
        case 'cleaned':
          report.usersWithLiteralKeys += 1;
          report.usersUpdated += 1;
          report.totalLiteralKeysProcessed += r.literalKeys;
          report.totalDeflated += r.deflated;
          report.totalDroppedOnly += r.droppedOnly;
          break;
        default:
          report.errors.push({ uid: item.uid, error: `unknown outcome: ${String(r.outcome)}` });
      }
    }
  }

  process.stdout.write(`${JSON.stringify(report)}\n`);

  const summary =
    `dryRun=${report.dryRun}` +
    ` scanned=${report.scanned}` +
    ` usersWithLiteralKeys=${report.usersWithLiteralKeys}` +
    ` usersUpdated=${report.usersUpdated}` +
    ` usersWouldUpdate=${report.usersWouldUpdate}` +
    ` totalLiteralKeys=${report.totalLiteralKeysProcessed}` +
    ` deflated=${report.totalDeflated}` +
    ` droppedOnly=${report.totalDroppedOnly}` +
    ` errors=${report.errors.length} truncated=${report.truncated}` +
    ` nextPageToken=${report.nextPageToken || ''}\n`;
  process.stderr.write(summary);

  if (report.errors.length > 0) process.exit(1);
}

// Allow other scripts to import the planner for inspection / unit-test
// without triggering CLI execution.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `Fatal: ${(err && err.stack) || (err && err.message) || String(err)}\n`,
    );
    process.exit(1);
  });
}

module.exports = {
  __test_planUserCleanup: planUserCleanup,
  __test_mergeLiteralIntoTarget: mergeLiteralIntoTarget,
  __test_isAttestationSet: isAttestationSet,
  __test_isPlainObject: isPlainObject,
};
