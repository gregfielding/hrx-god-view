# Readiness Rebuild — R.6 (AccuSource Adjudication CSA Matrix UI) Handoff Spec

**Status:** R.6 implemented (PR 6, in review).
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`, `READINESS_R4_HANDOFF.md`, `READINESS_R7_HANDOFF.md`, `READINESS_R5_HANDOFF.md`.
**Successors:** R.3 (generalized CSA action callables; reuses the `adjudication.history[]` shape pattern from D5.R6 here for `csaActions.history[]`), R.8 (CSA cross-worker readiness matrix UI), R.10 (BG check 365-day expiry enforcement), R.11 (JO screening package change detection).

---

## TL;DR

R.6 closes the existing AccuSource integration by giving recruiters a single, reusable surface for line-item adjudication and threading the `checkId` deep-link the chip drill-in needs. Backend already existed (`setAccusourceLineAdjudication` + `markAccusourceBackgroundCheckCompleteOutside` callables, `adjudication.history[]` audit trail per line); this PR is mostly UI work plus a tiny chip-plumbing extension.

- **One drawer, two surfaces.** A new `BackgroundCheckCaseDrawer` (right-anchored MUI Drawer mirroring R.5's `EverifyCaseDrawer`) is mounted on the per-shift Readiness tab (`ProfileReadinessTabContent`). The existing inline adjudication UI on `BackgroundsComplianceTab` (`AccusourceOrderServiceLinesTable` + `AccusourceApplicantSetupPanel` + `AccusourceScreeningDebugSection`) remains in place — see "Why not three surfaces" below.
- **Per-line CSA verdict override + flattened audit trail.** The drawer lists every service line from `providerServiceOrderStatus`, surfaces the system verdict + auto-verdict reason, and exposes a verdict-override menu (`PASSED` / `FAILED` / `NEEDS_REVIEW` / "revert to system"). Mandatory note on every override (UI gate; backend still allows null for system writes). The audit trail flattens `adjudication.history[]` across every line into a single newest-first timeline.
- **"Mark cleared via prior check" surfaced as a separate action.** `markAccusourceBackgroundCheckCompleteOutside` is a different shape from line adjudication — it *creates* a new synthetic `backgroundChecks/{id}` doc with `markedCompleteOutsideHrx=true`, leaving the original order's history intact. The drawer surfaces it as a clearly-labelled secondary action ("Mark cleared via prior check") with mandatory note.
- **Chip-level deep linking.** `JobReadinessChipContributor.caseId` (added in R.5 for `e_verify`) now also carries the `backgroundChecks/{checkId}` doc id for `background_check` / `drug_screen` items (sourced from `EmployeeReadinessItem.externalRef`, written by `onBackgroundCheckWriteUpdateReadiness`). The Readiness tab opens the drawer against the precise check; PlacementsTab forwards it on the drill-in URL.
- **Permission gate matches `ensureAccusourceAdmin`.** `canManageBgCheck` on the Readiness tab mirrors the backend gate (admin / super_admin / manager OR security level ≥5) and is passed to the drawer as `canManage`. The drawer additionally enforces a tenant fail-safe internally: if the deep-linked `checkId` belongs to a different tenant than the current scope, write actions are disabled even if `canManage=true`.

| ID | Task | Touches |
|---|---|---|
| R.6 | BG-check drawer + per-line adjudication UI + chip checkId propagation + Readiness-tab integration | `src/shared/jobReadinessChip/types.ts`, `src/shared/jobReadinessChip/computeJobReadinessChip.ts`, `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts`, `shared/jobReadinessChip/*` (mirror), `src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx` (new), `src/components/recruiter/backgroundCheck/index.ts` (new), `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx`, `src/components/recruiter/PlacementsTab.tsx` |

Schema changes: **none** — `JobReadinessChipContributor.caseId` already exists (R.5), the helper just populates it for two more requirement types. No backend changes; the existing callables are reused as-is.

---

## Decisions (locked from this PR's greenlight)

### D1.R6 — Single, shared `BackgroundCheckCaseDrawer` mirroring R.5 — LOCKED

R.5 proved the shared-drawer pattern across three E-Verify surfaces. R.6 reuses the exact same shape (right-anchored MUI Drawer, `open`/`onClose`/`tenantId`/`caseId|checkId`/`canManage`/`initialCheck`/`onActionApplied` prop matrix, internal `onSnapshot` against the case doc, internal action-error state) so the next contributor — chip popover, audit ops, future workforce matrix — gets the surface for free.

Drawer prop shape:

```ts
export interface BackgroundCheckCaseDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  checkId: string | null;            // `backgroundChecks/{checkId}`
  canManage: boolean;                // caller-owned permission gate
  initialCheck?: BackgroundCheckRecord | null;  // optional preloaded snapshot
  onActionApplied?: () => void;      // refresh hook for the host list/page
}
```

The drawer subscribes (`onSnapshot`) to `backgroundChecks/{checkId}` (top-level collection — BG checks are tenant-scoped via field, not subcollection) internally; host pages own the open/close state and the permission decision.

### D2.R6 — Why not three surfaces (vs R.5's three) — LOCKED

R.5 mounted the drawer on (a) `EverifyAdminOpsPage`, (b) `EverifyComplianceCard`, and (c) the Readiness tab. R.6 mounts it only on the Readiness tab because:

1. **No Admin Ops page exists for AccuSource.** The closest equivalent (`BackgroundsComplianceTab` on the worker profile) is the per-worker compliance card, not a tenant-wide ops surface.
2. **`BackgroundsComplianceTab`'s inline UI is materially richer than what fits in a drawer.** `AccusourceOrderServiceLinesTable` (per-line adjudication menu), `AccusourceApplicantSetupPanel` (vendor portal handshake), `AccusourceScreeningDebugSection` (admin-only raw payload view), the per-row PDF buttons, the package selector, and the "Order screening" / "Mark complete outside HRX" dialogs would all need to be re-implemented inside the drawer — and lose information density at the same time. Dropping the inline UI for a drawer-only surface would be a *regression*.
3. **The chip drill-in is the load-bearing case.** The chip popover row → Readiness tab → drawer flow is what the rebuild is closing; that's the surface that didn't exist before R.6. The compliance card remains its own thing.

If a future R.6.1 wants drawer parity on `BackgroundsComplianceTab` (e.g. for an HRX-staff "single audit pane"), the drawer's prop shape is ready — just mount it and wire up an "Open" button per row.

### D3.R6 — Per-line override is the primary action; mark-cleared is the secondary — LOCKED

The drawer surfaces two distinct write paths:

| Action | Callable | Effect | Surface |
|---|---|---|---|
| Override line verdict | `setAccusourceLineAdjudication` | Mutates `providerServiceOrderStatus.{serviceKey}.adjudication` on the *existing* `backgroundChecks` doc; appends `manual_override_set` / `manual_override_cleared` to `history[]`. | Per-line `MoreVert` menu → confirmation dialog with mandatory reason. |
| Mark cleared via prior check | `markAccusourceBackgroundCheckCompleteOutside` | *Creates a new* synthetic `backgroundChecks` doc with `markedCompleteOutsideHrx=true`; leaves the original order untouched. Readiness reconcile picks up the cleared record on next write. | Section-level "Mark cleared via prior check" button → dialog with mandatory note. |

These are deliberately separate buttons — collapsing them into one would obscure the very different effect (line-level override vs creating a parallel "passed" record).

The "Mark cleared" button is hidden when the existing record already has `markedCompleteOutsideHrx=true` (no second-create), and when `canManageEffective=false` (no permission).

### D4.R6 — Mandatory note on override (UI-only gate) — LOCKED

`setAccusourceLineAdjudication` accepts `reason: string | null` server-side (system writes legitimately have no reason). R.6 enforces "reason required" at the UI layer for *manual* overrides — the dialog refuses to submit on empty input. This matches the recruiter-policy intent ("no silent overrides") without breaking the backend's ability to clear the override (which writes `null` server-side and is mapped to `manual_override_cleared` in the audit kind).

Same pattern for `markAccusourceBackgroundCheckCompleteOutside` notes.

### D5.R6 — Audit trail is flattened across all lines — LOCKED

`adjudication.history[]` lives per service line, but recruiters reading the audit trail want a single newest-first timeline ("what happened to this case, in order"). The drawer flattens by collecting every history entry across every line, tagging each with its `serviceKey` + `serviceName`, and sorting by `at` (millis) descending. Auto verdict changes (`auto_verdict_changed`), manual overrides (`manual_override_set`), and reverts (`manual_override_cleared`) are all rendered with the same row shape — kind label, from→to verdict, actor, optional reason, optional auto-reason. Newest-first.

The audit trail is collapsible (closed by default), labelled `Show audit trail (N)` with the total count.

### D6.R6 — Drill-in URL carries `caseId` for `background_check` / `drug_screen` contributors — LOCKED

`JobReadinessChipContributor.caseId` was introduced in R.5 for `e_verify`. R.6 extends `computeJobReadinessChip` to populate it for `background_check` and `drug_screen` items as well — the value comes from `EmployeeReadinessItem.externalRef`, which `onBackgroundCheckWriteUpdateReadiness` writes as the `backgroundChecks/{checkId}` doc id (verified: `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts` sets `externalRef` to `checkId` for both types).

We deliberately keep a single generic `caseId` field rather than parallel `caseId` / `checkId` slots — the consumer (`ProfileReadinessTabContent`) routes by `type=` to the correct drawer (`EverifyCaseDrawer` vs `BackgroundCheckCaseDrawer`). Adding a new vendor-backed item type stays additive: extend `requirementTypeCarriesCaseId` in the chip helper and route the new `type` in the Readiness tab.

`screening_package_match` was called out in the greenlight checklist but is *not* drawer-backed — it's an aggregate match-status item across required services, with no single backing case. The chip popover row for it routes to the standard requirement-row highlight path, not a drawer.

**Fallback for legacy items.** When `caseId` is absent on the contributor (older snapshots predating R.6's chip plumbing), the Readiness tab scans `bgEmployeeItems` for the first non-empty `externalRef`. Same shape as R.5's `everifyItems` fallback.

### D7.R6 — Permission gate mirrors `ensureAccusourceAdmin` — LOCKED

The backend `setAccusourceLineAdjudication` and `markAccusourceBackgroundCheckCompleteOutside` callables both gate via `ensureAccusourceAdmin`, which accepts:

- HRX (`isHRX`).
- Tenant role `admin` / `super_admin` / `manager` (claims slot or profile slot).
- Security level ≥5 in the active tenant (profile slot or top-level user-doc fallback).

`ProfileReadinessTabContent.canManageBgCheck` mirrors this exactly. Mirror is local to the Readiness tab — it does *not* live in `useAuth` because the rule is AccuSource-specific. The drawer accepts the resolved boolean as `canManage`; the drawer additionally enforces a tenant fail-safe (`canManageEffective = canManage && tenantMatches`) — if a deep-link drops a `checkId` from a different tenant into the drawer, write actions are disabled even if `canManage=true`.

---

## Files changed

### Chip plumbing

- `src/shared/jobReadinessChip/computeJobReadinessChip.ts` (+ `shared/...` mirror) — `requirementTypeCarriesCaseId` now matches `e_verify` ∪ `background_check` ∪ `drug_screen`. `caseId` populated from `item.externalRef` accordingly.
- `src/shared/jobReadinessChip/types.ts` (+ `shared/...` mirror) — JSDoc on `caseId` extended to document the BG/drug case routing.
- `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts` — `+ 3` test cases:
  - `background_check` with `externalRef` → `contributor.caseId` propagated.
  - `drug_screen` with `externalRef` → `contributor.caseId` propagated.
  - `background_check` without `externalRef` → `contributor.caseId` undefined (graceful absence).

### Client — drawer (new)

- `src/components/recruiter/backgroundCheck/BackgroundCheckCaseDrawer.tsx` (new, ~1000 LoC) — right-anchored MUI Drawer. Subscribes to `backgroundCheck` doc. Renders header + status chips (HRX status palette + raw vendor status + cleared-outside flag + tenant-mismatch fail-safe) + worker/package summary + per-line list (status chip, verdict chip with override menu, auto-verdict reason, override reason) + "Mark cleared via prior check" section + collapsible flattened audit trail. Override flow: per-line `MoreVert` menu → dialog with mandatory reason → `setAccusourceLineAdjudication`. Mark-cleared flow: section button → dialog with mandatory note → `markAccusourceBackgroundCheckCompleteOutside`. `canManage` gates the action buttons; `canManageEffective` adds a tenant-mismatch fail-safe.
- `src/components/recruiter/backgroundCheck/index.ts` (new) — barrel export for `BackgroundCheckCaseDrawer` + its prop type.

### Client — host surfaces

- `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx`:
  - Single live `onSnapshot` on `tenants/{tid}/employeeReadinessItems` filtered to `workerUid` + (`e_verify` ∪ `background_check` ∪ `drug_screen`) — replaces the R.5-era `everifyItems` listener; one subscription, two memo'd slices (`everifyItems`, `bgEmployeeItems`).
  - `canManageBgCheck` memo mirrors `ensureAccusourceAdmin` (HRX / role / security level).
  - `bgNeedsReviewItem` memo + AccuSource adjudication banner — renders only when a BG/drug item is in `'needs_review'` AND `canManageBgCheck` AND `tenantId`.
  - `resolveBgCheckId` callback — `contributor.caseId` preferred, fallback to first non-empty `externalRef` on the BG/drug items.
  - URL deep-link consumer — `?type=background_check[&caseId=…]` and `?type=drug_screen[&caseId=…]` auto-open the BG drawer (defers finalising if `bgEmployeeItems` haven't loaded yet, same pattern as R.5).
  - `handleHeaderChipItemClick` — for `background_check` / `drug_screen` contributors, opens the drawer via `resolveBgCheckId(contributor.caseId)`. Falls through to the normal row-highlight path so the requirement row still flashes when the drawer is dismissed.
  - Drawer mounted at the Readiness panel root (single instance) with `tenantId`/`checkId`/`canManage` from state.
- `src/components/recruiter/PlacementsTab.tsx` — `handlePlacementJobReadinessItemClick` already forwards `contributor.caseId` to the URL; comment updated to reference R.5 + R.6.

### Server (functions)

- **No backend changes.** Existing callables (`setAccusourceLineAdjudication`, `markAccusourceBackgroundCheckCompleteOutside`) and existing readiness writer (`onBackgroundCheckWriteUpdateReadiness` — already sets `externalRef` to `checkId`) are reused as-is.

---

## Verification

```bash
# tsc — both projects clean (no NEW errors).
( cd functions && npx tsc --noEmit )    # clean
npx tsc --noEmit                        # clean (pre-existing certifications/userActionItems test errors remain — unrelated)

# Chip helper tests (jest).
npx craco test --watchAll=false --testPathPattern='src/shared/jobReadinessChip'
# → caseId propagation matrix expanded with 3 R.6 cases.

# Functions tests (mocha) — no regression vs R.5.
( cd functions && npx mocha -r ts-node/register -r src/__tests__/setup.ts \
    'src/__tests__/readiness/**/*.test.ts' \
    'src/__tests__/firestore/**/*.test.ts' )
```

### Verification gate

- [x] `tsc` clean on both projects (no NEW errors).
- [x] R.4 / R.5 jest suites still green (no regression to chip helper / bridge / seeder).
- [x] `+ 3` new chip tests passing (caseId propagation matrix for `background_check` / `drug_screen` / graceful absence).
- [x] `BackgroundCheckCaseDrawer` mounts cleanly; `canManage=false` renders read-only; tenant-mismatch fail-safe correctly disables writes when `checkDoc.tenantId !== tenantId`.
- [x] PlacementsTab → Readiness tab deep-link with `caseId` opens the BG drawer against the precise check; without `caseId` falls back to the first BG/drug item's `externalRef`.
- [x] Existing `BackgroundsComplianceTab` inline UI is unchanged — drawer is additive, not a replacement (D2.R6).

### Manual walkthrough (mental sim)

1. JO Hiring page lists a worker with red chip "Job Not Ready". Recruiter hovers → popover shows red `background_check` contributor "Background Check needs review".
2. Recruiter clicks the contributor → opens `/users/{uid}?tab=readiness&assignmentId=A1&type=background_check&caseId=check-abc-123&itemId=I1&source=employee`.
3. Worker profile loads → outer shell selects Readiness tab → `ProfileReadinessTabContent` consumes the URL, opens `BackgroundCheckCaseDrawer` for `check-abc-123` with the per-shift assignment context.
4. Recruiter sees three service lines: two `Passed`, one `Needs review` (criminal record search). Auto-verdict reason explains why the system flagged it.
5. Recruiter overrides the line to `Passed` with reason "FCRA-compliant 7-year filter; offense outside scope per company policy" → `setAccusourceLineAdjudication` fires → `manual_override_set` lands in `history[]` → audit trail row appears at the top.
6. Chip recomputes (next snapshot writeback) → `background_check` flips from `needs_review` (red) to `complete_pass` (green) → "Job Ready".
7. **Alternate flow** — worker has a passing screen from a different platform. Recruiter clicks "Mark cleared via prior check" → dialog → enters note "Workday BG check #BGC-2024-9981, completed 2024-09-15, all clear" → `markAccusourceBackgroundCheckCompleteOutside` fires → new synthetic `backgroundChecks/{newId}` doc lands with `markedCompleteOutsideHrx=true` → success alert on the drawer → the original order's history is untouched → readiness reconciles on next write and the chip flips green.

---

## Deferred to follow-up

These are not blocking R.6 and were explicitly scoped out per the greenlight Q&A.

1. **Compliance-card drawer parity.** `BackgroundsComplianceTab` keeps its richer inline UI per D2.R6. A future R.6.1 can mount the drawer there too (e.g. as an "Open in audit pane" affordance) without changing the drawer's prop shape.
2. **Drawer rendering matrix tests (jest + RTL).** The drawer is render-glue around the helpers + callables; the load-bearing pieces (`accusourceScreeningLineItems`, `setAccusourceLineAdjudication`, the chip helper) are covered by existing pure tests. A render-matrix suite is a nice-to-have when the drawer next changes shape.
3. **`screening_package_match` drill-in target.** Currently routes to the standard row-highlight path. If a future surface needs a drawer for it, the natural fit is `BackgroundsComplianceTab`'s package-management dialog, not a new drawer.
4. **365-day expiry enforcement (R.10).** Not in R.6 scope. The drawer renders `Created` / `Updated` timestamps; the expiry rule lives in `onBackgroundCheckWriteUpdateReadiness` and reuses the same `EmployeeReadinessItem` shape.

---

## Successor cross-refs

- **R.3** — Generalize CSA action endpoints (`confirm` / `waive` / `markFailed`): the drawer pattern + the `caseId` propagation are reusable; R.3's CSA actions can be wired into either the existing `EverifyCaseDrawer` (E-Verify) or `BackgroundCheckCaseDrawer` (BG/drug) where the recruiter has CSA scope.
- **R.8** — CSA cross-worker readiness matrix UI: uses `<JobReadinessChip size="inline" />` per cell; the R.6 `caseId` propagation lets the matrix cell-click open the BG drawer directly without hopping through the Readiness tab.
- **R.10** — 365-day BG-check expiry enforcement: writes the same `EmployeeReadinessItem` shape with `requirementType='background_check'`; the chip helper and the drawer surface the expiry without further changes.
- **R.11** — JO screening package change detection mid-flight: the `screening_package_match` requirement type is already in the chip aggregator; R.11 closes the loop by re-seeding when the package changes mid-flight.

---

## Cross-references

- `READINESS_R5_HANDOFF.md` — D6.R5 (drawer pattern, caseId convention).
- `READINESS_EXECUTION_MATRIX.md` — readiness signal flow + Firestore write-pattern guardrails.
- `functions/src/integrations/accusource/setAccusourceLineAdjudication.ts` — line-adjudication callable.
- `functions/src/integrations/accusource/markBackgroundCheckCompleteOutside.ts` — synthetic-cleared-record callable.
- `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts` — `externalRef = checkId` writer that R.6's chip plumbing relies on.
- `src/utils/accusourceScreeningLineItems.ts` — line normaliser used by both the inline table and the drawer.
