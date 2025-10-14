# Cloud Functions Cost Hardening Playbook (Cursor + Manual Ops)

**Project:** `hrx1-d3beb`  
**Goal:** Cut App Engine / Cloud Run (Functions) spend by stopping trigger storms, shrinking instances, and enforcing safe runtime limits.

> This document has two parts:  
> 1) **Exactly what to change** (functions, reasons, new rules, code snippets, and deploy commands).  
> 2) **Step‑by‑step manual ops** you’ll do outside of Cursor (gcloud, verification, and rollback).

---

## 0) TL;DR (What’s driving cost)

From the BigQuery billing CSV you exported, the biggest items were **Cloud Run Functions CPU/Memory** and **Cloud Scheduler Jobs**. That typically maps to:  
- **Firestore `onWrite/onUpdate` triggers** firing too often (no‑op writes, cascades).  
- **Schedulers** running too frequently / fanning out.  
- **Callable/HTTP** functions each using their own instance for short work (low concurrency).

---

## 1) Targeted Functions to Change (first wave)

These are the **most likely cost drivers** in your function list. We’ll harden these first. (You can apply the same patterns to the rest.)

### A) Firestore triggers (write amplifiers)
- `firestoreLog*Updated` (dozens of variants)  
- `updateActiveSalespeopleOn*` (on ActivityLog, Deal, EmailLog, Task)  
- `rebuild*` / `migrate*` helpers if still enabled

**Why:** These react to high‑frequency document changes; many of them log or mutate other docs, creating **write cascades**. If a doc is updated multiple times in seconds, triggers fire repeatedly.  
**Fix:** No‑op guards + idempotency + debounce + bulk writes.

**Deploy intent:** `--max-instances=1 --concurrency=1 --timeout=60s`

---

### B) Schedulers and batch jobs
- `scheduledGmailMonitoring`  
- `executePendingCampaigns`  
- `associationsIntegrityNightly` (already refactored with lock + pagination)  
- `scheduleRecurringCheckinV2`, `runAIScheduler`, `scheduleAutomatedJSIReports`

**Why:** Frequent schedule with unbounded work or per‑tenant loops.  
**Fix:** Reduce frequency; shard by day; enforce pagination; cap instances and disable retries; use tenancy locks.

**Deploy intent:** `--max-instances=1 --concurrency=1 --timeout=60s --no-retry`

---

### C) Callables/HTTP with high instance caps or long timeouts
- High caps: `inviteUser (maxInstances=20)`, `setTenantRole (20)`, `updateUserActivity (20)`  
- Long timeouts: `sendOtp (240s)`, `sendWorkerMessage (240s)`, `updateUserLoginInfo (240s)`, `getUsersByTenant (timeout=60s, maxInstances=5)`

**Why:** Excess instance hours and over‑provisioned timeouts/memory.  
**Fix:** Raise **concurrency** (40–80) and **lower maxInstances** (2–4). Tighten timeouts to realistic ceilings.

**Deploy intent:** `--concurrency=60 --max-instances=2 --memory=256Mi --timeout=30s`  
*(bump memory/timeout only if profiling shows it’s required)*

---

## 2) New “Hardening” Rules (apply to **all** functions)

1. **No‑op Guards for Firestore triggers**  
   - Skip if only `updatedAt`, `lastSeen`, or cosmetic fields changed.  
   - Whitelist meaningful fields per trigger.

2. **Idempotency for triggers**  
   - Persist `processedEvents/{eventId}` with a TTL. If exists → return.

3. **Debounce hot doc updates**  
   - Enqueue a Cloud Task per doc ID with 500–1500ms delay; worker processes the *final* state once.

4. **Pagination + bounded fan‑out**  
   - Always use `.limit()` + cursors; no full collection scans.

5. **BulkWriter + transforms**  
   - Use `BulkWriter` with capped QPS for mass updates. Prefer `increment`, `arrayUnion` transforms.

6. **Scheduler discipline**  
   - Use fewer, slower schedules. Prefer an **orchestrator** that fan‑outs internally and checks kill‑switch flags.  
   - **`retry: false`** for non‑idempotent jobs.

7. **Runtime limits**  
   - **Schedulers & triggers:** `max-instances=1`, `concurrency=1`, `timeout≤60s`, memory `256–512Mi`.  
   - **Callables/HTTP:** `concurrency=40–80`, `max-instances=2–4`, `timeout≤30–60s`, memory `256Mi` (raise only if needed).

8. **Feature flags & kill switches** *(already added)*  
   - `ENABLE_*` env vars per scheduler/worker; default to `false` in prod and toggle intentionally.

9. **Logging budget**  
   - Summary logs only; no large object dumps. Use counters / timings; sample at 1–5%.

10. **Region & cold start**  
   - Keep everything in a single primary region (`us-central1`). Avoid min instances unless truly necessary.

---

## 3) Code Snippets (drop‑in)

### 3.1 Relevant‑field change guard
```ts
// lib/relevantChanges.ts
import type { Change } from 'firebase-functions/v2/firestore';
import { DocumentSnapshot } from 'firebase-admin/firestore';

const IGNORED = new Set(['updatedAt', 'lastSeen', 'lastUpdatedBy', '_lastProcessedHash']);

export function relevantChanges(change: Change<DocumentSnapshot>, fields?: string[]) {
  const before = change.before.exists ? change.before.data() ?? {} : {};
  const after = change.after.exists ? change.after.data() ?? {} : {};
  const keys = fields && fields.length ? fields : Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const a = JSON.stringify(after[k]);
    const b = JSON.stringify(before[k]);
    if (a !== b) return true;
  }
  return false;
}
```

### 3.2 Idempotency by eventId
```ts
// lib/idempotency.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

export async function ensureFirstTime(eventId: string): Promise<boolean> {
  const ref = db.doc(`processedEvents/${eventId}`);
  const snap = await ref.get();
  if (snap.exists) return false;
  await ref.set({ at: FieldValue.serverTimestamp() }, { merge: false });
  return true;
}
```

Usage in a trigger:
```ts
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { relevantChanges } from './lib/relevantChanges';
import { ensureFirstTime } from './lib/idempotency';

export const firestoreLogTaskUpdated = onDocumentWritten('tenants/{t}/tasks/{id}', async (event) => {
  if (!(await ensureFirstTime(event.id))) return;
  const change = event.data;
  if (!change?.after?.exists) return;
  if (!relevantChanges(change, ['status','assigneeId','dueDate','priority'])) return;

  // ... do minimal work; optionally enqueue a debounce task ...
});
```

### 3.3 Debounce with Cloud Tasks (single fire per doc)
```ts
// lib/debounce.ts
import { CloudTasksClient } from '@google-cloud/tasks';
const client = new CloudTasksClient();
const QUEUE = process.env.TASKS_QUEUE || 'debounce-queue';
const LOCATION = process.env.TASKS_LOCATION || 'us-central1';

export async function enqueueOnce(path: string, payload: object, delayMs = 800) {
  const parent = client.queuePath(process.env.GCP_PROJECT!, LOCATION, QUEUE);
  await client.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `https://${LOCATION}-${process.env.GCP_PROJECT!}.cloudfunctions.net${path}`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
      scheduleTime: { seconds: Math.floor((Date.now() + delayMs) / 1000) }
    }
  });
}
```

> Create the queue once:  
> `gcloud tasks queues create debounce-queue --location=us-central1`

---

## 4) Redeploy Matrix (commands you can paste)

> **Region assumptions:** `us-central1`. Adjust if different.

### 4.1 Firestore triggers (cap instances and concurrency)
```bash
# Example patterns (repeat for each trigger group)
gcloud functions deploy firestoreLogTaskUpdated --gen2 --region=us-central1   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry

gcloud functions deploy updateActiveSalespeopleOnTask --gen2 --region=us-central1   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry
```

### 4.2 Schedulers (slow down + hard caps)
```bash
gcloud functions deploy scheduledGmailMonitoring --gen2 --region=us-central1   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry   --set-env-vars ENABLE_GMAIL_MONITORING=true

gcloud functions deploy executePendingCampaigns --gen2 --region=us-central1   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry   --set-env-vars ENABLE_EXECUTE_CAMPAIGNS=true
```

### 4.3 High‑cap callables/HTTP (increase concurrency, reduce instances)
```bash
gcloud functions deploy inviteUser --gen2 --region=us-central1   --concurrency=60 --max-instances=2 --memory=256Mi --timeout=30s

gcloud functions deploy setTenantRole --gen2 --region=us-central1   --concurrency=60 --max-instances=2 --memory=256Mi --timeout=30s

gcloud functions deploy updateUserActivity --gen2 --region=us-central1   --concurrency=60 --max-instances=2 --memory=256Mi --timeout=30s

gcloud functions deploy getUsersByTenant --gen2 --region=us-central1   --concurrency=40 --max-instances=2 --memory=256Mi --timeout=30s
```

### 4.4 Long‑timeout utilities (tighten where possible)
```bash
gcloud functions deploy sendOtp --gen2 --region=us-central1   --concurrency=40 --max-instances=2 --memory=256Mi --timeout=60s

gcloud functions deploy sendWorkerMessage --gen2 --region=us-central1   --concurrency=40 --max-instances=2 --memory=256Mi --timeout=60s

gcloud functions deploy updateUserLoginInfo --gen2 --region=us-central1   --concurrency=40 --max-instances=2 --memory=256Mi --timeout=60s
```

> **Note:** If any function truly needs more headroom, profile first and raise memory/timeout minimally.

---

## 5) Manual Ops — step‑by‑step (outside Cursor)

1. **Authenticate & set project**
   ```bash
   gcloud auth login
   gcloud config set project hrx1-d3beb
   gcloud config set run/region us-central1
   ```

2. **Create a Cloud Tasks queue (for debounce)**
   ```bash
   gcloud tasks queues create debounce-queue --location=us-central1
   ```

3. **(Optional) Set feature flags (kill switches)**
   ```bash
   gcloud functions deploy scheduledGmailMonitoring --gen2 --region=us-central1      --set-env-vars ENABLE_GMAIL_MONITORING=false
   # Repeat per scheduler until ready to re-enable
   ```

4. **Deploy the “first wave” changes** (use the commands in Section 4).

5. **Verify in Cloud Logging (15–60 min)**
   - Check for ERROR/retry loops.  
   - Validate reduced invocation counts on triggers.

6. **Confirm in BigQuery (next daily export)**
   - Run cost by function query:
     ```sql
     SELECT
       (SELECT ANY_VALUE(l.value) FROM UNNEST(labels) l
        WHERE l.key IN ('function_name','cloud_function','run.googleapis.com/service_name')) AS function,
       ROUND(SUM(cost),2) AS usd
     FROM `hrx1-d3beb.billing_export.gcp_billing_export_*`
     WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
       AND service.description IN ('Cloud Run Functions','App Engine')
     GROUP BY function
     ORDER BY usd DESC
     LIMIT 50;
     ```

7. **Iterate**  
   - Apply the same hardening to the remaining `firestoreLog*` functions.  
   - Reduce scheduler frequency or move to orchestrator pattern.

8. **Rollback (if needed)**  
   - List previous revisions and roll back:
     ```bash
     gcloud functions versions list <NAME> --region=us-central1
     gcloud functions versions delete <REVISION_ID> --region=us-central1
     # Or redeploy the last known good version
     ```

---

## 6) Ongoing Guardrails

- **Daily cost email**: scheduled BigQuery query top 10 functions by $ spend.  
- **Budget alerts**: set budget + % thresholds in Cloud Billing.  
- **Dashboards**: Looker Studio or Cloud Monitoring for invocations & instance time.

---

## 7) What Cursor should do in a PR

- Add **relevantChanges**, **idempotency**, and **debounce** utilities and wire them into all Firestore triggers.  
- Enforce `.limit()` + pagination for any multi-doc operation.  
- Add **orchestrator** scheduler and move frequent jobs under flags.  
- Add **npm scripts** for staging/prod deploys with recommended flags.  
- Commit `bigquery/queries.sql` and an **ops README**.

---

**That’s it.** Apply Section 4 deploys to the listed functions first, monitor logs for a day, then continue rolling out the hardening rules across the rest.
