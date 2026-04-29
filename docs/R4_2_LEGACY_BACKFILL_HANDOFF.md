# R.4.2 — Legacy Assignment Backfill Handoff Brief

**Status:** **LOCKED — IN FLIGHT (2026-04-29).** All six decision asks (L.4.2.1 – L.4.2.6) confirmed by Greg per the recommended path; see "Locks" table at the bottom. Code lands in this PR alongside the brief commit (R.16.1 / R.16.2a / R.16.2c / cleanup convention). Sequence: L.4.2.4 first (load-bearing helper extraction + regression test), then audit-types extension (L.4.2.5), then Stage A resolver (L.4.2.1), then page driver / callable / CLI / tests.

**Followups (live):** [`docs/R4_2_FOLLOWUPS.md`](./R4_2_FOLLOWUPS.md). Non-blocking findings surfaced during the BCiP run (bucket-name labeling polish, 4-worker enrollment investigation) live there to keep this brief as the canonical lock record.
**Predecessors:** R.4 (chip aggregator + persisted snapshot, shipped 2026-04-26), R.4.3 (defensive `'legacy_review'` chip state, shipped 2026-04-28 commit `28dc5d4d`).
**Goal:** Two-stage data-only backfill of the 29 active assignments in tenant `BCiP2bQ9CgVOCTfV6MhD` that currently render `'legacy_review'` (or `'computing'` if their `createdAt` happens to be post-floor). Wave 1 made them visually distinct; Wave 2 fixes the underlying data so they resolve to a real chip state.

> **Note (2026-04-29):** the original "29" was a chip-state-only count taken before R.4.3 reclassified pre-R.1 assignments into `'legacy_review'`. Pre-flight bucketing (per the section below) now splits by createdAt-vs-floor, so the brief's `~29` should be read as "the actual N from `.scratch/r4_2-preflight-*.json`". The post-R.4.3 count will be appended to this brief once the updated bucket script is re-run on tenant `BCiP2bQ9CgVOCTfV6MhD`.

> **Post-R.4.3 pre-flight (2026-04-29T15:58:58Z) — tenant BCiP2bQ9CgVOCTfV6MhD:**
>   - `targetForR4_2Backfill.total = 39` (revised up from the "29" chip-state-only count)
>   - 39/39 are pre-R.1 createdAt
>   - 39/39 have `hiringEntityId` missing AND `chip='computing'`
>   - 0/39 currently render `'legacy_review'` (persisted snapshot predates R.4.3 helper;
>     Stage C refresh post-write will sweep them through the new chip path)
>   - status mix: `confirmed=19, proposed=7, declined=4, cancelled=3, canceled=3, pending=3`
>   - status duplication (`'cancelled'` vs `'canceled'`) is a pre-existing data-hygiene smell;
>     R.4.2 processes both
>   - report: `.scratch/r4_2-preflight-20260429T155858Z.json`

**Post-R.4.3 pre-flight (2026-04-29T15:58:58Z) — tenant BCiP2bQ9CgVOCTfV6MhD:**
  - `targetForR4_2Backfill.total = 39` (revised up from "29" chip-state-only count)
  - 39/39 are pre-R.1 createdAt
  - 39/39 have `hiringEntityId` missing AND chip = `'computing'`
  - 0/39 currently render `'legacy_review'` (persisted snapshot predates R.4.3 helper;
    Stage C refresh post-write will sweep them through the new chip path)
  - status mix: `confirmed=19, proposed=7, declined=4, cancelled=3, canceled=3, pending=3`
  - status duplication (`'cancelled'` vs `'canceled'`) is pre-existing data-hygiene smell;
    R.4.2 processes both
  - report: `.scratch/r4_2-preflight-20260429T155858Z.json`

| Sub-scope | Estimate | Surface |
|-----------|---------:|---------|
| Stage A — Stamp `hiringEntityId` on each legacy assignment | ~½ day | Pure resolver + admin callable + CLI wrapper |
| Stage B — Run the standard seeder for each (post-Stage-A) | ~½ day | Wired through extracted shared helper from `onAssignmentCreatedAutoSeed` |
| Verification gate + ops dry-run/write/idempotency loop | included | Mocha cases + emulator probe + tenant-`BCiP` runbook |

---

## Pre-flight: ground-truth check (before code lands)

Re-run `node .scratch/bucketR8ComputingChip.js > .scratch/r4_2-preflight.json` once the cleanup PR (`28dc5d4d`) is deployed and re-confirm the 29-count is still accurate. Two things may have shifted since the count was taken:

1. **R.4.3 reclassification.** Pre-R.1 assignments now render `'legacy_review'` (gray) instead of `'computing'` — but the bucket script keys on `chip.state === 'computing'`, so they'd drop OUT of the bucket. The 29 is the count at the time the script was run; depending on when that was, today's chip-state distribution may show a `legacy_review` bucket and a smaller `computing` bucket.
2. **R.4.1 idempotency fix.** The recompute path now skips wasteful writes — but it ALSO means the chip data on the assignment doc is stable across re-reads. Check whether any chips silently flipped between "computing" and "legacy_review" during the deploy window.

The brief assumes Greg's number (29) is the upper bound. If pre-flight returns fewer, smaller / faster. If more, surface immediately.

**Action:** add a one-line bucket-by-`createdAt` to the bucket script before re-running:

```js
// Augment bucketR8ComputingChip.js so the report splits chip-empty
// + hiringEntityId-null assignments into pre-R.1 vs post-R.1
// halves. This makes the legacy population sized as a precise
// number rather than "the 29".
```

---

## Stage A — Stamp `hiringEntityId` on the assignment doc

### Root cause: assignments seeded before R.1 didn't carry hiringEntityId

The current chip-aggregator skips loading `employeeReadinessItems` when `hiringEntityId` is null (`functions/src/readiness/hrxReadinessSnapshotLoadContext.ts:332-338`):

```ts
hiringEntityId
  ? db.collection(`tenants/${tenantId}/employeeReadinessItems`)...
  : Promise.resolve(null),
```

The assignment-side `assignmentReadinessItems` query also returns `[]` for these 29 assignments (the seeder never ran for them — they predate `onAssignmentCreatedAutoSeed`'s deploy). Empty + empty → chip falls into the empty-input branch → `'computing'` (or `'legacy_review'` post R.4.3). Stage A unblocks the employee-side query so the chip aggregator can pick up at least screening/E-Verify state for free; Stage B fills in the assignment-side rows.

The current read-time resolution path (`hiringEntityIdForAssignment` in `src/shared/readinessEntityResolve.ts:80-89`) walks:

1. `joDoc.hiringEntityId` — direct.
2. (Loaded upstream by `fetchJobOrderBrief`:) `recruiterAccount.hiringEntityId` → `parentRecruiterAccount.hiringEntityId`.

If all of those resolve to null/empty, the read-time helper returns null. Backfill needs a deterministic resolution path AND a clearly-defined fallback for the assignments where the JO chain genuinely has nothing.

### L.4.2.1 — Resolution path priority chain (UNLOCKED — needs Greg)

| Option | Path | Pros | Cons |
|---|---|---|---|
| (A) | JO chain only (matches read-time logic) | Read/write parity; same answer the chip aggregator computes today | Won't fix any assignment whose JO + account chain is genuinely empty (probably the actual cause for the 29) |
| (B) | Worker `entity_employments` only — find the record matching `assignment.entityKey` (or resolved via `resolveAssignmentEntityKey`), then grab its `entityId` | Matches Greg's prompt wording ("Pull from the worker's entity employment at the time of placement") | Diverges from read-time logic; could stamp a different value than what the JO chain would produce going forward |
| (C) | JO chain → fall back to worker's entity_employments → fail | Broadest coverage; defensible audit trail (`stage_a_resolved_via: 'jo_chain' \| 'worker_employment' \| 'unresolved'`) | Slightly more code; per-assignment audit row gets a new field |

**Recommendation: (C).** The JO chain is the canonical read-time source so we honor parity when possible; the worker-employment fallback covers the 29-assignment case where the JO chain is genuinely empty (probably the actual cause for these legacy assignments — they were placed before `hiringEntityId` was reliably stamped on JOs). Per-assignment audit row records WHICH path won so ops can spot-check. Failing loudly when both are null routes the assignment to the manual queue (L.4.2.2).

### L.4.2.2 — Unresolvable-`hiringEntityId` policy (UNLOCKED — needs Greg)

What happens when L.4.2.1's resolution path returns null for an assignment.

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| (A) | Skip silently — audit row only, no per-assignment surfacing | Won't halt the batch | Buries problems; defeats the "shouldn't be auto-skipped silently" requirement Greg's prompt explicitly called out |
| (B) | Per-assignment row in dry-run/write report under a dedicated `unresolvable_hiring_entity_id` bucket; SKIP Stage B for that assignment; emit `cascadeAuditLog` row with `action: 'backfill_legacy_assignment_r4_2'`, `outcome: 'skipped_unresolvable_hiring_entity_id'`. The chip stays at `'legacy_review'` — visible to operators. | Clear signal; doesn't halt the batch; the chip itself is the manual-queue indicator (no separate queue collection needed) | Operators have to remember to check the bucket; ops spec needs to call out follow-up |
| (C) | Hard-fail the entire batch on first unresolvable | Forces the operator to investigate before proceeding | Very disruptive — even one stuck assignment blocks the other 28. Wrong tradeoff for a small fixed population. |

**Recommendation: (B).** Greg's prompt explicitly says "shouldn't be auto-skipped silently" — (B) is the loud version of skip. Bucket name is the audit signal; the `'legacy_review'` chip we just shipped (R.4.3) IS the manual queue (operators see gray "Legacy — needs review" → know to investigate). No second queue collection needed.

### L.4.2.3 — Stage A + Stage B atomicity (UNLOCKED — needs Greg)

| Option | Behavior | Pros | Cons |
|---|---|---|---|
| (A) | One Firestore transaction per assignment (Stage A and Stage B atomic) | Cleanest "all-or-nothing" semantics — no partially-fixed assignments | Stage B is heavy (loads JO + worker + screening eval + cert records); transactions have a 60s wall clock and 500-write limit. Per-assignment cert/license/etc rows can blow either limit on a complex JO. Conflicts with the seeder's existing internal write pattern (read-modify-write of existing items). |
| (B) | Independent stages, each idempotent. Stage A writes the assignment doc + audit. Stage B calls `runAssignmentReadinessSeed` (which is itself idempotent — skips existing item ids). On a partial failure (Stage A succeeded, Stage B failed), re-running the backfill skips Stage A (already stamped) and retries Stage B from where it failed. | Matches `runAssignmentReadinessSeed`'s existing semantics; small Stage A is fast; Stage B can retry independently; idempotent re-runs are the documented contract | Brief window where an assignment has `hiringEntityId` set but no items (chip flips from `'legacy_review'` → orphan-red `'Job Not Ready'` until Stage B completes). On a recovered re-run the chip ends up correct, so the window is the only cost. |
| (C) | Independent + skip Stage B if Stage A wrote nothing (i.e. `hiringEntityId` was already set) | Ensures Stage B only runs alongside a fresh Stage A write | Breaks the case where a previous run stamped hiringEntityId but Stage B failed mid-flight — the retry would skip Stage B and leave the assignment empty. Negates idempotency. |

**Recommendation: (B).** The transient "stamped but unseeded" window is acceptable — it's the same window the auto-seeder has on a fresh assignment placement, and the `'red'` orphan state is the correct semantic for that interval (operators can see "Job Not Ready, please re-seed"). The R.4.3 legacy_review chip won't fire post-stage-A because `createdAt` is still pre-floor BUT `readinessSeeded` flips to true once items land (the chip helper falls into the orphan-red branch instead of legacy_review per L.4.3.5 case 5). On a clean run, both stages complete in seconds and the chip transitions through `legacy_review` → orphan-red → real state in well under a minute. Greg confirmed this acceptable when locking L.4.3.5 case 5.

### L.4.2.4 — Seeder reuse for Stage B (UNLOCKED — needs Greg)

`onAssignmentCreatedAutoSeed.ts:88-167` runs a non-trivial pipeline at trigger time (load JO data → load worker + screening eval + cert records → build flag-based requirements → build Phase B match specs → stamp expiry → call `runAssignmentReadinessSeed`). Stage B needs identical logic.

| Option | Approach | Pros | Cons |
|---|---|---|---|
| (A) | **Extract shared helper** `seedReadinessForExistingAssignment(tenantId, assignmentId, assignmentData)` from the trigger handler into `functions/src/readiness/seedReadinessForExistingAssignment.ts`. Trigger calls it; backfill calls it. | Single-source the requirement-building; Phase B/C drift between trigger and backfill becomes structurally impossible | Small mechanical change to `onAssignmentCreatedAutoSeed` (delegate to the new helper); needs new tests for the extracted helper |
| (B) | Duplicate the logic in the backfill callable | Backfill stays self-contained; trigger code is untouched | Two copies that need to stay in sync as Phase B/C evolves; high regression risk |
| (C) | Backfill constructs a fake `event.data` and calls the trigger handler directly | No code duplication | Fragile — the trigger has `if (!event.data)` guards, retry-mode handling, log keys that all assume real Firestore events; testing the backfill becomes "test the trigger" |

**Recommendation: (A).** The extraction is mechanical (~30 lines moved into a new file with one explicit `assignmentData` parameter). Worth the structural-anti-drift guarantee. The trigger becomes a thin wrapper: `await seedReadinessForExistingAssignment({tenantId, assignmentId, data})`. The shared helper also opens up future surfaces (e.g. a "re-seed this assignment" admin action surfacing a Greg-mentioned `R.3` follow-up).

### L.4.2.5 — Audit action name + log destination (UNLOCKED — needs Greg)

Greg's prompt names the audit action `'backfillLegacyAssignmentR4_2'`. The existing `CascadeAuditAction` union (`functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts:266-271`) is finite:

```ts
export type CascadeAuditAction =
  | 'snapshot_on_activation'
  | 'snapshot_via_backfill'
  | 'push_to_active'
  | 'push_to_active_summary'
  | 'snapshot_skipped';
```

Sub-questions:

| Sub | Question | Options |
|---|---|---|
| 5a | Action name format | (A) Greg's `'backfillLegacyAssignmentR4_2'` (camelCase, version-tagged) · (B) `'backfill_legacy_assignment_r4_2'` (snake_case matching the rest of the union — `snapshot_via_backfill`, `snapshot_on_activation`) · (C) Generic `'backfill_assignment'` (no version tag) |
| 5b | Audit log destination | (A) Extend `CascadeAuditAction` union and write to `tenants/{tid}/cascadeAuditLog` (matches `snapshot_via_backfill` precedent) · (B) New collection `tenants/{tid}/dataBackfillAuditLog` (separates cascade from data-migration audits) · (C) Use `tenants/{tid}/system_logs` (the generic logger destination) |

**Recommendation:**
- **5a (B)** — snake_case `'backfill_legacy_assignment_r4_2'` to match the existing union convention. Greg's name was prose; the snake_case form is the same string mechanically and reads consistently with `snapshot_via_backfill`.
- **5b (A)** — extend `CascadeAuditAction` union and write to `cascadeAuditLog`. Justification: this backfill is a cascade-adjacent migration (it stamps `hiringEntityId`, which IS a cascade-policy field per R.16.2a), so it lives in the same audit log as R.16.1's `snapshot_via_backfill`. Reusing the collection means existing `cascadeAuditLog` queries (e.g. the R.16.3-interim affected-list lookup) automatically surface the backfill. Adding a new collection for one action would fragment the audit story for no real win.

Per-assignment audit row shape (writes one row per assignment, regardless of outcome):

```ts
{
  action: 'backfill_legacy_assignment_r4_2',
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
  triggeredBy: callerUid,                    // service-account uid for CLI runs, real uid for callable
  assignmentId: '<id>',                       // NEW field on CascadeAuditEntry — per-assignment subject
  jobOrderId: '<id-or-null>',
  outcome: 'stamped_and_seeded'
         | 'stamped_only_seed_failed'
         | 'skipped_unresolvable_hiring_entity_id'
         | 'stage_a_only_stage_b_no_op'  // R.4.2-F1 (2026-04-29) — renamed from
                                         // 'skipped_already_complete'. Pre-2026-04-29
                                         // audit rows may carry the old label.
         | 'error',
  stageAResolvedVia: 'jo_chain' | 'worker_employment' | 'unresolved' | 'already_set',
  stageAStampedHiringEntityId: '<id-or-null>',
  stageBItemsCreated: <number>,
  stageBItemsSkippedExisting: <number>,
  context: 'r4_2 legacy backfill (BCiP)',
  error: '<msg-when-outcome=error>',
  timestamp: serverTimestamp(),
}
```

`assignmentId` is a new optional field on `CascadeAuditEntry` (currently only `jobOrderId` is supported); R.4.2 adds it. Same idea as `affectedJoIds` — collection-key narrowing.

### L.4.2.6 — Out-of-scope confirmations (UNLOCKED — needs Greg)

Confirming we're NOT doing these as part of this PR:

| # | Item | Recommendation | Rationale |
|---|------|----------------|-----------|
| 6.1 | Backfill for tenants other than `BCiP2bQ9CgVOCTfV6MhD` | OUT-OF-SCOPE | The 29-assignment population is BCiP-specific; the callable accepts arbitrary `--tenant`, but we only run it for BCiP for this PR. Other tenants get the gray chip (R.4.3) until/unless they request a backfill. |
| 6.2 | Touching the chip data on the assignment doc directly | OUT-OF-SCOPE | The seeder + downstream `recomputeHrxReadinessSnapshotForAssignment` trigger do this naturally. Stage C below is a separate optional step that re-runs the existing snapshot refresh script post-backfill. |
| 6.3 | Modifying `R1_DEPLOY_DATE_ISO` or its tests | OUT-OF-SCOPE | R.4.3 just shipped; the const is locked. |
| 6.4 | Re-running for already-backfilled assignments | NOT OUT-OF-SCOPE — supported by idempotency design (re-runs are no-ops) | Standard backfill convention; matches R.16.1 backfill |
| 6.5 | `--force` flag (re-stamp + re-seed even when already done) | RECOMMENDED OUT-OF-SCOPE | The R.16.1 backfill ships `--force`, but it's overkill for a 29-assignment one-shot. Adding it doubles the test surface and creates a foot-gun (re-seeded items collide with existing items). If we ever need it, file as R.4.2.1. |
| 6.6 | Adding a "manual queue" UI surface for `outcome: 'skipped_unresolvable_hiring_entity_id'` | RECOMMENDED OUT-OF-SCOPE | The `'legacy_review'` chip we just shipped IS the manual queue (operators see gray → know to investigate). A dedicated Admin UI surface can wait. |

---

## Stage B — Run the standard seeder for each touched assignment

After Stage A stamps `hiringEntityId`, Stage B calls `seedReadinessForExistingAssignment` (per L.4.2.4). The shared helper:

1. Loads the JO data (same query the trigger uses).
2. Loads the worker + screening eval + cert records (same parallel-fetch pattern).
3. Builds flag-based requirements (`buildRequirementsForJobOrder`) — uses the snapshot-aware `getEffectiveJobOrderField` for `eVerifyRequired` per R.16.2a (so backfill matches the snapshot semantic).
4. Builds Phase B match specs (`buildPhaseBMatchSpecs`).
5. Stamps expiry (`stampExpiryOnSpecs`).
6. Calls `runAssignmentReadinessSeed` with `actorUid: 'system'` and `source: { kind: 'jobOrderAssignment', ref: assignmentId }`.

The seeder runner is already idempotent (`functions/src/readiness/seedAssignmentReadinessItemsRunner.ts:106-113` — checks `existingSnaps[i].exists` per item). So a re-run with all items already present returns `itemsCreated: 0, itemsSkippedExisting: N`.

**Open sub-decision (recommend leaving the trigger's behavior alone):** the trigger runs in `retry: false` mode (`onAssignmentCreatedAutoSeed.ts:60`). The backfill should NOT inherit that — it's not in a Firestore-trigger context. The shared helper takes a plain function call; backfill propagates errors up to the page-driver report. Same exception-handling shape as `runBackfillPage` from R.16.1.

---

## Implementation surface

### New files

| Path | Purpose |
|------|---------|
| `functions/src/readiness/seedReadinessForExistingAssignment.ts` | Shared helper extracted from `onAssignmentCreatedAutoSeed.ts`. Single-source the requirement-building pipeline. |
| `functions/src/jobOrders/backfillLegacyAssignmentsCallable.ts` | Admin callable wrapping `runBackfillLegacyAssignmentsPage`. `securityLevel >= 7` gate + `cors: true` + 540s timeout + 1GiB memory (same shape as `backfillJoSnapshotFieldsCallable`). |
| `scripts/backfillLegacyAssignmentsR4_2.js` | CLI wrapper. `--tenant` + `--dry-run`/`--write` + `--limit` + `--page-token`. Service-account creds; bypasses callable's security gate by design. Includes the firebase-admin instance-pinning gotcha block from `scripts/backfillJoSnapshotFields.js`. Writes `.scratch/backfillLegacyR4_2-<tenant>-<iso>.txt` per run. |
| `functions/src/__tests__/jobOrders/backfillLegacyAssignments.test.ts` | Mocha + Chai. Covers Stage A resolver (`hiringEntityIdFromChainOrEmployment`), per-assignment classifier, page driver, idempotency on second pass. ~12 cases. |

### Modified files

| Path | Change |
|------|--------|
| `functions/src/readiness/onAssignmentCreatedAutoSeed.ts` | Refactor: extract pipeline into `seedReadinessForExistingAssignment`; trigger becomes a thin caller. |
| `functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts` | Extend `CascadeAuditAction` union with `'backfill_legacy_assignment_r4_2'` and `CascadeAuditEntry` with optional `assignmentId?: string`, `outcome?: string`, `stageAResolvedVia?: string`, `stageAStampedHiringEntityId?: string \| null`, `stageBItemsCreated?: number`, `stageBItemsSkippedExisting?: number`. |
| `functions/src/index.ts` | `export { backfillLegacyAssignmentsCallable } from './jobOrders/backfillLegacyAssignmentsCallable';` |
| `.scratch/bucketR8ComputingChip.js` | Augment to also bucket by pre-R.1 vs post-R.1 `createdAt` so the pre-flight count is precise (per Pre-flight section above). |

### Helper signature sketches

Stage A pure resolver (testable in isolation):

```ts
// functions/src/jobOrders/backfillLegacyAssignmentsCallable.ts (or its own file)
export type StageAResolveResult = {
  resolvedHiringEntityId: string | null;
  resolvedVia: 'jo_chain' | 'worker_employment' | 'unresolved' | 'already_set';
};

export async function resolveLegacyAssignmentHiringEntityId(args: {
  fdb: admin.firestore.Firestore;
  tenantId: string;
  assignmentId: string;
  assignmentData: Record<string, unknown>;
}): Promise<StageAResolveResult> {
  // 1. Already set? → 'already_set'. Stage B can still run.
  // 2. JO chain (matches existing read-time path):
  //    - Load JO, look at `hiringEntityId`.
  //    - Else load recruiter account + parent, look at `hiringEntityId` on each.
  // 3. Worker entity_employments:
  //    - Use `resolveAssignmentEntityKey` to get the assignment's entityKey.
  //    - Walk worker's entity_employments; find the one whose entityKey matches.
  //    - That record's `entityId` is the hiringEntityId.
  // 4. Both null → 'unresolved' → caller reports + skips Stage B.
}
```

Per-assignment processor (mirrors `processOneJoForBackfill`):

```ts
export type LegacyAssignmentBucket =
  | 'stage_a_only_stage_b_no_op'      // Stage B reported zero NEW items.
                                      // Disambiguate via the audit row's
                                      // `stageAResolvedVia`: 'already_set'
                                      // ⇒ Stage A no-op'd too (true
                                      // already-complete); anything else ⇒
                                      // Stage A wrote and Stage B found
                                      // items pre-existing from another
                                      // code path. R.4.2-F1 (2026-04-29) —
                                      // renamed from 'skipped_already_complete'.
  | 'skipped_unresolvable_hiring_entity_id'
  | 'would_stamp_and_seed'             // dry-run only
  | 'would_stamp_only'                 // dry-run; hiringEntityId resolves but JO has no requirements
  | 'stamped_and_seeded'
  | 'stamped_only'                     // hiringEntityId stamped but seeder reported 0 items
  | 'stamped_only_seed_failed'
  | 'error';
```

Page driver report shape (mirrors `BackfillJoSnapshotReport`):

```ts
{
  tenantId, dryRun, limit, scanned, durationMs, truncated, nextPageToken,
  buckets: { stage_a_only_stage_b_no_op, skipped_unresolvable_hiring_entity_id,
             would_stamp_and_seed, would_stamp_only, stamped_and_seeded,
             stamped_only, stamped_only_seed_failed, errors_count },
  manualQueue: [{ assignmentId, jobOrderId, workerUid }],   // every assignment that hit unresolvable
  perAssignment: [{ assignmentId, bucket, resolvedHiringEntityId, resolvedVia,
                    stageBItemsCreated, stageBItemsSkippedExisting, error }],
  errors: [{ assignmentId, error }],
}
```

The `manualQueue` array makes the unresolvable bucket trivially extractable from the report (Greg's "shouldn't be auto-skipped silently" requirement). Operators can grep the `.scratch/` dump for that array directly.

---

## Verification gate

- [ ] Mocha cases cover (`functions/src/__tests__/jobOrders/backfillLegacyAssignments.test.ts`):
  - **Resolver:** JO chain wins · JO null → recruiter account wins · JO + account null → parent account wins · all null → worker entity_employments wins · all null + no matching employment → unresolvable · already-set → 'already_set' (Stage B still runs)
  - **Per-assignment processor:** dry-run produces `would_*` buckets · `--write` produces matching `stamped_*` buckets · already-stamped + items exist → `stage_a_only_stage_b_no_op` (R.4.2-F1: renamed from `skipped_already_complete`) · stage B failure path → `stamped_only_seed_failed` · unresolvable hiringEntityId → bucket + skipped Stage B · audit row written for every outcome
  - **Page driver:** pagination via `nextPageToken` · per-assignment error isolation · idempotency (second run reports `stamped_*: 0`, `stage_a_only_stage_b_no_op: N`)
  - **Shared helper extraction:** `seedReadinessForExistingAssignment` produces the same items the trigger does on a fresh assignment (regression guard for L.4.2.4 (A) extraction)
- [ ] **Emulator integration smoke** (one fixture: tenant with 3 pre-R.1 assignments — one resolvable via JO chain, one via worker employment, one unresolvable). Run callable in dry-run, verify report shape; run with `--write`, verify Firestore state; re-run, verify idempotency. Same shape as R.16.1's emulator probe per `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md` §L7 idempotency.
- [ ] All existing readiness suites stay green (`buildAssignmentReadiness.r4-bridge`, `computeJobReadinessChip`, `seedAssignmentReadinessItems-r1`, `seedAssignmentReadinessItems` — collectively ~50 cases).
- [ ] `tsc --noEmit` clean both projects.
- [ ] `scripts/check-cascade-mirror.sh` clean (no mirror touches expected — backfill is functions-only + scripts-only).
- [ ] `ReadLints` clean on touched files.
- [ ] Brief commits in the same PR as code (R.16.1 / R.16.2a / R.16.2c / cleanup convention).

---

## Deploy runbook (tenant `BCiP2bQ9CgVOCTfV6MhD`)

The order matters — same gotcha as R.16.1 backfill (script invokes the compiled functions bundle, so the deployed cloud function must match).

```bash
# 1. Confirm pre-flight count is still accurate
node .scratch/bucketR8ComputingChip.js > .scratch/r4_2-preflight-$(date -u +%Y%m%dT%H%M%SZ).json
# Eyeball: total empty-items + null-hiringEntityId assignments.

# 2. Build functions (script needs the compiled bundle path).
cd functions && npm run build && cd ..

# 3. Deploy the new callable + the trigger refactor.
firebase deploy --only \
  functions:backfillLegacyAssignmentsCallable,\
functions:onAssignmentCreatedAutoSeedReadiness

# 4. DRY-RUN first. NEVER --write before the dry-run report is reviewed.
node scripts/backfillLegacyAssignmentsR4_2.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --dry-run \
  --limit=50

# Eyeball the .scratch report:
#   - buckets.would_stamp_and_seed ≈ 29 (or pre-flight count)
#   - buckets.skipped_unresolvable_hiring_entity_id surfaces every problem case
#   - manualQueue array has matching length
#   - For each unresolvable: lookup the worker's entity_employments by hand
#     and confirm there's genuinely no record (vs a misshapen entityKey or similar)

# 5. WRITE — only after dry-run sign-off.
node scripts/backfillLegacyAssignmentsR4_2.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --write \
  --limit=50
# Expect: buckets.stamped_and_seeded ≈ buckets.would_stamp_and_seed from step 4

# 6. IDEMPOTENCY confirm.
node scripts/backfillLegacyAssignmentsR4_2.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --dry-run \
  --limit=50
# Expect:
#   - buckets.stamped_and_seeded == 0
#   - buckets.stage_a_only_stage_b_no_op ≈ scanned - skipped_unresolvable_hiring_entity_id
#   - errors == []

# 7. Optional Stage C — refresh the readinessSnapshotV1 on touched assignments
#    so the chip reflects the new state immediately (without waiting for the
#    next downstream trigger to fire). Reuse the existing R.4 script:
node scripts/refreshAssignmentReadinessSnapshotV1.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --no-dry-run

# 8. Manual smoke. Open one of the formerly-29 assignments in the recruiter
#    UI. Verify the chip is no longer 'legacy_review' / 'computing'. Open
#    one of the unresolvable-bucket assignments — verify it's STILL gray
#    (legacy_review) and the popover correctly directs to ops investigation.
```

---

## Out-of-scope (recorded for clarity)

| Item | Why excluded | Lands in |
|------|--------------|----------|
| Other tenants | BCiP-only per L.4.2.6.1 | Per-tenant follow-ups when surfaced |
| `--force` re-seed | Avoid foot-gun per L.4.2.6.5 | R.4.2.1 if needed |
| Manual-queue UI | The `'legacy_review'` chip IS the queue per L.4.2.6.6 | If ops requests a separate dashboard |
| Touching `R1_DEPLOY_DATE_ISO` | Const just shipped (R.4.3) | Never |
| Editing chip data directly | The seeder + downstream trigger handle it | n/a |

---

## Locks (CONFIRMED — Greg 2026-04-29)

| # | Lock | Decision | Notes |
|---|------|----------|-------|
| 1 | **L.4.2.1** — Resolution path | **(C) JO chain → worker employments → fail.** Resolution path tries cheap-cascade first, falls back to the actual cause (worker entity employment). Per-assignment audit row records which path won. |
| 2 | **L.4.2.2** — Unresolvable policy | **(B) Per-assignment bucket + skip Stage B + audit.** The R.4.3 `'legacy_review'` chip is the manual queue. No second queue surface needed. |
| 3 | **L.4.2.3** — Stage atomicity | **(B) Independent + idempotent.** Transactions can't span Stage B's read envelope anyway. Transient "stamped-but-unseeded" window acceptable (chip flips through states in seconds). |
| 4 | **L.4.2.4** — Seeder reuse | **(A) Extract shared helper `seedReadinessForExistingAssignment`.** Single source of truth for trigger + backfill. Load-bearing — landed first. |
| 5 | **L.4.2.5** — Audit name + collection | **(5a B + 5b A)** snake_case `'backfill_legacy_assignment_r4_2'` in `cascadeAuditLog`; convention matches existing union. Adds optional `assignmentId` field on `CascadeAuditEntry`. |
| 6 | **L.4.2.6** — Out-of-scope | **All as recommended.** BCiP-only, no `--force`, no separate manual-queue UI. |

---

## Cross-references

- Wave 1 cleanup PR (R.4.1 + R.4.3 + R.16.2d): `docs/CLEANUP_R4_R16.2D_HANDOFF.md` (commit `28dc5d4d`)
- R.4 chip aggregator: `docs/READINESS_R4_HANDOFF.md` §D3.R4
- R.4.3 chip helper + `R1_DEPLOY_DATE_ISO`: `src/shared/jobReadinessChip/computeJobReadinessChip.ts`
- R.1 schema lock: `docs/READINESS_R1_R2_HANDOFF.md` §"R.1 — PR 1 completion notes (2026-04-26)"
- R.16.1 backfill template (callable + script + tests): `functions/src/jobOrders/backfillJoSnapshotFieldsCallable.ts`, `scripts/backfillJoSnapshotFields.js`, `functions/src/__tests__/jobOrders/backfillJoSnapshotFields.test.ts`
- Auto-seed trigger to extract from: `functions/src/readiness/onAssignmentCreatedAutoSeed.ts`
- Read-time hiringEntityId resolver: `src/shared/readinessEntityResolve.ts:80-89` (`hiringEntityIdForAssignment`)
- Worker entity_employments resolver: `src/shared/readinessEntityResolve.ts:64-78` (`resolveAssignmentEntityKey`)
- Audit log shape: `functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts:266-348` (`CascadeAuditAction`, `CascadeAuditEntry`, `writeCascadeAuditEntry`)

---

*End of R.4.2 brief. **LOCKED 2026-04-29.** Implementation in flight in this PR. Pre-flight count update + per-tenant ops sequence on tenant `BCiP2bQ9CgVOCTfV6MhD` to follow the deploy of the new callable + trigger refactor (see Deploy Runbook above). Pre-flight result will be appended back to this brief once the updated bucket script is re-run.*
