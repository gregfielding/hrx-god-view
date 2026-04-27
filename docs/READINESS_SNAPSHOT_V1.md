# `readinessSnapshotV1` (HRX assignment readiness)

Cross-app snapshot on **`tenants/{tenantId}/assignments/{assignmentId}`**, distinct from **`assignmentReadinessV1`** (onboarding-instance / package sync).

**Production rollout:** [`READINESS_SNAPSHOT_V1_PRODUCTION_VERIFICATION.md`](./READINESS_SNAPSHOT_V1_PRODUCTION_VERIFICATION.md) — deploy, Firestore spot-checks, upstream tests, logs.

---

## Freshness coverage (current)

All server paths call **`recomputeHrxReadinessSnapshotForAssignment`** (esbuild bundle, same engine as Readiness tab). Writes are **skipped** when the comparable JSON is unchanged (idempotent).

| Category | What changes | How snapshot refreshes |
|----------|----------------|------------------------|
| **Assignment** | Any write on `assignments/{assignmentId}` | Inline after `assignmentReadinessV1` sync on same doc. |
| **Screening** | `backgroundChecks/{id}` | Resolved `(tenantId, assignmentId)` linkages (same rules as assignment readiness). |
| **Worker + tenant employment** | `worker_payroll_accounts`, `worker_onboarding`, `entity_employments`, `user_employments`, `worker_compliance_items` | Fan-out: **live** assignments for that worker in tenant (`status` ∈ `ASSIGNMENT_STATUS_QUERY_LIVE`), `userId`/`candidateId` queries merged, **cap 50**. |
| **Identity (work auth)** | `users/{userId}` | Only when derived work-auth status changes (`workEligibilityAttestation.authorizedToWorkUS`; not legacy `workEligibility`). Collection-group **`assignments`**: `userId` or `candidateId` + live statuses, deduped, **cap 50**. |
| **Hiring graph** | `job_orders`, `recruiter_jobOrders` | Gate: `hiringEntityId` or `recruiterAccountId` string change. Fan-out: live assignments with matching `jobOrderId`, **cap 50**. |
| **Hiring graph** | `accounts` | Gate: `hiringEntityId` change. Fan-out: job orders referencing account (`recruiterAccountId`), then live assignments per `jobOrderId`, deduped, **cap 50** (job-order scan **40** per `job_orders` / `recruiter_jobOrders` branch). |
| **Manual / UI** | Recruiter opens Readiness tab | Callable **`syncHrxReadinessSnapshotV1`** (debounced) for selected assignment. |

**Live assignment** = `pending`, `proposed`, `confirmed`, `in_progress`, `active` (`functions/src/utils/assignmentStatusNormalize.ts`).

**Not refreshed by triggers today:** `entities` changes that only alter `entityId→entityKey` mapping; `signature_envelopes` / onboarding-instance-only paths; assignments past fan-out caps; rare paths in notes under **Staleness**.

---

## Cross-app read contract (e.g. Flutter)

**Document path:** `tenants/{tenantId}/assignments/{assignmentId}`

**Field:** `readinessSnapshotV1` (map). May be **absent** until first compute (tab, callable, or trigger).

**Shape** (TypeScript: `ReadinessSnapshotV1Firestore` in `src/shared/readinessSnapshotV1.ts`):

| Field | Type | Notes |
|--------|------|--------|
| `state` | `READY` \| `READY_WITH_WARNINGS` \| `BLOCKED` \| `PENDING_INITIALIZATION` | Aggregate; `PENDING_INITIALIZATION` when assignment has no usable id in engine. |
| `sourceVersion` | number | Currently **`1`**. Bump if you change semantics or add required fields. |
| `summary` | `{ blockers, warnings, completed }` | Counts derived from `requirements` at write time. |
| `requirements` | array of rows | See below. |
| `updatedAt` | `Timestamp` (server) | Set on write; not part of comparable equality. |

**Requirement row** (`ReadinessSnapshotV1Requirement`):

| Field | Type | Notes |
|--------|------|--------|
| `key` | string | Stable id for logic/i18n (e.g. `work_authorization`, `i9`, `cert_<id>`). |
| `label` | string | English display string from server (see worker guidance). |
| `category` | `identity` \| `employment` \| `policies` \| `screening` \| `certification` | Grouping. |
| `status` | `complete` \| `missing` \| `in_progress` | Per-row progress. |
| `severity` | `hard_block` \| `warning` | Drives `state`; use for emphasis, not legal copy. |

**Intentionally omitted from persisted snapshot:** per-row **`detail`** (e.g. payroll hint) from `buildAssignmentReadiness` is **not** written to Firestore — only `key`, `label`, `category`, `status`, `severity`.

**Clients should:** treat missing `readinessSnapshotV1` as “not computed yet”; prefer **`sourceVersion`** + **`state`** for feature detection; use **`key`** for stable routing/copy, **`label`** as default display string.

---

## Worker-safe presentation

- **No hidden recruiter-only fields** in v1 — same object is used operator-side and cross-app.
- **`label`:** Built-in rows use neutral HR labels (e.g. “Work Authorization”, “I-9 Form”, “Background Check”). **Certification** rows use `worker_compliance_items` **title** / type label — may be long or tenant-specific; Flutter may truncate, map `key` to localized strings, or hide internal-sounding rows if product policy requires it.
- **`severity`:** Maps to UI emphasis (e.g. blocker vs reminder). Avoid alarming copy solely from `hard_block`; pair with supportive next-step UX.
- **`category`:** Safe for section headers; aligns with recruiter Readiness tab groupings.
- **Do not infer PII** from `requirements` alone; snapshot is status-oriented, not identity payload.

If recruiter-only copy is ever needed, add a **new field or version** — do not overload v1 without bumping **`sourceVersion`**.

---

## Field shape (JSON)

```json
{
  "state": "READY | READY_WITH_WARNINGS | BLOCKED | PENDING_INITIALIZATION",
  "sourceVersion": 1,
  "summary": { "blockers": 0, "warnings": 0, "completed": 0 },
  "requirements": [
    {
      "key": "string",
      "label": "string",
      "category": "identity | employment | policies | screening | certification",
      "status": "complete | in_progress | missing",
      "severity": "hard_block | warning"
    }
  ],
  "updatedAt": "<ServerTimestamp>"
}
```

---

## Writers

- **`syncHrxReadinessSnapshotV1`** callable (us-central1): auth per tenant recruiter/manager/admin or HRX / security patterns aligned with placements. Delegates to **`recomputeHrxReadinessSnapshotForAssignment`**.
- **Readiness Profile tab:** invokes callable after load (debounced).
- **Firestore triggers:** us-central1, `maxInstances: 5`, `retry: false`. Exports are listed in `functions/src/index.ts` (assignment/background inline + upstream + user + hiring linkage modules).

## Engine

- Shared: `src/shared/buildAssignmentReadiness.ts`
- Server loader: `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts` (bundled via esbuild).

## Relationship to `assignmentReadinessV1`

| Field | Purpose |
|--------|---------|
| `assignmentReadinessV1` | Legacy/sync from onboarding instances, signatures, backgrounds — recruiter tooling / Employment UI. |
| `readinessSnapshotV1` | HRX V1 assignment model = Readiness tab / `buildAssignmentReadiness`. |

---

## Trigger detail (reference)

Shared helper: **`recomputeHrxReadinessSnapshotForAssignment`** in `functions/lib/readiness/syncHrxReadinessSnapshotV1.cjs`.

**Indexes (deploy `firestore.indexes.json`):**

- Collection group **`assignments`:** (`userId`, `status`), (`candidateId`, `status`) — user work-auth fan-out.
- Collection group **`assignments`:** (`jobOrderId`, `status`) — hiring linkage fan-out.

**Hiring linkage:** Assignments with explicit **`entityKey`** are still recomputed when job/account changes (conservative; often no write). Skipping them is a **future optimization**.

---

## Staleness & reconciliation

**Residual gaps:** entity-name→key resolution without other writes; signature/onboarding-instance-only updates; **>50** assignments per fan-out query; **>40** job orders per account branch; worker with **>50** live assignments on user trigger.

**Reconciliation job:** **Not required for normal product use** given current trigger breadth. **Optional later** (e.g. nightly): backfill stale rows for cap edge cases, rare graph changes, or post-deploy drift. Prefer **scoped** jobs (per tenant or “assignments missing snapshot”) over full-table rewrites.
