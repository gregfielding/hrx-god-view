# Readiness Rebuild — R.10 (Background-check 365-day expiry enforcement) Handoff Spec

**Status:** R.10 implemented (PR ready for review).
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`, `READINESS_R4_HANDOFF.md`, `READINESS_R6_HANDOFF.md`, `READINESS_R7_HANDOFF.md`, `READINESS_R8_HANDOFF.md`.
**Successors:** none scheduled — R.10 closes the BG-check expiry side of the readiness rebuild.

---

## TL;DR

R.10 promotes the existing `PLACEHOLDER_SCREENING_VALIDITY_DAYS = 365` constant from a placeholder into an enforced expiry mechanism for background checks. The work is mostly server-side (~9 files touched, ~600 LoC including tests).

- Daily sweep walks top-level `backgroundChecks/{checkId}` docs, identifies any whose completion timestamp + resolved validity-days threshold is in the past, and stamps `expired: true` + `expiredAt` + `expiredValidityDays` on the doc.
- The existing `onBackgroundCheckWriteUpdateReadiness` Firestore trigger picks up the stamp and propagates `status: 'expired'` to the corresponding `employeeReadinessItems` doc — single source of truth for "BG check state → readiness state".
- `screeningValidityDays` is configurable via the existing screening-package cascade: JobOrder → Location → Account → 365 default. An Account that requires 180-day re-screening just sets `orderDefaults.screeningValidityDays = 180`; existing checks completed >180 days ago expire on the next sweep.
- Sweep is one-way (`WHERE expired != true`), so policy loosening (e.g., 365 → 730) doesn't un-expire already-expired checks.
- No chip-aggregator changes required — `'expired'` already routes to red per R.4 (`computeJobReadinessChip.ts:100-102, 155-158`).

| ID | Task | Touches |
|---|---|---|
| R.10.1 | Promote `PLACEHOLDER_SCREENING_VALIDITY_DAYS` → `DEFAULT_SCREENING_VALIDITY_DAYS` | `functions/src/compliance/screeningAutomationShared.ts`, `src/pages/UserProfile/components/backgroundsComplianceModel.ts` |
| R.10.2 | Add `screeningValidityDays` to cascade — types + merger | `src/types/recruiter/account.ts`, `src/types/recruiter/jobOrder.ts`, server + client `screeningAutomationShared` mirrors |
| R.10.3 | Add `expired` / `expiredAt` / `expiredValidityDays` to `BackgroundCheckRecord` | `src/types/backgroundCheck.ts` |
| R.10.4 | Daily sweep — `runBackgroundCheckExpiryPass` piggybacked on C.2 reconciler | `functions/src/readiness/dailyReconcileExpiredReadiness.ts` |
| R.10.5 | Bridge update — fingerprint + `expired:true` short-circuit | `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts` |
| R.10.6 | Pure-logic tests (mocha) | `functions/src/__tests__/readiness/backgroundCheckExpiryPass.test.ts` (new), `dailyReconcileExpiredReadiness.test.ts` (extended) |

No schema changes to `packages/contracts` (no contract for `backgroundChecks` or per-account `orderDefaults` exists today; out of R.10 scope to introduce one — see "Deferred to follow-up").

---

## Decisions (locked from this PR's greenlight)

### L1.R10 — Sweep-time dynamic resolution of `screeningValidityDays`, NOT order-time stamping — LOCKED

The daily sweep resolves `screeningValidityDays` from the cascade at sweep time, not from a stamped value on the BG check doc.

**Why:**

1. **No backfill obligation.** Stamping at order time would force a one-time migration over every existing BG check + an in-flight migration story for orders mid-flight. Sweep-time resolution avoids both.
2. **Policy changes apply forward naturally.** When an Account tightens 365 → 180, existing not-yet-expired checks past 180 days expire on the next sweep — exactly the operator expectation.
3. **The "shouldn't un-expire" invariant is preserved by the sweep filter.** The expiry pass query is `WHERE expired != true`, so already-expired checks are never re-evaluated. Policy loosening (365 → 730) only affects new checks; old expirations stand.
4. **Audit trail without coupling.** When the sweep flips a check, it stamps `expiredValidityDays` (the threshold actually applied at expiry time) so future audits can answer "what threshold was used here?" without coupling check-time data to policy-time data.

**Performance.** Account / Location / JobOrder lookups are memoized per sweep pass (Map keyed by `{tenantId}/{accountId|locationKey|jobOrderId}`) so a sweep over hundreds of checks costs O(unique accounts) Firestore reads, not O(checks). At our current scale (single tenant, ~hundreds of active BG checks at sweep time) this is well within the existing `dailyReconcileExpiredReadiness` 02:00 ET budget.

### L2.R10 — Piggyback on `dailyReconcileExpiredReadiness` (C.2), NOT a new scheduled function — LOCKED

R.10 adds `runBackgroundCheckExpiryPass(db, nowMs)` alongside the existing `runReconcilePass`, both invoked from the same `onSchedule` handler in `functions/src/readiness/dailyReconcileExpiredReadiness.ts`.

**Why:** one cron, one log surface, one idempotency guard via `function_runs`, one ops alert. The two passes are independent (C.2 walks `collectionGroup('assignmentReadinessItems')` looking for `complete_pass + past expiresAtMs`; R.10 walks top-level `backgroundChecks` looking for completed-not-yet-expired checks past their resolved validity), so they share infrastructure but not query logic.

**Idempotency.** The existing `function_runs` doc covers the entire daily run, both passes. If C.2 fails partway, the next-day re-run picks up where it left off — no double-expiry of BG checks because the `WHERE expired != true` filter naturally dedupes.

### L3.R10 — Trigger-driven readiness update via `onBackgroundCheckWriteUpdateReadiness`, NOT direct write from the sweep — LOCKED

Sweep stamps `expired: true` (+ `expiredAt`, `expiredValidityDays`) on the BG check doc. The existing trigger wakes up, sees the fingerprint changed, and writes `status: 'expired'` to the corresponding `employeeReadinessItems` doc.

Two contained changes in the bridge:

1. **Add `expired` to `readinessFingerprint`** so the trigger re-fires when the field flips. Today's fingerprint keys off `hrxStatus` + `markedCompleteOutsideHrx` + service-line verdicts only; without this addition, a write that only flips `expired:true` would be deduped and the readiness item wouldn't update.
2. **Short-circuit at the top of the trigger handler:** if `record.expired === true`, force readiness status to `'expired'` and skip the AccuSource translator entirely. This handles the late-webhook case (see below) and keeps the sweep + webhook paths from racing.

**Why:** single source of truth for "BG check state → readiness state". Direct-write from the sweep would create a parallel codepath that drift-bugs love. If anyone ever flips `expired:true` from another path (manual ops doc fix, future expiry source, vendor-provided "check expired" webhook), the readiness item follows automatically.

**Late-webhook case (worth a comment in the short-circuit code).** If an AccuSource webhook arrives for an already-expired check (e.g., a re-screen result lands days after the original check expired), the short-circuit means readiness stays `'expired'` regardless of what the webhook says. This is the right behavior — once a check is expired, only ordering a new check unblocks the worker; the original check's late updates can't un-expire it. The new re-screen would land on a different check doc and follow its own readiness flow.

### L4.R10 — `screeningValidityDays` cascade location and precedence — LOCKED

Mirror the existing `screeningPackageId` / `screeningPackageName` pattern:

- **Account default:** `tenants/{tid}/accounts/{accountId}.orderDefaults.screeningValidityDays?: number`
- **Location override:** `tenants/{tid}/accounts/{accountId}/location_defaults/{key}.screeningValidityDays?: number`
- **JobOrder override:** `tenants/{tid}/job_orders/{jobOrderId}.screeningValidityDays?: number` (top-level, matching how `screeningPackageId` lives at top-level on JOs per `src/types/recruiter/jobOrder.ts:182-184`)

**Precedence (highest first):** JobOrder → Location → Account → `DEFAULT_SCREENING_VALIDITY_DAYS` (365).

**Helper:** `mergeScreeningValidityDaysFromLayers(jobOrder, locationDefaults, account): { validityDays: number; source: 'job_order' | 'location_defaults' | 'account' | 'default' }` — sibling of `mergeScreeningPackageFromLayers`. Same signature pattern, same precedence rule, same null-safety.

**Forward-looking note (don't preempt).** When the broader cascade-engine work migrates field resolution to the registry-driven engine in `src/shared/cascade/loaders.ts` (`FIELD_PATHS_BY_LEVEL`), `screeningValidityDays` moves alongside `screeningPackageId` — both follow the same pattern today, both should migrate together later. R.10 follows the existing pattern; the migration to the registry engine is a separate, broader sweep.

---

## Implementation summary

Closed in this PR. Per the R.x convention, this section is appended at implementation-complete time so the handoff doc captures the as-built state, not just the design intent.

**Code shipped (in dependency order):**

1. `functions/src/compliance/screeningAutomationShared.ts`
   - `PLACEHOLDER_SCREENING_VALIDITY_DAYS` → `DEFAULT_SCREENING_VALIDITY_DAYS = 365` (old name kept as `@deprecated` alias for one cycle).
   - New `mergeScreeningValidityDaysFromLayers(jobOrder, locationDefaults, account)` — JO → Loc → Account → default precedence.
   - `coerceValidityDays` defensive validator — rejects non-integer, ≤0, NaN, string-shaped values; falls through to next layer.
   - `evaluateScreeningSatisfiedServer` accepts new optional `validityDays` opt; defaults to `DEFAULT_SCREENING_VALIDITY_DAYS` so existing call sites are byte-identical.
   - `BgLike` extended with `expired?: boolean | null` field.

2. `src/pages/UserProfile/components/backgroundsComplianceModel.ts` (client mirror)
   - Same constant rename + `mergeScreeningValidityDaysFromLayers`. Existing client `evaluateScreeningSatisfied` continues to use the deprecated alias — back-compat with no behavior change.

3. Type additions:
   - `src/types/recruiter/account.ts` — `RecruiterAccount.orderDefaults.screeningValidityDays?: number | null`.
   - `src/types/recruiter/jobOrder.ts` — top-level `JobOrder.screeningValidityDays?: number`.
   - `src/types/backgroundCheck.ts` — `BackgroundCheckRecord.expired` / `expiredAt` / `expiredValidityDays`.

4. `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts`
   - `readinessFingerprint` extended with `expired` field — without this, sweep writes that only flip `expired:true` would be deduped and never propagate.
   - Top-of-handler short-circuit: if `afterData.expired === true`, force `newStatus = 'expired'` and skip the AccuSource translator. Inline comment captures the late-webhook semantics (see L3.R10).

5. `functions/src/readiness/dailyReconcileExpiredReadiness.ts`
   - `decideBackgroundCheckExpiryAction(args)` — pure decision unit, mirrors `decideReconcileAction`'s shape.
   - `CascadeCache` class — per-pass memoized lookups for accounts / location_defaults / job_orders, exposes `readsPerformed` for the summary log.
   - `resolveScreeningValidityDaysForCheck(fdb, check, cache)` — sweep-time cascade resolver. Reuses `screeningLocationKeyCandidates` for location-key lookup order.
   - `runBackgroundCheckExpiryPass({ db, nowMs })` — top-level `backgroundChecks` sweep. Two queries (`orderCompleted == true`, `hrxStatus IN [completed, report_ready]`) deduped by docId; client-side filter on `expired === true` (preserves the one-way invariant). Stamps `expired` / `expiredAt` (server timestamp) / `expiredValidityDays` (audit stamp) / `updatedAt`.
   - `dailyReconcileExpiredReadiness` `onSchedule` handler now invokes both passes inside the same idempotency guard. Pass 1 failure does NOT skip pass 2 (logged, then re-thrown after both attempted) — the partial-failure log captures `pass1Done` + both summaries.

6. Tests:
   - **NEW** `functions/src/__tests__/readiness/backgroundCheckExpiryPass.test.ts` — 29 tests across 7 suites (see "Test breakdown" below).
   - **EXTENDED** `functions/src/__tests__/readiness/dailyReconcileExpiredReadiness.test.ts` — 3 wiring-smoke tests assert the orchestrator exports both passes with independent decision functions.

**Boundary invariants confirmed by tests:**

- `expiresAtMs >= nowMs` is "still valid" (matches `decideReconcileAction`); a check completed exactly `validityDays` days ago is caught on the next pass when `nowMs` advances by 1ms.
- Sweep is one-way at the query layer (`expired === true` filtered out client-side after the union of completed-state queries).
- Policy loosen (365 → 730) does NOT un-expire already-expired checks (verified via the cascade test "loosen 365 → 730 keeps a 400d-old check valid").
- Policy tighten (365 → 180) flips checks past 180d on the next sweep (verified via the cascade test "tighten 365 → 180 expires checks past 180d immediately").

**Out of R.10 scope, deferred:**

- Late-webhook backfill of an already-expired check's audit fields (e.g. updating `lastWebhookAt` after expiry). The short-circuit means readiness stays `'expired'`; the underlying `backgroundChecks` doc still receives the webhook merge, just doesn't drive readiness off it.
- Auto-ordering a new check on expiry — the spec explicitly excludes this. CSAs decide via the matrix UI (deferred follow-up #3).

---

## Files changed

### Server — primary

- `functions/src/compliance/screeningAutomationShared.ts`
  - Promote `PLACEHOLDER_SCREENING_VALIDITY_DAYS` → `DEFAULT_SCREENING_VALIDITY_DAYS` (keep `PLACEHOLDER_*` as a deprecated re-export for one cycle so any in-flight branches don't break).
  - New `mergeScreeningValidityDaysFromLayers(jobOrder, locationDefaults, account)` (L4.R10).
  - New `resolveScreeningValidityDaysForCheck(db, check, memo)` — the sweep-time resolver with per-pass memoization (L1.R10).
  - `evaluateScreeningSatisfiedServer` switches its hard-coded `PLACEHOLDER_SCREENING_VALIDITY_DAYS` to take a `validityDays?: number` option (defaults to `DEFAULT_SCREENING_VALIDITY_DAYS`). Existing callers continue to pass nothing → identical behavior.

- `functions/src/readiness/dailyReconcileExpiredReadiness.ts`
  - New `runBackgroundCheckExpiryPass(db, nowMs)` — query `backgroundChecks` for completed-but-not-expired, resolve cascade per check (memoized), evaluate, stamp `expired` / `expiredAt` / `expiredValidityDays` on docs past the threshold.
  - New `decideBackgroundCheckExpiryAction(args)` — pure function (mirrors `decideReconcileAction`'s pattern), single decision unit per check. This is what the unit tests import.
  - Existing `onSchedule` handler now invokes both passes in sequence; idempotency guard wraps both.

- `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts`
  - `readinessFingerprint` extended to include `expired` (and `expiredAt` for change detection on stamp updates) (L3.R10).
  - Top-of-handler short-circuit: if `record.expired === true`, write readiness `'expired'` and skip the AccuSource translator. With a comment explaining the late-webhook semantics.

### Client mirror

- `src/pages/UserProfile/components/backgroundsComplianceModel.ts`
  - Mirror the constant rename + `mergeScreeningValidityDaysFromLayers`. (No `resolveForCheck` on the client — that's a sweep-time-only concern.)

### Types

- `src/types/recruiter/account.ts` — add `screeningValidityDays?: number` to `RecruiterAccount.orderDefaults`.
- `src/types/recruiter/jobOrder.ts` — add top-level `screeningValidityDays?: number` allowance on `JobOrder` (and any `JobOrderPartial` / draft sibling types — keep aligned with `screeningPackageId`).
- `src/types/backgroundCheck.ts` — add three top-level fields to `BackgroundCheckRecord`:
  - `expired?: boolean` — sweep stamps `true`. Never reset by automation; manual flips only via ops doc fix.
  - `expiredAt?: Timestamp` — when the sweep stamped `expired:true`.
  - `expiredValidityDays?: number` — the threshold (in days) actually applied at expiry time. Audit trail.

### Tests

- `functions/src/__tests__/readiness/backgroundCheckExpiryPass.test.ts` — NEW. Pure-logic mocha. Cases:
  - Fresh check (completed 30d ago, validity 365) → `decision: 'skip'`.
  - Old check (completed 400d ago, validity 365, not yet expired) → `decision: 'expire'` with stamped `expiredValidityDays: 365`.
  - Already-expired check (`expired: true` already set) → query filter excludes it (asserted via the query-shape helper, not the decision function).
  - Policy change tighten (validity 180, completed 200d ago) → `decision: 'expire'` with stamped `expiredValidityDays: 180`.
  - Policy change loosen (validity 730, completed 400d ago, not yet expired) → `decision: 'skip'` (still within new threshold).
  - Non-completed check (`hrxStatus: 'in_progress'`, no `orderCompleted`) → `decision: 'skip_not_completed'`.
  - Account override resolves over default (validity 180 from account, no JO/location override) → uses 180.
  - JobOrder override beats Account override (JO 90, account 180) → uses 90.

- `functions/src/__tests__/readiness/dailyReconcileExpiredReadiness.test.ts` — extended. Smoke-test that the orchestrator invokes both passes (the existing `decideReconcileAction` tests stay; new tests assert `runBackgroundCheckExpiryPass` is callable and the two passes don't conflict on idempotency).

---

## Verification gate

- [x] `cd functions && npx tsc --noEmit` — clean (no NEW errors; the pre-existing `setTenantRole.test.ts` + certifications/userActionItems test-file errors flagged in R.7 verification persist, unrelated).
- [x] `npx tsc --noEmit` (root) — clean of new errors (same pre-existing certifications/userActionItems test-file errors).
- [x] R.10-specific mocha — `backgroundCheckExpiryPass.test.ts` (29 tests) + extended `dailyReconcileExpiredReadiness.test.ts` (R.10 wiring smoke, 3 tests) → **43 passing**, 0 failures.
- [x] Full readiness mocha suite (`functions/src/__tests__/readiness/*.test.ts`) → **131 passing**, 20 pending, 0 regressions.
- [x] Root jest readiness/screening suites (`computeJobReadinessChip`, `buildAssignmentReadiness`, `seedAssignmentReadinessItems`, `readinessStatusFromAccuSource`, `matchScreeningPackage`) → **111 passing**, 0 regressions.
- [x] Lints clean for every R.10-touched file.
- [x] `evaluateScreeningSatisfiedServer` callers unchanged at call site — the new `validityDays` opt is back-compatible (defaults to `DEFAULT_SCREENING_VALIDITY_DAYS`); existing call sites in `screeningAutomationTrigger.ts` and `jobRequirementMatcherHelpers.ts` produce byte-identical output.
- [ ] Manual staging smoke — confirm `dailyReconcileExpiredReadiness` `function_runs` doc still exits idempotent-true on second-run-same-day after R.10 deploy. (Deferred to deploy-time; not a code-level gate.)

### Test breakdown

`backgroundCheckExpiryPass.test.ts` — 29 cases across 7 suites:

1. **Fresh check, within validity** (3) — 30d / 364d / boundary at exactly `nowMs === expiresAtMs` all skip.
2. **Old check, expires** (3) — 400d / 1ms-past-threshold / `appliedValidityDays` audit-stamp passthrough.
3. **Policy change semantics** (3) — tighten 365→180 expires immediately; loosen 365→730 keeps a 400d-old check valid; arbitrary non-365 thresholds work.
4. **Non-completed checks** (4) — `in_progress` / `queued` skip; `orderCompleted=true` alone is enough; `hrxStatus='report_ready'` alone is enough.
5. **Defensive / missing data** (5) — null / 0 / negative `completedMs` skip; invalid `validityDays` (0, non-integer) falls back to default.
6. **Race precedence** (1) — `not_completed` wins over `missing_completed_at` when both apply.
7. **Cascade merge precedence** (10) — default fallback, account/location/JO precedence chain, invalid-value rejection (0, negative, non-integer, string), 1-day minimum (no special lower-bound enforcement).

`dailyReconcileExpiredReadiness.test.ts` — 14 existing cases + 3 R.10 wiring smoke tests (orchestrator exports both passes, decision functions are independent).

---

## Deferred to follow-up

These are not blocking R.10 and not on the "what to look for" list — captured here so the next pass picks them up cleanly.

1. **`packages/contracts` JSON schemas for `backgroundChecks` and `accounts.orderDefaults`.** Today neither has a JSON schema in `packages/contracts/firestore/schemas/`. R.10 follows the existing TypeScript-only pattern (see `src/types/backgroundCheck.ts`, `src/types/recruiter/account.ts`). When the contracts pass adds these collections, `screeningValidityDays` and the three new BG-check fields move into the schema codegen flow.
2. **Cascade-engine migration.** `screeningPackageId` / `screeningPackageName` / `screeningValidityDays` all live in the bespoke `mergeScreeningPackageFromLayers` / `mergeScreeningValidityDaysFromLayers` pattern today. The registry-driven engine in `src/shared/cascade/loaders.ts` has `FIELD_PATHS_BY_LEVEL` entries for the package fields but the merger itself isn't wired to the registry. When that migration happens, `screeningValidityDays` should move alongside the package fields in the same sweep, not separately.
3. **CSA "expired-check" surfacing in R.8 matrix.** Once R.10 ships, the matrix will start showing `'expired'` red cells for the BG / drug categories. The bulk-action menu's "Order new check" affordance — which is NOT in R.10 scope ("Does NOT auto-order a new check") — is the natural next surface for CSAs to act on the expired state. Track separately if it earns its keep once operators see expired-cell volumes in production.
4. **Unified BG check expiry signal across vendors.** Today the only persisted BG check doc is AccuSource-shaped (`hrxStatus`, service-line verdicts). If we ever onboard a second vendor with its own check doc shape, the sweep query needs to be vendor-agnostic — likely by reading a normalized `completedAt` rather than `updatedAt ?? createdAt` per `BgLike`. Note as a prerequisite for any second-vendor work.

---

## Successor cross-refs

- **R.4** — Job Readiness Chip aggregator: `'expired'` already classified as red (hard) / yellow (soft) per `computeJobReadinessChip.ts:100-102, 155-158`. R.10 emits `'expired'` on `employeeReadinessItems`; chip aggregation downstream is unchanged.
- **R.6** — AccuSource adjudication CSA matrix UI (`BackgroundCheckCaseDrawer`): drawer body could surface the new `expired`/`expiredAt`/`expiredValidityDays` fields, but R.10 doesn't require it. Tracked as deferred follow-up #3.
- **R.7** — Worker Profile chip + drill-in: the lg chip on a worker's BG-check assignment will land on red after expiry sweep; drill-in row shows `'expired'`. No code changes needed in R.7's tab (the listener picks up whatever the snapshot writer puts on the doc).
- **R.8** — CSA cross-worker readiness matrix UI: BG / drug category cells that flip to expired after R.10 lands will render as red `inline` chips. No matrix code changes required.
- **C.2 (`dailyReconcileExpiredReadiness`)** — R.10 piggybacks on this scheduled function. The two passes (C.2's `runReconcilePass` over assignment items, R.10's `runBackgroundCheckExpiryPass` over BG check docs) are independent but share the same idempotency / cron / log surface.
