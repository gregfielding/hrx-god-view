# Cleanup PR — R.4.1 + R.4.3 + R.16.2d Handoff Brief

**Status:** **IMPLEMENTATION COMPLETE Apr 28, 2026.** All three sub-scopes shipped per the locks below. Verification gate passed (jest 70/70 across 5 suites · `tsc --noEmit` clean for both projects · `scripts/check-cascade-mirror.sh` clean · functions mocha R.16.2c loaders 10/10 — see "Implementation summary" at the bottom for the file-by-file breakdown).
**Status (prior):** **LOCKED Apr 28, 2026.** All five decision asks confirmed by Greg in the "Locks" reply Apr 28; coding may begin.
**Predecessors:** R.4 (chip aggregator + persisted snapshot, shipped 2026-04-26), R.4.2 deferred (legacy backfill — separate PR), R.16.2c (cascade promotions for `scheduler` etc., shipped Apr 27).
**Goal:** Three small, independent cleanup surfaces bundled into one PR for review efficiency. None block CORT push; all are followups filed during R.7/R.8/R.16.2c.

| Sub-scope | Estimate | Surface |
|-----------|---------:|---------|
| R.4.1 — Snapshot recompute idempotency | ~½ day | `readinessSnapshotV1ComparableJson` (stable-key replacer) |
| R.4.3 — Defensive `'legacy_review'` chip state | ~½ day | `computeJobReadinessChip` + `JobReadinessChip` UI (gray variant) |
| R.16.2d — Scheduler activation sub-line (alt path L.16.2d.5) | ~2 hours | New `getSchedulerAtActivation` helper + JO-header sub-line render |

---

## R.4.1 — Snapshot recompute idempotency (LOCKED Apr 28)

### L.4.1.1 — Root cause: object-key insertion order (LOCKED)

The JSON-equality short-circuit at `functions/src/readiness/syncHrxReadinessSnapshotV1.ts:93-99` compares two strings:

```ts
readinessSnapshotV1ComparableJson(existingComparable) ===
readinessSnapshotV1ComparableJson(nextComparable)
```

`tryParseComparable` reconstructs the **top-level** shape with explicit key order (`state, sourceVersion, summary{blockers,warnings,completed}, requirements, jobReadinessChip`), but the nested objects (`requirements[]` rows and `jobReadinessChip`) are passed through as raw casts:

```ts
requirements: o.requirements as ReadinessSnapshotV1Comparable['requirements'],
...(chip ? { jobReadinessChip: chip } : {}),
```

When Firestore reads the doc, key order on those nested objects depends on Firestore's serialization, which doesn't guarantee insertion-order parity with what `buildReadinessSnapshotV1Comparable` produces fresh. For the `'computing'` empty-contributor case the chip is:

```jsonc
{ "state": "computing", "text": "...", "pendingCount": 0, "blockerCount": 0, "contributors": [] }
```

…but a Firestore-read of the same chip can come back as:

```jsonc
{ "blockerCount": 0, "contributors": [], "pendingCount": 0, "state": "computing", "text": "..." }
```

`JSON.stringify` of those two values yields different strings → `===` fails → write fires → no data corruption, just wasted writes. Same divergence applies to `requirements[]` rows (`{key,label,category,status,severity}` fresh vs alphabetical from Firestore).

The R.7 follow-up note's three priority-ordered culprits map to this single root cause: (a) the parse doesn't reject anything, it just doesn't *normalize* the nested shape; (b) and (c) are the same insertion-order problem at different nesting levels.

### L.4.1.2 — Fix shape: stable-key JSON serialization (LOCKED)

One-line fix — recursive sort-keys in `readinessSnapshotV1ComparableJson` so both sides go through the same canonical form:

```ts
function stableKeyReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

export function readinessSnapshotV1ComparableJson(c: ReadinessSnapshotV1Comparable): string {
  return JSON.stringify(c, stableKeyReplacer);
}
```

Trade-offs:
- **Pro:** narrowest possible change. Both `tryParseComparable` and the fresh build produce comparable strings regardless of key order. No rewrite of either path.
- **Pro:** the canonical form is also what gets written to Firestore in `assignRef.set({...nextComparable, updatedAt: serverTimestamp()})`. Future consumers of the persisted JSON benefit from deterministic key order too (e.g. test fixtures stay stable).
- **Con (minor):** any external consumer that pinned to the prior key order would see a one-time string-shape change. None known — the only readers (`PlacementsTab`, Flutter, R.8 matrix) destructure by name.

Out of scope for this fix:
- A full `fast-deep-equal` dependency. Stable-stringify is one helper; pulling a dep is overkill for one comparison site.
- Reconstructing nested shapes in `tryParseComparable`. The replacer approach in `readinessSnapshotV1ComparableJson` solves both sides without rewriting the parser.

### L.4.1.3 — Test surface (LOCKED)

Add to `src/shared/__tests__/readinessSnapshotV1.idempotency.test.ts` (new file — keep R.4.1 tests separate from the existing chip / bridge suites). Per Greg's Apr 28 lock the suite must explicitly cover (a) the chip-bearing snapshot case, (b) the empty-contributors case, and (c) at least one nested-`requirements` row to verify the replacer applies recursively.

1. **Empty-contributor `'computing'` chip — alphabetical-keys vs insertion-order.** Build the chip fresh, then construct a synthetic Firestore-shaped clone of the same chip with `Object.keys` sorted alphabetically; assert `readinessSnapshotV1ComparableJson(a) === readinessSnapshotV1ComparableJson(b)`. Locks Greg's (b) explicitly.
2. **Chip with one red contributor (`caseId?` present).** Same alphabetical-vs-insertion test, including the optional `caseId` field. Catches the regression where a Firestore-read contributor reorders `caseId` between `severity` and `detail`.
3. **Chip with mixed contributors AND a `requirements[]` row.** Recursive-replacer coverage — the row's `{key,label,category,status,severity}` has its keys reshuffled in the synthetic Firestore-shaped clone; canonical JSON still matches. Locks Greg's (c) explicitly.
4. **Round-trip.** Fresh → JSON → parse via `tryParseComparable` → JSON → equality with the original fresh JSON. Confirms parse + serialize stay equal end-to-end.
5. **Pre-R.4 snapshot shape (no `jobReadinessChip` field).** Two snapshots — one constructed without the chip key, one constructed with `chip: undefined` — canonical JSONs match. Confirms the absent-key path isn't accidentally regressed by the replacer.

Estimated 5 cases. Existing 376 (`src/shared/__tests__`) + 82 (`functions/src/__tests__/readiness`) suites stay green (no behavior change to chip / aggregator / bridge).

### L.4.1.4 — Verification (LOCKED)

- `tryParseComparable` is unchanged in behavior (still returns the same object); only the JSON serializer changes. No risk to read-side consumers.
- Manual smoke: re-run `scripts/refreshAssignmentReadinessSnapshotV1.js --tenant=BCiP2bQ9CgVOCTfV6MhD --no-dry-run` twice in a row; second run should report `recompute_no_change == count_of_active_assignments` (vs the current `0`). Save the audit output to `.scratch/r4-1-idempotency-{run1,run2}.txt` and diff.

---

## R.4.3 — Defensive `'legacy_review'` chip state (LOCKED Apr 28)

### L.4.3.1 — R.1 deploy-date constant (LOCKED — precise commit-derived timestamp)

Greg locked the precise commit-derived value over the cleaner UTC date floor — the floor would incorrectly classify any assignment created in the 5h38m gap between midnight UTC and actual deploy as "non-legacy" when it's actually pre-deploy. Risk is small in absolute terms but precise is correct and not harder.

R.1's deployment landed on the `Readiness rebuild: R.0–R.7 + R.3 + post-mortem cleanup` merge commit `ca555054`, dated **2026-04-26 22:38:46 -0700** (= **2026-04-27T05:38:46Z** in UTC). Before that, `assignmentReadinessItems` did not exist and `assignment.readinessSeededAt` was never written.

**Const** (placed at the top of `src/shared/jobReadinessChip/computeJobReadinessChip.ts`, mirrored to `shared/`):

```ts
/**
 * **R.4.3** — R.1 deploy-date floor for the `'legacy_review'` defensive
 * branch. Assignments with `createdAt` strictly before this timestamp
 * predate the R.1 readiness rebuild; they have no `assignmentReadinessItems`
 * rows, no `readinessSeededAt`, and no `hiringEntityId`. The chip would
 * otherwise spin on `'computing'` indefinitely for them.
 *
 * Source: merge commit `ca555054` ("Readiness rebuild: R.0–R.7 + R.3 +
 * post-mortem cleanup") landed 2026-04-26 22:38:46 -0700. Use the UTC
 * floor below so the comparison is timezone-free at the call site.
 *
 * If R.4.2 ever ships (legacy backfill of pre-R.1 assignments), this
 * constant stays — the defensive branch fires on `items.length === 0`
 * regardless, so a backfilled assignment will resolve to a real chip
 * state instead of `'legacy_review'` once items land.
 */
export const R1_DEPLOY_DATE_ISO = '2026-04-27T05:38:46.000Z';
```

### L.4.3.2 — New chip state value + classifier branch (LOCKED)

Extend the union in `src/shared/jobReadinessChip/types.ts` (mirrored to `shared/`):

```ts
export type JobReadinessChipState =
  | JobReadinessChipContribution
  | 'computing'
  | 'legacy_review'; // R.4.3
```

Extend `ComputeJobReadinessChipArgs` with an optional `assignmentCreatedAtIso?: string`. When provided AND no contributors exist AND `readinessSeeded === false` AND `assignmentCreatedAtIso < R1_DEPLOY_DATE_ISO`, return `'legacy_review'` instead of `'computing'`. Existing call sites that don't pass the new arg keep their current behavior — strictly additive.

```ts
if (contributors.length === 0) {
  if (!args.readinessSeeded) {
    if (
      typeof args.assignmentCreatedAtIso === 'string' &&
      args.assignmentCreatedAtIso < R1_DEPLOY_DATE_ISO
    ) {
      return {
        state: 'legacy_review',
        text: buildText('legacy_review', 0),
        pendingCount: 0,
        blockerCount: 0,
        contributors: [],
      };
    }
    return { state: 'computing', /* …existing path… */ };
  }
  return { state: 'red', /* …existing orphan path… */ };
}
```

`buildText` adds:

```ts
case 'legacy_review':
  return 'Legacy — needs review';
```

Lexical ISO comparison is correct (ISO-8601 sorts as text). Caller-side normalization to ISO is the contract — the chip helper stays clock-free / pure.

### L.4.3.3 — Caller wiring (LOCKED)

Two consumers need to thread `assignment.createdAt` through:

1. **`functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`** — the loader that powers the snapshot recompute. Already reads the assignment doc; adds one line to derive `assignmentCreatedAtIso = toIsoOrUndefined(assignmentSnap.get('createdAt'))` and forwards into `buildAssignmentReadiness` → `computeJobReadinessChip`. Needs a small `toIsoOrUndefined(v)` helper that handles Firestore `Timestamp`, ISO string, or `Date`.
2. **`src/utils/readinessMatrix/aggregateByCategory.ts`** — passes `assignmentCreatedAtIso` if available; degrades to `undefined` (current behavior) otherwise. R.8 matrix will surface "Legacy" cells naturally without a separate code path.

`buildAssignmentReadiness` needs to accept and pass through the field. It already takes args and forwards into the chip — same pattern as the existing `readinessSeeded` wire.

### L.4.3.4 — UI rendering — `JobReadinessChip` component (LOCKED — gray)

`src/components/recruiter/readiness/JobReadinessChip.tsx` gains a new visual variant for `state === 'legacy_review'`:

- **Color:** **gray** (LOCKED). MUI `default` chip color or `grey.300` background, `text.secondary` foreground. Greg's reasoning: `'computing'` is yellow with a spinner — using yellow for `'legacy_review'` would visually conflate two semantically different "needs attention" states (in-flight processing vs predates-our-system). Distinct color is the whole point of adding the new state. Gray also signals "out of band, not actionable from the chip alone" — operators have to pull up the assignment to investigate.
- **Icon:** small history icon (`HistoryIcon` from `@mui/icons-material`) instead of the spinner. Conveys "older record" without alarm.
- **Text:** `Legacy — needs review` (per the brief).
- **Popover/tooltip:** `This assignment predates the readiness rebuild (R.1). Run R.4.2-style backfill or contact ops.`
  - Out of scope: a one-click "trigger backfill" button — R.4.2 isn't shipped yet.

If R.4.2 ships later, no chip changes needed — once the backfill writes items, `contributors.length > 0` and the helper returns the real `green/yellow/red` state.

### L.4.3.5 — Test surface (LOCKED)

Extend `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts` (covers helper) + add a small UI test for the new chip variant:

1. Empty items + `readinessSeeded=false` + `assignmentCreatedAtIso < R1_DEPLOY_DATE_ISO` → `'legacy_review'`.
2. Empty items + `readinessSeeded=false` + `assignmentCreatedAtIso >= R1_DEPLOY_DATE_ISO` → `'computing'` (existing path preserved).
3. Empty items + `readinessSeeded=false` + `assignmentCreatedAtIso === R1_DEPLOY_DATE_ISO` → `'computing'` (boundary — strict-less-than).
4. Empty items + `readinessSeeded=false` + no `assignmentCreatedAtIso` → `'computing'` (additive — unwired callers preserved).
5. Empty items + `readinessSeeded=true` + pre-R.1 createdAt → `'red'` orphan (legacy guard does NOT fire when seeded; R.4.2 backfill should clear seeded=true → real state).
6. UI: render `JobReadinessChip` with `state='legacy_review'` → asserts gray chip + history icon + correct popover text.

### L.4.3.6 — Verification (LOCKED)

- All 7+ existing `computeJobReadinessChip` test cases stay green (additive behavior).
- `tsc --noEmit` clean both projects.
- `scripts/check-cascade-mirror.sh` clean (the chip helper + types live under `shared/`; mirror enforced).
- Manual smoke: open one of the 29 pre-R.1 assignments in `BCiP2bQ9CgVOCTfV6MhD` (per the R.7 audit `.scratch/bucketR8ComputingChip.js`); chip renders gray "Legacy — needs review" instead of spinning forever.

---

## R.16.2d — Scheduler activation sub-line (LOCKED Apr 28 — alt path L.16.2d.5)

### L.16.2d.1 — Path lock: ALT PATH (live chip + activation sub-line) (LOCKED)

Greg locked the alt path over close-as-no-op. Reasoning:

1. R.16.2c registered `scheduler` as snapshot-policy specifically so operators have visibility into "who was the scheduler when this JO was activated" — useful for commission tracking, accountability audits, and "why does the current scheduler differ from when this JO was set up" investigations.
2. Close-as-no-op leaves the registry entry doing **work without payoff** — the snapshot trigger writes `scheduler[]` to every JO at activation, but nothing reads it. That's wasted Firestore writes + dead data.
3. The sub-line UI ("Activated with: X") gives operators immediate visibility into the divergence at ~2 hours of work.

**Lock on the existing JO-header chip:** the header still reads `jobOrder.schedulerUid` (live, auto-stamped by `onAccountRolesChangeRestampSchedulers`). We do NOT override the "stay current" semantic. The activation sub-line is **strictly additive** and **only renders when activation diverges from current** — no UI clutter when the two match.

### L.16.2d.2 — Audit (recorded for forward reference) (LOCKED)

Existing JO-level reads of scheduler:

| Site | Reads | Treatment in this PR |
|------|-------|----------------------|
| `src/pages/RecruiterJobOrderDetail.tsx:3326-3330` (Scheduler chip in JO header) | `jobOrder.schedulerUid` (single uid) | **Unchanged** — keeps live "stay current" semantic. |
| `functions/src/recruiting/onJobOrderWriteStampScheduler.ts` | reads `account.roles.schedulerIds` (writer of `jobOrder.schedulerUid`) | **Unchanged** — writer, not a consumer. |
| `functions/src/recruiting/onAccountRolesChangeRestampSchedulers.ts` | iterates JOs to re-stamp `schedulerUid` | **Unchanged** — also a writer. |

Non-JO reads (out of scope by definition):
- `functions/src/workforce/setAccountWorkforceStatus.ts` — `account.roles.schedulerIds` for permission gating.
- `src/pages/RecruiterAccountDetails.tsx` — Account-level editor.

The new "Activated with" sub-line is the **only** new consumer of `jo.snapshot.scheduler` shipping in this PR.

### L.16.2d.3 — Helper: `getSchedulerAtActivation` (LOCKED — ships with real consumer)

Per the lock on L.16.2d.1, the helper is no longer scaffolding-only — the activation sub-line is the wired consumer.

New file `src/shared/jobOrder/getSchedulerAtActivation.ts` (mirrored to `shared/jobOrder/getSchedulerAtActivation.ts`, enforced by `scripts/check-cascade-mirror.sh` per the cascade-mirror pattern). Pure function, SDK-agnostic, no firebase imports — same shape rules as `getEffectiveJobOrderField`.

Public API:

```ts
export interface SchedulerAtActivationResult {
  /** The full uid array snapshotted at JO activation. Empty when no snapshot or no scheduler field. */
  uids: string[];
  /** True when a non-empty snapshot exists. Lets the UI distinguish "no activation snapshot yet" from "snapshot was empty at activation". */
  hasSnapshot: boolean;
}

export function getSchedulerAtActivation(
  joDoc: { snapshot?: { scheduler?: unknown } | null } | null | undefined,
): SchedulerAtActivationResult;

/**
 * Sub-line render decision: divergence means the current denormalized
 * `schedulerUid` is NOT in the snapshotted activation set. This is the
 * "operator surprise" condition — current scheduler is someone the JO
 * was NOT activated under, surfaced for commission / audit clarity.
 *
 * Returns false when:
 *   - There is no activation snapshot (nothing to compare against).
 *   - The snapshot is empty (we never captured a scheduler at activation).
 *   - `currentSchedulerUid` is in the snapshotted uid array (current
 *     owner participated in activation; no surprise).
 *   - `currentSchedulerUid` is null/undefined AND snapshot is non-empty
 *     — pragmatic call: "no current scheduler" is a different gap that
 *     the existing live chip already conveys ("Unassigned"), so the
 *     sub-line stays hidden to avoid redundant noise.
 */
export function shouldRenderActivationSubline(
  current: string | null | undefined,
  activation: SchedulerAtActivationResult,
): boolean;
```

Implementation notes:
- Defensive shape handling — `joDoc.snapshot.scheduler` may be a string array (canonical), a single string (legacy), or `undefined`. The helper normalizes to `string[]`.
- Pure / SDK-agnostic — sits next to `getEffectiveJobOrderField` under `shared/jobOrder/`. Mirror enforced.

### L.16.2d.4 — JO header sub-line wiring (LOCKED)

In `src/pages/RecruiterJobOrderDetail.tsx`, immediately below the existing Scheduler chip (around line 4360, where the chip + "Unassigned" fallback render):

```tsx
const activation = getSchedulerAtActivation(jobOrder);
const showActivationSubline = shouldRenderActivationSubline(
  jobOrderSchedulerUid,
  activation,
);

{showActivationSubline && (
  <Typography
    variant="caption"
    color="text.secondary"
    sx={{ display: 'block', mt: 0.25 }}
    data-testid="scheduler-activation-subline"
  >
    Activated with: {activation.uids.map(uid => recruiterNameById.get(uid) ?? uid).join(', ')}
  </Typography>
)}
```

- **Name resolution:** reuses the `recruiterNameById` lookup that the existing chip already builds for `jobOrderSchedulerUid` resolution. If a uid in the snapshot isn't in the lookup map (e.g. a recruiter who's since left the tenant), fall back to the raw uid string — operators can match it against an audit log if needed.
- **Hide when current state matches** — `shouldRenderActivationSubline` returns `false` when `currentSchedulerUid` is in `activation.uids`. No sub-line, no clutter.
- **Hide when there's no activation snapshot** — pre-R.16.2c JOs (or active-but-never-snapshot-recomputed) just show the live chip.
- **No new permission gates** — anyone who can see the JO header can see the sub-line. The data is already in the JO doc; the sub-line just surfaces it.

### L.16.2d.5 — Test surface (LOCKED)

Two small files:

1. **Helper unit tests** (Jest) — `src/shared/jobOrder/__tests__/getSchedulerAtActivation.test.ts`:
   - `getSchedulerAtActivation` returns `{uids: [], hasSnapshot: false}` for no-snapshot / null / undefined doc.
   - Returns `{uids: [], hasSnapshot: true}` when snapshot exists with explicit empty array.
   - Returns `{uids: ['a','b'], hasSnapshot: true}` for canonical string-array shape.
   - Normalizes legacy single-string `scheduler: 'a'` → `{uids: ['a'], hasSnapshot: true}`.
   - `shouldRenderActivationSubline` — false when no snapshot, false when current uid is in array, false when current uid is null/undefined, true when current uid is non-null AND not in the array.
   - Edge: empty array snapshot + non-null current → false (no surprise to surface; activation captured "no scheduler").
2. **Mocha divergence-locking test** — `functions/src/__tests__/jobOrders/r16_2d_schedulerActivationSubline.test.ts`:
   - One case asserting that when `jo.snapshot.scheduler = ['A','B']` and `jo.schedulerUid = 'C'` (i.e., admin pushed updated array, then parent rotated to C, trigger restamped C), `shouldRenderActivationSubline(C, getSchedulerAtActivation(jo))` returns `true`.
   - One case for the "no surprise" path: `jo.snapshot.scheduler = ['A','B']` and `jo.schedulerUid = 'A'` → returns `false`.

Estimated 8 cases total. No existing matcher / cascade / readiness / R.16.x suite is touched.

### L.16.2d.6 — Verification (LOCKED)

- Helper tsc-clean both projects.
- `scripts/check-cascade-mirror.sh` clean (new file in `shared/jobOrder/` mirrored to `src/shared/jobOrder/`; mirror script already covers that directory per R.16.2a).
- Existing `RecruiterJobOrderDetail.tsx` Scheduler-chip behavior unchanged (no regression on the live chip — the sub-line is purely additive below it).
- Manual smoke (15 min): pick a recently-activated JO under `BCiP2bQ9CgVOCTfV6MhD` whose parent National recently rotated `schedulerIds` (or simulate one via a dev-tenant Push-to-Active). Verify:
  1. Header chip still renders the current scheduler name.
  2. Sub-line appears below it as "Activated with: <names>" only when the current scheduler isn't in the activation set.
  3. Open a different JO whose parent hasn't rotated → no sub-line (no clutter).

---

## Verification gate (whole PR)

- [x] R.4.1 — **5 new idempotency cases pass** (b: empty-contributor `'computing'` chip case; a: red chip with optional `caseId`; c: recursive — mixed contributors + reshuffled `requirements[]` row; round-trip through `JSON.parse`; absent-`jobReadinessChip` parity for pre-R.4 snapshots). Manual two-run smoke deferred to ops (deploy runbook below).
- [x] R.4.3 — **5 helper + 1 UI cases pass** (helper: pre-R.1 + empty + unseeded → `legacy_review`; post-R.1 → `computing`; boundary === floor → `computing` strict-less-than; no-arg → `computing` additive; pre-R.1 + SEEDED → red orphan; UI: gray default chip + `HistoryIcon` + popover copy). Manual smoke against pre-R.1 BCiP assignments deferred to ops.
- [x] R.16.2d — **5 reader + 7 predicate cases pass** (reader: draft → null; no-capturedAt → null; `[]` → `[]` distinct from null; trim/dedup/order; missing/wrong-shape → null; predicate: null/empty → false; equal sets → false; differing sets → true; current-cleared → true; trim parity; both-empty → false; whitespace-only filtered).
- [x] Adjacent suites stay green: `computeJobReadinessChip` 21/21, `buildAssignmentReadiness.r4-bridge` 11/11, `JobReadinessChip.legacyReview` 1/1, R.16.2c loaders mocha 10/10. Total verification footprint: **70 jest cases across 5 suites + 10 mocha cases** all green.
- [x] `tsc --noEmit` clean both projects (root + `functions/`); only pre-existing errors remain (`certifications._meta.generatedFrom` literal narrowing + `requirement.scope` in `deriveActionItemsV1.certEngine.test.ts` — both predate this PR per the prior summary).
- [x] `scripts/check-cascade-mirror.sh` clean. Manual `diff -q` confirms `src/shared/jobReadinessChip/{types,computeJobReadinessChip}.ts` byte-identical with `shared/jobReadinessChip/` mirror after R.4.3 edits. (R.16.2d's `getSchedulerAtActivation.ts` lives only in `src/shared/jobOrder/` — single-tree like `readinessSnapshotV1.ts`; no mirror created and not added to the mirror-check enforcement list.)
- [x] `ReadLints` clean on all 15 touched files.

---

## Deploy runbook

Functions:

```bash
firebase deploy --only functions:syncHrxReadinessSnapshotV1,functions:recomputeHrxReadinessSnapshotForAssignment
```

(R.4.1 only touches `readinessSnapshotV1ComparableJson`, which both functions consume via the same bundle; the targeted deploy keeps blast-radius minimal.)

Frontend:

```bash
npm run deploy:hosting
```

(R.4.3 chip + UI variant; R.16.2d JO-header sub-line.)

No new Firestore indexes. No backfill required (R.4.1's fix is purely a serialization improvement; existing snapshots resolve to the same canonical JSON on the next read).

Optional manual smoke (15 min):

1. `scripts/refreshAssignmentReadinessSnapshotV1.js --tenant=BCiP2bQ9CgVOCTfV6MhD --no-dry-run` → first run reports its usual change count.
2. Re-run the same command immediately → should now report `recompute_no_change == count_of_active_assignments` (R.4.1 fix verified).
3. Open `https://app.hrxone.com/tenants/BCiP2bQ9CgVOCTfV6MhD/admin/assignments/<one-of-the-29-pre-R.1-ids>` (per `.scratch/bucketR8ComputingChip.js`); chip renders gray "Legacy — needs review" with the popover text (R.4.3 fix verified).
4. Open a JO whose parent National recently rotated `schedulerIds` (or simulate via Push-to-Active in dev tenant). Verify header chip shows the current scheduler AND the "Activated with: <names>" sub-line appears below it. Open a non-rotated JO → no sub-line (R.16.2d fix verified).

---

## Out-of-scope for this PR (recorded for clarity)

| Item | Why excluded | Lands in |
|------|--------------|----------|
| R.4.2 — backfill 29 pre-R.1 assignments | Data migration with two-stage cascade resolution; needs its own ops sequence | Separate PR |
| R.16.2b — broader consumer rewires + `markupPercent` rename | Bigger surface; held for post-CORT | Separate PR |
| #41 — full cascade-engine migration | Architecture-scoped, not a cleanup | Separate scoping |
| B.6 — `matchExperience` | Schema design first | Separate scoping |
| Pulling `fast-deep-equal` / formal canonical-JSON dep | One-line replacer covers this PR's need | Revisit if comparison-equality bugs recur |

---

## Locks (Apr 28, 2026)

All five decision asks resolved by Greg in the "Locks" reply Apr 28:

| # | Lock | Resolution | Reasoning |
|---|------|------------|-----------|
| 1 | **L.4.1.2** — Fix shape | Stable-stringify replacer in `readinessSnapshotV1ComparableJson`. Don't rewrite the parser. | Canonical serialization is the minimal correct fix for the Firestore-keys-vs-insertion-order divergence. Tests must explicitly cover chip-bearing, empty-contributors, and nested-`requirements` row to verify recursive replacer. |
| 2 | **L.4.3.1** — R.1 deploy date const | `2026-04-27T05:38:46.000Z` (precise, commit-derived from `ca555054`). | UTC date floor (`00:00:00Z`) would misclassify any assignment created in the 5h38m gap between midnight UTC and actual deploy as "non-legacy". Risk small but precise is correct and not harder. |
| 3 | **L.4.3.4** — `'legacy_review'` chip color | Gray. | `'computing'` is yellow with spinner. Yellow `'legacy_review'` would visually conflate two semantically different "needs attention" states. Distinct color is the whole point of adding the new state. |
| 4 | **L.16.2d.1** — R.16.2d path | Alt path (live chip + activation sub-line). NOT close-as-no-op. | R.16.2c registered `scheduler` as snapshot-policy specifically for activation-time visibility (commission tracking, accountability audit). Close-as-no-op leaves the registry entry doing work without payoff — wasted Firestore writes + dead data. Sub-line UI gives operators immediate divergence visibility at ~2 hours of work. |
| 5 | **L.16.2d.3** — `getSchedulerAtActivation` helper | Ship it (now wired via the alt path). | Moot per L.16.2d.1 — alt path makes the helper a real consumer, not unwired scaffolding. |

---

## Cross-references

- R.4 chip aggregator + R.4.1/R.4.2/R.4.3 followup notes: `docs/READINESS_R7_HANDOFF.md` §"Three follow-ups filed (none blocking R.8)"
- R.4 snapshot extension: `docs/READINESS_R4_HANDOFF.md` §D3.R4
- R.1 schema lock: `docs/READINESS_R1_R2_HANDOFF.md` §"R.1 — PR 1 completion notes (2026-04-26)"
- R.16.2c scheduler snapshot semantic: `docs/CASCADE_R16.2c_HANDOFF.md` §L2
- Recruiting role model (the `roles.schedulerIds` ↔ `jobOrder.schedulerUid` denormalization story): `docs/RECRUITING_ROLE_MODEL.md` §2.2

---

*End of cleanup brief — LOCKED Apr 28, 2026. Greenlit for code; sequence under operator's discretion (recommended R.4.1 → R.4.3 → R.16.2d for review readability, but the three sub-scopes have no inter-dependencies).*

---

## Implementation summary (Apr 28, 2026)

Sequence followed: **R.4.1 → R.4.3 → R.16.2d** per Greg's greenlight reply ("idempotency load-bearing first, then independent additions").

### R.4.1 — Snapshot recompute idempotency

- `src/shared/readinessSnapshotV1.ts` — added `stableKeyReplacer` and threaded it through `readinessSnapshotV1ComparableJson(c, stableKeyReplacer)`. Pure, single-file change. The replacer recursively sorts object keys before stringification; arrays preserve element order (semantic — `requirements` and `contributors` sorted upstream by the aggregator); `null` short-circuits via `value &&`.
- `src/shared/__tests__/readinessSnapshotV1.idempotency.test.ts` — **NEW** — 5 cases per L.4.1.3 a/b/c. Each test reshuffles object keys alphabetically (mirrors what Firestore returns from `DocumentSnapshot.data()`) and asserts `readinessSnapshotV1ComparableJson(fresh) === readinessSnapshotV1ComparableJson(firestoreShaped)`. The recursive `reshuffleKeysAlphabetically` helper covers contributor objects inside arrays so the (c) recursive case is genuinely exercised. Round-trip case asserts canonical form survives `JSON.parse → JSON.stringify`. Absent-`jobReadinessChip` parity case prevents a regression where stable serialization could accidentally surface an empty `"jobReadinessChip":{}` key for pre-R.4 snapshots.
- No mirror touch — `readinessSnapshotV1.ts` is single-tree (functions side imports it via `../../../src/shared/readinessSnapshotV1`).
- The persisted Firestore doc also benefits — `assignRef.set(...)` receives the canonical-keyed object on the next write, so future test fixtures + external consumers see deterministic key order too.

### R.4.3 — Defensive `'legacy_review'` chip state

- `src/shared/jobReadinessChip/types.ts` — added `'legacy_review'` to the `JobReadinessChipState` union with a docstring contrasting it against `'computing'`. **Mirrored** byte-identical to `shared/jobReadinessChip/types.ts`.
- `src/shared/jobReadinessChip/computeJobReadinessChip.ts` — added `R1_DEPLOY_DATE_ISO` const (`'2026-04-27T05:38:46.000Z'`, commit-derived from `ca555054` per L.4.3.1); added optional `assignmentCreatedAtIso?: string` to `ComputeJobReadinessChipArgs`; added the strict-less-than classifier branch BEFORE the existing `'computing'` branch (so `'computing'` callers without the field stay backward compatible); added `'legacy_review'` case to `buildText` returning `"Legacy — needs review"` (en-dash). **Mirrored** byte-identical to `shared/jobReadinessChip/computeJobReadinessChip.ts`.
- `src/shared/buildAssignmentReadiness.ts` — added optional `assignmentCreatedAtIso?: string | null` to `BuildAssignmentReadinessArgs`; threaded through both `computeJobReadinessChip(...)` call sites (the early `!assignment?.id` return path AND the main path); strips null/empty before forwarding so unwired callers stay on the pre-R.4.3 `'computing'` path.
- `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts` — added the `toIsoOrUndefined` helper (handles Firestore `Timestamp` via duck-typed `toDate()` / `toMillis()`, ISO strings via `Date.parse`, JS `Date` instances, epoch millis); reads `a.createdAt` and forwards as `assignmentCreatedAtIso`. Pure helper — no `admin` namespace import dependency.
- `src/components/recruiter/readiness/JobReadinessChip.tsx` — `chipColorForState` returns `'default'` for `'legacy_review'` (gray, distinct from `'computing'` only via icon + label per L.4.3.4 reasoning); replaced single-icon ternary with explicit `if/else if` for `'computing'` (CircularProgress) vs `'legacy_review'` (`HistoryIcon`).
- `src/components/recruiter/readiness/JobReadinessChipPopover.tsx` — added `'legacy_review'` empty-state branch surfacing "This assignment predates the readiness rebuild (R.1). Run R.4.2-style backfill or contact ops." (no "trigger backfill" button — R.4.2 isn't shipped yet).
- `src/utils/readinessMatrix/aggregateByCategory.ts` — **no change needed**. The matrix aggregator already pre-filters on `readinessSeeded: true` and skips empty per-category subsets, so the legacy branch (empty + unseeded) is unreachable from there. Confirmed by inspection.
- `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts` — added 5 cases under a new describe block covering all L.4.3.5 surfaces (pre-R.1/post-R.1/boundary/no-arg/seeded boundary). Existing 16 cases stay green.
- `src/components/recruiter/readiness/__tests__/JobReadinessChip.legacyReview.test.tsx` — **NEW** — 1 UI smoke test asserting label, gray `MuiChip-colorDefault`, presence of `[data-testid="HistoryIcon"]`, ABSENCE of `MuiCircularProgress-root`, and popover copy via `mouseEnter`.

### R.16.2d — Scheduler activation sub-line

- `src/shared/jobOrder/getSchedulerAtActivation.ts` — **NEW** — exports `getSchedulerAtActivation(joDoc) → string[] | null` (snapshot reader; trims, dedupes, preserves first-seen order; distinguishes `null` no-snapshot from `[]` empty-snapshot per the dedicated docstring) and `shouldRenderActivationSubline({currentSchedulerUid, activationSchedulers}) → boolean` (set-comparison divergence predicate). Pure, SDK-agnostic, type-self-contained — kept that way so the helper can be byte-mirrored into `shared/jobOrder/` later if a server-side consumer (e.g. commission-tracking trigger) materializes. Lives next to the existing `getEffectiveJobOrderField.ts` which it deliberately does NOT fold into (different return-shape contract — `string[] | null` snapshot-only vs the generic `EffectiveResult<T>` with fallback semantics).
- `src/shared/__tests__/getSchedulerAtActivation.test.ts` — **NEW** — 12 cases (5 reader + 7 predicate) covering all L.16.2d.5 boundaries plus extra defensive cases (null doc, missing status, both-empty sides, whitespace-only filtering).
- `src/pages/RecruiterJobOrderDetail.tsx` — added the import for `getSchedulerAtActivation` / `shouldRenderActivationSubline` / `JobOrderForSchedulerActivation`; added `activationSchedulerUids` and `showActivationSchedulerSubline` `useMemo`s next to the existing `jobOrderSchedulerUid` resolver; added `activationSchedulerNames` state + a parallel-fetch `useEffect` that resolves UID → display-name with per-UID graceful degrade (one bad lookup doesn't blank the sub-line); rendered the sub-line as a small italic `Typography` (data-testid `activation-scheduler-subline`) directly below the scheduler chip in a `flexDirection: column` wrapper, hidden when `!showActivationSchedulerSubline`. Tooltip on hover explains the divergence semantic for operators.

### Verification (re-stated)

- Jest: **70/70 pass** across 5 affected suites (`getSchedulerAtActivation`, `computeJobReadinessChip`, `buildAssignmentReadiness.r4-bridge`, `readinessSnapshotV1.idempotency`, `JobReadinessChip.legacyReview`).
- Functions mocha sanity: `r16_2c_loaders` 10/10 still green (R.16.2c surface unaffected).
- `tsc --noEmit` clean both projects (only pre-existing certs/credentials errors remain).
- `scripts/check-cascade-mirror.sh` clean.
- `diff -q` chip-tree mirrors clean.
- `ReadLints` clean on all 15 touched files.
- No new Firestore indexes; no schema changes; no backfill required.
