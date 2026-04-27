# Readiness Rebuild — R.8 (CSA Cross-Worker Readiness Matrix UI) Handoff Spec

**Status:** Spec locked, kickoff pending.
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`, `READINESS_R3_HANDOFF.md`, `READINESS_R4_HANDOFF.md`, `READINESS_R5_HANDOFF.md`, `READINESS_R6_HANDOFF.md`, `READINESS_R7_HANDOFF.md`.
**Successors:** R.10 (BG check 365-day expiry enforcement), R.11 (JO screening package change detection mid-flight); R.8.1 noted under Deferred.

---

## TL;DR

R.8 is the cross-worker × requirement-category matrix for CSA bulk-ish triage — the surface that lets a CSA confirm uniforms for 30 workers in one pass instead of opening 30 worker profiles. The technical core is already shipped:

- The chip component (`JobReadinessChip`) supports `size="inline"` (R.4 — its JSDoc names R.8 explicitly).
- The CSA action callables (`confirmReadinessItem` / `waiveReadinessItem` / `markReadinessItemFailed`) are live with idempotency, audit history, and admin gate (R.3).
- The vendor drawers (`EverifyCaseDrawer` / `BackgroundCheckCaseDrawer`) are reusable from R.5 / R.6.
- The chip data lives on `assignments.readinessSnapshotV1.jobReadinessChip` and on the `(worker × hiringEntity)` rows in `employeeReadinessItems` (R.4 + Phase D groundwork).

R.8 is the assembly job: paginated query → matrix grid → inline chip per cell → per-cell action menu → bulk-action drawer → vendor-drawer drill-in. **No new endpoints, no new schemas, no new triggers.** All movement is presentation + state-machine wiring on the read side, plus client-side fan-out of the existing R.3 callables on the write side.

| ID | Task | Touches (planned) |
|---|---|---|
| R.8 | Matrix view toggle in Workforce > Employee Readiness; paginated `getDocs` data layer; inline chip per cell; per-cell action menu (R.3 reuse); bulk-action bar (client-side fan-out + idempotency); vendor-drawer drill-in (R.5/R.6 reuse); cross-tenant scope hint (R.3 server-enforces) | `src/pages/WorkforceEmployeeReadiness.tsx` (toggle); `src/components/workforce/MatrixView/*` (new); `src/hooks/useReadinessMatrixPage.ts` (new); `src/components/recruiter/everify/EverifyCaseDrawer.tsx` + `src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx` (decoupling refactor IFF L6 verification fails); `docs/READINESS_R8_HANDOFF.md` (this doc) |

No schema changes. No Cloud Functions changes. No new tests required at the function layer (the helpers + callables are unchanged). React Testing Library coverage for the new matrix view + bulk-action machine is part of the PR.

---

## Prerequisites — must hold before R.8 ships

R.8 reads `readinessSnapshotV1.jobReadinessChip` and assumes R.1 item shapes. Both depend on the readiness rebuild being deployed AND production data being in shape:

1. **Readiness Cloud Functions deployed.** As of this doc, `functions/lib/readiness/syncHrxReadinessSnapshotV1.cjs` is current locally but the production deploy predates the R.0–R.7 megacommit (`ca555054`). See the chip-stuck bug investigation transcript for the probe data: 0/43 sampled assignments in `BCiP2bQ9CgVOCTfV6MhD` have `jobReadinessChip` because the deployed writer is pre-R.4. R.8 cannot ship until this is resolved.
2. **One-time snapshot refresh** for legacy assignments after deploy. The trigger doesn't fire on its own; the dedicated refresh script (modelled on the R.0c cleanup script) needs to run tenant-by-tenant.
3. **R.1 backfill (`backfillAssignmentReadinessItemsCallable`) executed with `--no-dry-run`.** Production probe shows 1/15 items carry `severity` / `resolutionMethod` in the C1 tenant — pre-R.1 items will misclassify as soft (yellow) instead of hard (red) until backfilled. Order: backfill items → recompute snapshots → matrix reads correct chips.

These prereqs are tracked separately from R.8 (chip-stuck-bug fix sequence), but R.8 implementation should not start until at least Prereq 1 is done — otherwise the matrix renders an entire page of `'computing'` cells in QA and the implementer can't tell their wiring apart from the data shape.

---

## Decisions (locked from this PR's greenlight)

### D1.R8 — Sequencing: matrix is a SECONDARY view via toggle, not a replacement — LOCKED

R.8 ships a "Matrix" / "List" toggle next to the existing `WorkforceScopeToggle` on `WorkforceEmployeeReadiness`. List view (Phase D.1.1a + the reserved D.1.1b/c shells) stays the primary triage surface; matrix view is the per-category bulk power tool.

**Why:** different mental models. List view is per-item triage where the CSA's question is "what does this worker still need?". Matrix view is per-category bulk where the question is "of the 50 workers I just placed, who's missing PPE acknowledgement?". Merging them produces a worse version of both.

**Consequence:** D.1.1b (per-item inline expansion) and D.1.1c (worker-level `⋯` + bulk-action bar) **continue to be reserved** in `WorkerReadinessRow.tsx`'s disabled action shells. R.8 does NOT pre-empt them. After R.8 ships and gets traffic, a separate decision can be made about whether D.1.1b/c still earn their keep — that decision is **not gated on R.8** and not in scope here.

### D2.R8 — Granularity: row per (worker × hiringEntity); cell per requirement category — LOCKED

Each row aggregates across that worker's assignments under the entity. A cell shows the `inline` chip computed over the union of underlying items (assignment-side + employee-side). Drill-in (popover row click, or per-cell vendor-drawer launch) picks the specific assignment or case when needed.

**Why:** matches Greg's per-person preference, matches the existing D.1.1a row layout, scales by worker count rather than (worker × shift) count. Per-shift detail isn't lost — it's just one click away via the chip popover (`JobReadinessChipPopover`) or the per-cell vendor drawer.

**Cell-data sources:**

| Cell category | Read from | Notes |
|---|---|---|
| Per-shift items (cert, license, willingness, skill_match, education_match, language_match, experience_match) | `assignmentReadinessItems` filtered by the worker's assignments under the entity | Aggregated across assignments to one chip per category. Underlying items remain accessible via popover. |
| BG / drug / E-Verify | `employeeReadinessItems` for `(workerUid, hiringEntityId)` | Job-level subset per `EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES`; vendor cells (see D5.R8). |
| `shift_confirmation` | `assignmentReadinessItems` | Aggregate across this entity's open shifts. (Soft-hide if no live shifts under the entity for the worker.) |

The matrix never reads `readinessSnapshotV1.jobReadinessChip` directly per cell — the snapshot chip is per-shift, not per-category. The matrix recomputes per-category aggregates from the underlying items. Chip *colour rules* are reused via the `computeJobReadinessChip` classifier so colour logic stays single-sourced; only the grouping changes.

### D3.R8 — Listener budget: paginated `getDocs` + manual refresh, NOT `onSnapshot` — LOCKED

Listening per cell across a paginated page (50 rows × ~10 cells) is a memory grenade. R.7 proved `onSnapshot` works at single-worker scale; R.8 explicitly does not extend that pattern.

**Pattern:**

1. **Page load:** paginated `getDocs` against `tenants/{tenantId}/assignments` filtered by tenant + workforce scope, ordered by something stable (e.g. `(workerUid, jobOrderId)`). Page size: **50 rows of (worker × hiringEntity) groups**, derived after grouping the assignment query results. Project the snapshot fields actually needed for the chip aggregation; avoid reading the whole assignment doc when possible.
2. **Per-page employee-side fetch:** one `where('workerUid', 'in', [...batch of ≤30])` query against `employeeReadinessItems` per page, filtered down to `EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES`. Two batches per 50-row page (Firestore caps `in` at 30 — handle ≤60 workers per page if grouping yields more workers than page rows).
3. **Refresh button.** Clearly visible header affordance (NOT buried in a `⋯` menu). Re-runs both queries for the current page. Throttle to one refresh per ~3s to prevent button-mash storms.
4. **Targeted invalidation after CSA action.** When a per-cell or bulk action completes, re-fetch ONLY the affected (worker × entity) rows — not the whole page. Bulk-action fan-out captures the affected rows up-front, so the post-action invalidation set is known.

**Cardinality:** 50 rows × 2 batched employee queries × 1 assignment query = ~3 round-trips per page load. Acceptable.

**Live updates:** the matrix is intentionally not live. A bulk-confirm by another CSA in another tab is reflected on the next refresh. This is the right trade-off: the matrix is a tool for the CSA actively working it, not a dashboard for passive monitoring (the list view is for that).

### D4.R8 — Bulk action UX: client-side fan-out, idempotent, partial-failure-tolerant — LOCKED

R.3 is per-item only; bulk = `Promise.allSettled` fan-out client-side. Five rules:

1. **Selection cap: 50 cells.** Hard cap in the selection UI. If a CSA tries to select beyond the cap, the over-cap rows just don't toggle (or render disabled-with-tooltip). Pulled from L4 default; revisit when we have user feedback.
2. **Per-row outcome surfaced.** The bulk-action toast or follow-up drawer shows ✓ / failed-with-reason per row. The drawer is the right surface when failures > 0; the toast is enough when all rows succeeded.
3. **Failed rows stay selected.** Successful rows clear from the selection set; failures remain so a CSA can correct (or change the action) and retry without re-selecting.
4. **R.3 idempotency tuple is the dedup mechanism.** The server short-circuits a re-confirm of an already-confirmed item with identical note (`unchanged: true`). The client treats `unchanged: true` as success in the bulk report — the cell already had the desired terminal state.
5. **Note semantics:** confirm allows empty; waive + markFailed require non-empty trimmed input. The note is **batch-level** — a single mandatory note applies to every row in the bulk waive/markFailed. If a CSA wants per-row notes, they fall back to per-cell action.

The fan-out concurrency is capped at **5 in-flight calls** to avoid flooding the callable; for a 50-row batch that's ~10 round-trip waves. Over a sane network this is sub-3s. A progress indicator surfaces during the fan-out.

### D5.R8 — Excluded-type routing: vendor cells open vendor drawers — LOCKED

Per-cell action menu logic uses the existing `CSA_READINESS_ACTION_EXCLUDED_TYPES` constant from `shared/csaReadinessActionTypes.ts` — single source of truth for both the matrix UI and the R.3 server-side rejection.

| `requirementType` | Per-cell menu |
|---|---|
| `e_verify` | "Open E-Verify case" → `EverifyCaseDrawer` (R.5) |
| `background_check` | "Open background check" → `BackgroundCheckCaseDrawer` (R.6) |
| `drug_screen` | "Open drug screen" → `BackgroundCheckCaseDrawer` (R.6) |
| `screening_package_match` | "Open background check" → `BackgroundCheckCaseDrawer` (R.6) — package-match is the screening-package mirror of the BG case |
| All others | "Confirm…" / "Waive…" / "Mark failed…" → R.3 callables |

For the vendor cells, the per-cell menu does NOT show confirm/waive/markFailed — even disabled. Mixing vendor and non-vendor actions in the same menu is the kind of subtle UX failure that produces the "I clicked confirm and it errored" support ticket. Single-action menu per cell is the rule.

For bulk actions, vendor cells are **uncheckable** in the matrix selection UI (the selection checkbox is hidden, with tooltip "Vendor case — open the case drawer to act"). Mixing vendor + non-vendor cells in a bulk batch is incoherent (which action would the bulk run?).

### D6.R8 — Drawer mount: VERIFY decoupling first, then refactor IFF coupled — LOCKED

Both `EverifyCaseDrawer` and `BackgroundCheckCaseDrawer` are currently mounted from `ProfileReadinessTabContent`. R.8 needs to mount them at the matrix level. Verification step **before** code starts:

1. Read both drawer components and confirm their props are self-contained (`caseId` / `tenantId` / `canManage` / `onClose` / `onUpdated` and similar).
2. Confirm neither drawer pulls implicit state from `ProfileReadinessTabContent` via context, ref forwarding, or sibling-effects.

If both drawers are clean → mount them at the matrix level with the same props. No refactor.

If either is coupled → small lift-and-shift refactor as part of R.8: pull the implicit dependency into props, update `ProfileReadinessTabContent` to pass it explicitly, mount at the matrix level. Should be < 1 hour of work; if it's bigger than that, file a separate cleanup PR before R.8 lands.

### D7.R8 — Filter dimensions: client-side post-page for MVP — LOCKED

Filter UI (blockers only / pending CSA action / severity hard-vs-soft / by JO / by worksite) operates on the **already-paginated** matrix page client-side. Page size is small (≤50 rows) so the filter cost is trivial.

**Why client-side:**

1. Server-side `(tenantId, jobOrderId)` and `(tenantId, worksiteId)` indexes on `assignments` are not yet shipped. Adding them preemptively is wasted ops if the matrix usage pattern doesn't actually need them.
2. The matrix is already paginated; the filter is a refinement of the visible page, not a server query optimization.
3. Filter state is purely UI — no URL parameter, no Firestore query rewrite. Trivial to ship.

**When to upgrade to server-side narrowing (R.8.1, deferred):** when production telemetry shows tenants where the unfiltered page is > 200 rows AND CSAs report "I keep paginating because my filter hides most of the visible page." Tracking this as a follow-up only — do not preemptively add the indexes.

### D8.R8 — Cross-tenant scope: matrix scoped to one tenant via existing toggle; UI hint + server gate — LOCKED

The matrix scopes to one tenant at a time using the existing `WorkforceScopeToggle`. For workers in tenants where the current user lacks readiness CSA admin privilege (security level <5 OR not in the role allowlist per `ensureReadinessCsaAdmin`), the per-cell action menu **renders disabled** (button visible, action items grayed out, tooltip explains "no admin role in this tenant").

**Two-layer enforcement:**

1. **UI hint (matrix component):** prevents the affordance from appearing actionable for cells the user genuinely can't act on. Uses the same role resolver pattern as the existing per-tenant gate — read once at matrix mount, cache in state for the page lifetime.
2. **Server gate (R.3 callables):** `ensureReadinessCsaAdmin` already enforces per-tenant. The UI hint is a UX nicety; the server is the security boundary. If the UI hint has a bug and a cell is wrongly enabled, the callable rejects the action with `permission-denied`.

Today the workforce workspace is single-tenant in production, so this is mostly forward-looking. Enforcing both layers now makes future multi-tenant enablement safe to ship without re-litigating UX.

---

## Files (planned)

### New

- **`src/components/workforce/MatrixView/index.tsx`** — top-level matrix component. Owns page state (selection set, filter state, refresh trigger). Renders header (toggle + filter bar + refresh button), grid (rows × category columns), and bulk-action bar (visible when selection > 0).
- **`src/components/workforce/MatrixView/MatrixRow.tsx`** — one row per (worker × hiringEntity). Renders worker avatar + name + entity sub-label (matches `WorkerReadinessRow` styling for visual consistency between list / matrix).
- **`src/components/workforce/MatrixView/MatrixCell.tsx`** — one cell per (row × requirement category). Renders the inline `JobReadinessChip` over per-category aggregated items. Owns the per-cell action menu (vendor vs non-vendor branch via `CSA_READINESS_ACTION_EXCLUDED_TYPES`).
- **`src/components/workforce/MatrixView/BulkActionBar.tsx`** — sticky footer when selection > 0. Action picker (confirm / waive / markFailed), batch note input, fan-out launcher, progress + outcome surfacing.
- **`src/components/workforce/MatrixView/MatrixFilterBar.tsx`** — inline filter chips (blockers / pending / severity / JO picker / worksite picker). Pure client-side filter state.
- **`src/hooks/useReadinessMatrixPage.ts`** — paginated `getDocs` + employee-side batched query, page-cursor state, refresh trigger, targeted-row invalidation.
- **`src/utils/readinessMatrix/aggregateByCategory.ts`** — pure helper. Takes assignment + employee items for a (worker × entity), returns `Map<categoryKey, JobReadinessChipData>` reusing `computeJobReadinessChip`'s classifier.
- **`src/utils/readinessMatrix/__tests__/aggregateByCategory.test.ts`** — jest unit tests for the aggregator.

### Modified

- **`src/pages/WorkforceEmployeeReadiness.tsx`** — adds the List/Matrix toggle next to `WorkforceScopeToggle`. Renders `<MatrixView />` instead of the table when toggle is "Matrix". List view code path unchanged.

### Conditionally modified (D6.R8 verification outcome)

- **`src/components/recruiter/everify/EverifyCaseDrawer.tsx`** and / or **`src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx`** — refactor IFF the verification step finds either drawer coupled to `ProfileReadinessTabContent` state. If clean, untouched.

### Tests

- **`src/components/workforce/MatrixView/__tests__/MatrixView.test.tsx`** — render + selection interaction + bulk-action machine + vendor-drawer drill-in. Mocks `useReadinessMatrixPage`.
- Existing R.4 / R.7 jest suites — confirm no regression (`computeJobReadinessChip`, `buildAssignmentReadiness`, `readinessSnapshotV1`, `seedAssignmentReadinessItems`).

---

## Verification gate

Same gate pattern as R.7. All must pass before merge:

- [ ] `tsc --noEmit` clean on both projects (no NEW errors; pre-existing certifications/userActionItems test-file errors remain — unrelated).
- [ ] R.4 chip-helper jest suites pass unchanged.
- [ ] New `aggregateByCategory.test.ts` unit tests pass (red-mix + yellow-mix + waiver-dominates + empty cases).
- [ ] New `MatrixView.test.tsx` integration tests pass (render → select → bulk confirm → see ✓ → failed-rows-stay-selected).
- [ ] Manual walkthrough on the C1 tenant against deployed R.4 chip data:
  1. Open Workforce > Employee Readiness; toggle to Matrix.
  2. Confirm 50-row page loads with chips populated (NOT computing).
  3. Click a non-vendor cell → action menu shows Confirm/Waive/MarkFailed.
  4. Click an E-Verify cell → action menu shows "Open case" → `EverifyCaseDrawer` opens with the right `caseId`.
  5. Select 5 cells across one category → bulk-confirm → toast shows 5 ✓.
  6. Select 5 cells; deliberately include one already-confirmed → bulk-confirm → 5 ✓ (idempotency lands `unchanged: true` for the already-confirmed cell, surfaced as success).
  7. Refresh button → page re-fetches, chips repopulate without flicker.
  8. Switch to a tenant where the current user lacks admin → per-cell menus render disabled with tooltip.
- [ ] D6.R8 verification step explicitly recorded in the PR description (drawer dependencies confirmed clean OR refactor diff included).

---

## Deferred follow-ups

These are explicitly out of scope for R.8 and tracked here so they don't get lost.

1. **R.8.1 — Server-side filter narrowing.** New `(tenantId, jobOrderId)` and `(tenantId, worksiteId)` indexes on `assignments`, plus filter-bar UI that drives the page query rather than client-side post-filter. Triggered when matrix pages exceed ~200 unfiltered rows AND CSAs report visibility issues.
2. **`useWorkerReadinessV1` hook integration.** This hook (`src/hooks/useWorkerReadinessV1.ts`) could become the canonical access point for per-worker readiness data; the matrix could share it with `ProfileReadinessTabContent`. Not blocking — the per-page hook in R.8 is fine for the matrix-specific access pattern.
3. **Live updates in matrix view.** Today the matrix is intentionally `getDocs` + manual refresh. If product feedback says CSAs want live, the right pattern is per-page `onSnapshot` on the `assignments` collection scoped to the current page's worker uids — NOT per-cell listeners.
4. **Per-cell audit timeline.** R.3 D9 deferred the full timeline ("show all 4 actions on this row") to R.8. Reasonable home: per-cell drawer that opens on long-press / shift-click, showing `csaActions.history[]`. Worth doing as a fast-follow once R.8 ships and CSAs confirm the matrix is the right surface for it.
5. **Sidebar inline chip per assignment row.** R.7 D1 deferred swapping the assignment-list sidebar's legacy 4-state chip for the new inline variant. R.8 proves the inline variant in production; the swap can land as a tiny follow-up PR.

---

## Successor cross-refs

- **R.10 — BG check 365-day expiry enforcement.** Independent of R.8; mentions R.8 only because the matrix surface is where expiry-driven yellow→red transitions become visible at scale.
- **R.11 — JO screening package change detection mid-flight.** Same — independent, but the matrix is where mid-flight package changes surface across affected workers in one view.
- **R.8.1 (deferred) — server-side filter narrowing.** See Deferred follow-up 1.
- **R.9 — Worker profile-edit UI in Flutter.** Worker-side counterpart for re-attesting; R.8 is the recruiter-side counterpart. Both feed the same R.3 / R.5 / R.6 endpoints.
