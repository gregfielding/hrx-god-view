# Sprint 4 execution — PR1 (policy + instrumentation + queue contract + dry-run)

## Locked rules

- **Auto-merge** only on **strong key**: same non-empty `userId` + same `jobOrderId` (pair evaluation).
- **Email + jobOrderId** auto-merge only with **`allowEmailFallbackMerge`** and both `userId`s empty and same normalized email.
- **No** auto-merge on name-only, phone-only, or fuzzy similarity → **`requires_review`**.
- **Loser handling (Sprint 4 default):** **soft-retire** metadata on docs; hard delete deferred until confidence is high.
- **Review queue path:** `tenants/{tenantId}/application_consolidation_review/{reviewId}` (tenant isolation).

## PR2 locks (implemented)

- **`clusterId`:** SHA-256 (first 32 hex chars) over payload `tenantId` + newline + `jobOrderId` + newline + lexicographically sorted `storage:docId` lines (e.g. `nested:…`, `tenant:…`). Firestore review doc id **is** `clusterId`.
- **Winner (pair):** If one candidate is **tenant** storage and one is **nested**, the **tenant** application doc is always the survivor. **`createdAt` / `docId` tie-break only within the same `storage` kind** (or when `storage` is omitted on identities).
- **Execute script:** Creates/updates review docs for **`requires_review`**; applies **auto-merge writes** for **`userId_jobOrderId` by default**; pass **`--allowEmailFallbackMerge`** to also execute **`email_jobOrderId`** merges. **Soft-retires** losers with `mergedIntoApplicationId`, `consolidationRetiredAt`, `consolidationRetiredReason`, `consolidationBatchId` — **does not** change loser `status`. **No** hard deletes, **no** trigger retirement, **no** read-path cleanup in PR2.

## Modules

| Area | Path |
|------|------|
| Policy (app) | `src/utils/applicationConsolidationPolicy.ts` |
| Policy (functions mirror) | `functions/src/utils/applicationConsolidationPolicy.ts` |
| Cluster id helper | `src/utils/applicationConsolidationClusterId.ts` |
| Retirement field names (types) | `src/types/applicationConsolidationApplicationFields.ts` |
| Review types | `src/types/applicationConsolidationReview.ts` |
| Tests | `src/utils/__tests__/applicationConsolidationPolicy.test.ts`, `applicationConsolidationClusterId.test.ts` |
| Dry-run script | `scripts/applicationConsolidationDryRun.ts` |
| Execute script | `scripts/applicationConsolidationExecute.ts` |
| Shared script helpers | `scripts/applicationConsolidationShared.ts` |
| Dry-run TS config | `scripts/tsconfig.consolidation.json` |

## Nested create instrumentation (historical)

PR1 used `recruiterNotificationOnJobOrderApplicationCreated` for **`legacy_nested_application_create_observed`** logs. **PR5:** that Cloud Function export and trigger were **removed**; nested path is not used for new apps.

## PR1 scope

- No Firestore writes from dry-run.
- No enqueue to review collection yet (PR2+).
- ~~Nested trigger~~ **Removed (PR5).**

## Find job orders with nested application debt

`tenants/{tenantId}/job_orders/{jobOrderId}/applications` may be empty for tenants that already migrated to tenant-level apps only.

```bash
npm run consolidation:scan-nested -- --tenantId=<TID> [--onlyWithNested] [--top=20] [--output=report.json]
```

Uses aggregation `count()` per job order (plus one read of all `tenants/{tenantId}/applications` to group by `jobOrderId`).

## PR2 — CLI

- **Plan (no writes):** `npm run consolidation:execute -- --tenantId=<TID> --jobOrderId=<JOID> [--maxPairs=500] [--allowEmailFallbackMerge]`
- **Execute:** same flags plus **`--execute`**; optional **`--batchId=<uuid>`** (defaults to random UUID when executing).

**Dry-run (read-only report):** `npm run consolidation:dry-run -- --tenantId=<TID> --jobOrderId=<JOID> [--maxPairs=500] [--allowEmailFallbackMerge] [--output=path.json]`

## PR2 — first batch rollout

1. Pick a **single** `tenantId` + `jobOrderId` with low traffic and known duplicate volume.
2. Run **`consolidation:dry-run`**; inspect `requires_review` vs `auto_merge` counts.
3. Run **`consolidation:execute`** **without** `--execute` and archive the JSON plan.
4. Run **`consolidation:execute -- --execute`** with an explicit **`--batchId`** (e.g. `pr2-<tenant>-<jobOrder>-2026-04-02`) for traceability.
5. Default execute uses **strong-key merges only**; enable **`--allowEmailFallbackMerge`** only if policy was explicitly approved for that tenant/job.
6. Verify review docs under `application_consolidation_review/{clusterId}` and loser retirement fields; **do not** expect `status` changes on losers.
