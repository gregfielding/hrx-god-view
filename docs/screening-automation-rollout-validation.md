# Screening automation — rollout validation packet

Operational reference for assignment-confirmed AccuSource automation (`onAssignmentConfirmedScreeningAutomation`).

---

## 1. Runtime flags and tenant config (modes)

### Environment variables (Cloud Functions runtime)

| Mode | `SCREENING_AUTOMATION_ENABLED` | `SCREENING_AUTOMATION_DRY_RUN` | Effective behavior |
|------|-------------------------------|--------------------------------|---------------------|
| **Off** | unset or not `true` | any | Automation does not run (early exit after transition check). No AccuSource call, no run doc, no audit from automation (see Cloud logs: `[screeningAutomation] disabled`). |
| **Dry-run** | `true` | unset or not `false` | **Default safe combo:** automation runs, resolves package, evaluates prior screenings, writes **audit** + **run doc** + **activity log** (“dry run”). **No** AccuSource API order. **No** worker push/inbox notification. |
| **Live** | `true` | `false` | Full order path: AccuSource order, automation fields on `backgroundChecks/{id}`, worker **activity log**, **notification** (push + inbox). |

**Resolution order:** Tenant document overrides env when a field is set; otherwise env applies.

- Env: `functions/src/compliance/screeningAutomationConfig.ts`
  - `enabled = process.env.SCREENING_AUTOMATION_ENABLED === 'true'`
  - `dryRun = process.env.SCREENING_AUTOMATION_DRY_RUN !== 'false'` → **dry-run is default when enabled** until `DRY_RUN=false`.

### Tenant override (Firestore)

**Path:** `tenants/{tenantId}/config/screeningAutomation`

**Examples:**

```json
// Inherit env only (no doc) — typical during rollout
```

```json
// Pilot tenant: automation on, still dry-run even if env says live
{
  "enabled": true,
  "dryRun": true
}
```

```json
// Single-tenant go-live (env still dry-run globally)
{
  "enabled": true,
  "dryRun": false
}
```

```json
// Emergency off for one tenant without redeploy
{
  "enabled": false
}
```

---

## 2. Notification timing (verification)

**Requirement:** Worker notifications **only** on real AccuSource orders.

**Implementation:** `sendNotificationAndPush` is invoked only in the **live** branch, **after** the `if (cfg.dryRun) { ... return; }` block (`screeningAutomationTrigger.ts`). Dry-run path returns before any notification call.

**QA proof:** In dry-run mode, confirm assignment → check `users/{workerUid}/notifications` — **no** new doc with `metadata.kind === 'screening_auto_ordered'` for this flow.

---

## 3. Manual QA — five assignment scenarios

Prerequisites: test tenant ID, test worker `candidateId`, job order with resolvable package (or location/account defaults). Use a non-production tenant first.

| # | Scenario | Setup | Expected |
|---|----------|--------|----------|
| **1** | Automation **off** | Env: `SCREENING_AUTOMATION_ENABLED` unset/false. Transition assignment `status` → `confirmed`. | No new doc in `screening_automation_runs/{assignmentId}`. Logs show disabled. |
| **2** | **Dry-run** with package | Env: `ENABLED=true`, `DRY_RUN` default or `true`. Job order (or layers) has package name/id. No prior satisfying BG. | Run doc `status: dry_run_completed`. Audit `outcome: dry_run` then evaluation log. Activity “Screening automation (dry run)”. **No** new `backgroundChecks` from automation. **No** notification. |
| **3** | **Live** order | Same as #2 but `DRY_RUN=false`. No prior satisfying BG. | Run doc `status: completed`. New `backgroundChecks/{id}` with `automationSource`, `automationAssignmentId`. Audit includes `ordered_live`. Worker notification created. |
| **4** | **Skipped — already satisfied** | Prior `backgroundChecks` for worker: completed/report_ready **and** equivalency key matches resolved package. | Run doc `status: skipped_satisfied`. Audit `outcome: skipped_already_satisfied` with `priorScreeningEvaluations`, `matchedBackgroundCheckIds`. **No** new order. **No** notification. |
| **5** | **Skipped — no package** | Job order + location + account have no package fields. | Run doc `status: skipped_no_package`. Audit `outcome: skipped_no_package`. **No** notification. |

**Idempotency spot-check:** Repeat a write that **does not** change `status` from non-confirmed to confirmed — trigger should **not** re-fire. Re-confirming after a finalized run should hit idempotent skip (see run statuses below).

---

## 4. Firestore collections/docs to inspect (per scenario)

| Artifact | Path | What to check |
|----------|------|----------------|
| Assignment | `tenants/{tenantId}/assignments/{assignmentId}` | `status === 'confirmed'`, `candidateId` / `userId`, `jobOrderId` |
| Run record | `tenants/{tenantId}/screening_automation_runs/{assignmentId}` | `status`, `fingerprint`, `dryRun`, `backgroundCheckId` (if live), `matchedBackgroundCheckId` (if skipped satisfied) |
| Audit trail | `tenants/{tenantId}/screening_automation_audit` (query `assignmentId` / order by `createdAt`) | `outcome`, `reasonSummary`, `resolvedPackageKey`, `priorScreeningEvaluations`, `matchedBackgroundCheckIds` / `newBackgroundCheckId` |
| Order (if live) | `backgroundChecks/{backgroundCheckId}` | `automationSource`, `automationAssignmentId`, `tenantId`, `candidateId` |
| Worker activity | `users/{candidateId}/activityLogs` | Dry-run vs live descriptions |
| Worker inbox | `users/{candidateId}/notifications` | **Only for live orders** — title “Background screening started” |

**Cloud Logging:** Filter `[screeningAutomation]` for structured evaluation logs.

---

## 5. Run doc statuses (`screening_automation_runs/{assignmentId}.status`)

| Status | Meaning |
|--------|---------|
| `processing` | Lock taken; work in progress (should be brief). |
| `dry_run_completed` | Dry-run finished; payload logged, **no** provider order. |
| `completed` | Live order succeeded; `backgroundCheckId` set. |
| `failed` | Live order threw; `error` on run doc; audit `order_failed`. |
| `skipped_satisfied` | Existing screening matched package + completion rules; no new order. |
| `skipped_no_package` | Could not resolve package from job/location/account. |
| *(none)* | Automation disabled or missing refs — often **no run doc** (early exit). |

Idempotent re-entry: if status is already `completed`, `dry_run_completed`, `skipped_satisfied`, or `skipped_no_package`, a new transition to `confirmed` will not re-process (same assignment doc id).

---

## 6. Audit fields (equivalency / disputes)

Each audit doc should make disputes debuggable:

- **`resolvedPackageKey`** — Canonical key required for this assignment (`id:…` or `name:…`).
- **`packageFingerprint`** — `packageName|packageId` merge fingerprint.
- **`resolvedPackageLayers`** — Merge result (job / location / account sources).
- **`priorScreeningEvaluations`** — One entry per `backgroundChecks` row examined: `backgroundCheckId`, `equivalencyKey`, `satisfied`, **`decisionDetail`** (human-readable).
- **`matchedBackgroundCheckIds`** — When skipped as satisfied, the winning doc id(s).
- **`reasonSummary`** — Short operator-facing sentence.
- **`outcome`** — Machine enum (`skipped_already_satisfied`, `dry_run`, `ordered_live`, etc.).

---

## 7. Rollback procedure (unexpected ordering)

1. **Stop new automation immediately**
   - Set **env:** `SCREENING_AUTOMATION_ENABLED=false` (redeploy functions **or** use your secret/param pipeline).
   - **Or** per tenant: `tenants/{tenantId}/config/screeningAutomation` → `{ "enabled": false }` (no deploy if you use Firestore-only override).

2. **Verify**
   - Confirm a test assignment: no new `screening_automation_runs` progression beyond existing docs; logs show `[screeningAutomation] disabled`.

3. **Optional data cleanup** (only if a bad order was created)
   - Do **not** delete worker-facing `backgroundChecks` without AccuSource ops guidance.
   - For **run doc** mistakes: you may delete `screening_automation_runs/{assignmentId}` **only** to allow a manual retry after fixing config (automation will treat as fresh only on a **new** confirmed transition — usually requires status churn; coordinate with ops).

4. **Communications**
   - If workers were notified incorrectly, use your normal support process; automation should not notify in dry-run (see §2).

5. **Re-enable**
   - Restore `ENABLED=true` with `DRY_RUN=true` first; validate audits; then `DRY_RUN=false` for live.

---

## 8. Deploy notes

- `createBackgroundCheckInternal` is **not** a deployable function name. Deploy the function export: `onAssignmentConfirmedScreeningAutomation` (or full `functions`).
- Use project-pinned CLI: `npx firebase deploy --only functions:onAssignmentConfirmedScreeningAutomation` from repo root.
