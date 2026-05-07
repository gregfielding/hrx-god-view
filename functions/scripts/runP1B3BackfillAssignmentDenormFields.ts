/**
 * Admin-side runner for the TS.1.P1.B.3 assignment-denorm backfill.
 *
 * Lives under `functions/scripts/` (not the repo-root `scripts/`)
 * because the backfill imports `firebase-admin` from
 * `functions/src/timesheets/backfillAssignmentDenormFieldsCallable.ts`
 * — and the root has its own copy of `firebase-admin` too. Putting
 * the runner inside `functions/` keeps Node's module resolution
 * inside a single `node_modules` tree, so the `FieldPath` instance-
 * check inside `@google-cloud/firestore` doesn't fail with the
 * "two copies of firebase-admin" error.
 *
 * Invokes `runBackfillAssignmentDenormFieldsPage` directly (Admin
 * SDK), bypassing the callable's auth + onCall wrapper. Same code
 * path, different entry point.
 *
 * **Why a script and not just the callable.**
 *   - Run with admin creds, no need for a sec-7 user session.
 *   - Pages through the whole tenant in one command instead of N.
 *   - Output goes to `.scratch/` matching the established convention
 *     (`p1b3-backfill-{tenantId}-{tag}.json` + `.summary.txt`).
 *
 * **Dry-run is the default.** Pass `--write` to mutate.
 * Recommended workflow:
 *   1. No flags → dry-run report → eyeball.
 *   2. If clean, re-run with `--write`.
 *   3. Re-run dry-run with the same tenant → expect 0 candidates
 *      (idempotency check).
 *
 * Usage (from repo root):
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-claude/service-account.json \
 *     npx ts-node functions/scripts/runP1B3BackfillAssignmentDenormFields.ts \
 *       --tenant=<tenantId> [--write] [--limit=200]
 *
 * @see functions/src/timesheets/backfillAssignmentDenormFieldsCallable.ts
 * @see TS.1 build plan §2.5 — Assignment denormalization
 */

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

if (!admin.apps.length) {
  // ADC honors GOOGLE_APPLICATION_CREDENTIALS automatically; falls
  // back to gcloud auth or metadata server if that's not set.
  admin.initializeApp({ projectId: "hrx1-d3beb" });
}

import {
  runBackfillAssignmentDenormFieldsPage,
  type BackfillReport,
} from "../src/timesheets/backfillAssignmentDenormFieldsCallable";

interface CliArgs {
  tenantId: string;
  write: boolean;
  limit: number;
  tag: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let tenantId = "";
  let write = false;
  let limit = 200;
  let tag = "dryrun";

  for (const raw of args) {
    if (raw === "--write") {
      write = true;
      tag = "write";
    } else if (raw.startsWith("--tenant=")) {
      tenantId = raw.substring("--tenant=".length).trim();
    } else if (raw.startsWith("--limit=")) {
      const n = parseInt(raw.substring("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, 500);
    } else if (raw.startsWith("--tag=")) {
      tag = raw.substring("--tag=".length).trim() || tag;
    }
  }

  if (!tenantId) {
    console.error("Error: --tenant=<tenantId> is required.");
    process.exit(1);
  }

  return { tenantId, write, limit, tag };
}

// `BackfillReport["fieldStats"][key]` actually has keys
//   already_set, stamped, would_stamp, unresolvable, skipped
// (snake_case in the source). Use a permissive type here so we
// don't have to re-export the FieldStat shape.
type FieldStat = {
  already_set: number;
  stamped: number;
  would_stamp: number;
  unresolvable: number;
  skipped: number;
};

function emptyStat(): FieldStat {
  return {
    already_set: 0,
    stamped: 0,
    would_stamp: 0,
    unresolvable: 0,
    skipped: 0,
  };
}

function aggregateFieldStats(
  acc: Record<string, FieldStat>,
  page: BackfillReport["fieldStats"],
): void {
  for (const key of Object.keys(acc)) {
    const a = acc[key];
    const p = (page as unknown as Record<string, FieldStat>)[key];
    if (!p) continue;
    a.already_set += p.already_set ?? 0;
    a.stamped += p.stamped ?? 0;
    a.would_stamp += p.would_stamp ?? 0;
    a.unresolvable += p.unresolvable ?? 0;
    a.skipped += p.skipped ?? 0;
  }
}

async function run() {
  const { tenantId, write, limit, tag } = parseArgs();
  const dryRun = !write;
  const startedAt = new Date();
  const fileTag = `${tag}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;

  console.log("━".repeat(60));
  console.log("TS.1.P1.B.3 — Assignment denorm-field backfill");
  console.log("━".repeat(60));
  console.log(`Tenant     : ${tenantId}`);
  console.log(`Mode       : ${dryRun ? "DRY-RUN (no writes)" : "WRITE"}`);
  console.log(`Page limit : ${limit}`);
  console.log("");

  const fdb = admin.firestore();
  const allReports: BackfillReport[] = [];
  let pageToken: string | null = null;
  let pageNum = 0;
  const totals = {
    scanned: 0,
    candidatesProcessed: 0,
    preFilteredFullyHealthy: 0,
    fieldStats: {
      hiringEntityId: emptyStat(),
      worksiteState: emptyStat(),
      worksiteDisplayName: emptyStat(),
      workerDisplayName: emptyStat(),
      shiftBreakDefaultMinutes: emptyStat(),
      weeklySchedule: emptyStat(),
    } as Record<string, FieldStat>,
    errors: [] as BackfillReport["errors"],
  };

  do {
    pageNum += 1;
    const before = Date.now();
    const report: BackfillReport = await runBackfillAssignmentDenormFieldsPage({
      tenantId,
      dryRun,
      limit,
      pageToken,
      fdb,
    });
    allReports.push(report);
    totals.scanned += report.scanned;
    totals.candidatesProcessed += report.candidatesProcessed;
    totals.preFilteredFullyHealthy += report.preFilteredFullyHealthy;
    aggregateFieldStats(totals.fieldStats, report.fieldStats);
    totals.errors.push(...report.errors);

    const ms = Date.now() - before;
    console.log(
      `Page ${pageNum.toString().padStart(2, "0")}: scanned=${report.scanned} ` +
        `healthy=${report.preFilteredFullyHealthy} ` +
        `candidates=${report.candidatesProcessed} ` +
        `errors=${report.errors.length} (${ms}ms)` +
        (report.nextPageToken ?
          ` → cursor=${report.nextPageToken.substring(0, 16)}…` :
          ""),
    );
    pageToken = report.nextPageToken;
  } while (pageToken);

  const summary = [
    "",
    "━".repeat(60),
    "TOTALS",
    "━".repeat(60),
    `Pages              : ${pageNum}`,
    `Assignments scanned: ${totals.scanned}`,
    `  pre-filter healthy (skipped): ${totals.preFilteredFullyHealthy}`,
    `  candidates processed         : ${totals.candidatesProcessed}`,
    `Errors             : ${totals.errors.length}`,
    "",
    "Field outcomes (already / stamped / would-stamp / unresolvable / skipped):",
    ...(
      Object.entries(totals.fieldStats) as Array<[string, FieldStat]>
    ).map(
      ([field, s]) =>
        `  ${field.padEnd(28)} ${String(s.already_set).padStart(5)} ` +
        `/ ${String(s.stamped).padStart(5)} ` +
        `/ ${String(s.would_stamp).padStart(5)} ` +
        `/ ${String(s.unresolvable).padStart(5)} ` +
        `/ ${String(s.skipped).padStart(5)}`,
    ),
    "",
    `Mode       : ${dryRun ? "DRY-RUN" : "WRITE"}`,
    `Started    : ${startedAt.toISOString()}`,
    `Finished   : ${new Date().toISOString()}`,
    "",
  ].join("\n");

  console.log(summary);

  if (totals.errors.length > 0) {
    console.log("First 10 errors:");
    for (const e of totals.errors.slice(0, 10)) {
      console.log(`  - ${e.assignmentId}: ${e.field} — ${e.message}`);
    }
    console.log("");
  }

  // Persist artifacts to repo-root .scratch/ for audit + diffing
  // across runs. Always resolve relative to this script's location
  // (functions/scripts/) → ../../.scratch.
  const scratchDir = path.resolve(__dirname, "..", "..", ".scratch");
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const baseName = `p1b3-backfill-${tenantId}-${fileTag}`;
  const jsonPath = path.join(scratchDir, `${baseName}.json`);
  const summaryPath = path.join(scratchDir, `${baseName}.summary.txt`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      { tenantId, dryRun, limit, totals, pages: allReports },
      null,
      2,
    ),
  );
  fs.writeFileSync(summaryPath, summary);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${summaryPath}`);

  if (dryRun) {
    console.log("");
    console.log("Dry-run complete. To apply, re-run with --write:");
    console.log(
      `  npx ts-node functions/scripts/runP1B3BackfillAssignmentDenormFields.ts ` +
        `--tenant=${tenantId} --write`,
    );
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
