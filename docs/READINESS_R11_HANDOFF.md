# Readiness Rebuild — R.11 (JO screening-package drift detection) Handoff Spec

**Status:** R.11 implementation complete; awaiting deploy + staging smoke.
**Predecessors:** `READINESS_R6_HANDOFF.md`, `READINESS_R7_HANDOFF.md`, `READINESS_R8_HANDOFF.md`, `READINESS_R10_HANDOFF.md`.
**Successors:** `R.11.1` — actuated reorder workflow (cancel + auto-order with new package). `R.11.2` — jurisdictional-scope refinement of service-set comparison. Both deferred follow-ups; see "Deferred to follow-up" below.

---

## TL;DR

R.11 detects when a JobOrder's `screeningPackageId` changes while in-flight `backgroundChecks` for that JO still reference the previous package. **Pure detection** — flags the affected checks, surfaces them in the CSA workspace, does not auto-cancel or auto-reorder.

Single trigger, two surfaces, one CSA action callable, two new indexes. Targeted at "1–2 day PR" scope.

| ID | Task | Touches |
|---|---|---|
| R.11.1 | New JO trigger `onJobOrderWriteDetectScreeningPackageDrift` (single responsibility, tight fingerprint) | `functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts` (new) |
| R.11.2 | Pure helpers — `classifyServiceSetDrift` + memoized AccuSource catalog reader | `functions/src/compliance/screeningAutomationShared.ts` |
| R.11.3 | Type extensions on `BackgroundCheckRecord` (`packageDrift` + `hasPendingPackageDrift`) | `src/types/backgroundCheck.ts` |
| R.11.4 | `acknowledgeBackgroundCheckPackageDriftCallable` — CSA "Keep current check" action | `functions/src/integrations/accusource/acknowledgePackageDrift.ts` (new) |
| R.11.5 | R.6 drawer extension — warning Alert + Acknowledge dialog + disabled Reorder button | `src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx` |
| R.11.6 | R.8 matrix drift banner — count query + filter mode | `src/components/workforce/MatrixView/index.tsx` (+ supporting helpers) |
| R.11.7 | Two new composite indexes on `backgroundChecks` | `firestore.indexes.json` |
| R.11.8 | Pure-logic mocha tests | `functions/src/__tests__/readiness/screeningPackageDrift.test.ts` (new) |

---

## Decisions (locked from this PR's greenlight)

### L1.R11 — Drift signal location: stamp on `backgroundChecks/{checkId}` only; do NOT mirror to readiness items — LOCKED

Authoritative drift state lives on the BG check doc:

```ts
packageDrift?: {
  jobOrderId: string;
  detectedAt: Timestamp;
  expectedPackageId: string | null;
  expectedPackageName: string | null;
  expectedServiceIds?: string[] | null;       // catalog snapshot at detection time, for audit
  driftKind: 'more_strict' | 'incomparable';  // 'less_strict' is short-circuited at detection (see L3)
  acknowledgedAt?: Timestamp | null;
  acknowledgedBy?: string | null;
  acknowledgmentNote?: string | null;
};
hasPendingPackageDrift?: boolean;  // denormalized flag — set/cleared in lockstep with packageDrift
```

The denormalized `hasPendingPackageDrift` boolean lets the R.8 matrix banner run a single tenant-wide query (`tenantId + hasPendingPackageDrift == true`) without scanning every check. Set when drift is stamped; cleared on acknowledgment.

**Why not mirror to `employeeReadinessItems`:**

1. **Drift is informational, not a status change.** The BG check is still in-flight; the readiness status for `background_check` doesn't change. Mirroring would require either a new readiness type (`background_check_package_drift` — too heavy for the "pure detection" budget) or co-opting an existing status (loses the type signal and breaks the "status accurately reflects placement readiness" invariant).
2. **Single source of truth.** Per the R.10 L3 principle ("BG check doc state → readiness state"), drift is BG-check-state, full stop. R.6 drawer is the CSA workspace for BG check state; the matrix routes there via the existing "Open case" path.
3. **R.4 chip aggregation does NOT change.** A worker with an in-flight drift-flagged check is still pre-clear-or-fail — the eventual outcome is what feeds readiness. Drift is a CSA workflow signal, not a placement readiness signal.

**R.8 matrix surface (V1):** a top-of-page **drift banner** — `"{N} background checks need package review"` with click-to-filter. One extra Firestore read per matrix page load. **Per-cell badges in matrix cells are deferred to R.11.1** if production CSA usage shows they're needed; they would add visual noise without proportional value in V1.

### L2.R11 — Trigger: NEW dedicated `onJobOrderWriteDetectScreeningPackageDrift` — LOCKED

A new `onDocumentWritten` trigger on `tenants/{tid}/job_orders/{joId}`. Tight fingerprint: only acts when `before.screeningPackageId !== after.screeningPackageId` (including null↔set transitions). Single responsibility — won't tangle with the four existing JO triggers (translation in `triggers/onJobOrderWrite.ts`, scheduler stamp in `recruiting/onJobOrderWriteStampScheduler.ts`, recruiter notifications in `recruiterDashboardNotifications.ts`, checklist task sync in `jobOrderChecklistTasks.ts` — each has its own concern).

**Rejected:** bolting onto an existing JO trigger. The existing handlers have unrelated single-purpose mandates; adding drift logic there would create exactly the load-bearing tangle we want to avoid in "pure detection".

### L3.R11 — Detection scope: flag any non-equivalent change; short-circuit "less-strict" via service-set comparison; conservative on incomparable — LOCKED

Logic per JO write where `screeningPackageId` changed:

1. Query `backgroundChecks` where `tenantId == X AND jobOrderId == joId` (new composite index — see L5). Client-filter for in-flight per the spec definition: `hrxStatus NOT IN ['completed', 'canceled'] AND markedCompleteOutsideHrx !== true`.
2. For each in-flight check:
   - **Already aligned shortcut:** `check.requestedPackageId === after.screeningPackageId` → no-op. Idempotent re-runs (e.g. JO re-saved with same package, or package was bounced and restored).
   - **Memoize once per trigger invocation:** read `integrations_accusource/catalog`, look up `after.screeningPackageId` → its `serviceIds[]`.
   - **Service-set comparison (`classifyServiceSetDrift`):**
     - `newServiceIds ⊆ check.requestedServices` → `'less_strict'`. **Don't stamp; log info.** Older check covers everything the new package wants.
     - `newServiceIds ⊄ check.requestedServices` (new package adds at least one service not in old) → `'more_strict'`. **Stamp drift.**
     - Either side missing service data (e.g., legacy check with no `requestedServices`, or catalog miss on new package) → `'incomparable'`. **Stamp drift conservatively + log warning.** False-positives are visible (CSA acknowledges, low cost); false-negatives are invisible (worker placed against outdated screening — real compliance risk). Fail-safe in the visible direction.
3. Stamp `packageDrift` + `hasPendingPackageDrift: true` on `'more_strict'` and `'incomparable'` cases. Skip on `'less_strict'`.

**`'incomparable'` telemetry:** the warning log gives us frequency monitoring. If incomparable rate is high, signal to either tighten heuristics or accelerate a legacy-check `requestedServices` backfill. Most legacy checks predate the `requestedServices` stamping pattern, so `'incomparable'` will dwindle naturally as those checks age out.

**Known V1 limitation (worth a code comment):** service-set comparison is just `serviceIds`, not jurisdictional scope or depth. Same `serviceId` can mean different counties / search depths. False-positive on jurisdictional change → CSA acknowledges, no automation harm. False-negative on jurisdictional reduction is the mirror case. Track as **R.11.2 follow-up** if production data shows it matters.

### L4.R11 — CSA actions: ship "Acknowledge / keep current check" only; defer "Reorder with new package" to R.11.1 — LOCKED

**Ships in R.11:**

- `acknowledgeBackgroundCheckPackageDriftCallable({ checkId, note? })` — sets `packageDrift.acknowledgedAt`, `acknowledgedBy`, `acknowledgmentNote`; clears `hasPendingPackageDrift`. Idempotent (no-op if already acknowledged or no drift). Audit-logged via existing audit infrastructure.
- R.6 drawer extension: `<Alert severity="warning">` block above the existing action area when `packageDrift && !packageDrift.acknowledgedAt`. **Single primary button** "Keep current check" → opens a small note dialog → calls the callable. Secondary "Reorder with new package" button is **disabled with tooltip** pointing to R.11.1 + the urgent-reorder ops channel escape hatch.

**Deferred to R.11.1 ("Reorder with new package"):**

- The survey confirmed there is **no AccuSource cancel-order callable today**. A real reorder requires (a) AccuSource cancel-order API integration, (b) `screeningAutomationTrigger` extension to detect "previous check canceled-for-drift, auto-order with new package", (c) cancel↔reorder audit pair. That's a 3–5 day PR on its own — out of R.11's "1–2 day pure-detection" budget.
- **Why no intent-stamp in V1:** an intent stamp ("CSA flagged for reorder, ops to handle manually") creates a half-built workflow. CSAs click "Request reorder", nothing visible happens, they wonder if it's broken or if ops missed it. The disabled-button-with-tooltip is honest about what works today.
- **V1 escape hatch:** the disabled-button tooltip includes "For urgent reorders, contact ops via [channel]" so CSAs see the path is coming and have a clear interim escalation. Channel value plumbed via app config or hardcoded constant initially.

### L5.R11 — Indexes: two new composites on `backgroundChecks` — LOCKED

1. `(tenantId ASC, jobOrderId ASC)` — for the JO trigger's in-flight query.
2. `(tenantId ASC, hasPendingPackageDrift ASC)` — for the matrix drift banner.

Added to `firestore.indexes.json`. **Manual deploy** required per the cursorrules gotcha:

```bash
firebase deploy --only firestore:indexes --project hrx1-d3beb
```

Without these indexes, both queries fail `INVALID_ARGUMENT` at runtime. Deploy runbook below makes this the gating step.

---

## Deploy runbook

R.11 has a hard ordering requirement that mirrors the R.4 chip-stuck post-mortem (see `READINESS_R7_HANDOFF.md` § Post-deploy chip-stuck investigation):

1. **Deploy indexes first.** `firebase deploy --only firestore:indexes --project hrx1-d3beb`. Confirm via Firebase Console → Firestore → Indexes that both new composites are `Enabled` (not `Building`). Index builds on a populated `backgroundChecks` collection can take 5–30 minutes depending on doc count.
2. **Deploy functions.** `firebase deploy --only functions:onJobOrderWriteDetectScreeningPackageDrift,functions:acknowledgeBackgroundCheckPackageDriftCallable --project hrx1-d3beb`. Verify with `gcloud functions describe ... --gen2` that both deployed.
3. **Deploy frontend.** `npm run deploy:hosting`. Drift banner + drawer alert ship in the same hosting build.
4. **Smoke test in staging:** edit a JO's screening package, observe a single in-flight check stamps `packageDrift` within ~5 seconds (trigger latency). Open the BG check in the R.6 drawer, confirm the warning banner renders. Click "Keep current check", confirm `hasPendingPackageDrift` clears and the banner disappears from the matrix.

If indexes are deployed AFTER the function code, the first JO write triggers a query failure logged as `INVALID_ARGUMENT` — caught by the trigger's try/catch but the drift is silently dropped for that write. Always indexes first.

---

## Files changed

### Server — primary

- `functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts` — NEW. The Firestore trigger, the in-flight check query, the per-check decision call, the batch stamp.
- `functions/src/compliance/screeningAutomationShared.ts` — adds `classifyServiceSetDrift(newServiceIds, oldServiceIds): { kind: 'less_strict' | 'more_strict' | 'incomparable', reason: string }` and a memoized `readPackageServiceIdsFromCatalog(db, packageId, cache): string[] | null`. Pure helpers — testable.
- `functions/src/integrations/accusource/acknowledgePackageDrift.ts` — NEW. The CSA acknowledge callable.
- `functions/src/index.ts` — register both new exports.

### Client — primary

- `src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx` — adds the warning Alert block + Acknowledge dialog + disabled Reorder button.
- `src/components/workforce/MatrixView/index.tsx` (or its data-loading sibling) — adds the drift banner + filter-to-drift mode.
- `src/hooks/useBackgroundCheckPackageDrift.ts` — NEW. Small data hook that owns the tenant-wide drift count query.

### Types

- `src/types/backgroundCheck.ts` — add `packageDrift?: BackgroundCheckPackageDrift` and `hasPendingPackageDrift?: boolean` to `BackgroundCheckRecord`. Define `BackgroundCheckPackageDrift` shape per L1.

### Indexes

- `firestore.indexes.json` — add two new composites on `backgroundChecks`.

### Tests

- `functions/src/__tests__/readiness/screeningPackageDrift.test.ts` — NEW. Pure-logic mocha:
  - `classifyServiceSetDrift` decision matrix:
    - Equal sets → `'less_strict'` (degenerate — already-aligned shortcut would catch this earlier, but verify).
    - New is strict subset → `'less_strict'`.
    - New is strict superset → `'more_strict'`.
    - Disjoint sets → `'more_strict'`.
    - New empty → `'incomparable'` (catalog miss).
    - Old empty / null → `'incomparable'` (legacy check without `requestedServices`).
    - Both null → `'incomparable'`.
    - Order-independence (sets, not lists).
  - Idempotency assertion: a check that's already-acknowledged should not get re-stamped on the same drift cause.

---

## Implementation summary

R.11 shipped as a **pure-detection** PR with no behavior changes for already-shipped flows. The full surface area:

### Server

- `functions/src/compliance/screeningAutomationShared.ts` — added `classifyServiceSetDrift(newServiceIds, oldServiceIds)` (pure set comparison, fully order-independent and dedup-safe), plus `AccusourceCatalogPackageServiceCache` (per-trigger memoized reader for `integrations_accusource/catalog`). Added `ServiceSetDriftKind` and `ServiceSetDriftResult` types. No imports added that would risk a circular dependency on `integrations/accusource` — the catalog path is hard-coded as a string literal at the read site.
- `functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts` — NEW. Exports the pure decision unit `decideDriftPerCheckAction` (testable without admin SDK mocks), the I/O orchestrator `runScreeningPackageDriftPassForJo`, and the `onDocumentWritten` trigger `onJobOrderWriteDetectScreeningPackageDrift`. Trigger has a tight package-id fingerprint, hard-cap of `DRIFT_MAX_CANDIDATES = 1000` per JO, batch-of-250 commits, structured info/warn logs per drift kind, and `try/catch` that swallows query errors so a missing index doesn't trigger retry storms (logs ERROR for ops to catch).
- `functions/src/integrations/accusource/acknowledgePackageDrift.ts` — NEW. `acknowledgeBackgroundCheckPackageDriftCallable({ checkId, note? })`. Idempotent (returns `alreadyAcknowledged: true` on re-fire), gated by `ensureAccusourceAdmin`, audit-logged via `accusourceLog`, dot-path update preserves the full drift struct for audit. Note capped at 2,000 chars.
- `functions/src/integrations/accusource/index.ts` — exports the new callable.
- `functions/src/index.ts` — registers `acknowledgeBackgroundCheckPackageDriftCallable` (callable) and `onJobOrderWriteDetectScreeningPackageDrift` (trigger).

### Client

- `src/types/backgroundCheck.ts` — added `BackgroundCheckPackageDrift` interface and the `packageDrift` + `hasPendingPackageDrift` fields on `BackgroundCheckRecord`. JSDoc captures L1.R11 lock semantics and the post-acknowledgment audit-preservation invariant.
- `src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx` — added `WarningAmberIcon` import, drift state (`ackDriftOpen`, `ackDriftNote`, `ackDriftSubmitting`, `ackDriftError`), close-reset for those, `submitAcknowledgeDrift` callback, the `pendingDrift` derived value, the warning Alert (rendered above the existing actionError banner so a CSA sees drift before any other context), and the Acknowledge dialog. The disabled "Reorder with new package" button uses MUI's required `<span>` wrapper to make Tooltip work over a disabled button. Tooltip wording per L4.R11 includes the urgent-reorder ops escape hatch.
- `src/hooks/useBackgroundCheckPackageDrift.ts` — NEW. Single tenant-wide one-shot query (NOT a snapshot listener — drift is informational, near-real-time isn't required, and a listener per matrix mount would burn an unnecessary connection). Race-guarded refresh, falls back from `orderBy('packageDrift.detectedAt', 'desc')` to unordered+client-sort if the orderBy variant lacks a matching index in V1.
- `src/components/workforce/MatrixView/index.tsx` — wired the hook, added the warning banner above the error Alert (only renders when `count > 0`), added the drift cases triage Dialog (worker, old package, new package, detected date, "Review" button per row → opens R.6 drawer with that check), passed `onActionApplied={driftHook.refresh}` on the existing `BackgroundCheckCaseDrawer` mount so the count converges immediately on acknowledgment.

### Indexes

- `firestore.indexes.json` — added two new composites on `backgroundChecks`:
  - `(tenantId ASC, jobOrderId ASC)` — for `runScreeningPackageDriftPassForJo`'s in-flight query.
  - `(tenantId ASC, hasPendingPackageDrift ASC)` — for `useBackgroundCheckPackageDrift`'s tenant-wide query.

### Tests

- `functions/src/__tests__/readiness/screeningPackageDrift.test.ts` — NEW. **31 passing** Mocha tests across 8 describe blocks covering the full decision matrix: equal sets, less_strict (`new ⊂ existing`), more_strict (`new ⊄ existing`), incomparable (legacy/catalog miss/null), return-shape invariants, in-flight gating per the R.11 spec definition, already-aligned shortcut + whitespace handling, service-set classification, and gating-order priority (terminal beats aligned beats classification).

## Verification gate

- [x] `cd functions && npx tsc --noEmit` — clean (zero output, exit 0).
- [x] `npx tsc --noEmit` (root) — only pre-existing errors in `certifications/__tests__/*` and `userActionItems/__tests__/*` (unchanged from R.10 baseline). No R.11-touched files surface errors.
- [x] R.11-specific mocha (`screeningPackageDrift.test.ts`) — **31 passing**.
- [x] Full readiness mocha suite (`'src/__tests__/readiness/**/*.test.ts'`) — **162 passing**, 20 pending, zero failures.
- [x] Root jest readiness/screening suites (`(readiness|backgroundCheck|screening)`) — **249 passing** across 19 suites, zero failures.
- [x] Lints clean for every R.11-touched file (verified via `read_lints` over all 11 paths).
- [ ] Manual staging smoke per the deploy runbook above (gating action for the deployer).

---

## Deferred to follow-up

1. **R.11.1 — Actuated reorder workflow.** AccuSource cancel-order API integration + `screeningAutomationTrigger` extension to auto-order on cancel-for-drift + cancel↔reorder audit pair. 3–5 day PR. Decouples the disabled "Reorder" button into a working surface.
2. **R.11.2 — Jurisdictional-scope refinement.** Today's `classifyServiceSetDrift` compares only `serviceId`; same `serviceId` can mean different counties/depths. If R.11.1's `'incomparable'` warning logs show jurisdictional drift is a real production concern, extend the comparison to include scope metadata from the catalog.
3. **R.11.3 — Per-cell drift badges in R.8 matrix.** V1 ships banner only. If CSA usage shows per-row context is missed, add inline badges to BG-check matrix cells. Requires the matrix to load drift state per row (one extra Firestore query per page or denormalize onto a row-summary doc).
4. **R.11.4 — Tenant-level "drift dashboard" page.** Aggregated view across JOs showing drift counts, age distributions, top-affected packages. If banner volume signals operations need a dedicated triage surface.
5. **R.11.5 — Legacy-check `requestedServices` backfill.** If `'incomparable'` rate stays high after old checks age out (suggesting a real backfill gap), one-shot script to populate `requestedServices` on legacy checks from `requestedPackageId` + catalog lookup. Pattern matches `scripts/refreshAssignmentReadinessSnapshotV1.js` (see `READINESS_R7_HANDOFF.md` for the established pattern).

---

## Successor cross-refs

- **R.4 / R.7** — chip + worker profile: untouched. Drift is a CSA workflow signal, not a placement readiness signal.
- **R.6** — `BackgroundCheckCaseDrawer`: extended with the drift warning Alert + Acknowledge dialog + disabled Reorder. Existing "Mark cleared via prior check" action area unchanged.
- **R.8** — CSA matrix UI: drift banner + filter-to-drift mode. Per-cell badges deferred (R.11.3).
- **R.10** — daily expiry sweep: independent. R.10 stamps `expired:true` on completed checks past validity; R.11 stamps `packageDrift` on in-flight checks against changed packages. Both write to the BG check doc; both are picked up by the same `onBackgroundCheckWriteUpdateReadiness` fingerprint **only for fields that affect readiness** — `packageDrift` does NOT extend that fingerprint (drift is informational; the trigger short-circuit on `expired:true` is the only L3-style propagation).
