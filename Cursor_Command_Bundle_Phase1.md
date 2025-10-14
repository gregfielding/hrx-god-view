# Cursor Command Bundle — Function Hardening Phase 1

**Project:** `hrx1-d3beb`  
**Goal:** Direct Cursor to rewrite specific Cloud Functions using the hardening rules, generate PRs, and prepare deploy scripts you will run outside Cursor.

---

## 0) Paste This Prompt Into Cursor

> **Goal:** Apply the cost-hardening rules from `CloudFunctions_Cost_Hardening_Playbook.md` to the first four high-impact functions and open a PR.
>
> **Branch:** `function-hardening-phase1`
>
> **Functions to modify (Phase 1):**
> 1. `firestoreLogTaskUpdated`
> 2. `updateActiveSalespeopleOnDeal`
> 3. `scheduledGmailMonitoring`
> 4. `executePendingCampaigns`
>
> **Implement the following in each function:**
> - **No‑op guard (`relevantChanges`)**: skip updates that change only `updatedAt`, `lastSeen`, `_lastProcessedHash`, etc. For each trigger, define a **whitelist of meaningful fields**.
> - **Idempotency (`ensureFirstTime`)**: persist `processedEvents/{eventId}` with TTL and **return early** if already processed.
> - **Debounce via Cloud Tasks (`enqueueOnce`)**: for hot documents, enqueue a single key‑based task with ~800ms delay to process the **final** state once.
> - **Pagination & bounded fan‑out**: no full collection scans; always `.limit()` + cursors; respect per‑tenant caps.
> - **Logging**: structured summary logs only; remove large object dumps; sample debug logs.
> - **Feature flags**: gate schedulers/workers with `ENABLE_*` env vars; default false.
> - **Retries**: schedulers must set `retry: false`.
>
> **Per‑function specifics:**
> - `firestoreLogTaskUpdated`:
>   - Whitelist fields: `['status','assigneeId','dueDate','priority','title']`.
>   - Idempotency by `event.id`.
>   - Debounce updates by doc ID.
> - `updateActiveSalespeopleOnDeal`:
>   - Whitelist: `['stage','ownerId','amount','closedate','probability']`.
>   - Ensure no write‑back loops; write only when the derived value actually changes.
> - `scheduledGmailMonitoring`:
>   - Frequency handled outside code; **inside code**: enforce max pages per run, time budget guard (stop after ~45s), and per‑tenant locks. Log a compact summary: `{tenantsProcessed, pages, newItems}`.
> - `executePendingCampaigns`:
>   - Process **N** campaigns per run (configurable, default 50); use cursor pagination; **no global scan**. Add per‑campaign idempotency key if updates are retried.
>
> **Create/Update helper libs (if not present):**
> - `functions/src/lib/relevantChanges.ts`
> - `functions/src/lib/idempotency.ts`
> - `functions/src/lib/debounce.ts`
>
> **Add npm scripts to root `package.json`:**
> ```json
> {
>   "scripts": {
>     "deploy:hardening:phase1": "bash scripts/deploy_hardening_phase1.sh"
>   }
> }
> ```
>
> **Create `scripts/deploy_hardening_phase1.sh`:**
> ```bash
> #!/usr/bin/env bash
> set -euo pipefail
> REGION=us-central1
> 
> # Firestore triggers: 1 instance, 1 concurrency, tight limits
> gcloud functions deploy firestoreLogTaskUpdated --gen2 --region=$REGION >   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry
> 
> gcloud functions deploy updateActiveSalespeopleOnDeal --gen2 --region=$REGION >   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry
> 
> # Schedulers: strict caps + retry off + feature flags
> gcloud functions deploy scheduledGmailMonitoring --gen2 --region=$REGION >   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry >   --set-env-vars ENABLE_GMAIL_MONITORING=true
> 
> gcloud functions deploy executePendingCampaigns --gen2 --region=$REGION >   --max-instances=1 --concurrency=1 --memory=256Mi --timeout=60s --no-retry >   --set-env-vars ENABLE_EXECUTE_CAMPAIGNS=true
> ```
>
> **Deliverables:**
> - New branch `function-hardening-phase1` with code changes.
> - A PR with a checklist explaining changes for each function.
> - The script `scripts/deploy_hardening_phase1.sh` + npm script hook.
>
> **Validation tasks:**
> - Unit tests/mocks for `relevantChanges`, `ensureFirstTime`, and `enqueueOnce`.
> - Dry‑run logs showing triggers skip on no‑op updates.
> - Ensure no circular write loops.
>
> **Do not** run deployments; only generate code + PR. I will deploy from terminal/CI.
>
> If anything is unclear, ask me for the relevant file paths and existing function implementations before changes.
>
> **Finally**, print a summary of all files created/edited and a checklist for me to verify post‑merge.
>
> Thanks! Apply Phase 1 now.
