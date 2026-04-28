# Cascade Propagation Policy — R.16.2a Consumer Rewire (Financial-Critical Slice) Handoff Spec

**Status:** R.16.2a **implementation complete** (Phases 1, 2, 3, 5 shipped Apr 27, 2026). Greenlight conditions both met before coding started: R.16.1 staging smoke green (CORT push end-to-end successful per R.16.1.1) and brief locks below stood. Awaiting targeted functions deploy + frontend deploy + manual staging smoke per the runbook §3.

**Test counts at ship:**
- Phase 1 (server wraps) — 21/21 new mocha cases passing.
- Phase 2 (client wraps) — 17/17 new jest cases passing; 18/18 R.16.1 helper jest cases unchanged.
- Cascade-affected mocha (jobOrders + cascade + readiness + onboarding + workerAiPrescreen + categoryScoreEvolution + firestore + messaging + translation + utils + accusource + manageAssociations) — **405 passing**, 27 pending (no regressions).
- `scripts/check-cascade-mirror.sh` — clean (extended to enforce parity on `jobOrder/getEffectiveJobOrderField.ts`).
- `tsc --noEmit` — clean both projects (modulo same pre-existing `auth/setTenantRole.test.ts` errors unrelated to this slice).
- `ReadLints` — no new lint errors on any touched file.
**Predecessor:** `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md` (snapshot machinery + admin tooling shipped).
**Successor:** R.16.2b (post-CORT polish — `screeningPackageId`/R.11 fold-in, `additionalScreenings`, per-position `futa`/`suta`/`rateMode`/`jobTitle`/`jobDescription`, remaining banner integrations).

**Goal:** flip the financial-critical and compliance-critical *read paths* on the JO doc so they read through `getEffectiveJobOrderField` (R.16.1 Phase 7 helper) — preferring the activation snapshot for non-draft JOs, falling back to the existing cascade/legacy resolution for drafts and pre-§16.1 active JOs without a snapshot. Plus surface `PushToActiveBanner` on the editors that produce dirty edits to these fields outside `AccountOrderDetailsForm`.

This is the slice that actually makes the §16.1 snapshot do work. Without R.16.2a, `cascadeAuditLog`'s `push_to_active` rows land but consumers still read live cascade values — the snapshot is "armed but disconnected". CORT downstream push (#32) is gated on this slice.

**Out of scope (deferred to R.16.2b unless explicitly noted):**
- `screeningPackageId` consumer rewire (already half-rewired via R.11's `pickEffectiveScreeningPackageId`; full consolidation deferred per L7 lock).
- `additionalScreenings` consumer rewire.
- Per-position `futa`, `suta`, `rateMode`, `jobTitle`, `jobDescription`.
- Banner integration on `AccountLocationDetail.tsx` (Location is a cascade position, not a snapshot point — L4 lock).
- Wraps on non-JO docs (postings, assignments) — Q5 lock defers to R.16.2b.
- Override visibility affordance (R.16.3).
- §14 / §15 features.
- Engine-level `propagation` enforcement (R.16.5).

---

## Locked decisions

> All ten L# items below are **LOCKED** as of Apr 27, 2026 by Greg. Implementation must conform; any drift requires re-review before merging.

### L1 (LOCKED) — Surgical wrap, never rewrite

**Pattern.** For every JO-doc consumer that currently reads `jo.{field}` or `jo.positions[i].{subField}` for a snapshot-policy field, replace the read with:

```ts
import { getEffectiveJobOrderField, getEffectiveJobOrderPositionField } from 'src/shared/jobOrder/getEffectiveJobOrderField';

// Top-level (e.g. eVerifyRequired, hiringEntityId, workersCompCode):
const { value: eVerifyRequired } = getEffectiveJobOrderField(jo, 'eVerifyRequired', {
  fallback: jo.eVerifyRequired ?? false,
});

// Per-position (e.g. markupPercentage, payRate, billRate, workersCompRate):
const { value: markupPct } = getEffectiveJobOrderPositionField(jo, positionId, 'markupPercentage', {
  fallback: jo.positions?.find((p) => p.positionId === positionId)?.markupPercentage ?? null,
});
```

**Why surgical:**
- Helper already returns `{ value, source: 'snapshot' | 'fallback' | 'absent' }`. Drafts and pre-§16.1 active JOs (no `capturedAt`) deterministically fall through to `fallback` — backwards compat is automatic.
- The `fallback` is the **caller's existing read**. R.16.2a doesn't change *what* the fallback resolves to, only *whether snapshot wins*. Means R.16.2a is reversible: comment out the wrap, the caller still works.
- No deletion of `recruiterAccountOrderDefaultsMerge.ts` — the merge utility stays the cascade engine for drafts, and stays the fallback for non-drafts when `snapshot` is absent.

**Why not rewrite:** the legacy merge (`fetchMergedRecruiterOrderDefaultsForJobOrder`) loads three docs (account + parent + location_defaults). R.16.2a's wrap reads from the JO doc only — the snapshot is already on the JO. Replacing the merge entirely would force every consumer to load the JO doc *and* know about cascade — too much surface change for a CORT-blocker. Wrap = isolated change per call site.

### L2 (LOCKED) — Field-name normalization at the wrap boundary

> Standard migration pattern: **read tolerantly, write canonically**. Wraps accept both `markupPercent` (legacy) and `markupPercentage` (canonical) at read time. Registry stays canonical. No live-data rename in this slice.


The cascade registry and snapshot envelope use **`markupPercentage`** (full word). The legacy Account doc and JO doc store **`markupPercent`** (truncated). The Account-level `extractAccountPricingPositions` does *not* normalize these — they coexist, and `fetchResolvedAccountPricingPositions` returns positions with `markupPercent` while the snapshot envelope writes `markupPercentage`.

**Proposed handling:**
- Wraps that read per-position markup must call the helper with **`'markupPercentage'`** (registry-canonical).
- The fallback expression must read **`row.markupPercent ?? row.markupPercentage`** (try legacy first because that's the live JO field name; fall back to the canonical name in case a JO migrated to it via Push-to-Active write).
- Push-to-Active write currently writes `'markupPercentage'` into `snapshot.positions[i].markupPercentage`. Confirmed in `pushToActive.ts` Phase 5 implementation.

**Do NOT rename `markupPercent` → `markupPercentage` on the live fields in R.16.2a.** That's a data-shape change with its own backfill story — defer to R.16.2b or a dedicated rename PR. R.16.2a only changes read paths.

### L3 (LOCKED) — In-scope consumer surface for R.16.2a

Targeting the seven fields named in the scope-lock:

**Top-level (3 fields):**

| Field            | Consumer (file)                                                                 | Read shape                                                          |
|------------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------|
| `eVerifyRequired` | `functions/src/readiness/onAssignmentCreatedAutoSeed.ts:214`                   | `if (readBool(jo.eVerifyRequired))` → seed e-verify requirement     |
| `eVerifyRequired` | `functions/src/workerAiPrescreen/aiPrescreenJobSlice.ts:113,135`               | `Boolean(posting.eVerifyRequired)` / `Boolean(job.eVerifyRequired)` |
| `eVerifyRequired` | `functions/src/index.ts:793`                                                   | AI prompt construction — `if (jobOrderData.eVerifyRequired)`        |
| `eVerifyRequired` | `src/components/JobOrderForm.tsx:2194`                                          | Form display — `formEntity.everifyRequired || formData.eVerifyRequired` |
| `hiringEntityId`  | `functions/src/onboarding/workerOnboardingPipeline.ts:172`                      | `(jo.hiringEntityId as string) \|\| (jo.entityId as string) \|\| null` |
| `hiringEntityId`  | `functions/src/onboarding/loadEntityOnboardingEngineBuildContextAdmin.ts:255`   | Bulk JO load — `(jd.hiringEntityId as string \| null \| undefined) ?? null` |
| `hiringEntityId`  | `src/components/recruiter/PlacementsTab.tsx:897`                                | `placementHiringEntityId ?? jobOrder.hiringEntityId`                 |
| `hiringEntityId`  | `src/components/JobOrderForm.tsx:316–324`                                       | Form display — composite of recruiter-account + JO + initial data    |
| `hiringEntityId`  | `src/components/apply/Wizard.tsx:757,832`                                       | Public apply flow — `jo.hiringEntityId ?? null`                      |
| `workersCompCode` | `functions/src/messaging/assignmentDetailsEmail.ts` *(if it reads from JO — confirm during impl)* | Display in assignment confirmation email |
| `workersCompCode` | (any payroll/billing consumer that reads JO comp code — confirm during impl)    | TBD                                                                 |

**Per-position (4 fields):**

| Field              | Consumer (file)                                          | Read shape                                                              |
|--------------------|----------------------------------------------------------|-------------------------------------------------------------------------|
| `payRate`          | `functions/src/placementsApi.ts:489,771`                 | `safeFiniteNumber(shift.payRate ?? jobOrder.payRate, 0)` (top-level read on JO — see L5) |
| `billRate`         | `functions/src/placementsApi.ts:490,772`                 | `safeFiniteNumber(shift.billRate ?? jobOrder.billRate, 0)` (top-level read on JO — see L5) |
| `markupPercentage` | `src/hooks/useActiveShifts.ts:75–77`                     | `data.markup ?? data.markupPercent ?? p0?.markupPercent`                |
| `markupPercentage` | `src/components/shifts/ShiftPlacementsDrawer.tsx:618`    | `shift.markupPercent` (display)                                         |
| `workersCompRate`  | (billing/invoice paths that compute margin — see L5)      | TBD during implementation                                               |
| `workersCompCode` (per-position when JO has positions[]) | `src/components/JobOrderForm.tsx:2875–2879,2956–2960` | `preset.workersCompCode` from accountPricing pre-fill                  |

This list is **scoping**, not the full implementation surface — the impl pass starts from these grep'd entry points and follows the call graph one hop. Anything that's clearly upstream-only (e.g. cascade engine internals, the snapshot trigger itself, or test fixtures) is excluded.

### L4 (LOCKED) — Banner integration scope for R.16.2a

> Scope confirmed: `RecruiterAccountDetails.tsx` only. `AccountLocationDetail.tsx` deferred — Location is a cascade position, not a snapshot point per R.16.1 L9.


R.16.1 Phase 8 wired `PushToActiveBanner` only on `AccountOrderDetailsForm` for `screeningPackageId` + `additionalScreenings`. The remaining R.16.2a fields live in two other forms:

1. **`src/pages/RecruiterAccountDetails.tsx`** — Account-level edit page. Edits:
   - `account.hiringEntityId` (line 4731 `<Select>`).
   - `account.defaults.eVerify.eVerifyRequired` (line 4865-ish — confirm during impl).
   - `account.workersCompCode` (Pricing tab per-position — line 6221, 6656; *and* via `<TextField>` lookup on line 6126, 6561).
   - `account.pricing.positions[i].{markupPercent, payRate, billRate, workersCompRate}` (Pricing tab — lines 6089–6310-ish, 7524-ish).

2. **`src/pages/AccountLocationDetail.tsx`** — Location-level edit page. Edits same per-position pricing fields at the location tier.

**Cut (LOCKED):** wire the banner on **(1) only** for R.16.2a. Per L9 of R.16.1, location-level edits don't carry snapshot-policy semantics (the snapshot is captured at the JO level from the resolved cascade — location overrides flow into the resolution but don't have their own snapshot). R.16.2b can add location-level banners if ops workflow demands; R.16.2a stays focused on the Account tier where the financial-critical edits actually happen.

**Banner trigger logic** (mirrors `AccountOrderDetailsForm`):
- Track `lastSavedRef` for each in-scope field on form mount.
- After successful save, compare new vs. saved value. If changed AND the field is in the snapshot-policy set, set `pushBanner` payload with `{ fieldKey, positionId?, previousValue, newValue, fieldLabel }`.
- Banner renders inline above the Pricing tab (per-position fields) and above the Hiring Entity / E-Verify section (top-level fields).
- Per-position fields share one banner instance — payload tracks `positionId` so the dialog filters correctly.

**Resolved (Q1, LOCKED).** One banner per dirty (positionId, fieldKey) pair, no cap, stacked vertically. Reasoning: Push-to-Active is per-field per R.16.1 L9 — each banner maps to one dialog. Affected-JO list can differ per field (a JO might use position X but not Y, so markup edits affect different JOs than rate edits). Collapse logic creates UX confusion; defer to a later ticket if N>5 becomes a real problem in practice (CSAs typically save 1–2 field changes at a time).

### L5 (LOCKED) — Top-level vs per-position read disambiguation

`functions/src/placementsApi.ts` reads `jobOrder.payRate` and `jobOrder.billRate` at the top level — this is the **JO's flat default rate**, used when a shift doesn't override. It's *not* indexed by `positionId`. The R.16.1 snapshot envelope only stores per-position rates (in `snapshot.positions[].{payRate,billRate,workersCompRate,markupPercentage}`); there's no top-level `snapshot.payRate`.

**Proposed resolution:**
- For `placementsApi.ts`'s flat read, **do not wrap in R.16.2a**. The flat `jo.payRate` field isn't a snapshot-policy field per the registry — only the per-position equivalents are. Snapshotting a flat default would require a separate registry entry.
- Wraps for `payRate`/`billRate`/`workersCompRate`/`markupPercentage` apply only to consumers that read **per-position** rates. Today that's the shift drawer's `markupPercent` display (`useActiveShifts.ts`, `ShiftPlacementsDrawer.tsx`) — confirm during impl whether the placements API actually has a per-position read path or always uses the flat JO default.

**If implementation reveals a per-position read in `placementsApi.ts`** (e.g. shifts created from a JO with `selectedPositionIds`), that read does get wrapped — flag to Greg before changing the placements path.

**Bottom-line scope (LOCKED, Q2):** R.16.2a wraps **per-position** rate reads only. The flat `jo.payRate`/`jo.billRate` defaults stay unwrapped — they're not a registry entry, and don't add one in this slice. R.16.2b can revisit if there's evidence the flat reads are actually used in production paths that affect CORT.

### L6 (LOCKED) — `recruiterAccountOrderDefaultsMerge.ts` is untouched

> Form pre-fill (composing defaults when creating a new JO) and JO read (resolving effective values on an existing JO) are different concerns. Leave the merge utility alone.


The merge utility is not a JO-doc reader — it composes Account → Parent → Location for *new JO creation* and *form pre-fill*. Its consumers (`JobOrderForm.tsx`, `AccountOrderDetailsForm.tsx`) operate on draft / pre-create state where the snapshot doesn't exist yet.

**Proposed:** R.16.2a does **not** modify `recruiterAccountOrderDefaultsMerge.ts`, does not add helper-wraps inside it, and does not change its callers' read paths. The wraps land *downstream* of the merge — at the consumer that already has a `JobOrder` doc in hand.

This avoids tangling the form-prefill cascade with the activation-snapshot read and keeps the audit-trail surface small for review.

### L7 (LOCKED) — R.11 stays untouched in R.16.2a

R.11's `pickEffectiveScreeningPackageId` already implements snapshot-vs-live precedence for `screeningPackageId` per L5 of R.16.1. Folding it into `getEffectiveJobOrderField` is a code-consolidation tidy, not a behavior change. **Defer to R.16.2b.**

The benefit of the deferral: R.16.2a's PR diff stays narrowly focused on the seven new fields. Reviewers can read the diff without needing to re-verify R.11's drift detection still works.

### L8 (LOCKED) — Tests structure

Two test surfaces:

1. **Unit tests on the wrapped consumers.** For each call site that gets wrapped, add a focused unit test: snapshot present → snapshot wins; snapshot absent → fallback wins; draft JO → fallback wins regardless of snapshot. Co-locate next to the consumer's existing test file (or create one if absent — note the brief will list which consumers don't have tests today).

2. **Integration test on `getEffectiveJobOrderField` × the seven specific fields.** Already covered by the 18 Jest tests shipped with R.16.1 Phase 7. No additional helper tests needed unless a wrap reveals a missing edge case.

**Estimated test count:** ~20–30 new unit tests across the in-scope consumer files (mocha-side for functions consumers, jest-side for src-side). Final number lands when implementation lists the exact wrapped consumers — locking the count now would be guesswork.

### L9 (LOCKED) — No new Firestore indexes

R.16.2a is read-side only — no new queries, no new collection-group reads. Confirmed by the surface in L3.

### L10 (LOCKED) — Banner-on-save semantics on `RecruiterAccountDetails.tsx`

The Account page auto-saves on field blur (per existing pattern). Banner state lifecycle:

- **Banner appears** when the post-save callback detects a snapshot-policy field changed value AND the user has `securityLevel ≥ 7` (server gate is on the callable, but UX-side only show the banner for users who can act on it).
- **Banner dismissed** by `onClose` callback OR after the dialog's push completes successfully (per R.16.1 Phase 8 pattern).
- **Multiple dirty fields stacked** — one banner per (fieldKey, positionId) pair, stacked vertically. Each banner owns its own dialog instance.

**No cap (LOCKED, Q1).** Render one banner per dirty (positionId, fieldKey) pair, stacked. No collapse logic. If N>5 becomes a real production problem, defer collapse to a later ticket — but the empirical baseline is CSAs save 1–2 fields at a time.

**UX gate (LOCKED, Q4).** Banner only renders for users with `securityLevel ≥ 7`. Standard "permission-aware UI" pattern — don't surface affordances users can't act on. Server-side callable still enforces independently (can't bypass via direct invocation). For users below level 7, the Account-level edit still saves and cascades to draft JOs correctly; they just don't see the Push-to-Active path. Higher-permission users can later push-to-active separately if needed.

---

## Implementation surface

### Phase 1 — Server-side wraps (functions package)

- **`functions/src/readiness/onAssignmentCreatedAutoSeed.ts`** — wrap the `eVerifyRequired` read on line 214. Add 3 mocha cases.
- **`functions/src/workerAiPrescreen/aiPrescreenJobSlice.ts`** — wrap both `eVerifyRequired` reads (lines 113, 135). Note: `posting.eVerifyRequired` may be from a posting doc, not a JO — confirm the underlying doc shape before wrapping. Add 4 mocha cases.
- **`functions/src/index.ts`** (line 793) — wrap the AI prompt's `eVerifyRequired` read. This is in a callable / scheduled function context — verify the shape of `jobOrderData` is a JO doc, not a transformed payload, before wrapping. Add 2 mocha cases.
- **`functions/src/onboarding/workerOnboardingPipeline.ts`** (line 172) — wrap the `hiringEntityId` read. Critical compliance path — every onboarding pipeline-start that pulls hiring entity from a JO. Add 4 mocha cases.
- **`functions/src/onboarding/loadEntityOnboardingEngineBuildContextAdmin.ts`** (line 255) — bulk JO load. Wrap the per-JO `hiringEntityId` extraction in the `Promise.all` map. Performance sensitive (this is a bulk path) — verify wrap is sync (it is, per Phase 7 helper). Add 3 mocha cases.

**Server-side wrap helper (LOCKED, Q3).** Mirror `src/shared/jobOrder/getEffectiveJobOrderField.ts` to `shared/jobOrder/getEffectiveJobOrderField.ts` (the symlink target). The helper is pure / SDK-agnostic — no admin-vs-CRA Firebase split needed, so byte-identical mirror is safe. Add the mirrored file to `scripts/check-cascade-mirror.sh`'s file list as the first step of Phase 1 so CI enforces parity from the moment the helper exists in both trees. Cross-package imports are explicitly **not** an option.

### Phase 2 — Client-side wraps (src package)

- **`src/components/JobOrderForm.tsx`** — wrap `hiringEntityIdForForm` composite (lines 316–324) and `eVerifyRequired` read on line 2194. The form is read-mode for non-draft JOs anyway (the in-place editor is gated), but the read still flows into the displayed value. Add 4 jest cases.
- **`src/components/recruiter/PlacementsTab.tsx`** (line 897) — wrap the `jobOrder.hiringEntityId` read. The `placementHiringEntityId` prop already overrides — wrap should sit between prop override and snapshot fallback, per:
  ```ts
  const effective = placementHiringEntityId ?? getEffectiveJobOrderField(jobOrder, 'hiringEntityId', { fallback: jobOrder.hiringEntityId }).value;
  ```
  Add 3 jest cases.
- **`src/components/apply/Wizard.tsx`** (lines 757, 832) — wrap the public-apply `hiringEntityId` reads. Critical path: a worker applying to a JO. The snapshot must take precedence here for non-draft JOs. Add 3 jest cases.
- **`src/hooks/useActiveShifts.ts`** (lines 75–77) — wrap the per-position `markupPercent` read. **Note the field-name mismatch (L2):** the live data uses `markupPercent`; the helper takes `'markupPercentage'`. Wrap shape:
  ```ts
  const { value: markup } = getEffectiveJobOrderPositionField(jo, positionId, 'markupPercentage', {
    fallback: toFiniteNumber(data.markup) ?? toFiniteNumber(data.markupPercent) ?? toFiniteNumber(p0?.markupPercent) ?? null,
  });
  ```
  Add 4 jest cases.
- **`src/components/shifts/ShiftPlacementsDrawer.tsx`** (line 618) — same pattern. Display-only; wrap is for future-proofing. Add 2 jest cases.

### Phase 3 — Banner integration on `RecruiterAccountDetails.tsx`

- **Top-level fields** (`hiringEntityId`, `eVerifyRequired`, `workersCompCode`):
  - Add `lastSavedHiringEntityIdRef`, `lastSavedEVerifyRequiredRef`, `lastSavedWorkersCompCodeRef` mirroring the R.16.1 Phase 8 pattern in `AccountOrderDetailsForm.tsx`.
  - On post-save callback for the Account doc, compare and set `pushBanner` payloads.
  - Render `<PushToActiveBanner>` above the Hiring Entity section.

- **Per-position fields** (`payRate`, `billRate`, `markupPercent`, `workersCompRate`, `workersCompCode` per-position):
  - Track `lastSavedPricingPositionsRef: Map<positionId, { payRate, billRate, markupPercent, workersCompRate, workersCompCode }>`.
  - On Pricing tab save (the existing save path on line 3553–ish), diff each position against last-saved.
  - For each (position, fieldKey) pair that changed, emit one banner. Per L10's open question, possibly cap at 5 with a collapse.
  - Render banners in a stack above the Pricing tab table.

**Note on `markupPercent` → `markupPercentage` mapping in the banner payload:** the dialog (R.16.1 Phase 8) takes `fieldKey: PushFieldKey`, which is the registry-canonical name. The banner payload must use `'markupPercentage'`, not `'markupPercent'`. The display label can remain "Markup Percent" if Greg prefers that copy.

### Phase 4 — Tests

Per L8: ~20–30 unit tests across the wrapped consumers. No callable / integration tests beyond what R.16.1 Phase 5 already shipped — the wraps are read-side, the helper is already tested, the callables are already tested. Wrap-tests verify: (a) snapshot wins on non-draft, (b) fallback wins on draft, (c) fallback wins on non-draft without snapshot.

### Phase 5 — Mirror script update

Per Q3 lock: mirror happens. Front-load this in Phase 1:
- Copy `src/shared/jobOrder/getEffectiveJobOrderField.ts` to `shared/jobOrder/getEffectiveJobOrderField.ts` (and its co-located test file mirroring is **not** required — Jest tests stay in `src/shared/jobOrder/__tests__/` only, since the file is byte-identical).
- Extend `scripts/check-cascade-mirror.sh` to also diff `src/shared/jobOrder/getEffectiveJobOrderField.ts` ↔ `shared/jobOrder/getEffectiveJobOrderField.ts` byte-for-byte (no field-path-map carve-out needed; this file has no SDK dependency).
- Verify the symlink-aware functions-side import path works: `import { getEffectiveJobOrderField } from '../shared/jobOrder/getEffectiveJobOrderField'` from anywhere in `functions/src/`.

### Phase 6 — Handoff doc updates

- Mark R.16.1 handoff's L2 as **partially resolved** — point at R.16.2a as the unblocker for the financial reads.
- Add the wraps to `CASCADE_IMPLEMENTATION_STATUS.md` if that doc tracks consumer-rewire progress.

---

## Verification gate

- [ ] Phase 1 server wraps: ~16 new mocha cases pass; existing 275 passing functions tests stay green.
- [ ] Phase 2 client wraps: ~16 new jest cases pass; existing 18 helper tests stay green; existing 84 cascade/snapshot tests stay green.
- [ ] Phase 3 banner integration on `RecruiterAccountDetails.tsx`: manual smoke — edit each in-scope field, confirm banner appears, dialog renders with correct affected-JO list, push works end-to-end.
- [ ] Phase 5 mirror script (if helper mirrored): `scripts/check-cascade-mirror.sh` clean.
- [ ] Cross-cutting: `tsc --noEmit` clean both projects (modulo the same pre-existing certifications/userActionItems test fixtures unrelated to this slice).
- [ ] R.16.1 staging smoke from the prior runbook still green — R.16.2a deploys must not regress §16.1's snapshot capture, push-to-active dialog, or backfill behavior.

---

## Deploy runbook

R.16.2a is **read-side only** — no new functions to register, no new indexes, no backfill. Deploy sequence shrinks to:

### Step 1 — Functions deploy

Server-side wraps live inside existing functions. **Verified mapping** of wrap files → deployed function names (traced via `index.ts` exports + import graph, Apr 27, 2026):

| Touched file | Wrap target | Deployed function(s) that consume the wrap |
|--------------|-------------|--------------------------------------------|
| `readiness/onAssignmentCreatedAutoSeed.ts` | `eVerifyRequired` | `onAssignmentCreatedAutoSeedReadiness` (note: NOT `onAssignmentCreatedAutoSeed` — the deployed name carries a `Readiness` suffix; `index.ts:318`) |
| `workerAiPrescreen/aiPrescreenJobSlice.ts` (`extractJobSliceFromJobOrder`) | `eVerifyRequired` + `hiringEntityId` | `submitWorkerAiPrescreenInterview` + `getWorkerAiPrescreenInterviewPlan` (both go through `buildAiInterviewContext`, which is the only consumer of the JO extractor) |
| `onboarding/workerOnboardingPipeline.ts` (`resolveEntityContext`) | `hiringEntityId` | `triggerWorkerOnboardingPipeline` + `startOnCallEmployment` + `startOnCallOnboarding` + `respondToAssignment` + `confirmAssignmentForWorker` + `logAssignmentUpdated` (the trigger that dynamic-imports `assignmentConfirmedOnboardingSlice`) |
| `onboarding/loadEntityOnboardingEngineBuildContextAdmin.ts` | `hiringEntityId` (bulk) | `syncEntityEmploymentOnboardingFromWorkerOnboarding` (only consumer, via `entityEmploymentOnboardingSync.ts`) |

Other `workerOnboardingPipeline.ts` callables (`updateWorkerOnboardingStep*`, `updateEntityEmploymentStatus`, `setEntityEmployment*`) operate on existing pipeline docs and don't call `resolveEntityContext` — not in scope.

**Targeted deploy** (10 functions; copy-paste, no spaces inside the comma list):

```bash
firebase deploy --only "functions:onAssignmentCreatedAutoSeedReadiness,functions:submitWorkerAiPrescreenInterview,functions:getWorkerAiPrescreenInterviewPlan,functions:triggerWorkerOnboardingPipeline,functions:startOnCallEmployment,functions:startOnCallOnboarding,functions:respondToAssignment,functions:confirmAssignmentForWorker,functions:logAssignmentUpdated,functions:syncEntityEmploymentOnboardingFromWorkerOnboarding"
```

**Sanity-check** before running, to verify all 10 names exist in the deployed registry (should return exactly 10 matches):

```bash
firebase functions:list 2>&1 | grep -E "(onAssignmentCreatedAutoSeedReadiness|submitWorkerAiPrescreenInterview|getWorkerAiPrescreenInterviewPlan|triggerWorkerOnboardingPipeline|startOnCallEmployment|startOnCallOnboarding|respondToAssignment|confirmAssignmentForWorker|logAssignmentUpdated|syncEntityEmploymentOnboardingFromWorkerOnboarding)"
```

**Safe fallback:** if any name doesn't match (e.g. a future rename) or you'd rather not chase the targeted list:

```bash
firebase deploy --only functions
```

Slower (~5–10 min vs ~2–3 min) but guarantees no missed wraps. R.16.2a is read-side only, so a full functions deploy carries no schema risk.

### Step 2 — Frontend deploy

```bash
npm run deploy:hosting
```

### Step 3 — Manual staging smoke

1. **Pre-§16.1 active JO** — load a JO with no `snapshot.capturedAt`. Confirm: Apply Wizard reads `hiringEntityId` correctly (fallback path); Placements tab reads `hiringEntityId` correctly; onboarding pipeline starts with the right entity.
2. **§16.1-snapshotted JO without push** — load a JO with `snapshot.capturedAt` set, no `lastPushedAt`. Edit the parent Account's `eVerifyRequired`. Save. Confirm: banner appears on `RecruiterAccountDetails.tsx`; the **JO's effective `eVerifyRequired` did not change** (snapshot still wins); onboarding pipeline for an existing assignment under that JO still uses the original snapshotted value.
3. **§16.1-snapshotted JO post-push** — open the dialog, push the new value to the JO. Re-load. Confirm: snapshot now reflects new value; consumers (Apply Wizard, Placements, onboarding) all read the new value.
4. **Draft JO** — confirm draft JO behavior unchanged: edits to parent Account flow through immediately (cascade resolution, no snapshot interception).
5. **Per-position pricing push** — edit a position's `markupPercent` on the Pricing tab. Confirm banner appears for that (positionId, markupPercentage) pair. Push. Confirm `useActiveShifts` and shift drawer display the new value for shifts under that JO+position.

### Step 4 — Cascade audit re-confirm

Pull a sample of `cascadeAuditLog` entries from staging post-push. Confirm:
- Per-JO rows have `pushedField.fieldKey` matching the wrapped field set.
- Summary rows aggregate correctly.
- No `push_to_active` rows for fields outside the locked R.16.2a surface (would indicate UI surfaced a banner for a field the wraps don't yet handle).

This is the gate before greenlighting CORT downstream push (#32).

---

## Deferred to R.16.2b

| Item | Why deferred |
|------|--------------|
| `screeningPackageId` consumer rewire (fold R.11's `pickEffectiveScreeningPackageId` into `getEffectiveJobOrderField`) | Already half-rewired in R.11; consolidation is tidy, not behavior change. Keep R.16.2a's diff focused. |
| `additionalScreenings` consumer rewire | Lower-criticality than financial fields. |
| Per-position `futa` consumer rewire | Tax math; verify all consumers are caught before flipping. |
| Per-position `suta` consumer rewire | Same as `futa`. |
| Per-position `rateMode` consumer rewire | Display-only in most paths; low risk if deferred. |
| Per-position `jobTitle` consumer rewire | Header field; fallback resolution already correct in most paths. |
| Per-position `jobDescription` consumer rewire | Same as `jobTitle`. |
| Banner integration on `AccountLocationDetail.tsx` | Location-level edits don't carry snapshot-policy semantics for the captured envelope. Deferred unless ops workflow requires it. |
| Multi-field collapse banner ("5 fields changed — review affected JOs") | UX polish. R.16.2a renders one banner per dirty (fieldKey, positionId) pair. |
| Override visibility affordance | R.16.3 — "Differs from parent" badge + reset/push/keep menu. |
| Engine-level `propagation` enforcement | R.16.5 — engine-side warning when a consumer reads through cascade for a snapshot-policy field on a non-draft JO without snapshot data. |
| `markupPercent` → `markupPercentage` field rename across live data | Data-shape change with its own backfill story. R.16.2a only changes read paths. |
| `placementsApi.ts` flat-rate (`jobOrder.payRate`) snapshot wrap | Flat default isn't a snapshot-policy field per the registry. Open question — would require a registry entry + migration. |

---

## Open-question resolutions (LOCKED)

| #  | Question                                                                                                     | Resolution                                                                                                                                                                                                                                                                                                                            |
|----|--------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Q1 | Multi-banner cap on `RecruiterAccountDetails.tsx` (stacked vs. collapsed at N>5)                              | **Stacked, no cap.** One banner per dirty (positionId, fieldKey) pair. Push-to-Active is per-field per R.16.1 L9 — collapse creates a multi-field dialog that forces users to mentally map fields → affected JOs. N>5 rare in practice; if it becomes a real problem later, defer collapse logic to a separate ticket.                |
| Q2 | Flat-rate `jobOrder.payRate` / `jobOrder.billRate` read in `placementsApi.ts` — wrap or leave?                | **Leave unwrapped.** Per L5, flat default isn't a registry entry. Don't add one in this slice — keeps the migration narrow. R.16.2b can revisit if production evidence shows the flat reads matter.                                                                                                                                   |
| Q3 | Helper file location — mirror to `shared/jobOrder/` or cross-package import?                                  | **Mirror.** Helper is pure / SDK-agnostic, so byte-identical mirror is safe. Extend `scripts/check-cascade-mirror.sh` to enforce parity from Phase 1 onward. Cross-package imports are explicitly excluded (creates dependency tangles).                                                                                                |
| Q4 | UX-side `securityLevel ≥ 7` banner gate, or always render and let the callable reject?                        | **UX-side gate.** Only render the banner for `securityLevel ≥ 7`. Standard "permission-aware UI" pattern — don't surface affordances users can't act on. Server-side callable still enforces independently. Lower-permission users still see Account-level edits flow to draft JOs correctly via cascade; they just don't see the push path. |
| Q5 | Wraps on non-JO docs (postings, assignments) — apply, or leave alone?                                         | **Leave alone for R.16.2a.** Defer to R.16.2b. Snapshot lives on the JO doc; non-JO docs have their own data lifecycle. R.16.2a stays focused on JO-doc reads to keep the diff narrow and reviewable. R.16.2b's task description must capture the deferred non-JO consumer surface.                                                    |

---

## Greenlight conditions

R.16.2a coding starts when **both** conditions are met:

1. R.16.1 staging smoke confirms — functions deployed, backfill ops sequence clean (dry-run report eyeballed → `--write` run matches dry-run counts → second dry-run confirms idempotency at 0 changes), frontend deployed, manual smoke per `CASCADE_PROPAGATION_R16.1_HANDOFF.md` runbook §3–§5 all five steps green.
2. Brief locks above stand — no late edits to L1–L10 or to the Q1–Q5 resolutions.

Until both are met, the implementation is paused. Status updates land here as the staging smoke progresses.

---

*End of R.16.2a kickoff brief. Decisions LOCKED Apr 27, 2026. Standing by for R.16.1 staging smoke to clear.*

---

## Implementation summary (Apr 27, 2026 — what shipped)

### Phase 5 (front-loaded) — Helper mirror + CI guard

- `src/shared/jobOrder/getEffectiveJobOrderField.ts` — refactored to drop the `JobOrderSnapshot` / `ResolvedPositionSnapshot` type imports (which transitively pulled in `firebase/firestore`'s `FieldValue`) in favour of inline structural fragments (`MinimalSnapshot`, `MinimalPositionSnapshot`). Helper is now pure / SDK-agnostic / type-self-contained, so byte-mirroring is safe.
- `shared/jobOrder/getEffectiveJobOrderField.ts` — new, byte-identical mirror.
- `scripts/check-cascade-mirror.sh` — extended to enforce the new mirror via the existing `mirrored_files` array (now keyed by sub-path under `cascade/` / `jobOrder/`). Runs in CI; `set -euo pipefail` blocks any drift.
- `functions/src/shared/jobOrder/getEffectiveJobOrderField.ts` — visible via the existing `functions/src/shared` symlink → `../../shared`. No additional symlink work needed.

### Phase 1 — Server wraps (4 wraps, 1 documented deferral)

| File | Wrap | Field | Deferred? |
|------|------|-------|-----------|
| `functions/src/readiness/onAssignmentCreatedAutoSeed.ts` | `eVerifyRequired` | top-level | — |
| `functions/src/workerAiPrescreen/aiPrescreenJobSlice.ts` (`extractJobSliceFromJobOrder`) | `eVerifyRequired` + `hiringEntityId` | top-level | sibling `extractJobSliceFromPosting` deferred per Q5 (postings are not JO docs) |
| `functions/src/onboarding/workerOnboardingPipeline.ts` (`resolveEntityContext`) | `hiringEntityId` | top-level | — |
| `functions/src/onboarding/loadEntityOnboardingEngineBuildContextAdmin.ts` (bulk JO load) | `hiringEntityId` | top-level | — |
| `functions/src/index.ts:793` (`generateJobDescription` AI prompt) | `eVerifyRequired` | — | **deferred to R.16.2b** with inline comment — `jobOrderData` is a client-supplied prompt payload, not a fetched JO doc; wrap would be a no-op until either the client sends the JO shape directly or the callable re-fetches the JO server-side |

### Phase 2 — Client wraps (4 wraps, 1 documented deferral)

| File | Wrap | Field |
|------|------|-------|
| `src/components/JobOrderForm.tsx` (`hiringEntityIdForForm`) | `hiringEntityId` | top-level (write-side payload composition on line 2194 untouched per L1 — R.16.2a is read-side only) |
| `src/components/recruiter/PlacementsTab.tsx` (entity-employment loader) | `hiringEntityId` | top-level (placement-level pin still wins absolutely; snapshot interjects between pin and live JO read) |
| `src/components/apply/Wizard.tsx` (two read sites) | `hiringEntityId` | top-level (public apply flow + entity-name resolution for C1-Events skip path) |
| `src/hooks/useActiveShifts.ts` (`readJoFinancials`) | `payRate`, `billRate`, `markupPercentage`, `workersCompRate` | per-position (L5 split — flat top-level reads stay unwrapped) |
| `src/components/shifts/ShiftPlacementsDrawer.tsx:618` | — | **deferred** with inline comment — display reads `shift.markupPercent` from a `ShiftRow`; no JO doc in scope. Upstream `useActiveShifts` wrap already enforces snapshot precedence |

### Phase 3 — Banner integration on `RecruiterAccountDetails.tsx`

- Top-level `hiringEntityId` banner — wired in `updateAccountField`. Diff against `lastSavedHiringEntityIdRef`. Banner stack rendered above the Hiring Entity FormControl (line ~4900).
- Per-position pricing banners — wired in `savePricing`. Diff each row's `payRate` / `billRate` / `markupPercent` / `workersCompRate` / `workersCompCode` against `lastSavedPricingPositionsRef` (a `Map<positionId, snapshot>`). Banner stack rendered inside the Pricing tab card, above the worksite-state controls + table. One banner per dirty `(positionId, fieldKey)` pair (Q1 lock — stacked, no cap).
- Banner gate — `securityLevel === '7'` only (Q4 lock); lower-permission users still get cascade-to-draft semantics from the save itself, just no push affordance.
- Documented deferrals (with inline comments):
  - **`eVerifyRequired`** banner — the UI on this page renders e-verify as read-only display ("Set by Hiring Entity… Cannot be changed on the account."); `defaultEVerify` state is hydration-only with no editable surface. Defer banner until R.16.2b adds an actual edit point.
  - **Top-level `workersCompCode`** banner — no top-level edit surface on this page (only per-position rows in the Pricing tab). Per-position `workersCompCode` IS covered by the Phase 3 banners above.

### Phase 4 — Tests (38 new cases / 53 total verified)

- `functions/src/__tests__/readiness/onAssignmentCreatedAutoSeed.eVerifyWrap.test.ts` — 4 cases.
- `functions/src/__tests__/workerAiPrescreen/aiPrescreenJobSlice.snapshotWrap.test.ts` — 9 cases.
- `functions/src/__tests__/onboarding/workerOnboardingPipeline.hiringEntityWrap.test.ts` — 4 cases.
- `functions/src/__tests__/onboarding/loadEntityOnboardingEngineBuildContextAdmin.hiringEntityWrap.test.ts` — 4 cases.
- `src/utils/__tests__/r16_2a_clientWraps.test.ts` — 17 jest cases covering all 4 client wraps + the L5 per-position split.
- R.16.1 helper jest suite (18 cases) — re-run, all green (no regression from the helper refactor in Phase 5).

### Files changed (10 source + 5 test + 1 doc + 1 mirror + 1 script + 1 new mirrored helper = 19 files)

Source:
- `src/shared/jobOrder/getEffectiveJobOrderField.ts` (Phase 5 refactor)
- `functions/src/readiness/onAssignmentCreatedAutoSeed.ts` (Phase 1)
- `functions/src/workerAiPrescreen/aiPrescreenJobSlice.ts` (Phase 1)
- `functions/src/onboarding/workerOnboardingPipeline.ts` (Phase 1)
- `functions/src/onboarding/loadEntityOnboardingEngineBuildContextAdmin.ts` (Phase 1)
- `functions/src/index.ts` (Phase 1 deferral comment)
- `src/components/JobOrderForm.tsx` (Phase 2)
- `src/components/recruiter/PlacementsTab.tsx` (Phase 2)
- `src/components/apply/Wizard.tsx` (Phase 2)
- `src/hooks/useActiveShifts.ts` (Phase 2)
- `src/components/shifts/ShiftPlacementsDrawer.tsx` (Phase 2 deferral comment)
- `src/pages/RecruiterAccountDetails.tsx` (Phase 3)

Tests: as listed above.

CI:
- `scripts/check-cascade-mirror.sh` — extended.
- `shared/jobOrder/getEffectiveJobOrderField.ts` — new mirror.

Doc:
- `docs/CASCADE_R16.2a_HANDOFF.md` — this file.

### Operational sequence after merge

1. **Functions deploy** — targeted command in §"Step 1" above.
2. **Frontend deploy** — `npm run deploy:hosting`.
3. **Manual staging smoke** — five steps in §"Step 3" of the runbook above (pre-§16.1 JO read, §16.1 snapshotted JO without push, §16.1 snapshotted JO post-push, draft JO control, per-position pricing push). Use the same CORT National Account that R.16.1.1 was smoke-tested on.
4. **`cascadeAuditLog` re-confirm** — pull a sample of post-push entries; verify `pushedField.fieldKey` lands inside the locked R.16.2a surface.
5. **Greenlight CORT downstream push (#32)** — once the smoke is green, R.16.2a's verification gate is met and CORT push can run with confidence that consumers actually read the snapshotted values.

R.16.2b kicks off after CORT push bakes — covers `screeningPackageId` consolidation (R.11 fold-in), `additionalScreenings`, the remaining per-position fields (`futa`/`suta`/`rateMode`/`jobTitle`/`jobDescription`), banner integration on `AccountLocationDetail.tsx`, the deferred `index.ts:793` AI-prompt wrap, the deferred posting extractor wrap, and the `markupPercent`→`markupPercentage` live-data rename (separate backfill story).

