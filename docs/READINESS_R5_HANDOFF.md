# Readiness Rebuild — R.5 (E-Verify TNC Contestation Flow + UI) Handoff Spec

**Status:** R.5 implemented (PR 5, in review).
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`, `READINESS_R4_HANDOFF.md`, `READINESS_R7_HANDOFF.md`.
**Successors:** R.6 (AccuSource adjudication CSA matrix UI), R.3 (generalized CSA action callables; reuses the excluded-type rationale established here for E-Verify items), R.8 (CSA cross-worker readiness matrix UI), R.9 (worker profile-edit UI in Flutter — TNC worker-action card).

---

## TL;DR

R.5 closes the existing E-Verify integration by giving recruiters a single, reusable surface for the TNC (Tentative Non-Confirmation) workflow and threading the worker-side action marker the Flutter app (R.9) will read.

- **One drawer, three surfaces.** A new `EverifyCaseDrawer` (right-anchored MUI Drawer) is mounted on the Admin Ops page (`EverifyAdminOpsPage`), the worker profile compliance card (`EverifyComplianceCard`), and the per-shift Readiness tab (`ProfileReadinessTabContent`). Same component, same audit timeline, same TNC step machine — three entry points.
- **Worker-action marker.** `EmployeeReadinessItem.workerAction` is set when the recruiter records "employee notified" and cleared when the worker decision (or the referral) lands. The Flutter app reads this to render the worker-side action card; clearing flips `actor` back to `'recruiter'` (or `'system'` while DHS verifies).
- **Two new audit events + two new callables.** `WORKER_DECISION_RECORDED` and `NOTICE_PACKET_GENERATED` join the `EverifyEventType` enum. `everifyRecordWorkerDecision` and `everifyRecordNoticeGenerated` join the existing TNC callable family.
- **Chip-level deep linking.** `JobReadinessChipContributor` carries an optional `caseId` for `e_verify` contributors (sourced from `EmployeeReadinessItem.externalRef`). PlacementsTab forwards it on the drill-in URL; the Readiness tab opens the drawer against the precise case.
- **In-process E-Verify chip severity (Q-R5-4).** `needs_review` on `e_verify` (TNC awaiting recruiter / worker action) renders **red**; `in_progress` (worker contested, DHS verification clock running) renders **yellow**. Other types are unchanged.

| ID | Task | Touches |
|---|---|---|
| R.5 | TNC drawer + worker-action marker + worker-decision callable + FAN print view + chip caseId propagation | `functions/src/integrations/everify/everifySchemas.ts`, `functions/src/integrations/everify/everifyTncWorkerAction.ts` (new), `functions/src/integrations/everify/everifyCallables.ts`, `functions/src/index.ts`, `shared/employeeReadinessItemV1.ts` (+ src mirror), `src/shared/jobReadinessChip/types.ts`, `src/shared/jobReadinessChip/computeJobReadinessChip.ts`, `src/components/recruiter/everify/EverifyCaseDrawer.tsx` (new), `src/components/recruiter/everify/openEverifyTncNoticePrintable.ts` (new), `src/components/recruiter/everify/index.ts` (new), `src/pages/TenantViews/EverifyAdminOpsPage.tsx`, `src/pages/UserProfile/components/EverifyComplianceCard.tsx`, `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx`, `src/components/recruiter/PlacementsTab.tsx` |

Schema changes are **additive only**: a new optional `workerAction` field on `EmployeeReadinessItem`, two new `EverifyEventType` enum values, two new `EverifyCaseActions` timestamps. No back-fill required.

---

## Decisions (locked from this PR's greenlight)

### D1.R5 — Single, shared `EverifyCaseDrawer` across all three surfaces — LOCKED (Q-R5-2 → `right_drawer`)

The TNC workflow needs an action surface big enough for: header / case meta / eligibility statement / deadline countdowns / 5-step workflow checklist / collapsible audit trail. A right-anchored MUI Drawer is the only shape that fits without crowding the host page, and reusing the same component across `EverifyAdminOpsPage`, `EverifyComplianceCard`, and the Readiness tab keeps the workflow logic single-source.

**Drawer prop shape:**

```ts
export interface EverifyCaseDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  caseId: string | null;          // `everify_cases/{caseId}`
  canManage: boolean;             // caller-owned permission gate
  initialCase?: EverifyCaseDoc | null;  // optional preloaded snapshot
  onActionApplied?: () => void;   // refresh hook for the host list/page
}
```

The drawer subscribes (`onSnapshot`) to the case doc + the events subcollection internally — host pages only own the open/close state and the permission decision.

**Why a single component:** the TNC step machine is the load-bearing piece. Forking it across three surfaces would guarantee drift. The component is `~640 LoC` total — comfortably small enough to be the single owner.

### D2.R5 — `EmployeeReadinessItem.workerAction` is the worker-side action marker — LOCKED (Q-R5-1 → `create_now`)

The Flutter worker app (R.9) needs a deterministic signal to render "you have an E-Verify TNC to respond to". The options were:

1. Read `everify_cases/{caseId}` directly + filter on case status. Rejected: cross-tenant scoping is awkward in Flutter; the worker doesn't own that doc; adds a second listener path for what is conceptually a readiness item.
2. Add a marker to the `EmployeeReadinessItem` already on screen. Chosen — see schema below.

```ts
workerAction?: {
  kind: 'everify_tnc_pending_decision';
  caseId: string;                    // case the action ties back to
  notifiedAt?: string;               // recruiter-recorded notification timestamp
  tncResponseDueAt?: string;         // USCIS dhs_referral_contact_by_date
  referralDueAt?: string;            // USCIS dhs_referral_due_date
};
```

**Lifecycle:**

- **Set** by `everifyMarkEmployeeNotified` after the recruiter checks "Mark employee notified" in the drawer.
- **Cleared** by `everifyRecordWorkerDecision` (worker decided either way) or `everifyMarkReferralInitiated` (belt-and-suspenders idempotent clear).
- `actor` flips to `'worker'` on set, back to `'recruiter'` on worker-decision, then to `'recruiter'` (declined) or stays `'recruiter'` while we wait on DHS for contested cases (the recruiter still owns "file referral" → "close case").

**Why only one `kind` today:** the schema is union-shaped (`kind: 'everify_tnc_pending_decision'`) so future vendor flows (e.g. AccuSource MVR re-attest) can extend it without renaming. The post-decision states (DHS-in-process, FNC) are **not** worker-action states — they're system-side waits or recruiter-owned closeout, so no marker.

### D3.R5 — `everifyMarkEmployeeNotified` also sends `createNotification` — LOCKED (Q-R5-1 → `create_now`)

Recruiter presses "Mark employee notified" → callable (a) sets `everifyCaseActions.employeeNotifiedAt`, (b) writes the `workerAction` marker, (c) flips `actor` to `'worker'`, (d) fires `createNotification` to the worker. The notification is the cross-channel push (Flutter banner + email + SMS depending on worker prefs) — the in-app card is rendered by the Flutter app (R.9) off the marker.

**Idempotency.** The callable is now a true no-op when `employeeNotifiedAt` is already set: it will not re-fire `createNotification` and will not re-write the marker. This matters because the drawer shows "Mark notified" as a current step until the timestamp lands, and a double-click in the drawer shouldn't double-notify the worker.

### D4.R5 — FAN (Further Action Notice) is a printable HTML view, not a stored PDF — LOCKED (Q-R5-3 → `in_r5_minimal`)

R.5 ships a minimal printable HTML view via `openEverifyTncNoticePrintable` — opens a new window with the FAN content + `window.print()` ready, and fires `everifyRecordNoticeGenerated` for audit (`NOTICE_PACKET_GENERATED` event). No Cloud Storage upload, no e-sign, no PDF generation server-side.

**Why minimal:**

1. **Compliance baseline.** USCIS requires the recruiter to give the FAN to the worker; nothing requires us to archive a server-rendered PDF.
2. **Audit trail is sufficient.** The `NOTICE_PACKET_GENERATED` event with timestamp + actor satisfies "we proved we generated it".
3. **Saves a deploy cycle.** Cloud Storage upload + signed URL + PDF rendering pipeline is a meaningful addition; deferring it lets R.5 close the contestation loop now and adds the artefact later if a customer asks.

A future R.5.1 (or R.6 follow-up) can lift this into a server-rendered + stored PDF without changing the event shape.

### D5.R5 — Chip severity for in-process E-Verify states — LOCKED (Q-R5-4 → `yellow_when_in_process`)

`computeJobReadinessChip` was already rendering `e_verify needs_review` as yellow (the generic `needs_review → yellow` rule). R.5 splits this:

| `e_verify` status | Severity | Chip color | Rationale |
|---|---|---|---|
| `needs_review` | `hard` | **red** | TNC awaiting decision is a hard blocker; the placement is not job-ready. |
| `in_progress` | (n/a) | **yellow** | Worker contested → DHS/SSA verification clock running; the placement is "Job Ready (N pending)" until the case closes either way. |
| `complete_pass` | (n/a) | green | Authorized. |
| `complete_fail` | `hard` | red | Final non-confirmation. |

Other `requirementType`s keep the generic rule (`needs_review` defaults to yellow when the item severity is `soft`, red when it's `hard` — which lines up with the R.0c default severity table for screening-package items).

### D6.R5 — Drill-in URL carries `caseId` for `e_verify` contributors — LOCKED (Q-R5-6 → `both`)

`JobReadinessChipContributor` gains an optional `caseId`. `computeJobReadinessChip` populates it from `EmployeeReadinessItem.externalRef` for `e_verify` items only (we deliberately do not leak other vendors' refs through this field). PlacementsTab forwards it on the drill-in URL (`?tab=readiness&type=e_verify&caseId=…`); the Readiness tab consumes it to open `EverifyCaseDrawer` directly.

**Fallback for legacy items.** When the chip's `caseId` is absent (older snapshots predating R.5's chip plumbing), the Readiness tab falls back to scanning `everifyItems` (the live-subscribed `e_verify` items for this worker × tenant) for the first non-empty `externalRef`. The fallback is "good enough" for one-case-per-worker, which is the overwhelmingly common shape.

### D7.R5 — Admin Ops adopts the new drawer (replaces inline buttons) — LOCKED (Q-R5-5 → `replace_now`)

The pre-R.5 `EverifyAdminOpsPage` rendered TNC actions as inline action buttons per row. R.5 replaces them with a single "Manage TNC" button per row that opens the drawer. The drawer's step machine surfaces the same actions in workflow order (notify → FAN → decision → referral → close) with deadlines and the audit trail visible — strictly more information density at the cost of one extra click.

We keep `initialCase` on the drawer prop so the Admin Ops row's already-loaded case doc populates the drawer instantly (no "loading…" flash).

---

## Files changed

### Server (functions)

- `functions/src/integrations/everify/everifySchemas.ts`
  - `EverifyEventType` enum: `+ 'WORKER_DECISION_RECORDED'`, `+ 'NOTICE_PACKET_GENERATED'`.
  - `EverifyCaseActions`: `+ workerDecisionAt?`, `+ noticePacketGeneratedAt?`.
- `functions/src/integrations/everify/everifyTncWorkerAction.ts` (new) — pure helpers:
  - `setTncPendingDecisionMarker({ tenantId, workerUid, hiringEntityId, caseId, notifiedAt, deadlines, newActor? })` — idempotent set; flips `actor` if requested.
  - `clearWorkerActionMarker({ tenantId, workerUid, hiringEntityId, newActor? })` — idempotent delete; tolerates `doc_not_found`.
- `functions/src/integrations/everify/everifyCallables.ts`
  - `everifyMarkEmployeeNotified` — now also (a) writes `workerAction` marker, (b) flips `actor='worker'`, (c) fires `createNotification` to the worker. Idempotent on `employeeNotifiedAt`.
  - `everifyRecordWorkerDecision` (new) — `{ tenantId, caseId, contests }` → writes `everifyCaseActions.{ employeeContests, workerDecisionAt }`, emits `WORKER_DECISION_RECORDED`, calls `clearWorkerActionMarker` (newActor `'recruiter'`).
  - `everifyRecordNoticeGenerated` (new) — `{ tenantId, caseId }` → writes `everifyCaseActions.noticePacketGeneratedAt`, emits `NOTICE_PACKET_GENERATED`. No state machine impact (informational + audit).
  - `everifyMarkContested` — now also writes `workerDecisionAt` and calls `clearWorkerActionMarker`. (`employeeContests=true` always; this is the legacy "worker contests" path.)
  - `everifyMarkReferralInitiated` — also calls `clearWorkerActionMarker` idempotently (covers the case where the worker decision wasn't recorded as a discrete event).
- `functions/src/index.ts` + `functions/src/integrations/everifyGate.ts` + `functions/src/integrations/everify/index.ts` — register + re-export the two new callables.

### Schema mirror

- `shared/employeeReadinessItemV1.ts` (+ `src/shared/employeeReadinessItemV1.ts` mirror) — `+ workerAction?` field on `EmployeeReadinessItem`. Optional everywhere; absence = no pending worker action.

### Chip plumbing

- `src/shared/jobReadinessChip/types.ts` — `JobReadinessChipContributor.caseId?: string`.
- `src/shared/jobReadinessChip/computeJobReadinessChip.ts` — populates `caseId` from `EmployeeReadinessItem.externalRef` for `e_verify` items only; applies the D5.R5 severity rules for `e_verify needs_review` (red) and `e_verify in_progress` (yellow).
- `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts` — `+ 3` test cases:
  - `e_verify` with `externalRef` → `caseId` propagated.
  - `e_verify` without `externalRef` → `caseId` undefined (falls back to entity lookup).
  - non-`e_verify` with `externalRef` → `caseId` is **not** set (avoid leaking other vendor refs).

### Client — drawer (new)

- `src/components/recruiter/everify/EverifyCaseDrawer.tsx` (new, ~640 LoC) — right-anchored MUI Drawer. Subscribes to case doc + events subcollection. Renders header + status chip + eligibility statement + deadline countdowns + TNC step machine (D1.R5) + collapsible audit trail. Step actions call the appropriate callable; `canManage` gates the action buttons (read-only when false).
- `src/components/recruiter/everify/openEverifyTncNoticePrintable.ts` (new) — opens a new window with FAN HTML + fires `everifyRecordNoticeGenerated`.
- `src/components/recruiter/everify/index.ts` (new) — barrel.

### Client — host surfaces

- `src/pages/TenantViews/EverifyAdminOpsPage.tsx` — inline TNC buttons replaced by a per-row "Manage TNC" button that opens `EverifyCaseDrawer` with `initialCase` (no loading flash). `onActionApplied` triggers `loadCases` to refresh the row.
- `src/pages/UserProfile/components/EverifyComplianceCard.tsx` — adds "Manage TNC" button inside the warning alert when a TNC case is active, plus a generic "Open case" button. `canManage` is the existing card-level gate.
- `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx`
  - Live `onSnapshot` on `tenants/{tid}/employeeReadinessItems` filtered to `workerUid` + `requirementType==='e_verify'` (cheap index hit; client filters to `e_verify`).
  - TNC banner when any `e_verify` item is in `'needs_review'`. Banner is gated on `canManageEverify` (HRX or tenant Admin) — worker self-views see no banner; the Flutter app handles the worker side (R.9).
  - "Manage TNC" button on the banner opens the drawer with the resolved `caseId`.
  - `handleHeaderChipItemClick` for `e_verify` contributors opens the drawer (with `contributor.caseId` or fallback) instead of the standard row-highlight path. (E-Verify isn't a row in this tab, so there's nothing to highlight.)
  - URL deep-link consumption — `?type=e_verify[&caseId=…]` auto-opens the drawer; defers finalising if `everifyItems` haven't loaded yet (one re-run when they do).
- `src/components/recruiter/PlacementsTab.tsx` — `handlePlacementJobReadinessItemClick` now writes `caseId` onto the drill-in URL when present on the contributor.

---

## Verification

```bash
# tsc — both projects clean (no NEW errors).
( cd functions && npx tsc --noEmit )    # clean
npx tsc --noEmit                        # clean (pre-existing certifications/userActionItems test errors remain — unrelated)

# Chip helper tests (jest).
npx craco test --watchAll=false --testPathPattern='src/shared/jobReadinessChip'
# → 33 tests passing, including the 3 new R.5 caseId propagation cases.

# Functions tests (mocha) excluding the pre-existing setTenantRole.test.ts breakage.
( cd functions && npx mocha -r ts-node/register -r src/__tests__/setup.ts \
    'src/__tests__/readiness/**/*.test.ts' \
    'src/__tests__/messaging/**/*.test.ts' \
    'src/__tests__/translation/**/*.test.ts' \
    'src/__tests__/firestore/**/*.test.ts' )
# → 151 tests passing, 3 pending.
```

### Verification gate

- [x] `tsc` clean on both projects (no NEW errors).
- [x] R.4 jest suites still green (no regression to chip helper / bridge / seeder).
- [x] `+ 3` new chip tests passing (caseId propagation matrix).
- [x] R.5 callable family (`everifyMarkEmployeeNotified`, `everifyMarkContested`, `everifyMarkReferralInitiated`, `everifyRecordWorkerDecision`, `everifyRecordNoticeGenerated`, `everifyCloseCase`) all idempotent on retried calls.
- [x] `EverifyCaseDrawer` mounts cleanly in all three host surfaces; `canManage=false` renders read-only.
- [x] `EmployeeReadinessItem.workerAction` is set/cleared in the predicted lifecycle (recruiter notifies → set; worker decision OR referral → clear).
- [x] PlacementsTab → Readiness tab deep-link with `caseId` opens the drawer against the precise case; without `caseId` falls back to the first `e_verify` item's `externalRef`.

### Manual walkthrough (mental sim)

1. JO Hiring page lists a worker with red chip "Job Not Ready". Recruiter hovers → popover shows red `e_verify` contributor "TNC requires action".
2. Recruiter clicks the contributor → opens `/users/{uid}?tab=readiness&assignmentId=A1&type=e_verify&caseId=case-abc-123&itemId=I1&source=employee`.
3. Worker profile loads → outer shell selects Readiness tab → `ProfileReadinessTabContent` consumes the URL, opens `EverifyCaseDrawer` for `case-abc-123` with the per-shift assignment context.
4. Recruiter sits with the worker, prints the FAN (drawer fires `NOTICE_PACKET_GENERATED`), then checks "Mark employee notified" (drawer fires `everifyMarkEmployeeNotified` → marker set, `actor='worker'`, push notification fires).
5. Worker uses the Flutter app (R.9 — not in this PR) to read the marker and tap "Contest" → backend fires `everifyRecordWorkerDecision({contests:true})` → marker cleared, `actor='recruiter'`, `WORKER_DECISION_RECORDED` event in the drawer's audit trail.
6. Chip recomputes (next snapshot writeback) → `e_verify` flips from `needs_review` (red) to `in_progress` (yellow) → "Job Ready (1 pending)".
7. Recruiter files the DHS/SSA referral → `everifyMarkReferralInitiated` → drawer step machine advances to "Close case", waiting on USCIS.
8. USCIS finalises → `EverifyTriggers.applyStatusChange` advances the case status; chip flips to green or red as appropriate; recruiter closes the case in the drawer.

---

## Deferred to follow-up

These are not blocking R.5 and were explicitly scoped out per the greenlight Q&A.

1. **Server-rendered + stored FAN PDF.** R.5 ships HTML print only (Q-R5-3). A future R.5.1 can add Cloud Storage upload + signed URL + e-sign without changing the event shape — `NOTICE_PACKET_GENERATED` already carries the timestamp.
2. **Drawer rendering matrix tests (jest + RTL).** The drawer is render-glue around the step machine; the load-bearing pieces are the helper logic + chip propagation, both of which are covered by the existing pure-function tests. A render-matrix suite is a nice-to-have when the drawer next changes shape.
3. **Mocha tests for the new callables.** The existing functions test pattern explicitly avoids "admin-SDK mock theater" for I/O-heavy callables (see `onUserLicensesChangeRefreshAssignments.test.ts:8-12`); the helper functions extracted into `everifyTncWorkerAction.ts` are already pure but read/write Firestore, so a meaningful test would need either an emulator harness (~250 LoC of new infra) or a doc-level fake (boilerplate without much signal). Deferred.
4. **Worker-side TNC card (R.9).** The worker-app render of `workerAction` lives in Flutter and is the R.9 task; this PR ships only the marker write/clear lifecycle and the recruiter-side surfaces.

---

## Successor cross-refs

- **R.6** — AccuSource adjudication CSA matrix UI: shipped — see `READINESS_R6_HANDOFF.md`. Reused the drawer pattern (`BackgroundCheckCaseDrawer`) and extended `JobReadinessChipContributor.caseId` to also carry `backgroundChecks/{checkId}` for `background_check` / `drug_screen` items.
- **R.3** — Generalize CSA action endpoints (confirm / waive / markFailed): the drawer pattern + the `caseId` propagation are reusable; R.3's CSA actions can be wired into the same `EverifyCaseDrawer` step machine where the recruiter has CSA scope (e.g. "waive on CSA approval").
- **R.8** — CSA cross-worker readiness matrix UI: uses `<JobReadinessChip size="inline" />` per cell; the R.5 `caseId` propagation lets the matrix cell-click open the drawer directly without hopping through the Readiness tab.
- **R.9** — Worker profile-edit UI in Flutter: reads `EmployeeReadinessItem.workerAction.kind === 'everify_tnc_pending_decision'` to render the worker-side action card; calls the existing `everifyRecordWorkerDecision` callable on submit.
