# GCP App Engine–Billed Spend Audit & Hardening
**Owner:** Platform/Infra • **Audience:** Cursor (code-first) • **Applies to:** Firebase Functions v2 + Cloud Scheduler + Firestore

> Goal: Stop surprise $ spend attributed to **App Engine** by (1) locating scheduled backups/looping jobs, (2) bounding and controlling schedulers/triggers, (3) eliminating legacy AE artifacts, and (4) installing permanent guardrails, observability, and budgets.

---

## 0) Global Defaults (Functions v2)

Add to your main functions entry (e.g., `functions/src/index.ts`). These are conservative, **cost-safe** defaults. Override per function only when required.

```ts
import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({
  region: "us-central1",
  minInstances: 0,
  maxInstances: 2,            // Cap concurrency-induced runaway
  timeoutSeconds: 240,        // Raise per-fn only if justified
  memory: "256MiB",
  concurrency: 40             // OK for HTTP; schedulers run singleton anyway
});
```

---

## 1) Codebase Audit (ripgrep) — Write results to `audit/`

Create `audit/` and run these searches from repo root. Use them to populate **INVENTORY.md**.

### 1A) Firestore/Datastore Exports (Backups)
```bash
rg -n --no-ignore -S \
  -e 'exportDocuments' \
  -e 'ExportEntities' \
  -e 'google\.firestore\.admin\.v1' \
  -e 'datastore\.admin\.v1' \
  -e 'firestore\.googleapis\.com.*:exportDocuments' \
  -e 'datastore\.googleapis\.com.*:export' \
  -e 'projects/.*/databases/\(default\):exportDocuments' \
  -e 'gs://.*(backup|export|firestore|datastore)' \
  -g '!**/node_modules/**' \
  > audit/export_matches.txt
```

### 1B) Schedulers / Cron
```bash
rg -n --no-ignore -S \
  -e 'functions\.pubsub\.schedule' \
  -e '@google-cloud/scheduler' \
  -e 'onSchedule' \
  -e 'cron' \
  -e 'schedule\(' \
  -e 'CloudScheduler' \
  -e 'gcloud scheduler' \
  -e 'pubsubTarget' \
  -e 'httpTarget' \
  -g '!**/node_modules/**' \
  > audit/scheduler_matches.txt
```

### 1C) Legacy App Engine Artifacts
```bash
rg -n --no-ignore -S \
  -e '^runtime:' \
  -e 'automatic_scaling' \
  -e 'basic_scaling' \
  -e 'manual_scaling' \
  -e 'min_instances' \
  -e 'appengine' \
  -e 'queue\.yaml' \
  -e 'cron\.yaml' \
  -e 'dispatch\.yaml' \
  -g 'app.yaml' \
  -g 'cron.yaml' \
  -g 'queue.yaml' \
  -g 'dispatch.yaml' \
  > audit/appengine_legacy_matches.txt
```

### 1D) Loop Risks / Self-Triggering
```bash
rg -n --no-ignore -S \
  -e 'while\s*\(true\)' \
  -e 'setInterval\(' \
  -e 'setTimeout\([^,]+,\s*(0|1|10|100)\)' \
  -e '\.publish\(' \
  -e 'functions\.firestore\.document\(.*\)\.onWrite' \
  -e 'onDocumentWritten' \
  -e 'onCreate\(|onUpdate\(|onWrite\(' \
  -e 'recurs(e|ion)' \
  -e 'callable.*retry' \
  -g '!**/node_modules/**' \
  > audit/loop_matches.txt
```

List Firestore triggers to check for write-back to same collection:
```bash
rg -n --no-ignore -S 'functions\.firestore\.document\([^\)]*\)' -g '!**/node_modules/**' > audit/firestore_triggers.txt
```

### 1E) Bucket References (Find Backup Destinations)
```bash
rg -n --no-ignore -S \
  -e 'gs://[a-z0-9_\-\.]+' \
  -e 'BACKUP_BUCKET|OUTPUT_URI|FIRESTORE_BACKUP' \
  -g '!**/node_modules/**' \
  > audit/bucket_references.txt
```

### 1F) Infra/IaC/CI that Creates Schedulers or AE
```bash
rg -n --no-ignore -S \
  -e 'google_cloud_scheduler_job' \
  -e 'google_app_engine' \
  -e 'appengine' \
  -e 'gcloud scheduler jobs' \
  -e 'gcloud app deploy' \
  -g '!**/node_modules/**' \
  > audit/iac_matches.txt
```

---

## 2) Inventory File (fill this in): `audit/INVENTORY.md`

### 2A) Backup/Export Jobs
| File | Symbol | Type | Schedule | Destination (bucket/prefix) | Retention | Guardrails | Owner |
|---|---|---|---|---|---|---|---|

### 2B) Schedulers
| File | Job | Target (HTTP/PubSub) | Frequency | Idempotent | Backoff/Retry | maxInstances | Timeout |
|---|---|---|---|---|---|---|---|

### 2C) Legacy App Engine
| File | Setting | Deployed? | Action |
|---|---|---|---|

### 2D) Loop Risks
| File | Pattern | Risk | Mitigation |
|---|---|---|---|

---

## 3) Remediations (Code)

### 3A) Kill Switches + Caps for Schedulers
Require an env flag for any scheduler that can generate cost; singleton execution; bounded runtime.

```ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
setGlobalOptions({ region: "us-central1" });

const ENABLE_BACKUPS = process.env.ENABLE_FIRESTORE_EXPORT === "true";
const BACKUP_BUCKET = process.env.BACKUP_BUCKET;

export const nightlyFirestoreExport = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "America/Los_Angeles",
    retryCount: 0,              // Not idempotent → no auto-retry
    maxInstances: 1,            // Singleton
    memory: "256MiB",
    timeoutSeconds: 300
  },
  async () => {
    if (!ENABLE_BACKUPS) return console.info("Export disabled by flag");
    if (!BACKUP_BUCKET) return console.error("Missing BACKUP_BUCKET");

    // TODO: implement export via googleapis, include idempotency key per-day
  }
);
```

### 3B) Pagination Helper (Bounded Work)
Create `functions/src/lib/paginate.ts`:

```ts
import { Firestore } from "@google-cloud/firestore";
const db = new Firestore();

export async function paginateCollection<T = FirebaseFirestore.DocumentData>(
  path: string,
  opts: { batchSize?: number; orderBy?: string; startAfter?: FirebaseFirestore.DocumentSnapshot | null; where?: [string, FirebaseFirestore.WhereFilterOp, any][] } = {}
) {
  const batchSize = opts.batchSize ?? 500;
  let q: FirebaseFirestore.Query = db.collection(path);
  if (opts.where) for (const [f, op, v] of opts.where) q = q.where(f, op, v);
  q = q.orderBy(opts.orderBy ?? "createdAt").limit(batchSize);
  if (opts.startAfter) q = q.startAfter(opts.startAfter);
  const snap = await q.get();
  return { docs: snap.docs as FirebaseFirestore.QueryDocumentSnapshot<T>[], last: snap.docs.at(-1) ?? null };
}
```

### 3C) Cursor Persistence for Schedulers
Store the last processed doc/ref so the next run continues without scanning the whole collection.

```ts
import { Firestore } from "@google-cloud/firestore";
const db = new Firestore();
const cursorDoc = db.doc("ops_cursors/associationsIntegrityNightly");

async function loadCursor(): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const snap = await cursorDoc.get();
  const path = snap.get("lastPath");
  return path ? await db.doc(path).get() : null;
}

async function saveCursor(lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null) {
  await cursorDoc.set({ lastPath: lastDoc?.ref.path ?? null, ts: Date.now() }, { merge: true });
}
```

### 3D) Change-Detection Guard (ignore meta-only updates)
Create `functions/src/lib/shouldProcess.ts`:

```ts
export function isMeaningfulChange(before: any, after: any, ignore: string[] = ["updatedAt","lastUpdated"]) {
  const b = { ...before }; const a = { ...after };
  for (const f of ignore) { delete (b as any)[f]; delete (a as any)[f]; }
  return JSON.stringify(b) !== JSON.stringify(a);
}
```

Use in Firestore triggers:
```ts
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { isMeaningfulChange } from "../lib/shouldProcess";

export const onUserUpdated = onDocumentUpdated("users/{id}", async (event) => {
  const before = event.data?.before.data();
  const after  = event.data?.after.data();
  if (!before || !after) return;
  if (!isMeaningfulChange(before, after)) return; // exit early
  // ... do real work ...
});
```

### 3E) Idempotency & Locks (no concurrent runs)
Create `functions/src/lib/lock.ts`:

```ts
import { Firestore } from "@google-cloud/firestore";
const db = new Firestore();

export async function acquireLock(name: string, ttlMs = 25*60*1000) {
  const ref = db.doc(`ops_locks/${name}`);
  const now = Date.now();
  return await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get("status") === "running" && (now - (snap.get("ts") ?? 0) < ttlMs)) {
      throw new Error("Lock held");
    }
    tx.set(ref, { status: "running", ts: now }, { merge: true });
    return async () => { await ref.set({ status: "done", ts: Date.now() }, { merge: true }); };
  });
}
```

Usage:
```ts
export const associationsIntegrityNightly = onSchedule({ /* … */ }, async () => {
  const key = new Date().toISOString().slice(0,10); // 2025-10-01
  const release = await acquireLock(`associationsIntegrityNightly-${key}`);
  try {
    // do work in bounded pages, saving cursor
  } finally {
    await release();
  }
});
```

### 3F) Remove/Neutralize Legacy App Engine
- If `app.yaml`/`cron.yaml`/`queue.yaml` found and AE isn’t used → **remove** and strip AE deploys from CI.  
- If AE must remain, enforce `automatic_scaling: min_instances: 0`.

---

## 4) Frequencies (Propose & Apply)

- **Nightly (02:00 local):** heavy integrity jobs, cold-path enrichers.  
- **Every 6–12h:** association refreshers, cache rebuilders.  
- **Hourly** only when user-facing freshness requires it.  
- Shard large “all tenants” scans by day-of-week or paginate incrementally.

For `associationsIntegrityNightly`: do **not** full-scan if tenant count is large; shard or page and store cursors.

---

## 5) Observability & Billing Visibility

### 5A) Structured Summary Logs in Schedulers
```ts
const started = Date.now();
// ... work ...
console.log(JSON.stringify({
  event: "job_summary",
  job: "associationsIntegrityNightly",
  processed: count,
  duration_ms: Date.now() - started,
  success: true
}));
```

### 5B) Cloud Billing → BigQuery Export (Detailed Usage v2)
- Enable in **Billing → Cost & Usage → Data Export → BigQuery (Detailed)**.
- Save queries (examples):

```sql
-- App Engine cost by SKU for a month
SELECT sku.description AS sku, SUM(cost) AS cost_usd
FROM `YOUR_DATASET.gcp_billing_export_v1_*`
WHERE service.description = 'App Engine'
  AND usage_start_time >= '2025-09-01' AND usage_start_time < '2025-10-01'
GROUP BY 1
ORDER BY cost_usd DESC;

-- By project
SELECT project.id AS project, sku.description AS sku, SUM(cost) AS cost_usd
FROM `YOUR_DATASET.gcp_billing_export_v1_*`
WHERE service.description = 'App Engine'
  AND usage_start_time >= '2025-09-01' AND usage_start_time < '2025-10-01'
GROUP BY 1,2
ORDER BY cost_usd DESC;
```

### 5C) Alerts
Create policies for:
- Function executions/min spike
- Function error ratio spike
- Logs ingestion bytes above baseline

Commit YAML/Terraform if IaC exists; otherwise document Console steps in `ops/runbook.md`.

---

## 6) Bucket Lifecycle (Backups Only)

- Identify actual backup **bucket/prefix** (via Scheduler/Function code or Firestore export operations).
- Apply lifecycle **only** to backup prefix (not user content).

Example JSON:
```json
{
  "rule": [
    { "action": { "type": "Delete" }, "condition": { "age": 30 } }
  ]
}
```

Apply:
```bash
gcloud storage buckets update gs://YOUR-BACKUP-BUCKET --lifecycle-file=lifecycle-backups-30d.json
```

---

## 7) Orchestrator (Optional)

Replace many tiny Cloud Scheduler jobs with a single hourly **orchestrator** that reads a registry (task name, enabled, lastRunAt, intervalMinutes) and enqueues only what’s due.

---

## 8) Budgets & IAM Guardrails

- **Budget & Alerts**: Budget filtered to **Service = App Engine** at 25/50/75/100%.
- **IAM**: In prod, remove `App Engine Admin/Deployer` unless required. If AE is unused, add org/folder **Deny** for `appengine.versions.create`.
- **Function Safety Caps** everywhere (see §0 + per-fn overrides).

---

## 9) Deliverables (PRs)

1. **PR #1 – Schedulers Hardening**
   - Env kill-switch for each scheduler.
   - `maxInstances: 1`, `retryCount: 0`, conservative memory/timeout.
   - Introduce `lib/paginate.ts`, `lib/shouldProcess.ts`, `lib/lock.ts`; apply to all schedulers.

2. **PR #2 – Frequency Reductions**
   - Propose/implement cron reductions per job with one-line business rationale.

3. **PR #3 – Observability**
   - Structured summary logs.
   - Docs for enabling Billing export + saved queries.
   - Alerting policies (YAML/Terraform or documented steps).

4. **PR #4 – Orchestrator (optional)**
   - Single hourly orchestrator with registry; deprecate redundant Scheduler entries.

5. **Docs**
   - `audit/INVENTORY.md` completed.
   - `ops/runbook.md`: pause/resume jobs, adjust pagination, rollback.

---

## 10) Acceptance Criteria

- No scheduler runs without **maxInstances** and **lock/idempotency**.
- No trigger processes **meta-only** updates.
- No job performs **unbounded** collection scans.
- High-cost jobs reduced in frequency unless business-critical.
- BigQuery export + alerts in place; SKU-level AE costs visible.
- Legacy App Engine deployment paths removed or `min_instances: 0` enforced.

---

### Comment block to add atop edited files
```txt
// CHANGE: Hardening per cost-control policy
// - Added env kill-switch (ENABLE_*)
// - Added maxInstances/timeout/memory caps
// - Added idempotency lock + pagination to bound work
// - Ignoring meta-only updates (updatedAt/lastUpdated)
// - Structured summary logs for observability
```
