# `readinessSnapshotV1` — production verification checklist

Short rollout checks after deploying HRX assignment readiness. Canonical contract and trigger map: [`READINESS_SNAPSHOT_V1.md`](./READINESS_SNAPSHOT_V1.md).

---

## 1. Function deployment / indexes

- [ ] **Build** — From repo root: `cd functions && npm run build` (includes `build:hrx-readiness-snapshot` esbuild for `syncHrxReadinessSnapshotV1.cjs`).
- [ ] **Deploy functions** — Deploy at least:
  - Callable: **`syncHrxReadinessSnapshotV1`**
  - All **`syncHrxReadinessSnapshotV1On*`** triggers (upstream, user, hiring linkage) plus **`assignmentReadinessOnAssignmentWrite`** / **`assignmentReadinessOnBackgroundCheckWrite`** (inline snapshot refresh on assignment / background writes).
  - Easiest safe path: `firebase deploy --only functions` for the target project/region (**us-central1** for Gen2 as currently used).
- [ ] **Firestore indexes** — `firebase deploy --only firestore:indexes` (or confirm prod already has collection group **`assignments`**: `(userId, status)`, `(candidateId, status)`, `(jobOrderId, status)` per main doc). Missing indexes show as **FAILED_PRECONDITION** in logs, not always in UI.
- [ ] **IAM / invoker** — Callable reachable from HRX web (auth + tenant rules as today). Triggers use default compute SA; no extra step unless org locks down Firestore triggers.

---

## 2. Manual Firestore verification (`assignments/{assignmentId}`)

Pick a **live** assignment (`pending` … `active`) with a known worker and job order.

- [ ] **Field present** — `readinessSnapshotV1` exists after first compute (tab open, assignment write, or upstream trigger). If absent, open **User Profile → Readiness** for that assignment or touch the assignment doc to force a path.
- [ ] **Shape** — `state`, `sourceVersion` (**1**), `summary` `{ blockers, warnings, completed }`, `requirements[]` with `key`, `label`, `category`, `status`, `severity`, and `updatedAt` server timestamp.
- [ ] **Consistency** — Compare `state` / requirement rows to **Readiness tab** for the same assignment (same engine + loader after pipeline-alignment deploy). Large drift means wrong project, stale deploy, or unresolved `jobOrderId` / hiring entity.

---

## 3. Sample upstream-change tests

For one **test assignment**, note `readinessSnapshotV1.updatedAt` and a hash of `requirements` (or screenshot). Then apply **one** change at a time; expect `updatedAt` to advance when readiness actually changes (idempotent skip if comparable JSON unchanged).

| Area | Test action | What should refresh (typical) |
|------|-------------|-------------------------------|
| **Assignment** | Edit assignment field that flows through readiness (e.g. flags, status) or any write on `assignments/{id}` | That assignment’s snapshot (inline on write path). |
| **Payroll** | Update `worker_payroll_accounts` doc for worker + entity key tied to that job’s hiring entity | Fan-out: live assignments for that worker in tenant (cap 50). |
| **Employment / onboarding** | Update `worker_onboarding` external steps or `entity_employments` for the relevant entity | Same fan-out. |
| **User employments / compliance** | Touch `user_employments` or `worker_compliance_items` used in readiness | Same fan-out. |
| **Background** | Update linked `backgroundChecks` row for that assignment | That assignment (and any others linked by same rules). |
| **Work authorization** | Change `users/{uid}.workEligibilityAttestation.authorizedToWorkUS` (boolean set/changed) | Live assignments for that user/candidate (collection-group query; cap 50). |
| **Job / account linkage** | Change `job_orders` / `recruiter_jobOrders` `hiringEntityId` or `recruiterAccountId`, or `accounts.hiringEntityId` (per gate in main doc) | Live assignments with matching `jobOrderId` (and account branch rules). |

---

## 4. Expected before / after behavior

| Before | After |
|--------|--------|
| No `readinessSnapshotV1` | Field appears; `state` and `requirements` match Readiness tab logic. |
| Worker completes I-9 / tax / handbook (Employment checklist) | Snapshot employment rows move toward `complete` on next trigger or Readiness tab callable. |
| Work auth attestation flips | `work_authorization` row and possibly `state` update on user trigger fan-out. |
| Background completes | `background_check` row → `complete` when assignment requires it. |
| Comparable payload unchanged | **No write** — logs may show unchanged skip (idempotent). |

---

## 5. Logs and failure points to watch

- **Cloud Logging** (Functions / Firestore triggers):
  - **Success path** — `readinessSnapshotV1 written` with `tenantId`, `assignmentId`, `state` (callable/core helper).
  - **Skip** — `readinessSnapshotV1 unchanged; skip write` (expected; not an error).
  - **Errors** — Search: `failed to sync readinessSnapshotV1` — substrings include `(assignment write)`, `(background_check)`, `(users write)`, `(hiring linkage)`, etc. These mean the trigger ran but recompute/write failed; assignment may stay stale.
- **Callable** — Client: `ProfileReadinessTabContent: syncHrxReadinessSnapshotV1 failed` in browser console → check network response, auth, and Cloud Logs for the same function.
- **Caps** — Workers with **>50** live assignments or heavy hiring fan-out may not refresh every doc in one trigger; see **Staleness** in main doc. Watch for silent “last N not updated.”
- **CORS / region** — Callable from custom domain: ensure `CALLABLE_BROWSER_CORS` includes production origin (see `functions/src/integrations/callableBrowserCors.ts`).

---

*After sign-off, treat Readiness tab + `readinessSnapshotV1` as functionally complete for this repo; ongoing work is monitoring, caps edge cases, and optional reconciliation if product requires it.*
