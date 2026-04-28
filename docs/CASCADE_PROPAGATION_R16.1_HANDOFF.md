# Cascade Propagation Policy — §16.1 Minimum Slice Handoff Spec

**Status:** R.16.1 design locked, implementation complete (Phases 1–8 shipped). **R.16.1.1 follow-up shipped** (National-Account fanout + previousValue filter — see "R.16.1.1" section at the bottom of this doc).
**Predecessor:** `docs/CASCADE_IMPLEMENTATION_STATUS.md` (audit doc, §F minimum-slice section).
**Successor:** R.16.2 — production consumer rewire (move billing / comp / hiring-entity reads to `getEffectiveJobOrderField`). Tracked separately; CORT push gate calls this out as conditional follow-up.

**Goal:** ship the smallest correct piece of §16 that makes the CORT National Account push safe — propagation enum + per-field policies + draft→active snapshot trigger + admin-controlled Push-to-Active + backfill for already-active JOs.

**Out of scope (deferred):**
- Override visibility affordance ("Differs from parent" badge + reset/push/keep menu).
- Production-editor rewiring to use the cascade engine (only a one-call helper ships here; consumers still read through `recruiterAccountOrderDefaultsMerge.ts` until a follow-up PR).
- §14 auto-JO-creator.
- §15 forward-sync trigger and auto-publish hook.
- O.5 override-mask warning.

---

## Locked decisions

### L1. Snapshot lives in a dedicated `jo.snapshot.*` namespace

Snapshotted values are written to `jo.snapshot.{fieldKey}` on the job-order doc. Not into the flat top-level fields like `jo.markupPercentage` or `jo.payRate`.

**Why a separate namespace:**
- Several snapshot fields (`markupPercentage`, `payRate`, `billRate`, `futa`, `suta`, `workersCompRate`) are registered with `editableAt: ['child']`. The cascade engine's `editableAt` guard (`resolveCascadedField.ts:95-97`) actively *ignores* JO-level deltas for these — meaning the engine would refuse to honour them as cascade overrides. Writing them into the existing flat fields would create a fight between "the engine refuses this" and "this is the snapshot."
- We need to distinguish two semantically different things:
  - **JO-level cascade override** (e.g. `jo.screeningPackageId` set explicitly during draft because this JO chose a different package than the parent) — already supported by the cascade engine.
  - **Activation snapshot** (the resolved effective value frozen at draft→active) — the new thing.
  Push-to-Active behaves differently for each: it overwrites snapshots, but it *won't* clobber an explicit JO-level override.
- Snapshot envelope is queryable for tooling / audit: `jo.snapshot.capturedAt`, `jo.snapshot.lastPushedAt` are the idempotency + ops markers.

**Snapshot envelope shape** (added to `src/types/recruiter/jobOrder.ts`):

```ts
export interface JobOrderSnapshot {
  /** Set on first snapshot (trigger or backfill). Idempotency key. */
  capturedAt: Timestamp;
  /** 'trigger' (draft→active) or 'backfill' (one-shot migration). */
  capturedBy: 'trigger' | 'backfill';
  /** Bumped on every Push-to-Active that touches this JO. */
  lastPushedAt?: Timestamp | null;

  // Top-level snapshot fields
  hiringEntityId?: string | null;
  eVerifyRequired?: boolean | null;
  workersCompCode?: string | null;
  screeningPackageId?: string | null;
  additionalScreenings?: string[] | null;
  selectedPositionIds?: string[] | null;

  /** Resolved + filtered to selectedPositionIds. Each entry includes
   *  every snapshot-policy sub-field (payRate, billRate, futa, suta,
   *  workersCompRate, markupPercentage, rateMode, jobTitle, jobDescription).
   */
  positions?: ResolvedPositionSnapshot[];
}

export interface ResolvedPositionSnapshot {
  positionId: string;
  jobTitle?: string;
  jobDescription?: string;
  rateMode?: string;
  payRate?: number | null;
  billRate?: number | null;
  futa?: number | null;
  suta?: number | null;
  workersCompRate?: number | null;
  markupPercentage?: number | null;
}
```

### L2. Consumer rewire is deferred — slice ships the read-side helper only

This slice ships **`getEffectiveJobOrderField(joDoc, fieldKey, positionId?)`** as the canonical read primitive. The function:

1. If JO is non-draft AND `joDoc.snapshot.{fieldKey}` is set, return the snapshot value (preferring snapshot over cascade post-activation).
2. Else, fall through to the existing cascade engine resolution (or `recruiterAccountOrderDefaultsMerge.ts` for fields the cascade doesn't yet cover).

**The slice does not rewire any production editor or pipeline.** That means:
- The legacy `recruiterAccountOrderDefaultsMerge.ts` is still the read path for JobOrderForm, AccountOrderDetailsForm, and downstream billing/payroll consumers.
- Account-level edits to snapshot fields *do not propagate* to active JOs through cascade-aware consumers — but they *do* still propagate through any consumer that reads Account-level data directly.
- **Consequence for CORT push:** the snapshot is a *safety net + explicit-control surface*, not an automatic shield. CORT push must either (a) be paired with a small follow-up PR that flips the critical financial consumers (markup, comp rate, hiring entity) to use `getEffectiveJobOrderField`, or (b) accept that during the CORT window, all sensitive Account-level edits go through the Push-to-Active dialog and not the raw account-edit form. This is documented in §F.4 below as a hard CORT-push prerequisite.

### L3. `workersCompCode` joins the cascade registry

`workersCompCode` is in the brief's snapshot-policy list but is not on the registry today. It exists on:
- `RecruiterAccount` (`src/types/recruiter/account.ts:38`).
- `JobOrder` and `JobOrderFormData` (`src/types/recruiter/jobOrder.ts:71`, `:365`).

Added to the registry as:

```ts
workersCompCode: {
  strategy: 'replace',
  editableAt: ['account', 'child'],
  label: "Workers' Comp Code",
  propagation: 'snapshot-on-activation',
}
```

Loader field-path map (`src/shared/cascade/loaders.ts:40-99`) gets one entry per level — `account: 'workersCompCode'`, `child: 'workersCompCode'`, `jo: 'workersCompCode'` (existing flat field already there).

### L4. Admin-SDK loader twin lands in this slice

The snapshot trigger (server-side) and Push-to-Active callable (server-side) both need to resolve cascade values. The current loader (`src/shared/cascade/loaders.ts`) imports `firebase/firestore` (CRA SDK) and is unusable from cloud functions.

This slice adds an admin-SDK twin at `shared/cascade/loaders.ts` (the root-level cascade tree). Identical chain composition (`loadCascadeChain`), identical field-path map enforced by CI (see L8), identical `LoaderContext` semantics. The twin accepts an injected `admin.firestore.Firestore` handle so unit tests can run against a fake without monkey-patching globals.

**Topology correction (audit follow-up):** The original audit (`docs/CASCADE_IMPLEMENTATION_STATUS.md` §E.4) flagged "two byte-identical mirrors" — `src/shared/cascade/` and `shared/cascade/`. The §16.1 work uncovered a *third* view: `functions/src/shared` is a **symlink** (`functions/src/shared → ../../shared`), so cloud-functions code imports the root-level tree as `./shared/cascade/...` and *writes* to functions/src/shared/cascade transparently land in shared/cascade. The two real trees stay independent (CRA vs. root); the functions package gets the root tree via the symlink. The CI guard (L8) checks both real trees against each other and validates the symlink resolves correctly.

### L5. R.11 surgical update — prefer snapshot for non-draft JOs

R.11's `runScreeningPackageDriftPassForJo` reads `jo.screeningPackageId` flat. After §16.1, a Push-to-Active for `screeningPackageId` writes to `jo.snapshot.screeningPackageId`, not the flat field. Without an R.11 update, the drift detector silently misses the change.

**Patch shape** (in `functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts`):
- Trigger fingerprint: also include `jo.snapshot.screeningPackageId` and `jo.snapshot.additionalScreenings`. Re-fire on those.
- Effective-package read: `effectivePackageId = jo.status === 'draft' ? jo.screeningPackageId : (jo.snapshot.screeningPackageId ?? jo.screeningPackageId)`.
- Same priority for `additionalScreenings`.

Test additions (in `functions/src/__tests__/readiness/screeningPackageDrift.test.ts`):
- non-draft JO with snapshot diff → drift detected.
- non-draft JO without snapshot (legacy pre-§16.1 data) → falls back to flat field → existing behaviour preserved.
- draft JO → ignores snapshot entirely.

### L6. Snapshot fires on `before.status === 'draft' && after.status !== 'draft' && after.status !== 'cancelled'`

`JobOrderStatus` (`src/types/recruiter/jobOrder.ts:325`) has six values: `draft | open | on_hold | cancelled | filled | completed`.

**Fires for:** draft→open (the typical case), draft→on_hold (gig sync edge case), draft→filled (rare), draft→completed (defensive — shouldn't happen but won't error).

**Does NOT fire for:**
- draft→cancelled — cancelled JOs don't need a snapshot.
- non-draft → anything (already past the gate).
- draft→draft (no transition).

Trigger fingerprint asserts both before-status and after-status to avoid spurious re-fires from unrelated JO writes.

### L7. Idempotency: snapshot is one-shot per JO

`jo.snapshot.capturedAt` is the idempotency marker.

- **Snapshot trigger:** if `jo.snapshot.capturedAt` already exists, the trigger early-exits with an info log. Reverse transitions (open→draft) preserve the existing snapshot; subsequent re-activation does not refresh.
- **Backfill script:** same — skips JOs with `capturedAt` set. Optional `--force` flag re-snapshots (use only with explicit op approval; emits a warning per JO).
- **Push-to-Active:** never blocked by idempotency. Updates `jo.snapshot.{field}` and bumps `jo.snapshot.lastPushedAt` every time.

This matches the spec's "frozen stays frozen" semantic. If an active JO needs its snapshot refreshed for any reason other than a Push-to-Active, the only path is the backfill script with `--force` (admin-only, audit-logged).

### L8. CI guard for the mirrored cascade trees

Pre-existing concern from the audit (§E.4): `src/shared/cascade/` and `shared/cascade/` are byte-identical mirrors with no enforcement. This slice adds `scripts/check-cascade-mirror.sh`, a hard-fail CI guard that:

1. Diffs `types.ts`, `registry.ts`, `resolveCascadedField.ts`, and `index.ts` between the two real trees (`src/shared/cascade/` and `shared/cascade/`). Any drift fails CI.
2. Diffs the `FIELD_PATHS_BY_LEVEL` constant between the CRA loader (`src/shared/cascade/loaders.ts`) and the admin loader (`shared/cascade/loaders.ts`). The two loaders are intentionally NOT byte-identical (different SDKs), but the per-level field-path map MUST stay in sync — the comparator strips comments + whitespace so the prose can differ but the keys/values cannot.
3. Verifies the `functions/src/shared` symlink is intact and resolves to the root tree. Catches a corrupted clone before it produces mysterious import errors at deploy time.

PR-Cop integration tracked as a follow-up.

### L9. Push-to-Active scope (V1)

Two callables:

1. **`previewPushToActiveCallable({ accountId, fieldKey, positionId?, newValue })`** — read-only. Returns `{ affectedJobOrders: AffectedJoSummary[] }` where each summary has `jobOrderId`, `jobTitle`, `tenantId`, `currentValue`, `newValue`, and `wouldChange: boolean`. Used by the UI dialog to populate the affected-JO list.

2. **`pushToActiveJobOrdersCallable({ accountId, fieldKey, positionId?, newValue, selectedJoIds, reason })`** — write. Validates security level ≥ 7. Validates `reason` is non-empty (max 2000 chars). Validates `selectedJoIds` is a subset of the preview-affected list (re-runs preview server-side). Writes `jo.snapshot.{fieldKey}` updates in batches of 250. Emits one audit entry per JO touched + one summary audit entry. Returns `{ updatedCount, skippedCount, auditId }`.

**Field-key support in V1:**
- Top-level: `hiringEntityId`, `eVerifyRequired`, `workersCompCode`, `screeningPackageId`, `additionalScreenings`.
- Per-position-field: `payRate`, `billRate`, `futa`, `suta`, `workersCompRate`, `markupPercentage`, `rateMode`, `jobTitle`, `jobDescription` — addressed via `positionId` argument. Updates `jo.snapshot.positions[i].{subField}` for the matching `positionId` in each affected JO.

**Out of V1:**
- Wholesale `positions` replace.
- Push of `selectedPositionIds` (admin would never use this — the JO chose its positions; pushing a new selection from Account doesn't make sense).

### L10. Audit trail location

New collection: `tenants/{tenantId}/cascadeAuditLog/{auditId}`. Schema:

```ts
interface CascadeAuditEntry {
  action: 'snapshotOnActivation' | 'pushToActive' | 'backfillSnapshotFields';
  at: Timestamp;
  actorUid: string | null;
  actorEmail: string | null;
  // For snapshotOnActivation:
  jobOrderId?: string;
  // For pushToActive:
  accountId?: string;
  fieldKey?: string;
  positionId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  affectedJoIds?: string[];
  reason?: string;
  // Free-form payload for ops debugging
  notes?: string;
}
```

Audit entries are read-only after creation; rules deny writes from anyone other than the Cloud Function service account.

---

## Implementation surface

### Phase 1 — Foundation (this PR's first commit)

- **`src/shared/cascade/types.ts`** — add `PropagationPolicy = 'live' | 'live-until-active' | 'snapshot-on-activation'` and `propagation?: PropagationPolicy` on `CascadeFieldSpec`.
- **`shared/cascade/types.ts`** — mirror.
- **`src/shared/cascade/registry.ts`** — add `propagation` per the L9 / L3 list. Add `workersCompCode` field. Update top-level `positions` entry with `propagation: 'snapshot-on-activation'`.
- **`shared/cascade/registry.ts`** — mirror.
- **`src/shared/cascade/__tests__/registry.test.ts`** — assert that snapshot-policy fields all carry `propagation: 'snapshot-on-activation'`. Assert default is `'live'`. Assert `workersCompCode` is registered.
- **`src/types/recruiter/jobOrder.ts`** — add `JobOrderSnapshot` and `ResolvedPositionSnapshot` interfaces. Add `snapshot?: JobOrderSnapshot` on `JobOrder`.

### Phase 2 — Admin-SDK loader twin (✅ shipped)

- **`shared/cascade/loaders.ts`** — admin-SDK twin of `src/shared/cascade/loaders.ts`. Same field-path map (CI-enforced parity), same chain composition, same memoization. Accepts an injected `admin.firestore.Firestore` handle through `LoaderContext` for testability.
- **`functions/src/__tests__/cascade/loaders.test.ts`** — 21 mocha cases covering field-path shape parity, argument validation, national/standalone/orphan hierarchies, shift extension, `preloadedJoData` fast path, and per-context memoization.
- **`scripts/check-cascade-mirror.sh`** — diffs the two real trees + validates the `functions/src/shared` symlink + diffs the `FIELD_PATHS_BY_LEVEL` constant between the two loaders.

### Phase 3 — Snapshot trigger

- **`functions/src/jobOrders/onJobOrderStatusTransitionSnapshot.ts`** — new file.
  - `decideShouldSnapshot(beforeStatus, afterStatus, existingSnapshot)`: pure function. Returns `'fire' | 'skip-no-transition' | 'skip-cancelled' | 'skip-already-snapshotted'`.
  - `runSnapshotPassForJo(tenantId, jobOrderId, joDoc)`: I/O orchestrator. Loads cascade chain via the admin loader, resolves every snapshot-policy field, builds `JobOrderSnapshot`, writes in one transaction.
  - `onJobOrderStatusTransitionSnapshot`: `onDocumentWritten('tenants/{tenantId}/job_orders/{jobOrderId}')` trigger. Status-change fingerprint to dedupe.
- **`functions/src/index.ts`** — register the new trigger.
- **Tests:** `functions/src/__tests__/jobOrders/snapshotOnActivation.test.ts`. ~25 cases — pure-logic decide function across the transition matrix; envelope shape; idempotency; child-vs-standalone hierarchy resolution; selectedPositionIds filtering for positions snapshot.

### Phase 4 — Backfill migration script (✅ shipped)

- **`scripts/backfillJoSnapshotFields.js`** — Node CLI wrapper. Mirrors the R.0c ops shape (same as `scripts/refreshAssignmentReadinessSnapshotV1.js`):
  - `--tenant <id>` required.
  - `--dry-run` (default) / `--no-dry-run` / `--write`.
  - `--force` to re-snapshot already-snapshotted JOs (rare; emits warning + tags audit context with `(forced)`).
  - `--limit <n>` for batched runs (default 1000, max 5000).
  - `--page-token <id>` for cursor-paginated continuation.
  - Outputs to `.scratch/backfillJoSnapshot-<tenant>-<timestamp>.txt` with bucket counts + summary footer.
  - Uses `GOOGLE_APPLICATION_CREDENTIALS` (already set in shell per `.cursorrules`).
  - Explicitly requires `firebase-admin` from `functions/node_modules` to avoid the dual-tree bug we hit in R.7.
- **`functions/src/jobOrders/backfillJoSnapshotFieldsCallable.ts`** — admin callable. Same logic the CLI compiles against; gated by securityLevel ≥ 7 on the requested tenant. Three exported helpers (`classifyJoForBackfill`, `processOneJoForBackfill`, `runBackfillPage`) keep the bucket decisions, audit emission, and pagination unit-testable in isolation.
- **`runSnapshotPassForJo` (extended)** — opt-in `force` parameter on the trigger's I/O orchestrator (`onJobOrderStatusTransitionSnapshot.ts`). When true, `decideShouldSnapshot` is fed `alreadySnapshotted: false`, the in-txn idempotency guard is bypassed, and the audit entry's `context` is suffixed with `' (forced)'`. The trigger never passes `force`; only the backfill `--force` path does.
- **Tests:** `functions/src/__tests__/jobOrders/backfillJoSnapshotFields.test.ts`. **18 cases** — bucket classification (status excluded, snapshot present/absent, dry-run vs write × force), per-JO orchestration (audit emission for skips, force re-snapshot path), and page-driver pagination + idempotency.

### Phase 5 — Push-to-Active (✅ shipped)

- **`functions/src/jobOrders/pushToActive.ts`** — both callables. Read-side `previewPushToActiveCallable` walks `where('recruiterAccountId','==',accountId)` and reports `wouldChange` per active JO with old-vs-new values. Write-side `pushToActiveJobOrdersCallable` re-runs preview server-side, refuses any selected JO not in its own preview (`preview_excluded`), and per-JO transactionally writes either a top-level dotted-path update (`snapshot.{fieldKey}` + `snapshot.lastPushedAt`) or a positions-array remap (`snapshot.positions[i].{subField}` via read-modify-write). Locked V1 surface is the union of `PUSH_TOP_LEVEL_FIELDS` (5 keys) and `PUSH_POSITION_FIELDS` (9 keys) — `selectedPositionIds` and wholesale `positions` replace are deferred (see L9, "out of V1").
- **Audit (per L10):** every successful per-JO push emits one `cascadeAuditLog` row with `action: 'push_to_active'`, `accountId`, `pushedField: { fieldKey, positionId, value }`, `oldValue`, `newValue`, `reason`, plus one `push_to_active_summary` row at the end with `affectedJoIds`, `updatedCount`, `skippedCount`, and the same `reason`. Per-JO rows on `skipped_*` outcomes are *not* audited (the summary row is the forensic record).
- **Validation (per L9):** `validatePushArgs` (pure, exported for tests) gates: `tenantId` / `accountId` non-empty, `fieldKey` in the locked surface, `positionId` shape matches top-level vs per-position, `newValue` shape matches the field's expected type (string / boolean / number / string-array, plus `null` always allowed), and on the write path: 1–200 `selectedJoIds` + a 1–2000 char trimmed `reason`.
- **Auth gate:** both callables enforce `activeTenantId === tenantId && securityLevel ≥ 7`. Mirrors the backfill callable's R.0c gate.
- **`functions/src/index.ts`** — registers both callables.
- **Tests:** `functions/src/__tests__/jobOrders/pushToActive.test.ts`. **42 cases** — pure helpers (field-surface lock, `valuesEqual` array-reorder semantics, `validatePushArgs` per-rule), `readCurrentSnapshotValue` lookups (top-level / per-position / no-snapshot / no-position), `runPreviewPushToActive` totals across mixed JO fleets, single-JO transactional write (top-level, per-position, no-op match, status-flip races, missing snapshot), and end-to-end orchestrator including audit emission (one per JO + one summary), preview-excluded refusal, idempotency, sibling-field preservation on dotted-path writes, and a mid-flight cancel race that the txn re-read catches.

### Phase 6 — R.11 update

- **`functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts`** — read effective package via snapshot-aware helper.
- **`functions/src/__tests__/readiness/screeningPackageDrift.test.ts`** — three new test cases (L5).

### Phase 7 — Read-side helper (✅ shipped)

- **`src/shared/jobOrder/getEffectiveJobOrderField.ts`** — exports two helpers:
  - `getEffectiveJobOrderField(joDoc, fieldKey, { fallback? })` — top-level snapshot fields.
  - `getEffectiveJobOrderPositionField(joDoc, positionId, subField, { fallback? })` — per-position sub-fields.
  Both return `{ value, source: 'snapshot' | 'fallback' | 'absent' }`. L2 precedence: draft JOs and JOs without a `capturedAt` snapshot fall through to the caller's fallback; non-draft snapshotted JOs prefer the snapshot value, including explicit `null` (deliberately frozen "no value"). Distinct from `undefined` (snapshot didn't capture this field).
- **`src/shared/jobOrder/__tests__/getEffectiveJobOrderField.test.ts`** — Jest. **18 cases** — draft / non-draft × snapshot present/absent, top-level + per-position lookups, explicit `null` honoured, missing field falls back, missing position falls back, missing positions array falls back, no-fallback `'absent'` source.
- **No production-code adoption in this slice.** The helper is library-only — R.16.2 wires it into the financial / compliance read paths.

### Phase 8 — Push-to-Active UI (✅ shipped)

- **`src/components/recruiter/PushToActiveDialog.tsx`** — opens, calls `previewPushToActiveCallable`, renders the affected-JO list as a checkbox table (rows with `wouldChange === true` checked by default; ineligible rows visible but checkbox-disabled with the inline reason). Reason TextField is mandatory, 1–2000 chars, with live char counter. Submit button label reflects the selection count. After the push, the dialog rerenders as a result view with per-JO outcome rows so the operator can see exactly what landed.
- **`src/components/recruiter/PushToActiveBanner.tsx`** — `Alert`-style banner that owns the dialog open state. Hidden when its `payload` prop is `null`. Single payload at a time per L9 (one push = one fieldKey). Reusable on Child-account forms when R.16.2 wires those.
- **`src/components/recruiter/AccountOrderDetailsForm.tsx`** — wires the banner. Tracks `lastSavedScreeningRef` and `lastSavedAdditionalScreeningsRef`; on a successful Account-level save (the form auto-saves on blur), compares new vs prior snapshot-policy field values and sets the banner payload. Banner is suppressed at the location-edit level (location edits don't carry snapshot-policy semantics for V1's push surface).
- **Surfaced fields in V1:** `screeningPackageId` and `additionalScreenings`. The remaining snapshot-policy top-level fields (`hiringEntityId`, `eVerifyRequired`, `workersCompCode`) live in editors outside `AccountOrderDetailsForm` — they'll get banners hooked up in R.16.2 alongside the consumer rewire so the dialog surface lights up on the same forms that produce the dirty edit.
- **No automated tests for UI** in this slice — manual smoke test in the verification gate. The dialog's preview/push interactions are exercised via the callable test suite (Phase 5) which reproduces the `selectedJoIds` + `reason` invariants the dialog enforces client-side.

---

## Verification gate

- [x] Phase 1 foundation: `cd functions && npx tsc --noEmit` clean. Registry shape-lock test passes (asserts new propagation invariants). Mirror diff clean.
- [x] Phase 2 loader twin: 21 admin-flavoured loader tests pass. `scripts/check-cascade-mirror.sh` returns clean.
- [x] Phase 3 snapshot trigger: pure-logic tests + I/O orchestrator tests pass (decide / resolve / run split per L6/L7/L10). **Manual gate at deploy:** create draft JO, transition to open, observe `jo.snapshot.*` in Firestore + the `cascadeAuditLog` row.
- [x] Phase 4 backfill: 18 tests pass. Manual gate: dry-run report eyeballs clean against staging tenant; write run reports same N as dry-run; second run reports 0 changes (idempotency confirm). **(Manual gate runs at deploy.)**
- [x] Phase 5 Push-to-Active: 42 callable tests pass. **Manual gate at deploy:** preview returns affected list; push updates `jo.snapshot.{field}`; one audit entry per JO + one summary entry appear with the supplied reason.
- [x] Phase 6 R.11: 84 cascade/snapshot/R.11 tests still pass.
- [x] Phase 7 helper: 18 Jest tests pass.
- [x] Phase 8 UI: code shipped. **Manual gate at deploy:** banner appears on save of `screeningPackageId` / `additionalScreenings` at the Account level; dialog renders affected list, push works end-to-end.
- [x] Cross-cutting: `npx tsc --noEmit` clean for the new code in both root + functions projects (pre-existing test-fixture errors in `src/utils/certifications/__tests__/` and `src/utils/userActionItems/__tests__/` are unrelated to R.16.1 and not introduced by this slice). Functions-side cascade/jobOrders/readiness mocha suite: **275 passing, 20 pending**. `scripts/check-cascade-mirror.sh` clean.
- [x] Lints clean across every R.16.1-touched file (frontend ESLint clean; functions-side ESLint matches the pre-existing single-quote convention, same warnings as the surrounding files in `functions/src/jobOrders/`).

---

## Deploy runbook

Ordering matters. Follows the R.11 pattern (indexes → functions → frontend) plus a backfill step.

### Step 1 — Indexes (only if needed)

R.16.1 ships **no new Firestore indexes**. The Push-to-Active preview uses a single-equality query (`where('recruiterAccountId','==',accountId)` on `tenants/{tid}/job_orders`) — the existing `recruiterAccountId` index from R.6/R.7's account-fanout work covers it. Backfill paginates by `__name__` cursor, no composite needed.

```bash
# Only if the indexes file changes:
firebase deploy --only firestore:indexes
```

### Step 2 — Functions deploy

Deploy the new server-side surface area:

```bash
firebase deploy --only \
  functions:onJobOrderStatusTransitionSnapshot,\
functions:previewPushToActiveCallable,\
functions:pushToActiveJobOrdersCallable,\
functions:backfillJoSnapshotFieldsCallable,\
functions:onJobOrderWriteDetectScreeningPackageDrift
```

(Last entry redeploys R.11 with the snapshot-aware updates.)

### Step 3 — Backfill on the staging tenant

Use `BCiP2bQ9CgVOCTfV6MhD` as named in the brief. The CLI loads the **compiled** callable bundle from `functions/lib/jobOrders/backfillJoSnapshotFieldsCallable.js`, so confirm `cd functions && npm run build` ran as part of the functions deploy in Step 2. Standard R.0c pattern:

```bash
# Dry run first — output goes to .scratch/
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD --dry-run

# Eyeball .scratch/backfillJoSnapshot-BCiP2bQ9CgVOCTfV6MhD-<ts>.txt — confirm:
#   - `scanned` matches the expected JO count under the tenant
#   - `buckets.would_snapshot` is the count of pre-§16.1 active JOs missing snapshot
#   - `buckets.skipped_status` is drafts + cancelled
#   - `buckets.skipped_already_snapshotted` is 0 on a first run (or matches any
#     JOs whose snapshot trigger already fired post-deploy)
#   - `errors` is empty

# Write
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD --write

# Idempotency confirm — second pass should see every just-snapshotted JO bucket
# into `skipped_already_snapshotted`, with `would_snapshot` and `snapshotted` at 0.
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD --dry-run

# Pagination — if `truncated: true` in any report, continue from `nextPageToken`:
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD \
  --write --page-token <id-from-previous-report>
```

`--force` is documented but not part of the deploy runbook. It's reserved for a follow-up where the registry's snapshot field set expands and you need to re-resolve frozen envelopes — never as part of a routine deploy.

### Step 4 — Frontend deploy

```bash
npm run deploy:hosting
```

Deploy after backfill so Push-to-Active UI doesn't surface against tenants where the snapshot doesn't yet exist (would render empty affected lists).

### Step 5 — Manual staging smoke

1. Create a draft JO under a test national account. Transition to open. Confirm `jo.snapshot.{...}` populated and `cascadeAuditLog` entry exists with `action: 'snapshotOnActivation'`.
2. Edit a snapshot-policy field on the parent Account. Confirm banner appears on the form.
3. Open Push-to-Active dialog. Confirm affected-JO list renders. Confirm per-row checkbox defaults to checked. Reason input is required.
4. Submit Push-to-Active. Confirm:
   - All selected JOs' `jo.snapshot.{field}` updated.
   - One audit entry per JO + one summary audit entry.
   - R.11 fires for `screeningPackageId` push if applicable; drift detection should run with the new effective value.
5. Re-open Push-to-Active. Confirm the same JOs no longer appear (their snapshot now matches).

### Step 6 — CORT push prerequisite check

**Before greenlighting the CORT exercise**, confirm at minimum one of:
- Follow-up consumer-rewire PR has shipped (markup, comp rate, hiring entity reads now go through `getEffectiveJobOrderField`), OR
- Operational discipline locked: Greg + deployer have agreed that during the CORT window, all Account-level edits to snapshot fields go through Push-to-Active. No direct edits to AccountOrderDetailsForm for snapshot fields.

The slice as-shipped does not by itself prevent silent live propagation through legacy consumers. This is documented in L2.

---

## Deferred to follow-up

| Item | Tracker | Why deferred |
|------|---------|--------------|
| Production consumer rewire | R.16.2 | Explicit user scope. 1-3 day mechanical PR. Critical for full CORT protection. |
| Override visibility affordance ("Differs from parent" badge + reset/push/keep menu) | R.16.3 | UX polish. Not a CORT gate. |
| Wholesale `positions` Push-to-Active | R.16.4 | Risky, low demand. Granular per-position-field push covers the realistic case. |
| §14 auto-JO-creator | §14 | Substantial feature; separate phase. |
| §15 forward-sync trigger + auto-publish | §15 | Substantial feature; separate phase. |
| O.5 override-mask warning | O.5 | Optional; nice-to-have after consumer rewire. |
| Add `propagation` enforcement in cascade engine | R.16.5 | Today the engine is propagation-blind. The trigger interprets propagation server-side. Future hardening could surface a warning when a consumer reads through the cascade for a snapshot-policy field on a non-draft JO without snapshot data. |

---

*End of R.16.1 handoff. Foundation cuts begin in this turn; subsequent phases will land as the slice progresses.*

---

## R.16.1.1 — National-Account fanout + previousValue filter (post-R.16.1 patch)

**Status:** shipped (post-R.16.1 staging smoke).
**Why this patch:** R.16.1 staging smoke on the CORT National Account surfaced "0 active job orders affected" in the Push-to-Active dialog whenever an admin edited a snapshot-policy field on the National. Root cause: `runPreviewPushToActive` queried `where('recruiterAccountId','==',accountId)`, which only returns JOs directly owned by the National. CORT is structured National → child accounts → JOs, so the National's own JO collection is empty.
**Predecessor:** R.16.1 (Push-to-Active machinery + UI).
**Successor:** R.16.2 — when the consumer rewire ships, multi-tier walks (National → MSP → Child → Location) get absorbed there.

### Locked decisions

#### L1.1.1. Walk one level of fanout (National + direct children)

`previewPushToActiveCallable` and `pushToActiveJobOrdersCallable` resolve `accountId → [accountId, ...childAccountIds]` from the Account doc and query `recruiterAccountId in <chunk>` for each 30-id chunk (Firestore's `in` cap). Single-tier accounts collapse to the legacy single-id path.

**Why one level:** R.16.1.1's job is to unblock CORT. CORT is a two-tier (National → child) topology. Multi-tier walks (National → MSP → child → location) require recursion + cycle-guards + per-tier audit; that machinery belongs in R.16.2 with the consumer rewire.

#### L1.1.2. `previousValue` filter — block silent overwrites of child overrides

When the dialog sends `previousValue` (the Account-level value before the user's edit), the server only marks `wouldChange=true` for JOs whose snapshot equals `previousValue`. JOs whose snapshot diverges (likely a child-level override or already-pushed) are flagged `previous_value_mismatch` — disabled in the dialog with the copy "Child override or already changed — push manually if intended."

**Why a snapshot-equality test rather than a per-field child-override check:** per-field override checks would require a snapshot envelope schema change (record the source of each value at activation: parent vs. child vs. JO-level). That's R.16.1.1.b material at the earliest, and the snapshot-equality test catches the same case for ~all real-world flows. The known false-positive — a child that coincidentally overrode to the same value as the old National — gets a JO-row in the dialog that the operator can deselect.

**Backwards compat:** legacy clients (and tests) that don't send `previousValue` get exact V1 semantics (`wouldChange = !valuesEqual(snapshot, newValue)`). The new field is opt-in on the wire.

#### L1.1.3. Defense-in-depth gate inside `writePushToActiveOne`

The transactional write also re-checks `valuesEqual(oldValue, previousValue)` before flipping the snapshot. Catches the narrow race where a sibling push lands between the page-level preview re-run and the transaction.

### Implementation surface

- `functions/src/jobOrders/pushToActive.ts`
  - **+ `resolveAccountFanoutIds(fdb, tenantId, accountId)`** — reads `tenants/{tid}/accounts/{aid}.childAccountIds`, returns deduped + sorted `[accountId, ...children]`.
  - **+ `chunkIds(ids, size = 30)`** — Firestore `in`-cap helper.
  - **`runPreviewPushToActive`** — now resolves fanout, fires parallel chunked queries, dedupes results, applies `previousValue` filter, exposes `totals.previousValueMismatch`.
  - **`writePushToActiveOne`** — accepts optional `previousValue` + `hasPreviousValue`; aborts the txn write with `previous_value_mismatch` if the in-transaction snapshot diverged.
  - **`runPushToActivePage`** — threads `previousValue` through to per-JO writes.
  - **`validatePushArgs`** — accepts optional `previousValue`; same shape gate as `newValue` when supplied.
  - **`previewPushToActiveCallable` / `pushToActiveJobOrdersCallable`** — forward `previousValue` from the request payload (only when present, so legacy callers retain V1 behavior).

- `src/components/recruiter/PushToActiveDialog.tsx`
  - **+ `previousValue?: unknown`** prop, forwarded to both callables (only when supplied — preserves wire shape for legacy callers).
  - **`useEffect` deps** updated to include `previousValue` (re-fetch preview if it changes mid-open, defensive).
  - **+ `'previous_value_mismatch'`** ineligibility row state with operator-friendly copy + new totals chip ("N child override / already changed").

- `src/components/recruiter/PushToActiveBanner.tsx`
  - Unpacks `previousValue` from the existing `PushToActiveBannerPayload` and forwards to the dialog. No change to caller surfaces — `AccountOrderDetailsForm` already populates it from `lastSavedScreeningRef.current` / `lastSavedAdditionalScreeningsRef.current`.

- `functions/src/__tests__/jobOrders/pushToActive.test.ts`
  - **+ 21 new tests** (5 `chunkIds`, 4 `resolveAccountFanoutIds`, 4 fanout preview, 4 `previousValue` filter, 3 write-side `previousValue` gate, 1 fanout + previousValue end-to-end).
  - Fake Firestore upgraded to support `where('field','in',[...])` and to return immutable query refs from `where()` (matching admin SDK semantics — caught a real mutability bug).

### Verification gate (all green)

| Gate | Result |
|------|--------|
| All 63 push-to-active tests pass (42 R.16.1 + 21 R.16.1.1) | ✓ |
| 296 functions Mocha (cascade + jobOrders + readiness) green | ✓ |
| `scripts/check-cascade-mirror.sh` clean | ✓ |
| `npx tsc --noEmit` clean on R.16.1.1 surface (functions + frontend) | ✓ |
| ReadLints clean on `pushToActive.ts`, `PushToActiveDialog.tsx`, `PushToActiveBanner.tsx`, `pushToActive.test.ts` | ✓ |

### Deploy runbook

1. **Functions** — only the two callables changed:

   ```bash
   firebase deploy --only \
     functions:previewPushToActiveCallable,functions:pushToActiveJobOrdersCallable
   ```

2. **Frontend** — banner/dialog forward `previousValue`; legacy server still works without it during the deploy window:

   ```bash
   npm run deploy:hosting
   ```

3. **CORT manual smoke** — pick up from where R.16.1 staging smoke stopped:
   - Open the CORT National Account → Order Details. Change `screeningPackageId`. Save.
   - Banner should appear. Click "Review affected job orders…".
   - Dialog should now show **non-zero** affected count, populated from child accounts.
   - Confirm any child-overridden JOs appear with the `previous_value_mismatch` row state (disabled checkbox, "Child override / already changed" copy).
   - Submit Push-to-Active. Confirm only the eligible JOs land + audit rows look correct.
   - Re-open dialog. Confirm idempotency (those JOs now show "Already matches").

4. **Greenlight R.16.2a** — once CORT smoke is green, kick off R.16.2a per `docs/CASCADE_R16.2a_HANDOFF.md`.

### Deferred to R.16.2

- Per-row "Source" attribution in the dialog (requires snapshot envelope schema change to record value source).
- Per-field child-override discrimination (today an "already-pushed" JO and a "child-overridden" JO look identical — both surface as `previous_value_mismatch`).
- Multi-tier cascade walks (National → MSP → child → location).
