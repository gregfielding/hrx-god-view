# Translation Phase 1 — Go-Live Checklist

Deployment wiring, permissions, and guardrails so the translation engine runs continuously without surprises.

---

## 1) Create / confirm the Cloud Tasks queue

**Region:** Use the same region as your functions (e.g. `us-central1`).

```bash
gcloud tasks queues create translation-es \
  --location=us-central1 \
  --max-attempts=5 \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-doublings=5
```

If the queue already exists, you can skip or run with `--update-existing` if you need to change config.

**API:** Ensure Cloud Tasks API is enabled for the project:

```bash
gcloud services enable cloudtasks.googleapis.com
```

---

## 2) Cloud Tasks service account (OIDC)

You need a service account email for **`TASKS_SERVICE_ACCOUNT_EMAIL`**.

**Option A — Default Compute SA (simpler, broader):**  
`PROJECT_NUMBER-compute@developer.gserviceaccount.com`

**Option B — Dedicated SA (recommended):**

```bash
# Create SA
gcloud iam service-accounts create hrx-translation-tasks \
  --display-name="HRX Translation Cloud Tasks"

# Email will be: hrx-translation-tasks@PROJECT_ID.iam.gserviceaccount.com
```

This SA is used by Cloud Tasks to **invoke** the HTTP worker (OIDC token). It does **not** need permission to create tasks; the **Cloud Functions runtime SA** creates the tasks.

Give the Tasks SA:
- **Cloud Run Invoker** (Gen2 HTTP functions run on Cloud Run) on the `processTranslationJob` function / service.

---

## 3) Lock down the HTTP worker (OIDC-only)

Goal: only the Tasks service account can call `processTranslationJob`. No public access, no custom auth headers in code.

**After first deploy of the worker:**

1. Find the Cloud Run service name for `processTranslationJob` (e.g. in Firebase Console → Functions, or `gcloud run services list --region=us-central1`).
2. Remove public invoker (if present):
   ```bash
   gcloud run services remove-iam-policy-binding PROCESS_TRANSLATION_JOB_SERVICE_NAME \
     --region=us-central1 \
     --member="allUsers" \
     --role="roles/run.invoker"
   ```
3. Grant invoker only to your Tasks SA:
   ```bash
   gcloud run services add-iam-policy-binding PROCESS_TRANSLATION_JOB_SERVICE_NAME \
     --region=us-central1 \
     --member="serviceAccount:hrx-translation-tasks@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/run.invoker"
   ```

Replace `PROCESS_TRANSLATION_JOB_SERVICE_NAME` and `PROJECT_ID` with your values. Then set **`TASKS_SERVICE_ACCOUNT_EMAIL`** to that same SA email.

---

## 4) Deploy order (worker URL dependency)

You cannot set **`TRANSLATION_WORKER_URL`** until the worker exists.

1. **Deploy** `processTranslationJob` only (or deploy all functions once).
2. **Copy** the HTTPS URL of `processTranslationJob` from the Firebase Console or:
   ```bash
   gcloud functions describe processTranslationJob --gen2 --region=us-central1 --format="value(serviceConfig.uri)"
   ```
3. **Set** `TRANSLATION_WORKER_URL` in your functions config (see §5).
4. **Redeploy** only the trigger so it gets the new env (no need to deploy all functions):
   ```bash
   firebase deploy --only functions:onJobPostingWrite
   ```

---

## 5) Satisfying the needs (worker + trigger)

### Worker (HTTP): `processTranslationJob`

| Need | How to satisfy |
|------|----------------|
| **OPENAI_API_KEY** | Same as your other functions. Add to `functions/.env` or `functions/.env.<projectId>` (e.g. `.env.hrx1-d3beb`). The worker also checks `OPENAI_KEY` and Firestore via `getOpenAIKey(tenantId)`. |
| **Invokable by Cloud Tasks SA only** | After deploy: remove `allUsers` invoker from the worker’s Cloud Run service; grant **only** `TASKS_SERVICE_ACCOUNT_EMAIL` the role **Cloud Run Invoker**. See §3 below. |

### Trigger (Firestore): `onJobPostingWrite`

| Need | How to satisfy |
|------|----------------|
| **TRANSLATION_ENABLED** | Set to `true` or `false` in `functions/.env` or `functions/.env.<projectId>`. Trigger reads `process.env.TRANSLATION_ENABLED` and no-ops when not `"true"`. |
| **Queue + worker URL + tasks SA for enqueuer** | Same env files. Set: `TRANSLATION_WORKER_URL`, `TASKS_SERVICE_ACCOUNT_EMAIL`. Optional: `TASKS_LOCATION` (default `us-central1`), `TASKS_QUEUE_TRANSLATION` (default `translation-es`). |

**Template:** Copy variable names from `functions/translation.env.example` into your `.env` or `.env.<projectId>`, fill in values, then redeploy so the trigger and worker get the new vars.

---

## 5b) Required env / secrets (reference)

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENAI_API_KEY` | Yes (worker) | Same as other OpenAI-using functions; in `.env` / `.env.<projectId>`. |
| `TRANSLATION_WORKER_URL` | Yes (trigger) | Full HTTPS URL of `processTranslationJob` (from Console or `gcloud functions describe processTranslationJob --gen2 --region=us-central1 --format="value(serviceConfig.uri)"`). |
| `TASKS_SERVICE_ACCOUNT_EMAIL` | Yes (trigger) | SA used by Cloud Tasks for OIDC; must have **Cloud Run Invoker** on the worker. |
| `TRANSLATION_ENABLED` | Yes (prod) | `true` to enable; `false` or unset = trigger no-ops. |
| `TRANSLATION_LOG_LEVEL` | No | `normal` \| `verbose`. |
| `TASKS_LOCATION` | No | Default `us-central1`. |
| `TASKS_QUEUE_TRANSLATION` | No | Default `translation-es`. |

This project loads env from `functions/.env` and `functions/.env.<projectId>` at deploy time. Add the translation variables there; no need for `firebase functions:config` for these.

---

## 6) Runtime identity: who creates tasks?

The code that **creates** tasks runs under the **Cloud Functions default runtime service account** (e.g. `PROJECT_ID@appspot.gserviceaccount.com` or your custom runtime SA).

That identity needs permission to **enqueue** tasks:

- **Cloud Tasks Enqueuer** (`roles/cloudtasks.enqueuer`) on the project or the queue, **or**
- A custom role with `cloudtasks.tasks.create` on the queue.

Grant (example):

```bash
# Replace with your runtime SA and project
gcloud tasks queues add-iam-policy-binding translation-es \
  --location=us-central1 \
  --member="serviceAccount:PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"
```

---

## 7) Manual test (fast, definitive)

1. **Create a job posting** with only EN:
   - `postTitle_i18n.en`, `jobTitle_i18n.en`, `jobDescription_i18n.en` (and optionally `requirements_i18n.en`, `payDetails_i18n.en`).
2. **Confirm** a Cloud Task is created (Cloud Console → Cloud Tasks → `translation-es` queue).
3. **Confirm** the worker runs and writes:
   - `*_i18n.es` for those fields
   - `translationMeta.es.fieldHashes` with per-field hashes
4. **Confirm no loop:** the worker write is “translation-only”; the trigger should skip enqueue (no second task).
5. **Update** e.g. `jobDescription_i18n.en` → confirm ES for that field refreshes (and only needed fields re-translate if using per-field hashes).
6. **Manual lock:** set `translationMeta.es.status = "manual"` (or add fields to `translationMeta.es.manualFields`). Edit EN again → confirm ES is not overwritten.

---

## 8) Per-field manual locks (optional)

Doc-level lock: `translationMeta.es.status === "manual"` → no auto-translation for the whole doc.

Per-field lock: `translationMeta.es.manualFields` (array of field paths, e.g. `["jobDescription_i18n"]`). Only those fields are skipped; others still translate. Implemented in code so recruiters can lock a single field.

---

## 9) Hash model

The worker uses **per-field hashes** in `translationMeta.es.fieldHashes`. Partial doc updates only re-translate fields whose EN (and thus hash) changed; no single shared `sourceHash` for the whole doc.

---

## 10) Monitoring checklist

- **Cloud Tasks queue depth** — Spikes or growth → worker failing or IAM blocking invocation.
- **Worker logs** — OpenAI errors, placeholder mismatch errors, 5xx vs 200.
- **Firestore write rate** on `job_postings` — Ensure no feedback loop (trigger → task → write → trigger).
- **`translation_logs`** — Success/error ratio, average `durationMs`, `fieldCount`, `skippedDueToLength`; use for cost and health.

Set alerts on queue depth and error rate so you catch issues early.

---

## 11) Deployment reminder (before first production run)

- [ ] Cloud Tasks queue exists and API enabled
- [ ] `TASKS_SERVICE_ACCOUNT_EMAIL` has `roles/run.invoker` on the worker
- [ ] Runtime service account can enqueue tasks (Cloud Tasks Enqueuer)
- [ ] `TRANSLATION_WORKER_URL` is correct
- [ ] `OPENAI_API_KEY` (or Secret Manager binding) works
- [ ] `TRANSLATION_ENABLED=true` when you want translation on; set to `false` to disable without redeploying code

**Budget guard:** Fields whose source text exceeds 8000 characters are skipped and recorded in `translation_logs.skippedDueToLength`.

---

## 12) Go-live sequence (safe order)

When you’re ready:

1. **Deploy everything with `TRANSLATION_ENABLED=false`**
2. **Confirm**
   - No tasks being enqueued
   - Trigger exits cleanly (no errors)
3. **Set** `TRANSLATION_ENABLED=true`
4. **Redeploy** the trigger (so it picks up the new env)
5. **Create one new test posting** (EN-only `*_i18n` fields)
6. **Confirm**
   - One Cloud Task created
   - One worker execution
   - One translation write to the doc
   - No additional task (no loop)
   - One `translation_logs` entry with correct summary

Then:

- Enable for **one staging tenant**
- Wait **24h**
- Then allow **real traffic** (broader rollout)

---

## 13) Things to watch immediately

| Watch | Why |
|-------|-----|
| **Cloud Tasks backlog** | Should stay near zero. Growth = worker failing or IAM blocked. |
| **`translation_logs` `skippedDueToLength` spikes** | Many entries → recruiters pasting very large blocks; consider UX or limits. |
| **Firestore write rate on `job_postings`** | Should not spike beyond normal edits. Spikes suggest a loop or runaway trigger. |
| **OpenAI latency** | If average > 3–5s, consider timeout and retry tuning (worker timeout is 120s). |

---

## 14) Strategic take

This is a **multilingual content pipeline**, not just job translation.

It’s the backbone for:

- Multi-language onboarding flows
- AI-driven worker coaching in Spanish
- Cross-language engagement analytics
- Future auto-translation of recruiter notes
- Spanish-first recruiting campaigns
