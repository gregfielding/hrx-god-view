# R.4.2 — Legacy Assignment Backfill — Followups

**Parent brief:** [`docs/R4_2_LEGACY_BACKFILL_HANDOFF.md`](./R4_2_LEGACY_BACKFILL_HANDOFF.md).
**Convention:** mirror of the R.0c → R.0c-fix relationship — followups stay in their own doc so the parent brief reads as the canonical lock record while live operational findings collect here.

This file tracks issues surfaced by the R.4.2 implementation + initial BCiP run (2026-04-29) that are NOT in scope for R.4.2 but were found while doing it. Each entry is non-blocking — the R.4.2 backfill itself shipped clean (54/58 fully fixed, 4 in the operator-visible manual queue, 0 errors).

---

## R.4.2-F1 — Bucket-name classifier patch

**Resolved (2026-04-29):** rolled into the same-day cleanup PR alongside F3. See **Resolution** at the bottom of this entry.
**Severity:** Cosmetic / labeling. Underlying audit data was correct throughout.
**Discovered:** 2026-04-29, during the BCiP `--write` run.

### Observation

The page driver's `'skipped_already_complete'` bucket is emitted for two distinct outcomes:

1. **True already-complete** — `hiringEntityId` was already set AND items already existed. Stage A no-op + Stage B no-op. The literal label is correct.
2. **Stage A wrote, Stage B was a no-op** — `hiringEntityId` was missing (Stage A wrote it) but the `shift_confirmation` (or other) item already existed from another code path (cadence trigger, prior partial seed, `syncAssignmentReadinessV1OnAssignmentWrite`). The label "skipped already complete" is misleading because Stage A *did* fix the assignment.

The BCiP `--write` run produced 18 of category 2 (out of 54 successful Stage A writes). The bucket counter conflated them with the (zero, in this run) category 1 outcomes.

### Why it matters

Operator-facing only. The `cascadeAuditLog` row carries the truth via:
- `stageAResolvedVia` (e.g. `'jo_chain'` proves Stage A wrote)
- `stageAStampedHiringEntityId` (the actual value Stage A merged in)
- `stageBItemsSkippedExisting` (the count Stage B short-circuited on)

So a forensic query can always recover the per-stage detail. The bucket-name issue is purely about the rolled-up report's readability.

### Fix sketch

Add a third bucket value `'stage_a_only_stage_b_no_op'` (or similar — naming TBD) and split the classifier:

```ts
// Current (collapsed):
if (itemsCreated === 0 && itemsSkipped > 0) {
  bucket = 'skipped_already_complete';
}

// Proposed (split):
if (itemsCreated === 0 && itemsSkipped > 0) {
  bucket = stampNeeded
    ? 'stage_a_only_stage_b_no_op'    // R.4.2-F1
    : 'skipped_already_complete';
}
```

Knock-on changes:
- Add the new value to the `LegacyAssignmentBucket` union and `LegacyAssignmentBuckets` shape.
- Update the test fixtures in `functions/src/__tests__/jobOrders/backfillLegacyAssignments.test.ts`.
- Update the CLI summary line in `scripts/backfillLegacyAssignmentsR4_2.js`.
- The audit-row `outcome` string should match the new bucket.

### Decision (superseded — see Resolution)

Originally filed for batch cleanup. After the Step 8 smoke test passed cleanly the rename was bundled into the same-day fast-mode cleanup PR alongside F3 (status-spelling normalizer) instead of waiting for an organic R.4.x cleanup batch.

### Resolution (2026-04-29)

The collapsed-into-one rename approach won out over the split-bucket approach proposed above. Both cases (true-already-complete + Stage-A-wrote-Stage-B-no-op) now share the bucket name `'stage_a_only_stage_b_no_op'`. Justification:

- **The page driver pre-filter makes the "true already-complete" case effectively impossible.** Any assignment fully healthy (`hiringEntityId` set AND items present) is short-circuited at scan time and never enters the per-row classifier. So in production every row that lands in the renamed bucket really is "Stage A wrote (or was a no-op for an unhealthy reason like missing items)" — the dominant operational reality.
- **Per-stage detail is still recoverable from the audit row.** `stageAResolvedVia === 'already_set'` proves Stage A no-op'd; anything else proves Stage A wrote. So a forensic query loses nothing.
- **One label is simpler than two.** Bucket-name churn ≪ shipping value.

Files touched in this PR:
- `functions/src/jobOrders/backfillLegacyAssignmentsCallable.ts` — type union, `LegacyAssignmentBuckets` interface, `emptyBuckets()` initialiser, branches in `processOneLegacyAssignmentForBackfill`, switch arm in the page driver. Inline comment notes the rename.
- `functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts` — `outcome` field doc-comment in `CascadeAuditEntry` notes the rename + that pre-2026-04-29 audit rows may carry the old label. The field type stays `string` (not a typed union) so historical rows still parse.
- `functions/src/__tests__/jobOrders/backfillLegacyAssignments.test.ts` — added §3a "bucket-rename exclusivity guard" with two assertions: (a) `Object.keys(report.buckets)` does not include the old key but does include the new one; (b) end-to-end Stage-A-wrote-Stage-B-no-op fixture surfaces the new bucket in both the report and the audit row.
- `scripts/backfillLegacyAssignmentsR4_2.js` — CLI summary line + idempotency-check docstring.
- `docs/R4_2_LEGACY_BACKFILL_HANDOFF.md` — three sites updated (audit shape, type union, post-write expectations).

**Pre-2026-04-29 audit rows in `cascadeAuditLog` keep the old label.** No data migration; new rows use the new label going forward. The `outcome` field is `string` in `CascadeAuditEntry`, so historical readers handle both transparently.

---

## R.4.2-F2 — Four unenrolled-worker investigation

**Severity:** Operational data hygiene. Manual-queue chip provides interim visibility.
**Discovered:** 2026-04-29, during the BCiP `--write` run.
**Tracker:** Task #49 (separate) — this entry exists for forensic context cross-linking.

### Observation

Four assignments in tenant `BCiP2bQ9CgVOCTfV6MhD` landed in the R.4.2 manual queue (`outcome: 'skipped_unresolvable_hiring_entity_id'`) because their workers have **zero `entity_employments` docs** in the tenant. Confirmed via `.scratch/probeUnresolvableWorkers.js` — all four are scenario (a) from the L.4.2.1 design (zero records).

| Worker UID | Assignment(s) | JO |
|---|---|---|
| `arStZ9SrjAdKAWfg5RHJIZruvLn2` | `V1kvqJAajjo7UvgPTkNt__arStZ9SrjAdKAWfg5RHJIZruvLn2` | `br0wmqSmuBR94ppBpxGh` |
| `xSiXIEqpRUNtOZtSHF7yzy94PRZ2` | `V1kvqJAajjo7UvgPTkNt__xSiXIEqpRUNtOZtSHF7yzy94PRZ2` | `br0wmqSmuBR94ppBpxGh` |
| `CNKKmdBnodW7tupM6olp941Iez52` | `t2itTwPwDzx6F3INwpJa__CNKKmdBnodW7tupM6olp941Iez52` | `wG3sqU9mdUPqM7s1C1Q7` |
| `kzXomcUtzmeyo63KcqizocL1sNY2` | `t2itTwPwDzx6F3INwpJa__kzXomcUtzmeyo63KcqizocL1sNY2` | `wG3sqU9mdUPqM7s1C1Q7` |

Two distinct JOs, two workers each. Notable: `CNKKmdBnodW7tupM6olp941Iez52` resolved fine via `jo_chain` on a *different* JO (`iwxGF1CS8UwT1bmSpqnd`) where the JO chain carried `hiringEntityId`. Same worker, different JOs, different outcomes — confirming the resolver's two paths are genuinely independent and that this is a per-(worker, JO) condition rather than a per-worker condition.

### Likely root causes

1. **Pre-onboarding placement that never completed onboarding.** Worker was placed on a JO before the auto-onboarding path was wired (or the path failed); the corresponding `entity_employments` doc was never created.
2. **Manual placement that bypassed onboarding flow.** A recruiter/admin pushed the assignment directly without routing through the onboarding pipeline.
3. **Pre-R.0c era data with broken linkage.** The `entity_employments` collection itself was migrated/restructured before R.0c; some pre-migration assignments may have been orphaned.

### Investigation per-worker (do this in task #49)

For each of the four workers, determine:

- Does the worker have an `entity_employments` doc in *any* tenant? (Maybe they were onboarded into a different tenant and the assignment is a cross-tenant artifact.)
- Is the assignment status active or terminal (`cancelled`/`canceled`/`declined`/`completed`)? Terminal-status manual-queue rows can probably be ignored — the assignment is over.
- Does the JO require a hiringEntityId for the worker to operate (e.g. is it a payroll-bearing placement)? If yes, the missing entity_employments doc is a real compliance gap.
- If the worker should be retroactively enrolled: create the `entity_employments` doc (matching the JO's `hiringEntityId`) and re-run R.4.2 — Stage A will pick it up via `worker_employment` fallback this time.

### Operator-visible signal

Until task #49 is resolved, the four assignments render the gray **`'legacy_review'`** chip with a HistoryIcon in the recruiter UI (per R.4.3). Operators can see them as "needs investigation" without any additional dashboard surface — that's the L.4.2.2 + L.4.2.6.6 design.

### Cross-references

- R.4.2 brief: `docs/R4_2_LEGACY_BACKFILL_HANDOFF.md` §L.4.2.2 (manual-queue policy).
- R.4.3 chip helper: `src/shared/jobReadinessChip/computeJobReadinessChip.ts` (the `'legacy_review'` branch).
- Probe script: `.scratch/probeUnresolvableWorkers.js` (re-run anytime to re-verify these are still scenario (a)).
- BCiP write report: `.scratch/backfillLegacyR4_2-BCiP2bQ9CgVOCTfV6MhD-2026-04-29T16-07-26-710Z.txt`.
- Stage C refresh log: stdout from `2026-04-29T16:14Z`-ish run of `scripts/refreshAssignmentReadinessSnapshotV1.js --tenant=BCiP2bQ9CgVOCTfV6MhD --no-dry-run`.

---

## R.4.2-F3 — Assignment status spelling drift (`'canceled'` vs `'cancelled'`)

**Severity:** Data hygiene. No functional impact (downstream readers already accept both spellings).
**Discovered:** 2026-04-29, in the BCiP pre-flight status-mix report.

### Observation

The R.4.2 BCiP pre-flight reported the legacy population's status mix as:

```
confirmed=19, proposed=7, declined=4, cancelled=3, canceled=3, pending=3
```

`'cancelled'` (British, double-L) and `'canceled'` (American, single-L) are coexisting variants of the same logical state. British is the canonical form in the dataset (more common, matches the `shift.status` convention, matches Phase-1 onboarding step labels in `entityOnboardingEngineFromContext.ts`).

### Why it matters

- **No runtime breakage.** Every downstream reader that branches on status uses a guard like `s === 'cancelled' || s === 'canceled'` or `['cancelled', 'canceled', ...].includes(s)` (verified across `assignmentReadinessDerive.ts`, `workerShiftRemindersV2.ts`, `updateNextShiftDate.ts`, `gigJobOrderStatusSync.ts`, `workerShiftReminders.ts`).
- **But the drift is real and growing.** The cascade trigger at `functions/src/shiftAssignmentCascades.ts` was emitting `'canceled'` (single-L) on every shift cancellation, regenerating the drift continuously. Phase2 UI status dropdowns also write the single-L form via `<MenuItem value="canceled">` literals.
- **Without normalization, status-grouping queries (e.g. "give me all cancelled assignments for tenant X") need to repeat the union guard everywhere.**

### Resolution shipped in this PR (2026-04-29)

Three-pronged fix, mirroring the R.0c / R.1 / R.4.2 ops shape so the next operator can drive it without a fresh playbook:

1. **One-shot data normalizer** — `scripts/normalizeAssignmentStatusSpelling.js` + companion callable `functions/src/jobOrders/normalizeAssignmentStatusSpellingCallable.ts`. Dry-run default, single-tenant scope (gated `securityLevel >= 7`), idempotent re-runs report `written: 0`, audit-logged via `cascadeAuditLog` with new action `'normalize_status_spelling'`. Filter is `shouldNormalizeAssignmentStatus` — case-sensitive match on the exact `'canceled'` literal; everything else (including casing variants like `'Canceled'`) is left alone for separate hygiene attention.

2. **Upstream writer patched** — `functions/src/shiftAssignmentCascades.ts` now emits `'cancelled'` (double-L) in both cascade paths (shift cancelled → assignments cancelled, application withdrawn → assignments cancelled). Header comment updated to reflect the canon. This stops the regenerator at the source for the dominant write site.

3. **Audit-action union extended** — `'normalize_status_spelling'` added to `CascadeAuditAction` in `functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts`. Two new optional `CascadeAuditEntry` fields (`beforeAssignmentStatus`, `afterAssignmentStatus`) capture the rewrite; the same R.16.1 forensic infrastructure picks these rows up with no extra plumbing.

### Out-of-scope in this PR (still open)

- **Phase2 UI dropdown literals.** `src/components/phase2/{AssignmentDetail,AssignmentsCalendar,AssignmentsList,CreateAssignment}.tsx` still contain `<MenuItem value="canceled">` literals + matching switch-case branches that read the single-L variant. Switching the dropdown value alone would break the case-statement reads, so this is a coordinated UI cleanup that should ship as a self-contained patch (likely 6 file edits, all in `src/components/phase2/`). Track separately when the Phase2 UI surface gets touched again.
- **`AssignmentReadinessStateV1` derived enum** — `'canceled'` here is a *derived* readiness state, not the raw `assignment.status`. `assignmentReadinessDerive.ts:171` explicitly normalizes via `normalized === 'cancelled' ? 'canceled' : 'completed'`, so the readiness state's spelling is its own decision. Not touched.
- **Casing variants** (`'Canceled'`, `'CANCELED'`) — the normalizer's filter is case-sensitive intentionally. Casing variants would surface as a separate (and weirder) hygiene issue worth investigating independently rather than silently absorbed by a bulk rewrite.

### Ops sequence (BCiP, post-merge)

```bash
# 1. Build + deploy the new callable.
cd functions && npm run build && cd ..
firebase deploy --only \
  functions:normalizeAssignmentStatusSpellingCallable,\
functions:onJobOrderShiftCancelledCascadeAssignments,\
functions:onApplicationWithdrawnOrDeletedCascadeAssignments

# 2. Pre-flight: count current `'canceled'` population.
node scripts/normalizeAssignmentStatusSpelling.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --dry-run \
  --limit=1000
# Eyeball: candidates ≈ 3 (matches the R.4.2 pre-flight status mix above);
# wouldWrite === candidates; errors === [].

# 3. Write.
node scripts/normalizeAssignmentStatusSpelling.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --write \
  --limit=1000
# Expect: written ≈ 3, errors === [], one cascadeAuditLog row per rewrite.

# 4. Idempotency confirm.
node scripts/normalizeAssignmentStatusSpelling.js \
  --tenant=BCiP2bQ9CgVOCTfV6MhD \
  --dry-run \
  --limit=1000
# Expect: candidates === 0, skipped_already_canonical === scanned, errors === [].
```

If a future re-run shows `candidates > 0`, the phase2 UI dropdowns are the most likely culprit — see "Out-of-scope" above.

### Cross-references

- Tests: `functions/src/__tests__/jobOrders/normalizeAssignmentStatusSpelling.test.ts` covers the filter (matches only the exact source literal, leaves casing variants + similar strings + non-strings alone), the page driver (dry-run no-write contract, write rewrites + audits, idempotent re-run, pagination/truncation, empty tenant), and the audit action (every rewrite emits `'normalize_status_spelling'` with before/after fields).
- Patched writer: `functions/src/shiftAssignmentCascades.ts` (both `onJobOrderShiftCancelledCascadeAssignments` and `onApplicationWithdrawnOrDeletedCascadeAssignments`).
- Audit type extension: `functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts` (`CascadeAuditAction` union + two new optional fields on `CascadeAuditEntry`).

---

## How to add a new entry

1. Use ID format `R.4.2-F<N>` where N increments from the last entry.
2. Required sections: **Observation**, **Why it matters**, and either **Fix sketch** (for code-fixable items) or **Investigation** (for ops items).
3. Link back to the parent brief and any tracker entries.
4. If the entry resolves, leave it in place but add a `**Resolved (YYYY-MM-DD):**` line at the top — historical context matters more than file size.

---

*Last updated: 2026-04-29 — F1 resolved, F3 added + resolved (same fast-mode cleanup PR).*
