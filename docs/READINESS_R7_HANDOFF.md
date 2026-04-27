# Readiness Rebuild — R.7 (Worker View — Header Chip + Readiness Tab Drill-In) Handoff Spec

**Status:** R.7 implemented (PR 4, in review).
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`, `READINESS_R4_HANDOFF.md`.
**Successors:** R.5 (E-Verify TNC contestation flow + UI), R.6 (AccuSource adjudication CSA matrix UI), R.3 (generalize CSA action endpoints), R.8 (CSA cross-worker readiness matrix UI — the inline-chip surface).

---

## TL;DR

R.7 closes the chip → drill-in → detail loop end-to-end:

- **Header chip (lg).** The Worker Profile Readiness tab now renders the same `JobReadinessChip` component the placement tile uses (R.4), in `size="lg"`, in the selected-assignment header. Per-shift only — entity-scope rows keep the legacy 4-state badge as a fallback since the chip is per-shift by design.
- **Live data via Firestore listener.** Each visible assignment opens a `onSnapshot` subscription on `tenants/{tid}/assignments/{aid}` and reads `readinessSnapshotV1.jobReadinessChip` off the doc. The R.4 snapshot writer (`syncHrxReadinessSnapshotV1`, debounced-invoked on `selectedId` change) populates the chip; the listener picks up the writeback so the chip transitions from `'computing'` → real state without a manual refresh.
- **Drill-in URL params honoured.** `?tab=readiness&assignmentId=&itemId=&type=&source=` (the URL R.4's PlacementsTab popover writes) is now consumed end-to-end:
  1. Outer `UserProfile/index.tsx` selects the Readiness tab on `tab=readiness`.
  2. `ProfileReadinessTabContent` auto-selects `assignmentId` (when it matches a loaded assignment), scrolls to + flash-highlights the rows matching `type` (`requirementType` → `req.key` predicate map), and strips the four readiness-specific keys from the URL once handled.
- **In-tab popover-row clicks reuse the same machinery** — clicking a contributor in the lg chip's popover sets the same highlight state, so the user sees the matching row light up without leaving the tab.

| ID | Task | Touches |
|---|---|---|
| R.7 | lg header chip + per-assignment chip-data listener + deep-link URL handler + row highlight + scroll + per-shift / entity-scope split | `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx`, `src/pages/UserProfile/index.tsx`, `src/components/recruiter/PlacementsTab.tsx` (handler signature includes `assignmentId`) |

No schema changes, no Cloud Functions changes, no new tests required (the helper is unchanged). All movement is presentation + state-machine wiring.

---

## Decisions (locked from this PR's greenlight)

### D1.R7 — Header chip replaces (does not duplicate) the legacy `<Chip>` on real-assignment rows — LOCKED

The selected-assignment header used to render an MUI `<Chip>` showing the legacy 4-state aggregate (`READY` / `READY_WITH_WARNINGS` / `BLOCKED` / `PENDING_INITIALIZATION`). On per-shift assignment rows that chip is now replaced by the new `JobReadinessChip` (`lg` variant). The legacy chip remains the fallback when:

- the worker has zero assignments (entity-scope mode), or
- the synthetic `ENTITY_ONBOARDING_ASSIGNMENT_ID` row is selected.

Why: the JobReadinessChip is per-shift by design (`assignmentReadinessItems` are seeded per-(worker × shift)). Entity-scope rows don't have a per-shift snapshot, so the existing legacy aggregate stays the primary signal there.

**Coexistence:** the per-row sidebar chip on the assignments list (`<Chip label={readinessBadgeLabel(rowState)} ...>`) is **kept** in R.7 — it shows the legacy state as a quick density indicator, and the matrix surface (R.8) is the place where the new inline JobReadinessChip per row becomes the right visual. R.7 doesn't reach into the sidebar.

### D2.R7 — Chip data sourced from `readinessSnapshotV1.jobReadinessChip`, NOT recomputed in-tab — LOCKED

`ProfileReadinessTabContent` already recomputes the legacy 4-state aggregate in-memory via `buildReadinessForAssignmentRow` → `buildAssignmentReadiness`. We deliberately do NOT pipe `assignmentReadinessItems` / `employeeReadinessItems` through that recompute path — instead we read the persisted chip off the snapshot doc.

**Why:**

1. **Single source of truth.** PlacementsTab + Flutter + this tab all read the same persisted field, so they can't disagree.
2. **No redundant Firestore reads.** The R.4 loader (`hrxReadinessSnapshotLoadContext.ts`) already fans out the cross-collection queries when the snapshot writer recomputes; doing the same fan-out client-side would double the read cost on every tab open.
3. **`syncHrxReadinessSnapshotV1` debounce already runs.** This tab triggers the writer 600ms after `selectedId` change. The snapshot listener picks up the writeback automatically.
4. **Failure modes are honest.** When the chip field is absent (older snapshot, write hasn't landed) the chip renders `'computing'` — exactly what the R.4 component was designed for. A client-side recompute path would silently mask the absence.

### D3.R7 — Live `onSnapshot` listener per visible assignment — LOCKED

```ts
useEffect(() => {
  if (!tenantId || assignments.length === 0) {
    setChipDataByAssignmentId(new Map());
    return;
  }
  const unsubs: Array<() => void> = [];
  for (const a of assignments) {
    const ref = doc(db, p.assignments(tenantId), a.id);
    const unsub = onSnapshot(ref, (snap) => {
      const v = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      const snapshotV1 = (v?.readinessSnapshotV1 ?? null) as ReadinessSnapshotV1Firestore | null;
      const chip = snapshotV1?.jobReadinessChip ?? null;
      setChipDataByAssignmentId((prev) => {
        const next = new Map(prev);
        next.set(a.id, chip);
        return next;
      });
    });
    unsubs.push(unsub);
  }
  return () => { for (const u of unsubs) u(); };
}, [tenantId, assignments]);
```

**Cardinality:** single worker × single tenant = usually ≤10 listeners. Acceptable. If we ever scale this up (e.g. recruiter dashboard with N workers × M assignments) the right move is `getDoc` batches + a manual refresh trigger, not subscriptions.

**Behaviour:** on each writeback the chip transitions seamlessly. We never fall back to a stale chip because we always read straight from the snapshot doc.

### D4.R7 — URL deep-link contract — LOCKED

The R.4 placement-chip popover writes:

```
/users/{workerUid}?tab=readiness&assignmentId={aid}&itemId={iid}&type={requirementType}&source={assignment|employee}
```

R.7 splits the consumption across two layers:

- **Outer (`UserProfile/index.tsx`):** consumes only `tab` (and only when `tab === 'readiness'`); selects the Readiness tab via `setTabValue('Readiness')`; strips the `tab` key from the URL via `replace: true`. The four readiness-specific keys are LEFT on the URL for the inner consumer.
- **Inner (`ProfileReadinessTabContent`):** consumes `assignmentId` / `itemId` / `type` / `source`:
  - `assignmentId` — auto-selects the matching assignment if loaded; no-ops if not loaded.
  - `type` — drives the row highlight + scroll-into-view (see D5.R7).
  - `itemId` — stashed for diagnostics + a future exact-match upgrade (currently the `ReadinessRequirement.key` synthesis doesn't carry the underlying readiness-item Firestore id, so by-itemId match isn't yet possible; by-type match is the current contract).
  - `source` — informational; the popover side already surfaces it. Not consumed beyond URL strip.
  - All four keys are stripped from the URL via `setSearchParams(next, { replace: true })` once handled, gated on a `handledDeepLinkRef` so a refresh doesn't re-flash the highlight.

**`handledDeepLinkRef` rationale:** the alternative is to tie the strip to the highlight expiry timer, but that creates a window where a refresh would re-trigger the highlight forever. The ref-based one-shot is simpler and matches the pattern already used in `UserProfile/index.tsx` for `employmentI9SectionFlash` / `backgroundComplianceHighlightId`.

### D5.R7 — Row highlight via `requirementType → req.key` predicate map — LOCKED

The chip carries `requirementType` (a string like `'background_check'` / `'cert_match'` / `'license_match'` / `'e_verify'` / etc.); the in-memory readiness rows on this tab use synthetic keys like `'background_check'` / `'work_authorization'` / `'cert_<docId>'`. They don't line up 1:1, so we map by-type using a small predicate table:

| `requirementType` | Highlights `req.key` matching |
|---|---|
| `'background_check'` / `'screening_package_match'` | `'background_check'` |
| `'drug_screen'` | `'drug_screen'` |
| `'e_verify'` | `'work_authorization'` OR `'i9'` OR `'i9_*'` (E-Verify surfaces as work-auth / I-9 on this tab) |
| `'cert_match'` / `'required_certification'` | any `'cert_*'` |
| `'license_match'` | any `'license_*'` |
| willingness types / skill / education / orientation / safety_briefing / shift_confirmation / ppe_acknowledgement / custom | (no row highlight — the chip popover remains useful but no row is currently surfaced for these types on this tab) |

**Highlight rendering:**

- Each `ReadinessRequirementRow` carries a stable element id `id="readiness-requirement-row-${req.key}"`.
- When `highlightRequirementType` is set, the matching rows render with a `warning.lighter` background + 2px `warning.main` outline, and a 0.5s CSS transition so the flash isn't jarring.
- The first matching row is `scrollIntoView({ behavior: 'smooth', block: 'center' })` 220ms after the highlight fires (gives React time to paint).
- Highlight clears after 3500ms.

**Future upgrade:** when this tab starts reading raw readiness items (deferred — see "Deferred to follow-up" below), `itemId` can become the exact-match key and the predicate table drops out.

### D6.R7 — In-tab popover click reuses the highlight machinery — LOCKED

```ts
const handleHeaderChipItemClick = useCallback((c: JobReadinessChipContributor) => {
  setHighlightRequirementType(c.requirementType);
  setHighlightItemId(c.itemId);
}, []);
```

The same `useEffect` that handles URL-deep-link highlights also handles in-tab clicks — there's only one piece of state, one scroll path, one timer. Keeps mental model tight.

### D7.R7 — `assignmentId` carried on the chip drill-in callback — LOCKED

Originally the R.4 callback was `(workerUid, contributor) => void`. R.7 extends it to `(workerUid, assignmentId | null, contributor) => void` so PlacementsTab can thread the per-tile assignment context onto the URL without a Firestore lookup. `assignmentId` is the parent-context — it's not on the contributor itself (a contributor is one item; one assignment owns multiple items). Purely additive on the call site.

---

## Files changed

### Inner tab (primary)

- `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx`
  - New imports: `useRef`, `useSearchParams`, `onSnapshot`; `JobReadinessChip` component; `JobReadinessChipData` / `JobReadinessChipContributor` types; `ReadinessSnapshotV1Firestore` type.
  - `ReadinessRequirementRow` accepts a new `highlighted?: boolean` prop, renders a stable element id, applies the flash style.
  - New helper `highlightedKeysForRequirementType` (D5.R7).
  - New state — `chipDataByAssignmentId`, `highlightRequirementType`, `highlightItemId`, `handledDeepLinkRef`.
  - New effect — per-assignment `onSnapshot` listener (D3.R7).
  - New effect — URL-param consumption (D4.R7).
  - New effect — highlight expiry + scroll-into-view (D5.R7).
  - New `headerChipData` / `showHeaderChip` memo + `handleHeaderChipItemClick` callback.
  - New `isRequirementHighlighted` callback feeding all `renderRequirementRows` calls.
  - Header `<Chip>` is now conditional: `<JobReadinessChip size="lg" />` on per-shift rows, legacy `<Chip>` on entity-scope rows (D1.R7).

### Outer profile shell

- `src/pages/UserProfile/index.tsx` — new `useEffect` that consumes `?tab=readiness` and selects the `'Readiness'` tab via `setTabValue` (mirrors the existing `?tab=employment` handler). Strips only `tab` from the URL; the readiness-specific keys are left for the inner consumer.

### Originating surface

- `src/components/recruiter/PlacementsTab.tsx`
  - `PlacementWorkerTileMainColumn.onJobReadinessItemClick` signature now `(workerUid, assignmentId, contributor)` (D7.R7).
  - `handlePlacementJobReadinessItemClick` writes `assignmentId` onto the URL when known.
  - Both call sites unchanged (the chip's onClick adapter passes `worker.assignmentId` through).

---

## Verification

```bash
# tsc — both projects clean.
( cd functions && npx tsc --noEmit )
npx tsc --noEmit   # pre-existing, unrelated errors in certifications + userActionItems test files

# Helper + bridge tests (jest).
npx craco test --watchAll=false --testPathPattern='(computeJobReadinessChip|buildAssignmentReadiness|readinessSnapshotV1|seedAssignmentReadinessItems)'
# → 5 suites, 70 tests passing
```

### Verification gate

- [x] `tsc` clean on both projects (no NEW errors; pre-existing certifications/userActionItems test-file errors remain — unrelated).
- [x] R.4 jest suites still green (no regression to chip helper / bridge / seeder).
- [x] `ReadinessRequirementRow` renders without warnings when `highlighted` is omitted (default `false` preserves the legacy spacing — only the wrapper `Stack` gained slightly larger `py` to accommodate the outline; visually a wash).
- [x] `useSearchParams` import path matches existing react-router-dom usage (`UserProfile/index.tsx` already imports it).
- [x] `onSnapshot` listener cleans up correctly on `assignments` change / unmount (return-array pattern, same as elsewhere in the file).
- [x] `handledDeepLinkRef` ensures a refresh doesn't re-trigger highlight + scroll (one-shot per mount).

### Manual walkthrough (mental sim)

1. Recruiter opens placement tile, sees yellow chip "Job Ready (2 pending)".
2. Hovers the chip → popover lists 2 yellow contributors (e.g. `physical_willingness`, `cert_match`).
3. Clicks `cert_match` row → opens new tab `/users/{uid}?tab=readiness&assignmentId=A1&itemId=I1&type=cert_match&source=assignment`.
4. Worker profile loads → `index.tsx` sees `tab=readiness`, selects the Readiness tab, strips only `tab`.
5. `ProfileReadinessTabContent` mounts → finishes initial `load`, sees the four URL keys, auto-selects assignment `A1`, sets `highlightRequirementType='cert_match'`, strips the four keys from the URL.
6. Render: header shows lg `JobReadinessChip` for `A1` (`'computing'` momentarily until snapshot listener fires), then transitions to the real chip state.
7. Highlight effect: scrolls to the first `cert_*` requirement row, applies the warning outline + lighter background.
8. After 3.5s: highlight clears; row returns to normal.
9. User clicks another row in the chip's popover (in-tab) → highlight machinery fires again, scrolls + flashes.

---

## Deferred to follow-up

These are not blocking R.7 and are not on the "what to look for" list — captured here so the next pass picks them up cleanly.

1. **Per-row resolutionMethod / evidence / audit-trail surfacing.** The chip popover already exposes `resolutionMethod` / `severity` / `status` / `detail` per contributor (R.4 D7). Surfacing the same on the per-row list would require reading the raw `assignmentReadinessItems` + `employeeReadinessItems` collections into the tab and rendering a side-panel or expanding row. The current row format ("Cert Name (Missing)") is action-oriented; the popover is the inspection surface. A natural place for this enhancement is when R.5 (E-Verify TNC contestation UI) adds its own per-row drawer for E-Verify items.
2. **Exact-`itemId` match for row highlight.** Today the row keys are synthesized by `buildAssignmentReadiness` (e.g. `'cert_<docId>'` from `WorkerComplianceItem.id`, NOT from `AssignmentReadinessItem.id`). Once the tab reads raw items (item 1 above) the predicate table in `highlightedKeysForRequirementType` collapses to `(key) => key === itemId`.
3. **Sidebar inline chip per assignment row.** R.7 keeps the legacy 4-state `<Chip>` per assignment in the sidebar list. R.8 (CSA matrix) introduces the inline JobReadinessChip variant; the sidebar swap is a natural follow-along once R.8 lands and proves the inline variant in production.
4. **`useWorkerReadinessV1` hook integration.** This hook (`src/hooks/useWorkerReadinessV1.ts`) is currently used elsewhere; it could become the canonical access point for `readinessSnapshotV1.jobReadinessChip` to centralise the read pattern. Not blocking — the inline `onSnapshot` is fine for one tab.

---

## Successor cross-refs

- **R.5** — E-Verify TNC contestation flow + UI: per-row inspection drawer is a natural place to also surface `resolutionMethod` / `severity` / audit history (item 1 above). **Status: shipped — see `READINESS_R5_HANDOFF.md`.** R.5 added `JobReadinessChipContributor.caseId` (consumed by `PlacementsTab.handlePlacementJobReadinessItemClick`) and the `?caseId=…` URL param (consumed by `ProfileReadinessTabContent` to auto-open the new `EverifyCaseDrawer`).
- **R.6** — AccuSource adjudication CSA matrix UI: completes the BG side of the same surface.
- **R.3** — Generalize CSA action endpoints (confirm / waive / markFailed): once these exist, the chip popover + the per-row drawer can offer inline CSA actions where the recruiter has scope.
- **R.8** — CSA cross-worker readiness matrix UI: uses `<JobReadinessChip size="inline" />` per cell; reuses the same `readinessSnapshotV1.jobReadinessChip` field; benefits from R.3 endpoints.
- **R.9** — Worker profile-edit UI in Flutter: worker-side counterpart for re-attesting; the auto-resolution side of R.3.

---

## Post-deploy chip-stuck investigation (2026-04-27)

**Context.** Greg reported placement tiles stuck on `"Job Ready (computing…)"` for assignments created before R.4 shipped (specifically Al Gaymon / Wazir Zaimah on a CORT JO). Two hypothesised causes were filed in the bug report:

1. **Stale snapshot docs** — `readinessSnapshotV1.jobReadinessChip` field absent on docs that haven't been rewritten since R.4 shipped. `syncHrxReadinessSnapshotV1` only fires on change to its inputs, so untouched assignments never get the new field.
2. **Pre-R.1 readiness items missing `severity` / `resolutionMethod`** — the R.1 backfill callable was deployed but never run with `--no-dry-run` in production.

Investigation confirmed both, plus uncovered a third (legacy assignments that never had readiness items created at all). The chip-stuck repro case (Al Gaymon CORT JO 506570) is **fixed** end-to-end. This section captures what was learned so future `readinessSnapshotV1` field additions don't repeat the loop.

### Runbook for future `readinessSnapshotV1` field additions

This is the single most important takeaway. Any future schema-level addition to `readinessSnapshotV1` (a new field on the snapshot doc, a new sub-shape on `jobReadinessChip`, etc.) MUST follow this order. Skipping a step or running them out of order is what produced the stuck-on-`'computing'` window for ~3 weeks after R.4 shipped.

**Step 1 — Deploy the Cloud Functions bundle FIRST.**

```bash
firebase deploy --only functions:syncHrxReadinessSnapshotV1,functions:onAssignmentReadinessItemWrite,functions:onEmployeeReadinessItemWrite,functions:onAssignmentCreatedAutoSeedReadiness
```

The deployed trigger and any backfill / refresh script MUST share the same snapshot shape. If you backfill before the deploy, a subsequent assignment write fires the **stale** trigger and overwrites the freshly-backfilled snapshot with the pre-migration shape — silent data regression.

**Step 2 — Verify the deploy is live.**

```bash
gcloud functions describe syncHrxReadinessSnapshotV1 \
  --region=us-central1 --gen2 \
  --format='value(updateTime)'
# → ISO timestamp must be AFTER your local merge time.
```

`firebase deploy` exits 0 on partial / cached deploys. Treat the gcloud `updateTime` as ground truth, not the CLI's "Deploy complete" line.

**Step 3 — Run any item-shape backfills (R.1-style, dry-run first).**

These complete the **inputs** the snapshot writer reads. Skipping this leaves the writer aggregating over data that's missing classification fields, so the chip lands in a degraded state even after refresh.

```bash
node scripts/backfillAssignmentReadinessItems.js --tenant=<tid>            # dry-run
node scripts/backfillAssignmentReadinessItems.js --tenant=<tid> --no-dry-run
```

**Step 4 — Run the snapshot-refresh script (dry-run first).**

This script (see "Established pattern" below) re-invokes the deployed recompute over assignments whose snapshot is stale or missing the new field. It is internally idempotent — a second pass against an up-to-date tenant should report `written=0`.

```bash
node scripts/refreshAssignmentReadinessSnapshotV1.js --tenant=<tid>           # dry-run
node scripts/refreshAssignmentReadinessSnapshotV1.js --tenant=<tid> --no-dry-run
node scripts/refreshAssignmentReadinessSnapshotV1.js --tenant=<tid> --no-dry-run  # idempotency check
```

**Step 5 — Smoke-test one repro case.**

Pick an assignment that originally exhibited the user-visible symptom (the placement tile) and confirm the chip lands on a real state, not `'computing'`. The smoke test is the only end-to-end signal that catches semantic regressions the script's own classification can't see.

### Established pattern: `scripts/refreshAssignmentReadinessSnapshotV1.js`

This script is the canonical pattern for any future field migration on `readinessSnapshotV1`. Future additions should be modelled on it directly rather than reinventing the structure.

**What it does:**

- Pages over `tenants/{tid}/assignments` (snapshot subset only — doesn't read items directly; the recompute does that).
- Pre-classifies each assignment as `missing_snapshot` / `missing_chip` / `chip_computing` / `current` and skips already-current docs by default. `--force` overrides for full re-runs.
- Invokes the SAME `recomputeHrxReadinessSnapshotForAssignment` function the deployed trigger uses, loaded via the local esbuild bundle at `functions/lib/readiness/syncHrxReadinessSnapshotV1.cjs`. Single source of truth — script and trigger always write the same shape.
- Internal idempotency: `recomputeHrxReadinessSnapshotForAssignment` JSON-equality-checks the existing snapshot and skips writes when unchanged (this is what `recompute_no_change` reports in the output).

**Critical gotcha — dual `firebase-admin` trees.** The repo ships TWO copies of `firebase-admin`:

- Repo root `node_modules/firebase-admin` — major 13.x.
- `functions/node_modules/firebase-admin` — major 11.x.

The esbuild bundle was built with `--external:firebase-admin`, so at runtime it resolves `require('firebase-admin')` from `functions/node_modules`. If an ops script naively does `require('firebase-admin')` from the repo root, it gets the 13.x copy, the bundle gets the 11.x copy, and any SDK sentinel created by the bundle (e.g. `FieldValue.serverTimestamp()`) is rejected by the script's Firestore client as a foreign-prototype `ServerTimestampTransform`. The error message is opaque ("Couldn't serialize object of type ServerTimestampTransform"), so this bites silently.

**Fix (already in the script header at `scripts/refreshAssignmentReadinessSnapshotV1.js` lines 110–129):** force both paths through the SAME `firebase-admin` instance the bundle loads.

```js
const path = require('path');
const admin = require(
  path.resolve(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'),
);
```

Any future script that imports a function-bundle export MUST do this. Don't `require('firebase-admin')` directly. The script's header documents the rationale; preserve it verbatim when copying as a template.

### Three follow-ups filed (none blocking R.8)

- **R.4.1 — recompute idempotency on chip-bearing snapshots.** `tryParseComparable` round-trip appears to diverge on empty-contributor chips, causing the recompute to write a byte-equivalent snapshot back instead of skipping. Symptom: `recompute_no_change=0` on idempotency re-runs of the refresh script for assignments where the chip is `'computing'`. Wasted Firestore writes; no data corruption (`errors=0` always). Likely culprits in priority order: (a) `tryParseComparable` rejects what `buildReadinessSnapshotV1Comparable` produces fresh, (b) key insertion order differs between Firestore-read and fresh-build, (c) some non-deterministic field in the chip / summary. **Priority: low.** Tracked because each manual `--no-dry-run` re-run on a clean tenant burns ~40 wasted writes.

- **R.4.2 — legacy assignment readiness coverage gap.** 29 active (confirmed / proposed / pending) assignments in `BCiP2bQ9CgVOCTfV6MhD` are pre-R.1 era: they have `readinessSeededAt: null`, `hiringEntityId: null`, and zero readiness items. The R.1 seeder shipped after these assignments existed, AND assignment-create back then didn't write `hiringEntityId`, so even retroactive seeding requires a two-stage backfill: (a) resolve and stamp `hiringEntityId` from the JO/account cascade, (b) run the seeder. The chip correctly emits `'computing'` for these — `computeJobReadinessChip` returns `'computing'` when there are zero contributors AND `readinessSeeded` is false, which is exactly the state of these assignments. **Priority: medium.** Only this fully resolves the user-visible "spinner forever" symptom for legacy-era confirmed placements; the Al Gaymon CORT JO repro case happens to land on the `current` bucket (it had a single I-9 employee item), which is why the chip-stuck investigation closed without needing R.4.2 first. Bucketing analysis is in `.scratch/bucketR8ComputingChip.js`.

- **R.4.3 — defensive chip UX for legacy-era `'computing'`.** Even after R.4.1 + R.4.2 ship, future legacy data could re-introduce the same shape. Add a defensive branch to `JobReadinessChip` (and `computeJobReadinessChip`) so when an assignment is `createdAt < <R.1 deploy date>` AND the chip would otherwise be `'computing'`, render a distinct "Legacy — needs review" state instead of the indefinite spinner. Surfaces the data gap as a finite, actionable state. **Priority: low–medium.** Cheap insurance against a class of bug recurring without reusing the same investigation loop.

### Longer-term concern: dual `firebase-admin` major versions in the repo

The root tree pins `firebase-admin@13.x` (used by build / deploy / scripts) and `functions/` pins `firebase-admin@11.x` (used by the deployed function bundle and any ops script that loads function exports). They co-exist today only because:

- `functions/` has its own `node_modules` that the function bundle is wired to via `--external:firebase-admin`.
- Ops scripts that interoperate with function exports explicitly require from `functions/node_modules` (per the gotcha above).

Bumping `functions/` to 13.x is a real upgrade PR with non-trivial regression scope (the SDK changed `Timestamp` semantics, `FieldValue.serverTimestamp()` behaviour at write-merge boundaries, and BulkWriter error retry shape across this major). Don't do it as a side-effect of another change. **Track here as a known split, not active work.** When someone proposes "let's just bump it", point them at this section so they understand the regression surface before opening the PR.

The pragmatic test for whether this matters: as long as ops scripts always import via `require(path.resolve(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))` and the `firebase-functions` peer pin in `functions/package.json` is compatible, the split is invisible to production. The cost is one extra line of boilerplate at the top of every ops script that touches function bundles.
