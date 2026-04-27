# Readiness Rebuild — R.4 (Job Readiness Chip — Aggregator + Component) Handoff Spec

**Status:** R.4 implemented (PR 3, merged). **R.7 implemented (PR 4, in review — see `READINESS_R7_HANDOFF.md`).**
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`.
**Design notes:** `READINESS_R4_PLACEMENT_CHIP_DESIGN.md` (predates R.1/R.2 ground-truth corrections; superseded by this doc where they conflict).
**Successors:**

- **R.7** — *landed.* Wires the chip into `ProfileReadinessTabContent` worker-view header (`size="lg"`) and consumes the `?tab=readiness&assignmentId=&itemId=&type=&source=` deep link end-to-end (auto-selects assignment, scrolls + flash-highlights the matching requirement row). See `READINESS_R7_HANDOFF.md`.
- **R.5** — *landed.* Adds optional `caseId` to `JobReadinessChipContributor` (sourced from `EmployeeReadinessItem.externalRef` for `e_verify` items only) and overrides chip severity for `e_verify needs_review` (red) and `e_verify in_progress` (yellow). PlacementsTab forwards `caseId` on the drill-in URL. See `READINESS_R5_HANDOFF.md`.
- **R.8** — wire chip into the CSA cross-worker matrix (`size="inline"`); same component, same data source.

---

## TL;DR

R.4 ships the per-(worker × shift) **Job Readiness chip**: a single aggregate visual built from the readiness items R.1+R.2 already write to Firestore. It is a **bridge**, not a parallel pipeline:

- **Aggregator** lives inside the existing `buildAssignmentReadiness` (`src/shared/buildAssignmentReadiness.ts`). It now optionally returns a new `jobReadinessChip: JobReadinessChipData` field, alongside the unchanged `readiness` / `requirements` / `summary`. Old callers pass nothing extra and see no chip; the snapshot writer passes the items and gets the chip.
- **Persistence** is additive on the existing `readinessSnapshotV1` Firestore document. The new field is `readinessSnapshotV1.jobReadinessChip` — back-compatible with `PlacementsTab.tsx` and Flutter (both ignore unknown fields).
- **Component** is `JobReadinessChip` (`src/components/recruiter/readiness/`) — three sizes (`sm` / `lg` / `inline`), hover/focus popover, drill-in via `onItemClick`. Wired into `PlacementsTab` placement tiles. Worker header (R.7) and CSA matrix (R.8) wiring deferred — chip component already supports their sizes.

**No new Cloud Function** is added. The chip is computed on every existing snapshot recompute path because the readiness loader (`hrxReadinessSnapshotLoadContext.ts`) was extended to fetch the two readiness item collections and pass them through.

| ID | Task | Touches |
|---|---|---|
| R.4 | Pure aggregator + component + cross-collection load + bridge into `buildAssignmentReadiness` + persisted `readinessSnapshotV1.jobReadinessChip` + PlacementsTab wiring | `src/shared/jobReadinessChip/`, `src/shared/buildAssignmentReadiness.ts`, `src/shared/readinessSnapshotV1.ts`, `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`, `functions/src/readiness/syncHrxReadinessSnapshotV1.ts`, `src/components/recruiter/readiness/`, `src/components/recruiter/PlacementsTab.tsx` |

---

## Decisions (locked from this PR's greenlight)

### D1.R4 — Bridge, do not replace, the existing aggregator — LOCKED

The existing `buildAssignmentReadiness` already computes the legacy 4-state readiness aggregate (`READY` / `READY_WITH_WARNINGS` / `BLOCKED` / `PENDING_INITIALIZATION`) consumed by `PlacementsTab` and Flutter via `readinessSnapshotV1`. R.4 **extends that function with optional inputs and one optional output field** rather than introducing a parallel aggregator:

```ts
// Old (R.0): the only inputs and output that pre-R.4 callers know about.
export interface BuildAssignmentReadinessArgs {
  user: AssignmentReadinessUserInput;
  employment: AssignmentReadinessEmploymentInput;
  assignment: AssignmentReadinessAssignmentInput | null;
  screening: AssignmentReadinessScreeningInput;
  certifications: AssignmentReadinessCertItem[];
  // R.4 — additive, opt-in:
  assignmentReadinessItems?: AssignmentReadinessItem[] | null;
  employeeReadinessItems?: EmployeeReadinessItem[] | null;
  readinessSeeded?: boolean | null;
}

export interface BuildAssignmentReadinessResult {
  readiness: OverallReadinessState;
  requirements: ReadinessRequirement[];
  summary: { blockers: number; warnings: number; completed: number };
  // R.4 — only emitted when the additive inputs are provided:
  jobReadinessChip?: JobReadinessChipData;
}
```

**Why:** placement tiles, Flutter, the `useWorkerReadinessV1` hook, the engine-trust signal builder, and the Profile Readiness tab all depend on the existing field set. Replacing the function (or its persisted shape) would require coordinated multi-surface changes; bridging is a single-PR change with zero behavioural risk to legacy callers.

### D2.R4 — Persistence: additive field on `readinessSnapshotV1` — LOCKED

```ts
// src/shared/readinessSnapshotV1.ts — Firestore-shape (unchanged keys preserved):
export type ReadinessSnapshotV1Firestore = {
  state: OverallReadinessState;
  sourceVersion: number;
  summary: { blockers: number; warnings: number; completed: number };
  requirements: ReadinessSnapshotRequirementRow[];
  jobReadinessChip?: JobReadinessChipData;   // R.4 — optional, additive
  updatedAt?: FieldValue | Timestamp;
};
```

`buildReadinessSnapshotV1Comparable` includes `jobReadinessChip` only when present so the JSON-equality check in `syncHrxReadinessSnapshotV1` doesn't false-positive on the first recompute after deploy. `tryParseComparable` round-trips the same field so existing snapshots compare cleanly to new ones.

### D3.R4 — Cross-collection read (load-bearing) — LOCKED

The chip aggregates over **two** readiness collections, not just one. From the R.1 ground-truth note:

> AccuSource and E-Verify bridges write to `employeeReadinessItems`, NOT `assignmentReadinessItems`. So there's a two-collection split:
>
> - `assignmentReadinessItems` — per-shift, per-worker (what the seeder creates)
> - `employeeReadinessItems` — per-(worker × hiring-entity) globally (where AccuSource / E-Verify land)

A chip that read only the assignment side would silently miss background-check / drug-screen / E-Verify status — i.e. the most common red contributors. The loader (`hrxReadinessSnapshotLoadContext.ts`) was extended to fan out both queries in parallel and pass them through:

```ts
const [assignmentReadinessItemsSnap, employeeReadinessItemsSnap] = await Promise.all([
  db
    .collection(`tenants/${tenantId}/assignmentReadinessItems`)
    .where('assignmentId', '==', assignmentId)
    .get(),
  hiringEntityId
    ? db
        .collection(`tenants/${tenantId}/employeeReadinessItems`)
        .where('workerUid', '==', workerUserId)
        .where('hiringEntityId', '==', hiringEntityId)
        .get()
    : Promise.resolve(null),
]);
```

Both queries are tenant-scoped indexed lookups (no fan-out). When `hiringEntityId` cannot be resolved the employee-side query is skipped and the chip degrades to assignment-only inputs (the popover correctly shows the BG/E-Verify rows as missing rather than fabricating green).

**Subset filter:** within `employeeReadinessItems` only the JOB-level subset contributes to Job Readiness — `background_check`, `drug_screen`, `e_verify`. The remainder (`i9`, `handbook_acknowledgement`, etc.) belongs to the Employee Readiness chip and is filtered out by the helper:

```ts
// src/shared/jobReadinessChip/labels.ts
export const EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES: ReadonlySet<EmployeeReadinessRequirementType> = new Set([
  'background_check',
  'drug_screen',
  'e_verify',
]);
```

### D4.R4 — Two-axis classification per item — LOCKED

Per spec, each item's contribution to the chip is decided from **status × severity × resolutionMethod**, not from `status` alone. The classifier (`classifyContribution` in `computeJobReadinessChip.ts`) implements the matrix locked in the planning doc + R.1+R.2 ground-truth:

| Status | `resolutionMethod` | Severity | Contribution | Detail |
|---|---|---|---|---|
| any | `csa_waived` | any | green | "Waived by recruiter" |
| `complete_pass` / `complete` (legacy) / `not_applicable` | any | any | green | "Satisfied" |
| `complete_fail` | any | hard | red | "Failed" |
| `complete_fail` | any | soft | yellow | "Failed (soft requirement)" |
| `needs_review` | any | any | yellow | "Needs review" |
| `expired` | any | hard | red | "Expired" |
| `expired` | any | soft | yellow | "Expired (soft requirement)" |
| `incomplete` / `in_progress` / `blocked` | any | hard | red | "Pending" / "In progress" / "Blocked" |
| `incomplete` / `in_progress` / `blocked` | `self_attest` | soft | yellow | "Worker has not answered yet" |
| `incomplete` / `in_progress` / `blocked` | other | soft | yellow | "Pending" / "In progress" |
| anything else (defensive) | any | any | yellow | "Unknown status" |

**Why this matrix:** it captures the conceptual line in Greg's spec — *missing cert / license / screening = genuinely blocking (red); missing self-attestation or soft match = "we just haven't asked yet" (yellow); BG pending CSA adjudication = CSA's task, not a hard worker block (yellow)*.

**Severity asymmetry in employee items.** `EmployeeReadinessItem` does NOT carry `severity` or `resolutionMethod` (R.1 added those only to the assignment-side schema; R.3 will mirror to the employee side). The helper hard-codes `severity: 'hard'` and `resolutionMethod: null` for the three job-level employee types — failing any of them genuinely blocks the worker, so the conservative assumption is correct. R.3 should make this explicit on the schema and remove the helper-side fallback.

### D5.R4 — Aggregate rule + chip text — LOCKED

```ts
if (blockerCount > 0) state = 'red';
else if (pendingCount > 0) state = 'yellow';
else state = 'green';
```

| State | Text | Color |
|---|---|---|
| `'green'` | `Job Ready` | `success` (filled) |
| `'yellow'` | `Job Ready (N pending)` (`N` = yellow contributor count) | `warning` (outlined) |
| `'red'` | `Job Not Ready` | `error` (outlined) |
| `'computing'` | `Job Ready (computing…)` (with inline spinner) | `default` (outlined) |

The yellow-state suffix `(N pending)` reads from `JobReadinessChipData.pendingCount` (NOT a recount on render). `blockerCount` is also exposed on the data — the chip text doesn't use it but the popover summary line does.

### D6.R4 — Empty-input split: `'computing'` vs orphan-red — LOCKED

When both readiness item arrays are empty, we have two distinct outcomes:

- **`readinessSeeded === false`** → `'computing'`. The seeder hasn't run yet for this assignment (e.g. brand-new placement, snapshot writer ran before the seeder). Don't accidentally show green.
- **`readinessSeeded === true`** → `'red'` orphan ("Readiness not yet computed"). The seeder ran but produced zero items (a bug or a misconfigured JO); make it visible rather than silent.

`readinessSeeded` is sourced from either:

1. `assignment.readinessSeededAt` field (canonical), or
2. `assignmentReadinessItems.length > 0` fallback (covers pre-R.0 assignments that have items but no `readinessSeededAt` stamp — they should NOT degrade to `'computing'` after the R.4 deploy).

This is the only path where empty inputs produce a non-green chip — every other empty case (e.g. all `not_applicable`) resolves green naturally because no contributor is red or yellow.

### D7.R4 — Stable contributor sort — LOCKED

Within `JobReadinessChipData.contributors` the helper sorts:

1. Tier (red → yellow → green).
2. `requirementType` lexicographically (stable, predictable; tenants who want a custom order do it in the chip component, not here).
3. `itemId` lexicographically (stable secondary key for items of the same type — e.g. multiple cert matches).

The popover renders contributors in this order — no client-side re-sort.

### D8.R4 — Drill-in routing — LOCKED for placement tiles; honoured end-to-end by R.7

`PlacementsTab` opens the worker profile in a new tab, with the contributor identity carried on the query string. R.7 (`READINESS_R7_HANDOFF.md`) consumes the URL end-to-end. The R.7 PR also extended the on-tile callback signature to thread `assignmentId` (parent context — not on the contributor itself) so the URL carries it without a Firestore round-trip:

```ts
// (after R.7) — `assignmentId` is threaded through from the per-tile context.
const params = new URLSearchParams({
  tab: 'readiness',
  source: contributor.source,           // 'assignment' | 'employee'
  type: contributor.requirementType,    // R.7 row-highlight key
  itemId: contributor.itemId,           // diagnostic + future exact-match
});
if (assignmentId) params.set('assignmentId', assignmentId); // R.7 auto-select
window.open(`/users/${workerUid}?${params.toString()}`, '_blank', 'noopener,noreferrer');
```

R.7 consumption (mirrored here for cross-ref clarity):

1. `UserProfile/index.tsx` reads `tab=readiness` and selects the Readiness tab.
2. `ProfileReadinessTabContent` reads `assignmentId` / `itemId` / `type` / `source`, auto-selects the matching assignment, sets `highlightRequirementType=type`, scrolls + flash-highlights matching rows via the `requirementType → req.key` predicate map, and strips the four readiness-specific keys from the URL.

---

## Why this PR is safe

- **Pure helper** — `computeJobReadinessChip` has no firebase / clock / async dependencies. 28-test unit suite covers empty inputs, the 9-status × 2-severity × 3-resolutionMethod classification matrix, `csa_waived` dominance, the cross-collection filter, and the sort.
- **Additive aggregator output** — `buildAssignmentReadiness` only emits `jobReadinessChip` when the new args are provided. The 6-test bridge suite confirms (a) legacy callers still get the same `BuildAssignmentReadinessResult` shape, (b) new callers get the chip, (c) the comparable snapshot includes the chip exactly when the result does.
- **Additive persisted shape** — `readinessSnapshotV1.jobReadinessChip` is optional. `PlacementsTab` already reads `readinessSnapByAssignmentId` and now plumbs `snap.jobReadinessChip` into the new prop without changing any other read path. Flutter ignores unknown fields.
- **No new Cloud Function** — chip is computed on every existing snapshot recompute via the loader extension. `syncHrxReadinessSnapshotV1.ts` was updated only on the `tryParseComparable` side so the JSON-equality short-circuit still works.
- **Component is presentation only** — no state machinery, no fetches; sx-only sizing matrix.

---

## Files changed

### Pure helper (new)

- `shared/jobReadinessChip/types.ts` (mirrored to `src/shared/`) — `JobReadinessChipSource | Contribution | State | Contributor | Data`.
- `shared/jobReadinessChip/labels.ts` (mirrored to `src/shared/`) — display labels per requirement type + `EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES` filter.
- `shared/jobReadinessChip/computeJobReadinessChip.ts` (mirrored to `src/shared/`) — pure aggregator (D4–D7.R4).
- `shared/jobReadinessChip/index.ts` (mirrored to `src/shared/`) — barrel.
- `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts` — 28 jest specs.

### Bridge into existing aggregator

- `src/shared/buildAssignmentReadiness.ts` — `BuildAssignmentReadinessArgs` extended with `assignmentReadinessItems?` + `employeeReadinessItems?` + `readinessSeeded?`; `BuildAssignmentReadinessResult` extended with `jobReadinessChip?: JobReadinessChipData`.
- `src/shared/readinessSnapshotV1.ts` — `ReadinessSnapshotV1Firestore` + `ReadinessSnapshotV1Comparable` extended with optional `jobReadinessChip`; `buildReadinessSnapshotV1Comparable` includes the field only when present.
- `src/shared/__tests__/buildAssignmentReadiness.r4-bridge.test.ts` — 6 jest specs (legacy / new caller asymmetry; comparable propagation).

### Cloud Functions wiring (no new function)

- `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts` — parallel reads of both readiness item collections (D3.R4); derives `readinessSeeded` from `assignment.readinessSeededAt` or `assignmentReadinessItems.length > 0`; passes the trio to `buildAssignmentReadiness`.
- `functions/src/readiness/syncHrxReadinessSnapshotV1.ts` — `tryParseComparable` round-trips `jobReadinessChip` so the JSON-equality write-skip still functions correctly.

### Component (new)

- `src/components/recruiter/readiness/JobReadinessChip.tsx` — `sm` / `lg` / `inline` sizes; popover anchor (hover / focus / click); spinner on `'computing'`; calls `onItemClick(contributor)`.
- `src/components/recruiter/readiness/JobReadinessChipPopover.tsx` — sorted breakdown; per-tier styling; clickable contributor rows; empty-state copy for `'computing'` / orphan-red / no-outstanding.
- `src/components/recruiter/readiness/index.ts` — named re-exports.

### Surface wiring

- `src/components/recruiter/PlacementsTab.tsx` —
  - `placementJobReadinessChipDataForAssignmentId(assignmentId)` (`useCallback`) reads `snap.jobReadinessChip` from existing `readinessSnapByAssignmentId`.
  - `handlePlacementJobReadinessItemClick(workerUid, contributor)` (`useCallback`) opens the worker profile in a new tab with the deep-link query (D8.R4).
  - `PlacementWorkerTileMainColumn` accepts new optional props `jobReadinessChipData` + `onJobReadinessItemClick`; renders `<JobReadinessChip size="sm" />` between the worker info row and the existing readiness icon row.
  - Both call sites (Worker Pool + Assignments column) pass the new props.

---

## Verification

```bash
# tsc — both projects clean.
( cd functions && npx tsc --noEmit )
npx tsc --noEmit   # pre-existing, unrelated errors in certifications + userActionItems test files

# Helper + bridge tests (jest).
npx craco test --watchAll=false --testPathPattern='(computeJobReadinessChip|buildAssignmentReadiness|readinessSnapshotV1|seedAssignmentReadinessItems)'
# → 5 suites, 70 tests passing

# Functions readiness tests (mocha).
( cd functions && ./node_modules/.bin/mocha --require ts-node/register 'src/__tests__/readiness/**/*.test.ts' )
# → 99 passing
```

### Verification gate

- [x] `tsc` clean on both projects (functions + client) — no NEW errors; pre-existing certifications/userActionItems test-file errors remain (unrelated, tracked separately).
- [x] Helper unit tests pass: empty inputs, computing vs orphan-red, single-item classification matrix, `csa_waived` dominance, aggregate rule, cross-collection processing, employee-side subset filter, label resolution, contributor sort.
- [x] Bridge integration tests pass: legacy caller sees no chip, new caller sees chip, snapshot comparable propagation.
- [x] Existing readiness mocha suite green (no regression to matchers / expiry helpers / reconcile job).
- [x] `syncHrxReadinessSnapshotV1` round-trip (write → parse → compare) holds when chip is present and when it is absent.

---

## Carry-overs (not blocking R.4)

- **`ppe_acknowledgement` severity (R.1):** verified `'hard'` in `shared/seedAssignmentReadinessItems.ts` — accidental deviation to `'soft'` was caught and corrected during R.1 verification. Spec D3.R1 and implementation now agree. No further action required.
- **R.0c backfill dry-run:** ships deployable, **must not** be run with `dryRun: false` in production until the dry-run report is signed off. Same safety pattern as R.0a/R.0b. Not blocked by R.4.

---

## Successor cross-refs

- **R.7** — *landed.* Worker Readiness tab (`ProfileReadinessTabContent.tsx`) renders `<JobReadinessChip size="lg" />` in the selected-assignment header (replaces the legacy 4-state `<Chip>` on per-shift rows; legacy chip retained as fallback on entity-scope rows). Honours `?tab=readiness&assignmentId=&itemId=&type=&source=` deep-link via `useSearchParams` — auto-selects assignment + scrolls + flash-highlights matching requirement rows. See `READINESS_R7_HANDOFF.md`.
- **R.8** — CSA cross-worker matrix — render `<JobReadinessChip size="inline" />` per cell. Same data source; popover should still use the per-(worker × shift) snapshot. Consider a virtualization-aware popover when matrix density is high.
- **R.3** — Mirror `severity` + `resolutionMethod` onto `EmployeeReadinessItem` so the chip helper can stop hard-coding `severity: 'hard'` for BG/drug/e-verify and so the `'csa_waived'` shortcut works on the employee side.
