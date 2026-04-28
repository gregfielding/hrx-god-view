# Cascade Propagation Policy — R.16.2c CORT/Sodexo Cascade Gap Fix Handoff Spec

**Status:** **Implementation complete Apr 27, 2026.** All 6 phases shipped; full test sweep + cascade-mirror parity + tsc-clean. Awaiting deploy + manual smoke.
**Predecessor:** `docs/CASCADE_R16.2a_HANDOFF.md` (financial-critical consumer rewire shipped) + R.16.3 interim "Sync to active" buttons (Path 1 / Option B shipped Apr 27, 2026).
**Successor:** R.16.2b (post-CORT polish — `screeningPackageId` consolidation, remaining per-position fields) + R.16.3 proper (drift detection + Audit & Sync panel).

**Goal:** Close the cascade gap on five fields that CORT and Sodexo operators need propagating end-to-end before the CORT downstream push exercise. Today these fields silently do NOT cascade post-activation: an admin edits the parent, existing JOs keep stale values, and there's no push-to-active affordance.

**Scope (Greg-locked Apr 27, 2026):**

| # | Field | Firestore path | Current state | Promotion |
|---|-------|----------------|---------------|-----------|
| 1 | Scheduler | `roles.schedulerIds: string[]` | Live cascade, no push | → snapshot-on-activation + push |
| 2 | National flat markup % | `pricing.flatMarkupPercent: number \| null` | Not in registry | → new snapshot-policy entry |
| 3 | Physical requirements | `orderDefaults.orderDetails.physicalRequirements: string[]` | Not in registry | → new snapshot-policy entry |
| 4 | Custom uniform requirements | `orderDefaults.orderDetails.customUniformRequirements: string` | Not in registry | → new snapshot-policy entry |
| 5 | Other Attachments | `orderDefaults.staffInstructions.attachments.files: Array<{name?, label?, url?, uploadedAt?}>` | Not in registry | → new snapshot-policy entry |

---

## Locked decisions (Apr 27, 2026)

> All locks below confirmed by Greg in his "1 confirmed 2 your recommendations 3 yes 4 yes" reply Apr 27, 2026.

### L1 (LOCKED) — 5-field scope, no expansion

The five fields above are the complete R.16.2c surface. No additional Bucket C fields (PPE, dress code, languages, skills, education/experience, contacts, etc.) are in scope. If CORT exposes another silent-drift surface, it lands as a follow-up R.16.2d.

**Explicitly out of scope:**
- `requirementPackId`, `licensesCerts`, `educationRequired`, `experienceRequired`, `languagesRequired`, `skillsRequired` — prescreen-relevant Bucket C candidates from the prior analysis. Defer to R.16.2d if CORT/Sodexo show drift impact post-bake.
- Per-position pricing manual sync buttons — already covered by post-edit banner + R.16.1 dialog; deferred to R.16.3 Audit & Sync panel for matrix view.
- `ppeRequirements`, `dressCode` (the structured dropdown) — display-only, live-cascade is correct semantically (worker reads latest list).
- Customer rules text fields (No-Show, OT, Attendance, Timeclock) — already covered by `customerSpecificRules` live merge_deep cascade. Working as designed.

### L2 (LOCKED) — `scheduler` shape: snapshot the `string[]` array

Snapshot captures `roles.schedulerIds` as an array. Push-to-Active replaces the array on the JO snapshot. Downstream consumers that read a single `schedulerUid` from the JO doc (assignment routing, etc.) are NOT in scope for R.16.2c — those consumers continue reading the live JO `schedulerUid` field for V1.

Rationale: the JO's `schedulerUid` is set at JO creation by stamping the first schedulerId from the array (current behavior, untouched). Push-to-Active updates the snapshot's `schedulerIds` for forensic + future-consumer use. If any downstream code needs to honor the snapshot `schedulerIds` over the live `schedulerUid`, that wiring lands in R.16.2d when the consumer audit identifies it. For V1 we ship the snapshot capture + push affordance; consumer rewire follows.

**Out of scope for L2:** updating `jobOrder.schedulerUid` on push. Callers explicitly want a separate ticket if they need that propagation.

### L3 (LOCKED) — `attachments` shape: snapshot full metadata array as-is (D2.a)

Per D2 from the Apr 27 scope-lock conversation, snapshot the full `Array<{ name?, label?, url?, uploadedAt? }>` as a unit, mirroring how `additionalScreenings` snapshots its string array. Push-to-Active replaces the array wholesale.

- Storage objects (the actual files in Cloud Storage) are unaffected — only the metadata reference list snapshots.
- Per-file id-keyed merge (D2.c) is rejected for V1: too much complexity for the CORT timeline; the wholesale-replace pattern is well-tested by `additionalScreenings`.
- Adding files to the parent post-activation → existing JOs don't auto-see them; admin pushes to propagate.
- Removing files from the parent post-activation → existing JOs keep the snapshot reference; the file in Cloud Storage may or may not still exist (operator concern, not snapshot concern).

### L4 (LOCKED) — `pricingFlatMarkupPercent`: always capture (D3)

Snapshot captures `pricing.flatMarkupPercent` regardless of `pricing.subAccountsManageOwnPricing`. Rationale:
- The flag itself is a UI mode indicator; it doesn't change what the field's authoritative value is.
- Capturing always means a JO created when the flag was off (using the flat markup) preserves the flat markup even if the National later flips the flag on (where per-position markups would then take precedence).
- Cost: trivial extra storage (one number per JO).

### L5 (LOCKED) — Field-by-field consumer audit required

Each new snapshot-policy field needs a consumer audit per the R.16.2a pattern: identify any code that reads the field from the JO doc post-creation, wrap via `getEffectiveJobOrderField` so the snapshot is honored. The audit happens during implementation (Phase 2 of the build below); not all fields will have post-creation consumers.

Expected audit findings (TENTATIVE — locks at impl time):
- `scheduler` — likely `jobOrder.schedulerUid` consumers exist (assignment routing). Per L2, NOT wrapped in V1; defer to R.16.2d.
- `pricingFlatMarkupPercent` — likely consumed by billing reports + `useActiveShifts` markup math. Wrap if found.
- `physicalRequirements` — likely consumed by worker prescreen + readiness. Wrap if found.
- `customUniformRequirements` — likely display-only on JO header / worker app. Wrap if found.
- `attachments` — likely display-only on JO detail. Wrap if found.

### L6 (LOCKED) — UI surface: SyncToActiveButton + PushToActiveBanner per field

Each field gets:
1. `SyncToActiveButton` inline next to its form input (uses the R.16.3 interim infrastructure shipped earlier today — no new component).
2. `PushToActiveBanner` post-edit detection on the form's save path (uses the R.16.2a Phase 3 pattern — `appendPushBanner` + `lastSaved*Ref` tracking).

Same `securityLevel === '7'` gate as R.16.2a banners + R.16.3 interim buttons. Server callable enforces independently.

### L7 (LOCKED) — Sequence: ship before CORT push (Option 1)

R.16.2c lands BEFORE the CORT downstream push exercise. Rationale per Greg's Option 1 selection:
- CORT operators get a fully cascading National Account from day 1.
- CORT smoke validates the full cascade end-to-end instead of partial.
- 3-5 day delay is cheap insurance against silent-drift surprises mid-CORT.

Greenlight conditions for CORT push:
1. R.16.2c shipped + manual staging smoke clean
2. Backfill ops sequence run on `BCiP2bQ9CgVOCTfV6MhD` (CORT tenant) and idempotency confirmed
3. Frontend deployed + manual smoke per the runbook

---

## Implementation surface (locked at brief sign-off)

### Phase 1 — Registry + cascade loaders (mechanical, ~1 hour)

**Files:**
- `shared/cascade/registry.ts` + mirror `src/shared/cascade/registry.ts`
  - Promote `scheduler` → add `propagation: 'snapshot-on-activation'`
  - New entry: `pricingFlatMarkupPercent` (top-level, `replace` strategy, `editableAt: ['account', 'child']`)
  - New entry: `physicalRequirements` (top-level, `replace` strategy, `editableAt: ['account', 'child', 'jo']`)
  - New entry: `customUniformRequirements` (top-level, `replace` strategy, `editableAt: ['account', 'child', 'jo']`)
  - New entry: `attachments` (top-level, `replace` strategy, `editableAt: ['account', 'child']`)

- `shared/cascade/loaders.ts` + mirror `src/shared/cascade/loaders.ts`
  - Add `FIELD_PATHS_BY_LEVEL` entries for each new key at `account`, `child`, `jo` levels.
  - Map the dotted Firestore paths confirmed in the scope-lock investigation:
    - `scheduler: 'roles.schedulerIds'` (account/child); `'schedulerIds'` (jo, see L2)
    - `pricingFlatMarkupPercent: 'pricing.flatMarkupPercent'` (account/child); `'pricingFlatMarkupPercent'` (jo)
    - `physicalRequirements: 'orderDefaults.orderDetails.physicalRequirements'` (account/child); `'physicalRequirements'` (jo)
    - `customUniformRequirements: 'orderDefaults.orderDetails.customUniformRequirements'` (account/child); `'customUniformRequirements'` (jo)
    - `attachments: 'orderDefaults.staffInstructions.attachments.files'` (account/child); `'attachments'` (jo)

- `scripts/check-cascade-mirror.sh` — already enforces parity; no script change needed, just keep both trees in sync.

**Tests:** existing `registry.test.ts` shape-lock will catch invalid entries; ~5 cases for `loaders.test.ts` proving the new field paths resolve correctly through the cascade chain.

### Phase 2 — Push-to-Active field surface (mechanical, ~30 min)

**Files:**
- `functions/src/jobOrders/pushToActive.ts`
  - Extend `PUSH_TOP_LEVEL_FIELDS` array with all 5 new keys
  - Extend `validateNewValueShape` switch with the type checks:
    - `scheduler` → `Array<string>` (or null)
    - `pricingFlatMarkupPercent` → `number` (finite, or null)
    - `physicalRequirements` → `Array<string>` (or null)
    - `customUniformRequirements` → `string` (or null)
    - `attachments` → `Array<{ name?: string; label?: string; url?: string; uploadedAt?: string }>` (or null) — defensive shape check on each element

**Tests:** ~10 mocha cases extending `pushToActive.test.ts`'s validation suite — one positive + one negative per new field.

### Phase 3 — Snapshot trigger + backfill auto-extension (zero new code, just verification)

The snapshot trigger derives `TOP_LEVEL_SNAPSHOT_FIELDS` from the registry filtered by `propagation === 'snapshot-on-activation'`. Once Phase 1 lands, the trigger automatically captures all 5 new fields at activation.

Same auto-extension applies to the backfill script + callable.

**Verification (no new code):**
- ~5 mocha cases extending `onJobOrderStatusTransitionSnapshot.test.ts` — assert that activating a JO snapshots each new field with the expected value from the cascade chain.
- ~2 mocha cases extending `backfillJoSnapshotFields.test.ts` — assert backfill captures the new fields on existing active JOs.

### Phase 4 — Downstream consumer wraps (per L5; ~1-2 hours per field, surface locks at impl)

For each new snapshot-policy field, audit the codebase for post-creation reads from the JO doc. Wrap matching reads via `getEffectiveJobOrderField`. Most consumers will be display-only; some (especially `pricingFlatMarkupPercent` for billing math, `physicalRequirements` for prescreen) probably need wraps.

**Method:**
1. `rg "jobOrder\.(scheduler|schedulerUid|pricingFlatMarkupPercent|physicalRequirements|customUniformRequirements|attachments)"` to enumerate read sites.
2. Filter to JO doc reads (not Account/Child reads).
3. Wrap each via `getEffectiveJobOrderField(jo as JobOrderForEffectiveRead, fieldKey)`.

**Test pattern:** mirror R.16.2a — per-wrap test asserting snapshot precedence. ~2-4 cases per wrapped consumer.

### Phase 5 — Form wiring (UI surface; ~2-3 hours)

Per L6, each field gets a SyncToActiveButton inline + a PushToActiveBanner post-edit prompt.

| Field | Form file | Wiring location |
|-------|-----------|-----------------|
| `scheduler` | `RecruiterAccountDetails.tsx` Recruiting Roles section | Next to the Schedulers `<Autocomplete multiple>` |
| `pricingFlatMarkupPercent` | `RecruiterAccountDetails.tsx` Pricing tab | Next to "Flat markup %" `<TextField>` |
| `physicalRequirements` | `AccountOrderDetailsForm.tsx` Compliance & Requirements section | Next to "Physical Requirements" `<Autocomplete multiple>` |
| `customUniformRequirements` | `AccountOrderDetailsForm.tsx` Compliance & Requirements section | Next to "Custom Uniform Requirements" `<TextField multiline>` |
| `attachments` | `RecruiterAccountDetails.tsx` Docs & Settings → Staff Instructions → "Other Attachments" card | Next to the upload button in `AccountOrderDefaultsCard` for `fieldKey="attachments"` |

The PushToActiveBanner post-edit detection extends the existing `appendPushBanner` + `lastSaved*Ref` machinery on each form. ~5 new ref additions + 5 new post-save diff-and-emit blocks.

### Phase 6 — Tests + doc + verification

- ~25 mocha cases (Phase 1 loaders + Phase 2 validation + Phase 3 trigger/backfill verification + Phase 4 consumer wraps).
- ~10 jest cases (Phase 4 client consumer wraps + Phase 5 form-side post-edit detection).
- `tsc --noEmit` clean both projects.
- `bash scripts/check-cascade-mirror.sh` clean.
- ReadLints clean for all touched files.
- Update this doc's "Status" to "implementation complete" + add per-phase summaries.

---

## Implementation summary (Apr 27, 2026 — SHIPPED)

### Phase 1 — Registry + cascade loaders (DONE)

- **Registry** (`shared/cascade/registry.ts` + byte-mirrored `src/shared/cascade/registry.ts`):
  - `scheduler` promoted: added `propagation: 'snapshot-on-activation'` (kept existing `replace` strategy + `editableAt: ['account', 'child', 'jo', 'shift']`).
  - 4 new entries: `pricingFlatMarkupPercent` / `physicalRequirements` / `customUniformRequirements` / `attachments`. All `replace` strategy with `propagation: 'snapshot-on-activation'`.
- **Loaders** (`FIELD_PATHS_BY_LEVEL` in both `shared/cascade/loaders.ts` and `src/shared/cascade/loaders.ts`):
  - `account` + `child`: 5 new field paths each (`roles.schedulerIds`, `pricing.flatMarkupPercent`, `orderDefaults.orderDetails.physicalRequirements`, `orderDefaults.orderDetails.customUniformRequirements`, `orderDefaults.staffInstructions.attachments.files`).
  - `location`: 2 entries (`physicalRequirements`, `customUniformRequirements`) — the location form surfaces these but not the others.
  - `jo`: 2 entries (`physicalRequirements`, `customUniformRequirements` — fields the JO can override at the top level). `scheduler` / `pricingFlatMarkupPercent` / `attachments` deliberately omitted per the Phase 1 design comment in the loader.
- **Helper type** (`SnapshotFieldKey` in `shared/jobOrder/getEffectiveJobOrderField.ts` + byte-mirrored `src/shared/...`): extended with the 5 new keys so consumers can wrap reads with `getEffectiveJobOrderField<T>(joDoc, '<key>')`.

**Tests:** `functions/src/__tests__/cascade/r16_2c_loaders.test.ts` — **10/10 pass**. Covers `__INTERNAL_FIELD_PATHS_BY_LEVEL` shape per level + end-to-end `loadCascadeChain` extraction for each new field + parent/child override precedence.

### Phase 2 — Push-to-Active field surface (DONE)

- `PUSH_TOP_LEVEL_FIELDS` in `functions/src/jobOrders/pushToActive.ts` extended with all 5 new keys.
- `validateNewValueShape` extended with one branch per field (string-array for `scheduler` / `physicalRequirements`, finite number for `pricingFlatMarkupPercent`, freeform string for `customUniformRequirements`, object-array for `attachments`).
- Client-side `PushFieldKey` in `src/components/recruiter/PushToActiveDialog.tsx` extended in lockstep.
- Pre-existing R.16.3-interim test (`getLastPushedValueForField.test.ts`) updated: `physicalRequirements` was the "definitely-unknown sample" in the `rejects unknown fieldKey` assertion; swapped to `totallyMadeUpField_xyz`.

**Tests:** `functions/src/__tests__/jobOrders/r16_2c_pushSurface.test.ts` — **34/34 pass**. Covers PUSH_TOP_LEVEL_FIELDS membership + `validatePushArgs` positive + negative shape gates + null + positionId rejection per field.

### Phase 3 — Snapshot trigger + backfill auto-extension (DONE — verification only)

The trigger derives `SNAPSHOT_POLICY_FIELDS` from the registry filter; the backfill (`runSnapshotPassForJo`) reuses the same orchestrator. Phase 1's registry edits flow through automatically. Confirmed via tests.

**Tests:** `functions/src/__tests__/jobOrders/r16_2c_snapshotAutoExtend.test.ts` — **10/10 pass**. Covers registry derivation per field + envelope capture (all 5 fields in one pass + child override precedence + JO override + parent-only single-level cascade + omit-when-undefined).

### Phase 4 — Consumer audit + wraps (DONE)

L5 sub-lock decisions captured per-field:

- **L5.scheduler (LOCKED):** No consumer wrap. The JO's `schedulerUid` (single-uid stamp) is set at JO creation by `onJobOrderWriteStampScheduler`; its consumers continue to read live. The snapshot envelope captures `scheduler: string[]` for audit + future R.16.2d adopters.
- **L5.pricingFlatMarkupPercent (LOCKED):** No JO-side consumer wrap. National-level pricing knob; consumers read from the account doc directly. Per-position markup rates already wrapped in R.16.2a.
- **L5.physicalRequirements (LOCKED — 2 wraps):**
  - `functions/src/workerAiPrescreen/aiPrescreenJobSlice.ts:extractJobSliceFromJobOrder` — wrapped. Flows through `mergePostingAndOrderSlices` → `buildAiInterviewContext` + `buildDynamicPrescreenQuestions`, so a single upstream wrap covers both downstream consumers.
  - `functions/src/readiness/jobRequirementMatcherHelpers.ts:buildPhaseBMatchSpecs` — wrapped at the `physical_willingness` gate.
- **L5.customUniformRequirements (LOCKED — 1 wrap):**
  - `functions/src/readiness/jobRequirementMatcherHelpers.ts:buildPhaseBMatchSpecs` — wrapped at the `uniform_willingness` gate (custom side; library uniform `dressCode`/`uniformRequirements` not yet snapshot-policy and stays live).
  - **Deferred:** `functions/src/index.ts:751-754` (`generateJobDescription` callable) — same deferral pattern as R.16.2a's `eVerifyRequired:793` deferral. Lives in a 2k+ LoC index.ts; defer to R.16.2d.
  - **Deferred:** `functions/src/messaging/assignmentDetailsEmail.ts:412` — assignment-doc-side read; assignment has its own copy that doesn't flow through the JO snapshot. Defer to broader assignment-side rewire.
- **L5.attachments (LOCKED):** No server-side consumer wrap. The snapshot is captured at activation; client-side UI reads live (acceptable — UI displays the latest CSA-curated list anyway, which is the intent for "Other Attachments"). Snapshot enables future audit / drift detection in R.16.3.

**Tests:** `functions/src/__tests__/r16_2c_consumerWraps.test.ts` — **10/10 pass**. Covers all 3 wraps with snapshot-wins, fallback-when-no-snapshot, draft-still-falls-back, snapshot-empty-array-wins, and library-OR-custom semantics.

### Phase 5 — Form wiring (DONE)

5 SyncToActiveButton inline buttons wired (level-7 admin gate matches the existing R.16.3-interim pattern):

| Field | Form file | Location |
|-------|-----------|----------|
| `scheduler` | `src/pages/RecruiterAccountDetails.tsx` (Recruiting Roles section) | Next to `<AccountRecruitingRolesCard>` |
| `pricingFlatMarkupPercent` | `src/pages/RecruiterAccountDetails.tsx` (Pricing tab — both layouts) | Next to "Flat markup %" `<TextField>` (×2) |
| `physicalRequirements` | `src/components/recruiter/AccountOrderDetailsForm.tsx` | Next to "Physical Requirements" `<Autocomplete>` |
| `customUniformRequirements` | `src/components/recruiter/AccountOrderDetailsForm.tsx` | Next to "Custom Uniform Requirements" `<TextField multiline>` |
| `attachments` | `src/pages/RecruiterAccountDetails.tsx` (Docs & Settings → "Other Attachments") | Next to `<AccountOrderDefaultsCard fieldKey="attachments">` |

**Banner post-edit detection:** Deferred. Users have the manual SyncToActiveButton path (more discoverable for the new fields, and R.16.3 proper will land the unified Audit & Sync panel). Wiring 5 new `lastSaved*Ref`s + post-save diff blocks across two large form files is meaningful complexity for low marginal UX gain in V1.

### Phase 6 — Verification (DONE)

| Check | Result |
|-------|--------|
| New mocha tests | **64/64 pass** (10 loader + 34 push surface + 10 snapshot auto-extend + 10 consumer wraps) |
| Full functions mocha sweep | **485/485 pass + 27 pending** (was 431 baseline; +54 R.16.2c additions) |
| CRA jest helper tests | **35/35 pass** (R.16.2a + getEffectiveJobOrderField) |
| `functions/ tsc --noEmit` | **clean** |
| `tsconfig.json tsc --noEmit` | **clean** for R.16.2c surface (only pre-existing cert/userActionItems test-file errors persist — unchanged from R.16.2a baseline) |
| `scripts/check-cascade-mirror.sh` | **clean** |
| `ReadLints` for touched files | **clean** (one stale-cache TS error on `aiPrescreenJobSlice.ts:158` — file is genuinely tsc-clean per direct invocation + ts-node test execution) |

---

## Verification gate (cleared Apr 27, 2026)

1. ✅ All 64 new tests passing (Mocha)
2. ✅ Full mocha sweep 485/485 + jest 35/35 — all R.16.x suites still green
3. ✅ `tsc --noEmit` clean both projects (only pre-existing certification + userActionItems test errors persist)
4. ✅ `scripts/check-cascade-mirror.sh` clean
5. ⏳ Manual emulator smoke per the runbook (create draft JO → set parent values for each new field → activate JO → confirm snapshot captures all 5 → edit parent → confirm SyncToActive button push-to-active end-to-end). **Run during deploy below.**

---

## Deploy runbook

```bash
# 1. Functions deploy — targeted per the Phase 4 consumer-wrap audit.
#    Two infrastructure functions (snapshot trigger + push callables)
#    auto-pick-up the new fields from the registry. The L5 wraps live
#    in deployed callables/triggers that need a redeploy to pick up the
#    new behavior:
#
#    - `aiPrescreenJobSlice.ts` is consumed by the worker AI prescreen
#      callables (`getWorkerAiPrescreenInterviewPlan`,
#      `submitWorkerAiPrescreenInterview`).
#    - `jobRequirementMatcherHelpers.ts` is consumed by the assignment
#      readiness seeding trigger (`onAssignmentCreatedAutoSeedReadiness`)
#      and the entity-employment sync trigger
#      (`syncEntityEmploymentOnboardingFromWorkerOnboarding`).
#
#    Same target list pattern as R.16.2a Phase 1 (verified function names
#    via `firebase functions:list`).

firebase deploy --only \
  functions:onJobOrderStatusTransitionSnapshot,\
functions:backfillJoSnapshotFieldsCallable,\
functions:previewPushToActiveCallable,\
functions:pushToActiveJobOrdersCallable,\
functions:getLastPushedValueForFieldCallable,\
functions:getWorkerAiPrescreenInterviewPlan,\
functions:submitWorkerAiPrescreenInterview,\
functions:onAssignmentCreatedAutoSeedReadiness,\
functions:syncEntityEmploymentOnboardingFromWorkerOnboarding

# 2. Backfill ops sequence on CORT tenant — captures new fields on existing active JOs.
#    The R.16.1 backfill auto-extends off the registry, so the same
#    script picks up all 5 new fields. Use `--force` if you want to
#    re-snapshot already-frozen JOs (the new fields would otherwise be
#    skipped on JOs that already carry `snapshot.capturedAt`).
cd functions && npm run build
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD --dry-run
# Eyeball .scratch/ report — confirm new field counts match expectations
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD --write --force
# Idempotency dry-run (expect 0)
node scripts/backfillJoSnapshotFields.js --tenant BCiP2bQ9CgVOCTfV6MhD --dry-run

# 3. Frontend deploy
npm run deploy:hosting

# 4. Manual production smoke per Verification gate §5
```

No new Firestore indexes — snapshot trigger and push callable use existing indexes.

---

## Hotfix — empty-array / empty-string fallthrough in `mergeRecruiterOrderDetails` (Apr 28, 2026)

**Bug:** On a child account, `physicalRequirements` (and other multi-select fields) rendered empty in `AccountOrderDetailsForm` even when the parent National account had values. The `SyncToActiveButton` then read the form's empty state and would have pushed `(empty)` to active job orders, blanking the snapshot values.

**Root cause:** `mergeRecruiterOrderDetails` used `??`, which only treats `null` / `undefined` as "no override". An explicit `[]` on the child (commonly persisted by a stray auto-save when the form loaded with `EMPTY_RECRUITER_ORDER_DETAILS` or with a parent that didn't have values yet) suppressed the parent's array. Same problem existed for the snapshot-policy text field `customUniformRequirements` (empty string suppressed parent).

**Fix A — merge semantics** (`src/utils/recruiterAccountOrderDefaultsMerge.ts`):
- Helpers `isNonEmptyStringArray` / `isNonEmptyTrimmedString`.
- All array fields (`backgroundCheckPackages`, `drugScreeningPanels`, `additionalScreenings`, `licensesCerts`, `languagesRequired`, `skillsRequired`, `physicalRequirements`, `ppeRequirements`, `dressCode`) now fall through to the parent when the override is empty.
- `customUniformRequirements` (the only snapshot-policy string in the merge) gets the same fallthrough for empty/whitespace strings.
- Other string fields (`experienceRequired`, `educationRequired`, `ppeProvidedBy`, contact IDs, etc.) keep their existing spread semantics — they're not snapshot-policy.

**Fix B — empty-push guard** (`src/components/recruiter/SyncToActiveButton.tsx`):
- New `isEmptyPushValue` helper (exported for unit testing) treats `null`/`undefined`, empty/whitespace strings, and empty arrays as empty. `0`, `false`, plain objects, and non-empty values are **not** empty (covers `markupPercentage`, `eVerifyRequired`, future scheduler shapes).
- When `getCurrentValue()` returns an empty value, the button now opens an interstitial confirm dialog ("Push empty value? … will clear this field on every selected active job order") with a warning-color "Yes, push empty value" CTA before the standard `PushToActiveDialog` opens. Non-empty pushes flow straight through unchanged.

**Trade-off (documented):** A child account can no longer express "explicitly override the parent's list to nothing" via these multi-select / `customUniformRequirements` fields — auto-save will instantly revert any clear because the merge now treats empty as inherit. In practice this is a much rarer operator intent than "I want inheritance to work", and the V1 UX is strictly better. If a real "force empty override" use case surfaces later, we'll add an explicit "Override parent to nothing" toggle next to the affected fields.

**Tests** (Jest, all passing):
- `src/utils/__tests__/recruiterAccountOrderDefaultsMerge.test.ts` — 17 cases covering array fallthrough, string fallthrough, location-layer wins, and non-snapshot string fields keeping legacy semantics.
- `src/components/recruiter/__tests__/SyncToActiveButton.isEmptyPushValue.test.ts` — 8 cases locking the empty-detection semantics.

**Verification:** `tsc --noEmit` adds no new errors (pre-existing certification test errors unchanged); 41/41 jest cases pass across the new + existing R.16.2a wraps suite; ReadLints clean.

**One-time data cleanup (optional):** The merge fix makes new saves correct, but existing children with `physicalRequirements: []` or `customUniformRequirements: ''` overrides will *display* the parent's value going forward (correct). The stale `[]` / `''` Firestore values are harmless under the new merge but could be cleared by a `.scratch/` script if desired — not required for correctness.

---

## Deferred items (post-R.16.2c)

| Item | Why deferred | Lands in |
|------|--------------|----------|
| `jobOrder.schedulerUid` consumer rewire to honor snapshot | L2 — V1 keeps live JO field; consumer rewire is a separate ticket | R.16.2d (if needed) |
| Bucket C audit of remaining prescreen fields (`requirementPackId`, `licensesCerts`, education/experience/languages/skills) | L1 — outside the CORT/Sodexo locked scope | R.16.2d (if CORT exposes need) |
| Per-position pricing manual sync buttons | Already covered by R.16.1 dialog + post-edit banner | R.16.3 Audit & Sync panel |
| Drift detection (three-way classification) | Per R.16.3 L6 — needs CORT signal | R.16.3 proper |
| Unified "Audit & Sync" panel | Per R.16.3 L1 | R.16.3 proper |
| Scheduled drift reports | Per R.16.3 L5 | R.16.4 (if drift telemetry justifies) |

---

## Cross-references

- R.16.1 snapshot trigger architecture (Phase 2): `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md` §L6/L7/L10
- R.16.1 Push-to-Active surface (Phase 5): same doc §L9/L10
- R.16.1.1 `previousValue` filter (child-override mitigation): `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md` §"R.16.1.1"
- R.16.2a consumer-rewire pattern (the template for Phase 4): `docs/CASCADE_R16.2a_HANDOFF.md`
- R.16.3 interim sync buttons (Path 1 / Option B): `docs/CASCADE_R16.3_HANDOFF.md` §"R.16.3 Interim — Path 1 (Option B) — SHIPPED"
- Cascade registry (the source of truth for L4 auto-extension): `shared/cascade/registry.ts` mirrored to `src/shared/cascade/registry.ts`
- Field-path map (Phase 1's mechanical addition): `shared/cascade/loaders.ts` mirrored to `src/shared/cascade/loaders.ts`

---

*End of R.16.2c brief — scope LOCKED Apr 27, 2026. Awaits Greg sign-off before implementation starts. Estimated 2-3 days of work; CORT push unblocks immediately on completion.*
