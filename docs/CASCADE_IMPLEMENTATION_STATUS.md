# Cascade Implementation Status Audit

**Audit date:** 2026-04-27
**Audit scope:** `cursor-cascading-order-data-spec.md` (base) + §14 Downstream Consumers + §15 Job Board Posting Cascade + §16 Propagation Policy.
**Audit method:** code grep + manual file inspection. Every "complete" claim points at a file path + line range.
**Spec doc availability:** the spec text itself is not checked in (lives in chat history; branch `feature/cascading-order-data` carried the original work). Audit is therefore against the kickoff brief in `docs/CASCADE_IMPLEMENTATION_STATUS.md` request, cross-referenced against in-tree comments that quote the handoff (e.g. `src/shared/cascade/registry.ts` § comments cite "handoff §3", "handoff §13.1", "handoff §15.3", "handoff §15.7").

---

## TL;DR

| Phase | Spec section | Status | One-line verdict |
|-------|--------------|--------|-------------------|
| O.1   | Registry     | **complete** | 14 fields + 8 sub-fields locked; shape-lock test guards invariants. |
| O.2   | Engine       | **complete** | Pure resolver, all 5 strategies implemented, provenance returned. |
| O.3   | Loaders      | **partial**  | CRA-side loader shipped; admin-SDK twin (`functions/`) deferred. |
| O.4   | UI           | **partial**  | Strip + hook exist as library; **zero production call sites**. |
| O.5   | Override-mask warning | **unstarted** | No engine signal, no UI affordance. |
| §14   | Downstream consumers | **partial** | Registry slots locked; consumers (auto-JO-creator, click-to-create-shift, completeness gate) all unbuilt. |
| §15   | Posting cascade | **partial — registry only** | `postingVisibility` / `postingPolicy` are in registry; forward-sync trigger, AI-gen callable, auto-publish hook, naming reconciliation all unbuilt. |
| §16   | Propagation policy | **unstarted** | No `propagation` field on registry, no draft→open snapshot trigger, no Push-to-Active, no override badge, no migration script. |
| —     | Cross-cutting parallel impls | **partial** | `recruiterAccountOrderDefaultsMerge.ts` + R.10 layer-merger still own the read path; cascade engine has no production consumer. |

### CORT-push gating call: **NO-GO as defined**

The kickoff brief sets three gates for CORT push:

1. ✅ **O.1–O.5 complete** — failed (O.3 has no admin twin, O.4 has no consumers, O.5 is unstarted).
2. ❌ **§16 propagation policy + draft→open snapshot trigger complete** — failed (none of §16 has shipped).
3. ❌ **Push-to-Active at least partial** — failed (unstarted).

Even on a softer read: editing a CORT National Account today writes through `src/utils/recruiterAccountOrderDefaultsMerge.ts` (the legacy one-shot merger), which is **propagation-naive**. There is nothing in the codebase that prevents an Account-level edit from re-resolving live for active JOs the next time they're read. That is exactly the failure mode §16 was designed to prevent — and §16 is empty. Greenlight for CORT requires either (a) §16 minimum slice (live/snapshot enum + draft→open trigger + Push-to-Active) shipped first, or (b) explicit acceptance of the live-propagation behaviour for the CORT exercise window. Recommend (a).

---

## A. Base spec (O.1–O.5) cascade engine

### O.1 — Registry — **complete**

**Where:** `src/shared/cascade/registry.ts` (266 lines), mirrored byte-for-byte at `shared/cascade/registry.ts` (mirror confirmed clean via `diff -q`).

**Locked fields** (`src/shared/cascade/registry.ts:35-258`):

| Key | Strategy | Editable at | Notes |
|-----|----------|-------------|-------|
| `scheduler` | replace | account, child, jo, shift | |
| `hiringEntityId` | replace | account, child | |
| `eVerifyRequired` | replace | account, child | |
| `screeningPackageId` | replace | account, child, jo | Canonical name; alias `backgroundCheckPackageId` flagged for rename in O.4 (handoff §13.1). |
| `additionalScreenings` | union_with_remove | account, child, jo | `string_exact` identity. |
| `billingContact` | replace | account, child | |
| `invoiceAddress` | replace | account, child | |
| `uniformRequirements` | union_with_remove | account, child, jo, shift | `slug` identity ("Cowboy Boots" ≡ "cowboy_boots"). |
| `staffInstructions` | merge_deep | account, child, jo, shift | |
| `customerSpecificRules` | merge_deep | account, child, jo | |
| `postingVisibility` | merge_deep | account, child, jo | Has `defaults` block (registry `:118-143`). §15.3. |
| `postingPolicy` | merge_deep | account, child, jo | No defaults; §15.3 is opt-in per tenant. |
| `positions` | keyed_list | account, child | `identityKey: 'positionId'`; sub-fields below. |
| `selectedPositionIds` | level_only | jo | §14. |
| `shiftTemplate` | level_only | jo | Shape: `ShiftTemplate` interface in `types.ts:267-282`. §14.2. |

**`positions.itemFields`** sub-cascade (`registry.ts:176-233`): `jobTitle`, `jobDescription`, `rateMode`, `markupPercentage` editable at account+child; `payRate`, `billRate`, `futa`, `suta`, `workersCompRate` locked to `child` only with `requiredForCompleteness: true`. The completeness flag is registry-side only — see §14 for unwired consumer.

**Shape-lock test:** `src/shared/cascade/__tests__/registry.test.ts:1-268` — 27 `it()` cases across:
- known-strategy, non-empty-label, ≥1 editable level (per-entry `describe.each`)
- `keyed_list` declares `identityKey` + `itemFields`
- `union_with_remove` declares `itemIdentity`
- `level_only` has exactly one editable level
- `itemFields` recursively pass the same checks
- canonical-name guard (`screeningPackageId` present, `backgroundCheckPackageId` absent — `:170-171`)
- `requiredForCompleteness` only on `keyed_list` leaf fields (`:194-220`)

**Deviations from spec:** none material. Two minor notes:
1. **Spec text uses dotted `posting.visibility`; registry stores it flat as `postingVisibility`** — explicitly noted in registry comment `:113-117` as decision 2026-04-26 Q2. Forward-syncs and consumers must remap.
2. **No `propagation` field on any registry entry.** This is a §16 surface; flagged as unstarted there. The shape-lock test does not yet enforce its presence (will need to be added when §16 lands).

**Known gap:** `defaults` block is currently registered only for `postingVisibility`. Spec implies it could apply to other `merge_deep` fields (`staffInstructions`, `customerSpecificRules`), but those land empty by design today.

---

### O.2 — Engine — **complete**

**Where:** `src/shared/cascade/resolveCascadedField.ts` (594 lines), mirrored at `shared/cascade/resolveCascadedField.ts` (byte-identical).

**Public API** (`resolveCascadedField.ts:57-69`):

```57:69:src/shared/cascade/resolveCascadedField.ts
export function resolveCascadedField<K extends CascadingFieldKey>(
  field: K,
  chain: ReadonlyArray<AncestorLevel>,
  options: ResolveOptions = {},
): ResolvedCascadeValue {
  const spec = CASCADE_REGISTRY[field] as CascadeFieldSpec;
  if (!spec) {
    throw new Error(`[cascade] unknown field "${String(field)}"`);
  }
  return dispatch(field as string, spec, chain, options);
}
```

**Strategy implementations** (each handles `editableAt` guard via `dispatch:95-97`):

| Strategy | Function | Notes |
|----------|----------|-------|
| `replace` | `resolveReplace` (`:133-152`) | First contributor `set_initial`, every later contributor `overrode`. Explicit `null` *is* a value. |
| `union_with_remove` | `resolveUnionWithRemove` (`:181-` ; identity helpers `:300+`) | Supports `{ added, removed }` + bare-array shorthand. `slug` normaliser collapses whitespace + strips non-alphanumerics. |
| `merge_deep` | `resolveMergeDeep` | Per-key cascade, child keys win, descendants can clear via `null`. |
| `keyed_list` | `resolveKeyedList` | Recursive — calls `resolveCascadedFieldWithSpec` per item field using `itemFields`. |
| `level_only` | `resolveLevelOnly` | Returns the closest editable level's value as-is. |

**Engine I/O contract** (`types.ts:151-181`):
- Input: `AncestorLevel[]` with `levelType`, `levelId`, optional `levelLabel`, and `deltas` (raw per-level deltas — never the merged result).
- Output: `ResolvedCascadeValue<T>` = `{ value: T, provenance: ProvenanceEntry[] }`. Provenance is part of the contract — engine *always* returns it.

**Test coverage** (`src/shared/cascade/__tests__/resolveCascadedField.test.ts:1-495`): 31 `it()` cases. Worked-example coverage per strategy + cross-cutting concerns (`editableAt` guard, child/location collapsing, "Reset to inherited" via deletion). Engine is unit-testable in isolation — no Firestore mocks.

**Cross-hierarchy handling:** confirmed via `EditableLevel`-vs-`LevelType` distinction (`types.ts:30-40`). Both `child` and `location` collapse to the `'child'` editable tier, so the engine handles both hierarchies (National→Child→JO→Shift and Standalone→Location→JO→Shift) through a single chain composition. The engine itself never branches on hierarchy shape; the loader supplies the right chain.

**Deviations from spec:** none. The engine is the cleanest piece of the audit — pure, no async, no Firestore, exhaustively switch-cased on strategy with a `never` typecheck for unhandled cases (`:114`).

---

### O.3 — Loaders — **partial**

**Where:** `src/shared/cascade/loaders.ts` (370 lines).

**What's shipped:**
- `loadCascadeChain(ctx, target)` (`:160-229`) — composes the ancestor chain for a JO (or JO + shift). Handles all three documented shapes:
  - National hierarchy: `[parent_account, child_account, jo, shift?]`
  - Standalone hierarchy: `[standalone_account, location?, jo, shift?]`
  - Orphaned national edge case: `[account, jo, shift?]`
- Per-request memoization via `LoaderContext` (`:113-128`) — dedupes `getDoc` calls when one render fans out multiple cascade lookups.
- `extractDeltas` (`:313-328`) — applies `FIELD_PATHS_BY_LEVEL` (`:40-99`) to walk dotted paths into raw docs and produce the flat `deltas` blob the engine expects. This is the only place that knows about `orderDefaults.*` nesting on accounts vs. flat fields on JOs.
- Account-type inference (`:354-366`) mirrors `recruiterAccountOrderDefaultsMerge.ts:inferParentId` — same heuristic, different return shape.

**Test coverage** (`src/shared/cascade/__tests__/loaders.test.ts`): 16 `it()` cases. Mocks `firebase/firestore` to assert chain shape, level-type tagging, deltas extraction, and per-request cache reuse.

**Gaps:**

1. **No admin-SDK twin.** The file's own header (`:11-15`) calls this out:
   > "The cloud-functions side (forward-sync trigger P.2) needs an admin-SDK twin — kept out-of-scope for O.3 because the only consumer right now is the recruiter UI."

   Concrete impact: any cloud function that wants to resolve cascaded values server-side has no library — they'd have to hand-roll the chain walk. This blocks §15 forward-sync, §16 snapshot trigger, and the auto-JO-creator. **Required before §15/§16 server work.**

2. **Field-path map is an Instructions-tab subset.** `FIELD_PATHS_BY_LEVEL` (`:40-99`) only maps the fields the Instructions tab needs:
   - `account` / `child`: 8 fields (`staffInstructions`, `additionalScreenings`, `screeningPackageId`, `eVerifyRequired`, `uniformRequirements`, `customerSpecificRules`, `postingVisibility`, `postingPolicy`)
   - `location`: 5 fields (no posting/eVerify)
   - `jo`: 8 fields (drops eVerify; adds `selectedPositionIds`, `shiftTemplate`)
   - `shift`: 2 fields (`staffInstructions`, `uniformRequirements`)

   Missing from every level: `scheduler`, `hiringEntityId`, `billingContact`, `invoiceAddress`, `positions`. So `resolveCascadedField('positions', chain)` against a real loader chain would return empty even when positions data exists at the account doc — the loader wouldn't extract it. **Adding any of these to the loader is one entry per level + a path string.** Documented in the file header (`:36-38`).

**Deviations from spec:** the spec implied a single loader function per hierarchy; the implementation collapses both hierarchies into `loadCascadeChain` and does shape inference internally. Cleaner; no semantic difference. The spec also implied loaders would be parameterised over which fields to fetch; in practice all fields are extracted on every call (pure-CPU, the data was already on the doc), and the engine ignores fields it doesn't care about. Fine.

---

### O.4 — UI — **partial**

**Where:**
- `src/components/cascade/CascadeProvenanceStrip.tsx` (169 lines)
- `src/shared/cascade/useCascadedField.ts` (109 lines)

**What's shipped:**

`CascadeProvenanceStrip` (`CascadeProvenanceStrip.tsx:82-167`) renders:
- Where the value came from (Inherited from / Set at / Overridden at / Added at / Removed at — `:71-80` `CONTRIBUTION_VERB` map).
- Optional "Reset to inherited" button when the current provenance level matches the editor's `editLevel`.

`useCascadedField` (`useCascadedField.ts:54-109`) is a stable hook over loader+engine:
- Loads the chain via `loadCascadeChain`, resolves a single field, returns `{ value, provenance, chain, loading, error, refresh }`.
- Race-guarded against fast drawer toggles (`reqIdRef`, `:65-66`, `:81`, `:86`).

**Critical gap: no production consumers.**

```bash
$ grep -r 'useCascadedField\|CascadeProvenanceStrip' src/ --include '*.tsx' --include '*.ts'
src/components/cascade/CascadeProvenanceStrip.tsx:    (definition only)
src/shared/cascade/useCascadedField.ts:              (definition only)
src/shared/cascade/__tests__/loaders.test.ts:        (test imports loadCascadeChain, not the hook)
```

Zero references outside the cascade tree. The spec's O.4 slice (Instructions-tab integration: 7 instruction cards each rendering the strip + reset wired to `useCascadedField`) **did not actually ship** — neither `StaffInstructionCard.tsx` nor any other Instructions UI imports the hook or strip. The library exists; the integration didn't happen.

What this means concretely:
- **Override badge / "Differs from parent" affordance**: not built. No component renders a parent-value tooltip. (Grep for `Differs from parent`, `overrideMasked`, `conflictsWithParent`: zero hits.)
- **Reset / Push / Keep menu** (the §16 override visibility affordance): not built.
- **Provenance display anywhere users see it**: not built.

So while the cascade *library* is shippable, **no user can see cascade behaviour through any UI today.** Every editor users actually open (JobOrderForm, AccountOrderDetailsForm, etc.) reads through `recruiterAccountOrderDefaultsMerge.ts` and renders flat values without provenance.

**Test coverage:** `useCascadedField` and `CascadeProvenanceStrip` have **no dedicated tests.** Only the lower layers (engine + loader + registry) are tested. Risk is low — the hook is thin and the strip is presentational — but should be noted.

---

### O.5 — Optional override-mask warning — **unstarted**

The spec calls for an optional warning when a child override masks a *different* parent value (e.g. JO sets `screeningPackageId: 'pkg_b'` while Account has `'pkg_a'` — surface that the JO is masking the account's choice).

**Search results:** zero hits for `overrideMasked`, `maskingWarning`, `overridesMaskedAncestor`, `conflictsWithParent`, `Differs from parent`.

The engine returns provenance, so **the data needed for this warning is already in `ResolvedCascadeValue.provenance`** — any consumer can compare ancestor and target levels and decide to surface a warning. But:
- No consumer does this today.
- The engine itself doesn't return a `maskedAncestor` shorthand (the spec implied this would be on the `ProvenanceEntry`).
- No UI component exists for the warning.

**Severity:** low for CORT push — this is by design "optional." Docs it now and treat as nice-to-have.

---

## B. §14 Downstream Consumers — **partial**

| Item | Status | Notes |
|------|--------|-------|
| Positions completeness gate | **registry-only** | `requiredForCompleteness` flag set on 5 sub-fields (`registry.ts:198-232`); shape-lock enforces it (`registry.test.ts:194-220`). **No consumer reads it.** No JO form filters its position picker by completeness. No backend gate refuses to assign an incomplete position. |
| `selectedPositionIds: string[]` on JO as `level_only` | **complete** | Registry entry (`registry.ts:241-245`). Existing JO form already wrote `selectedPositionIds`; cascade-side declaration matches the existing storage shape. |
| `shiftTemplate` field at JO level (`level_only`, no cascade) | **partial** | Registry entry (`registry.ts:253-257`); shape locked in `types.ts:267-282` (`ShiftTemplate` interface — `defaultPositionId`, `defaultStartTime`, `defaultEndTime`, `defaultDurationMinutes`, `defaultHeadcount`, `defaultDaysOfWeek`, `defaultBreakMinutes`). **NOT consumed by click-to-create-shift.** `src/components/phase2/CreateAssignment.tsx` references a different concept (`shiftTemplateId` on Phase 2 assignments — see `:83`, `:91`, `:189`, `:375`-`377`). The two `ShiftTemplate`s don't share a type. |
| `defaultShiftPattern` field name | **renamed** | The actual field shipped is `shiftTemplate.defaultDaysOfWeek` (`types.ts:279`). No `defaultShiftPattern` in the codebase. Reasonable rename — `defaultDaysOfWeek` matches the existing `weeklySchedule` Firestore convention noted in `types.ts:191-194`. |
| Auto-JO-creator | **unstarted** | No `autoCreateJobOrder*` cloud function. No `gigJobOrderAutoCreate*`. The current gig flow has `gigJobOrderStatusSync.ts` (which transitions existing JOs between `open`/`on_hold` based on shift dates — `functions/src/jobOrders/gigJobOrderStatusSync.ts:1-206`), but nothing that *creates* a JO. §16.7's "creates as `status: 'draft'`" is therefore vacuously satisfied because no creator exists. |
| Click-to-create-shift form using `shiftTemplate` to pre-populate | **unstarted** | `shiftTemplate` is a field, but the existing shift-creation form (recruiter-side) is unchanged — no consumer calls `useCascadedField('shiftTemplate', target)` to pre-fill the form. |

**Gap to close before §14 is callable "complete":**
1. Wire `requiredForCompleteness` consumer — either a `isPositionComplete(position)` helper used by the position picker on the JO form, or a backend Firestore rule. Recommend the helper as a first cut (visible to the user, doesn't require rules deploy).
2. Wire `shiftTemplate` into the shift-creation form (CRA-side `useCascadedField('shiftTemplate', { tenantId, jobOrderId })` → seed form defaults; user can override per-shift).
3. Decide if auto-JO-creator is in §14 scope or a separate phase. Current code says "no creator" — that's a substantive feature, not a hookup.

**No tests exist for §14 consumer behaviour** because none of the consumers exist. The shape-lock and engine tests cover the registry/strategy layer only.

---

## C. §15 Job Board Posting Cascade — **partial — registry only**

| Item | Status | Notes |
|------|--------|-------|
| `posting.visibility.*` in cascade registry | **complete** | `postingVisibility` in registry (`registry.ts:118-143`) with full `defaults` block (16 toggles across compensation/timing/requirements/screening). Shape locked at `PostingVisibility` (`types.ts:210-230`). Shape-lock test asserts presence + defaults shape (`registry.test.ts:223-` ). |
| `posting.policy.*` in cascade registry | **complete** | `postingPolicy` in registry (`registry.ts:157-161`); shape at `PostingPolicy` (`types.ts:248-256`) with `autoPublishOnOpenShifts`, `autoUnpublishWhenNoOpenShifts`, `defaultExpirationDays`, `maxApplicationsDefault`, `autoAddToUserGroup`. Shape-lock test (`registry.test.ts:256-`). No `defaults` block (deliberate — opt-in per tenant). |
| New posting-only fields (`aiGeneratedDescription`, `aiDescriptionGeneratedAt`, `aiDescriptionEdited`, `aiDescriptionPrompt`, `overrides`, `lastSyncedFromJobOrderAt`) | **unstarted** | Zero hits on any of these names anywhere in the repo. Field schema not declared on the posting type. |
| Forward-sync trigger `jobOrderToPostingSync.ts` (or equivalent) | **unstarted** | No file matches `jobOrderToPostingSync`, `postingSync`, `onJobOrderWriteSyncPosting`, `forwardSyncPosting`. The `job_postings` collection is written by `src/services/recruiter/jobsBoardService.ts` directly from the recruiter UI (`:840`, `:1020`, `:1031`, `:1066`, etc.) — **no server-side sync from JO to posting exists.** |
| Naming reconciliation per §15.4 (canonical `boardVisibility`, `showStartDate`, etc.) | **unstarted / partial-by-coincidence** | Search for `boardVisibility`, `manualPublishOnly`: zero hits in `functions/src` and `src/services`. The cascade registry uses `postingVisibility.show*` (`registry.ts:122-141`) which matches §15.4's canonical names *for the visibility object*, but there's no surface where the old names are actively renamed. If old names exist on existing `job_postings` docs, they'd need a migration. |
| Migration script for renamed fields | **unstarted** | No migration script in `tools/migrations/` or `scripts/` that touches posting field names. |
| `generatePostingDescription` callable | **unstarted** | Not registered in `functions/src/index.ts`. No file matches the name. The existing AI plumbing (Apollo enrichment, etc.) doesn't have a posting-description hook. |
| Auto-call hook on auto-create | **unstarted** | No auto-create flow exists for postings (auto-create runs from auto-JO-creator, which is also unstarted — see §14). |
| Auto-publish / auto-pause hook in `gigJobOrderStatusSync` | **unstarted** | `functions/src/jobOrders/gigJobOrderStatusSync.ts:1-206` does *not* read `postingVisibility` or `postingPolicy`. Confirmed via grep — zero hits in this file. Today the function only flips JO status `open`↔`on_hold` based on shift-occurrence dates (`:48-` `dateHasHours`, `:55-` `getDateRange`). It does not touch the posting doc. |
| Refusal cases (missing required fields, `boardVisibility: 'hidden'`, `manualPublishOnly: true`) | **unstarted** | Refusal logic implies the auto-publish path exists; it doesn't. |

**Concrete consequence:** if a CSA edits an Account-level `postingVisibility.showPayRate` today, **nothing propagates the change to live `job_postings` docs.** The current jobs-board service writes from form submission only; there's no JO→posting trigger and no cascade-aware read on posting render.

**Severity for CORT push:** medium-low. CORT is an internal account; postings might not even be active for it during the audit window. Confirm with deployer whether CORT JOs have associated public postings. If yes, the "stale posting" risk is real but limited to one tenant.

**Tests covering §15 surfaces:** registry shape-lock tests cover the cascade entries (`registry.test.ts:223-267`). No integration tests for the (unbuilt) forward-sync, AI gen, or auto-publish.

---

## D. §16 Propagation Policy — **unstarted**

| Item | Status | Notes |
|------|--------|-------|
| `propagation: 'live' \| 'live-until-active' \| 'snapshot-on-activation'` field on every registry entry | **unstarted** | No registry entry declares `propagation`. The `CascadeFieldSpec` interface (`types.ts:104-141`) does not include the field. Adding it is non-breaking (optional) but the shape-lock test will need an update. |
| `onJobOrderStatusTransition` Cloud Function for draft→open snapshot | **unstarted** | Zero hits across the repo for this name or any variant (`onJobOrderStatusTransition`, `onJobOrderActivate`, `snapshotJoOnActivate`). Nothing creates the snapshot, nothing flips the live↔snapshot mode. |
| Per-field policy assignments per §16.3 (`hiringEntityId`, `eVerifyRequired`, `workersCompCode`, `workersCompRate`, `markupPercentage`, position-pricing fields → snapshot-on-activation) | **unstarted** | Implied by the `propagation` field — see above. Note: the registry already groups these as the "compliance-anchor" fields (`registry.ts:43-52` for `hiringEntityId`/`eVerifyRequired`; pricing under `positions.itemFields` with `requiredForCompleteness` flag) so the *eligible set* is identifiable. The policy declaration just isn't there. |
| Push-to-Active admin action | **unstarted** | No callable, no UI, no audit trail. Zero hits for `pushToActive`, `push-to-active`, `pushSnapshotToActive`. |
| Override visibility affordance — "Differs from parent" badge + reset/push/keep menu | **unstarted** | No badge UI; no reset/push/keep menu. The `CascadeProvenanceStrip` component supports a "Reset to inherited" button (`CascadeProvenanceStrip.tsx:54-60`) but doesn't render a parent-vs-current diff or surface push/keep options. |
| Gig JO auto-creator creates as `status: 'draft'` | **vacuously satisfied** | Auto-creator doesn't exist (§14). Trivially compliant. |
| Migration script `tools/migrations/backfillJoSnapshotFields.ts` for existing active JOs | **unstarted** | No script. |
| JO-level rate overrides don't push back to Child (passive compliance with §16.4) | **passively compliant** | Rate fields (`payRate`, `billRate`, `futa`, `suta`, `workersCompRate`) are registered as `editableAt: ['child']` only (`registry.ts:198-232`). The `editableAt` guard in the engine (`resolveCascadedField.ts:95-97`) ignores any JO-level write of these fields when reading. Existing JO form (`JobOrderForm.tsx`) does not write these fields back to Child; cross-checked via `recruiterAccountOrderDefaultsMerge.ts` (which is read-only for the merge layer). **Confirmed: no upstream-write logic exists.** Caveat: this is *passive* compliance — the system doesn't actively prevent a future PR from adding the bad behaviour. |

**Severity for CORT push:** **HIGH.** Without §16:
- A CSA editing `markupPercentage` on the CORT National Account today **will silently change billing on every active JO under CORT** the next time those JOs render their resolved values. The legacy `recruiterAccountOrderDefaultsMerge.ts` is propagation-naive — it just reads parent + child + location every time.
- Same risk for `hiringEntityId`, `eVerifyRequired`, `workersCompRate`, position pricing.
- **There is no Push-to-Active action**, so even if you wanted to do "snapshot on activate, then push later," the manual override doesn't exist.

This is the single largest gap in the audit and the primary blocker for CORT push.

---

## E. Cross-cutting concerns

### E.1 — Existing parallel implementations

Three live parallel paths that need to be reconciled with the cascade engine:

| File | Purpose | Status | Migration plan |
|------|---------|--------|----------------|
| `src/utils/recruiterAccountOrderDefaultsMerge.ts` (214 lines) | Merge national → child → location for the order-details surface. Used by `JobOrderForm.tsx` and `AccountOrderDetailsForm.tsx`. Implements its own propagation-naive `??`-merge over `RecruiterOrderDetailsData`. | **Active legacy.** Owns the read path for every JO form today. | **Not yet migrated to cascade engine.** Field-path map in `loaders.ts:40-99` was deliberately built to mirror this file's read paths so a future migration is mechanical. Recommendation: migrate after §15 forward-sync lands, since both paths converge on the same posting-doc surface. Keep the legacy file in place during migration; flip consumers one at a time. |
| `functions/src/compliance/screeningAutomationShared.ts` — `mergeScreeningValidityDaysFromLayers` (R.10 layer-merger) | Resolve `screeningValidityDays` across Account → Location → JobOrder for background-check expiry. | **Active.** Not yet on cascade engine. | **Intentionally parallel for R.10.** R.10's design doc (`docs/READINESS_R10_HANDOFF.md`) chose sweep-time dynamic resolution over baking the value into a snapshot, so it lives outside the cascade engine. Migration possible later (it would slot in as a `replace` strategy field on the registry once the admin-SDK loader twin lands), but no immediate plan. |
| `functions/src/jobOrders/gigJobOrderStatusSync.ts` (206 lines) | Status flipping `open`↔`on_hold` based on shift dates. | **Active.** Doesn't read cascade. | **Out of cascade scope today.** §15.7 implies extending this with an auto-publish hook — that's where it becomes a cascade consumer. |

**Recommendation:** document the migration order explicitly when the next cascade phase ships. Don't leave both paths alive indefinitely — the legacy merger will rot relative to registry additions.

### E.2 — Test coverage summary

| Layer | File | `it()` count | Coverage |
|-------|------|-------------|----------|
| Registry shape-lock | `src/shared/cascade/__tests__/registry.test.ts` | 27 | Per-field invariants; canonical-name guard; `requiredForCompleteness` constraint. |
| Engine | `src/shared/cascade/__tests__/resolveCascadedField.test.ts` | 31 | Worked examples per strategy; `editableAt` guard; child/location collapsing; reset-to-inherited via delta deletion. |
| Loaders | `src/shared/cascade/__tests__/loaders.test.ts` | 16 | Chain shape across hierarchies; deltas extraction; per-request memoization. |
| Hook (`useCascadedField`) | — | 0 | None. |
| Strip (`CascadeProvenanceStrip`) | — | 0 | None. |
| Forward-sync trigger | — | 0 | Trigger doesn't exist. |
| Snapshot trigger | — | 0 | Trigger doesn't exist. |
| Push-to-Active flow | — | 0 | Action doesn't exist. |

**Total cascade-layer tests: 74 cases across 3 files.** All Jest, all unit-level, all colocated under `src/shared/cascade/__tests__`. No integration tests because there's no consumer to integrate against.

### E.3 — Firestore indexes

**Required indexes for current cascade-related queries: zero.**

The loader is a pure ancestor-chain doc-fetch — every read is by `docId`. No `where()`, no `orderBy()`, no composite query. So nothing needs an index today.

**Future index requirements** (when these lands):
- §15 forward-sync trigger: probably needs `(tenantId, jobOrderId)` on `job_postings` (depending on the doc layout — could also be subcollection). To be specified when the trigger lands.
- §16 snapshot trigger: typically reads JO docs by `id`, so no new index expected.
- Push-to-Active admin action: same — single-doc reads.
- Migration script `backfillJoSnapshotFields`: collection-group scan over `job_orders` likely needs `(tenantId, status)` if it filters to active only. Existing index check needed when implementing.

### E.4 — Mirrored cascade trees (`src/shared/cascade/` vs `shared/cascade/`)

Both trees exist; `diff -q` confirms byte-identical. The file headers (e.g. `src/shared/cascade/registry.ts:10-11`) call this out explicitly: the duplicate is intentional so the CRA bundle (`src/shared`) and any future workspace-shared consumer (`shared/`) both get the same code. **Risk:** they can drift. Add a CI check (single `diff -r` step) the next time anyone touches the cascade tree.

---

## F. CORT-push readiness — explicit gates

Reproducing the kickoff criteria:

| Gate | Required state | Actual state | Pass? |
|------|----------------|--------------|-------|
| Cascade engine (O.1–O.5) **complete** | All five phases shipped + UI consumers live. | O.1, O.2 complete. O.3 missing admin twin. O.4 has no consumers. O.5 unstarted. | **NO** |
| §16 propagation policy + draft→open snapshot trigger **complete** | Per-field `propagation` enum + `onJobOrderStatusTransition` trigger live. | Neither shipped. | **NO** |
| Push-to-Active admin action **at least partial** | Callable + audit trail behind a UI button. | Callable doesn't exist. UI doesn't exist. | **NO** |
| §14/§15 partial gaps documented with severity | Auto-JO-creator, posting auto-sync downstream features can be deferred if non-blocking. | Documented above. Severity assessed. | **YES** |

**Cascade audit verdict: NO-GO for CORT push as currently spec'd.**

### Minimum slice to reach GO

If the goal is "exercise CORT National Account data downstream without silent propagation to active JOs," the smallest unblocking PR is:

1. **§16 minimum slice:**
   - Add `propagation?: 'live' | 'live-until-active' | 'snapshot-on-activation'` to `CascadeFieldSpec` (`types.ts:104-141`).
   - Mark the §16.3 fields (`hiringEntityId`, `eVerifyRequired`, `workersCompRate`, `markupPercentage`, position-pricing leaves) as `'snapshot-on-activation'`.
   - Ship `onJobOrderStatusTransition` trigger that, on draft→open, copies the resolved snapshot-policy fields onto the JO doc (e.g. `jo.snapshot.markupPercentage`).
   - Update the consumer (`recruiterAccountOrderDefaultsMerge.ts` or its replacement) to prefer `jo.snapshot.*` over the cascaded resolved value when the JO is non-draft.
   - Migration script `tools/migrations/backfillJoSnapshotFields.ts` to backfill `jo.snapshot.*` for existing non-draft JOs from current resolved values (one-shot).
   - **Estimate:** 2-3 day PR.

2. **Push-to-Active minimum slice:**
   - Callable `pushToActiveJoSnapshotCallable({ jobOrderId, fields? })` that re-resolves from the cascade and writes to `jo.snapshot.*` with audit-log.
   - One UI button on the JO detail page (no need for the full reset/push/keep menu yet).
   - **Estimate:** 1 day PR after (1) lands.

Total: roughly one-week effort to clear the CORT gate. Everything else (O.4 UI consumers, O.5 warning, §14 auto-creator, §15 forward-sync, AI gen, auto-publish) can land post-CORT as separately scoped PRs.

### Alternative: explicit propagation acceptance

If the CORT exercise window is short (single session, controlled edits, deployer in the loop), an alternative is to accept the propagation behaviour:

- Edits to CORT National Account fields propagate live to active JOs by design (today's behaviour).
- Deployer commits to not editing snapshot-policy fields (markup, comp rate, hiring entity, eVerify) during the window.
- Document the constraint in the CORT runbook.

This is faster but technically risky; recommend (1) only if the window is genuinely controlled and short.

---

## G. Surprises / things that deviated from expectation

1. **The cascade engine has zero production consumers.** The library is shippable-quality, but the spec's O.4 slice (Instructions tab integration) didn't actually land. Every editor users see still goes through `recruiterAccountOrderDefaultsMerge.ts`. This is the most surprising audit finding — easy to misread the registry file's confident `defaults` block + `merge_deep` strategy as "this is wired up."
2. **`CascadeFieldSpec` has no `propagation` field.** §16 was clearly anticipated (the comments in `registry.ts:113-117` reference handoff §15.3 and decision 2026-04-26 Q3=a; `types.ts:155-181` carefully defines provenance), but the propagation enum and its consumer wiring never made it in. The shape was left open-ended; the call to ship it never came.
3. **Two `ShiftTemplate` types in the codebase — different shapes.** The cascade `ShiftTemplate` (`src/shared/cascade/types.ts:267-282`, JO-level pre-fill) is unrelated to the Phase 2 assignments `shiftTemplateId`/`shiftTemplates` in `src/components/phase2/CreateAssignment.tsx:91`. Naming collision is latent — anyone reading "shiftTemplate" cold could conflate them.
4. **`gigJobOrderStatusSync` doesn't read `postingPolicy`.** The registry comment (`registry.ts:145-148`) explicitly says "Posting lifecycle policy. Read by: `gigJobOrderStatusSync` for auto-publish / auto-unpublish on open-shift transitions (handoff §15.7)." That read does not exist. The comment is aspirational, not factual.
5. **`requiredForCompleteness` is unread.** A registry-level flag with shape-lock test coverage that no consumer currently checks. Useful documentation, but currently inert.
6. **`location` level is in the loader but not in `EditableLevel`.** Deliberate — the engine treats child + location as the same depth, so `editableAt` only enumerates `account|child|jo|shift`. Worth knowing if you're tracing why a `location`-level write doesn't surface in `editableAt` lists.
7. **Mirrored `src/shared/cascade/` and `shared/cascade/` trees.** Byte-identical today; load-bearing assumption with no CI guard. Easy fix when convenient.

---

## H. Follow-up backlog (in priority order)

1. **§16 minimum slice** — gating CORT push. See §F. (~3 days.)
2. **Push-to-Active minimum slice** — gating CORT push. (~1 day after §16.)
3. **Wire the cascade engine to one real UI surface** — start with Instructions tab as originally spec'd. Validates O.4 end-to-end and sets the pattern for §15 / §16 UIs. (~2 days.)
4. **Migrate `recruiterAccountOrderDefaultsMerge.ts` consumers to the cascade engine.** Mechanical. (~3-5 days.)
5. **§15 forward-sync trigger + AI description gen** — non-CORT-blocking. (~1 week.)
6. **§14 click-to-create-shift `shiftTemplate` consumer** — non-CORT-blocking. (~1 day.)
7. **§14 positions completeness gate consumer** — non-CORT-blocking. (~1 day.)
8. **§14 auto-JO-creator** — substantial feature; scope separately. (~1-2 weeks.)
9. **O.5 override-mask warning** — nice-to-have. (~1 day after O.4 has at least one consumer.)
10. **Add CI guard for the mirrored cascade trees** — `diff -r src/shared/cascade shared/cascade` as a PR-Cop check. (~30 min.)
11. **Plan migration off `mergeScreeningValidityDaysFromLayers`** once §16 + admin-SDK loader twin exist; track in the R.10 follow-up file rather than here.

---

*End of audit. Standing by for greenlight on §16 minimum slice or for CORT-window propagation-acceptance decision.*
