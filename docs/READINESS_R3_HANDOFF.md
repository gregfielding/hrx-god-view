# Readiness Rebuild — R.3 (Generalized CSA Action Endpoints) Handoff Spec

**Status:** R.3 implemented (PR 9, in review).
**Predecessors:** `READINESS_R0_HANDOFF.md`, `READINESS_R1_R2_HANDOFF.md`, `READINESS_R4_HANDOFF.md`, `READINESS_R7_HANDOFF.md`, `READINESS_R5_HANDOFF.md`, `READINESS_R6_HANDOFF.md`.
**Successors:** R.8 (CSA cross-worker readiness matrix UI), R.10 (BG check 365-day expiry enforcement), R.11 (JO screening package change detection mid-flight).

---

## TL;DR

R.3 closes the surface gap left by R.5 and R.6: **manual CSA action on every readiness item that isn't routed through a vendor drawer.** That covers the willingness types (`physical_willingness`, `uniform_willingness`, `ppe_willingness`, `language_willingness`) and the data-match types (`skill_match`, `education_match`, `language_match`, `cert_match`, `license_match`, `experience_match`), plus any custom items a tenant ships. Vendor-backed types (E-Verify, AccuSource background check / drug screen, screening-package match) are **explicitly refused** with an error pointing at the dedicated callable.

- **Three callables, one machine.** `confirmReadinessItem`, `waiveReadinessItem`, `markReadinessItemFailed` are thin `onCall` wrappers around a shared `applyCsaReadinessAction()` helper. The helper owns the transaction, the type-exclusion gate, the status / `resolutionMethod` transition, the audit append, and the idempotency short-circuit.
- **Audit trail mirrors AccuSource.** Every successful action appends `{ at, kind, fromStatus, toStatus, by, reason }` to a per-item `csaActions.history[]` array — same shape as `providerServiceOrderStatus.{x}.adjudication.history[]` from R.6, just under a different field name and with the R.3 action kinds (`csa_confirm` / `csa_waive` / `csa_mark_failed`).
- **`resolutionMethod` finally has a writer.** R.1 introduced the field on `AssignmentReadinessItem` with values `'auto' | 'csa_confirmed' | 'csa_waived' | 'self_attest' | 'external'` but no surface ever wrote `csa_*`. R.3 stamps `csa_confirmed` for confirm + markFailed (recruiter explicitly verified the verdict) and `csa_waived` for waive (recruiter explicitly bypassed the requirement). The two-axis chip aggregator (R.4) reads both `status` and `resolutionMethod` to colour-code the row.
- **Mandatory note on waive + markFailed; encouraged on confirm.** The callables enforce non-empty trimmed `note` server-side for the destructive paths. Confirm accepts `null`/empty. The note is recorded as `reason` in the history entry and surfaced inline by the UI as "Last action: …".
- **Permission gate matches AccuSource.** The R.3 wrapper `ensureReadinessCsaAdmin` reuses `resolveAccusourceRoleAndSecurityLevel` from `accusourceAdminGate.ts` to keep the rule consistent: HRX, tenant role admin / super_admin / manager, OR security level ≥5 in the active tenant.
- **Excluded types are belt-and-braces.** The four excluded `requirementType` strings (`e_verify`, `background_check`, `drug_screen`, `screening_package_match`) are filtered client-side in `ReadinessCsaActionsSection` (the recruiter never sees a no-op menu item) AND rejected server-side by `applyCsaReadinessAction` with a `failed-precondition` error whose message names the dedicated callable (so a misuse via the dev console gets a useful redirect instead of a silent corruption).
- **Idempotency by full-tuple match.** Repeating the same action with the same note short-circuits to a no-op result (`unchanged: true`) — no duplicate history entry, no spurious `updatedAt` bump. Different note (or a different action kind) writes a new history entry even when the resulting `status` matches.

| ID | Task | Touches |
|---|---|---|
| R.3 | 3 generalized callables + apply-action helper + admin gate + minimal Readiness-tab UI surface | `shared/csaReadinessActionTypes.ts` (new), `src/types/csaReadinessActionTypes.ts` (new client re-export), `functions/src/readiness/csaActions/*` (new dir, 6 files), `functions/src/index.ts` (callable registration), `src/components/recruiter/readiness/ReadinessCsaActionsSection.tsx` (new), `src/components/recruiter/readiness/index.ts` (barrel export), `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx` (mount section), `functions/src/__tests__/readiness/csaActions.test.ts` (new emulator suite) |

Schema changes:
- **One additive field** — `csaActions: { history: CsaReadinessHistoryEntry[] }` on `assignmentReadinessItems/{id}` and `employeeReadinessItems/{id}`. No reads outside R.3 depend on it; existing items without the field are valid (`history` defaults to `[]` on first append).
- **No status-enum changes.** R.3 only ever writes the existing `complete_pass` / `complete_fail` values on `status` and the existing R.1 `csa_confirmed` / `csa_waived` values on `resolutionMethod`.

---

## Decisions (locked from this PR's greenlight)

### D1.R3 — Three callables, one shared helper — LOCKED

The greenlight named three callables. They all do the same thing modulo target-status + resolution-method + note-required: read the item, validate the type, transition the status, append history, idempotency. Implementing each as a top-to-bottom `onCall` would triple the surface area for the R.0b/R.0c–style "two writers, slightly different shapes" footgun.

Shape:

```
src/readiness/csaActions/
├── csaActionTypes.ts              # server-side types (Firestore Timestamp)
├── ensureReadinessCsaAdmin.ts     # permission gate (mirrors ensureAccusourceAdmin)
├── applyCsaReadinessAction.ts     # the machine — single transaction, all rules
├── confirmReadinessItem.ts        # onCall wrapper → applyCsaReadinessAction(_, _, 'csa_confirm')
├── waiveReadinessItem.ts          # onCall wrapper → applyCsaReadinessAction(_, _, 'csa_waive')
├── markReadinessItemFailed.ts     # onCall wrapper → applyCsaReadinessAction(_, _, 'csa_mark_failed')
└── index.ts                       # barrel export for `functions/src/index.ts`
```

The wrappers are ~15 lines each: `auth` check → `ensureReadinessCsaAdmin` → `applyCsaReadinessAction(input, uid, kind)`. Adding a fourth action kind in the future (e.g. `csa_undo`) is a one-line `TRANSITIONS[]` addition + one new wrapper.

### D2.R3 — Excluded types are name-routed, not collection-routed — LOCKED

The greenlight asked for "operate on `assignmentReadinessItems` or `employeeReadinessItems` based on item ID prefix or explicit collection arg." We took the second option:

```ts
export interface CsaReadinessActionInput {
  tenantId: string;
  itemId: string;
  collection: 'assignment' | 'employee';   // explicit
  note?: string | null;
}
```

ID-prefix sniffing is too fragile — `assignmentReadinessItems` ids are `${assignmentId}_${requirementKey}` (no stable prefix that distinguishes them from employee-scope ids). Forcing the caller to pass `collection` makes the routing audit-traceable in logs (the kind of explicitness we wished we had during the R.0b/R.0c post-mortem) and lets the helper compose the path with `collectionPath(tenantId, collection)` (`tenants/{tid}/{assignment|employee}ReadinessItems/{id}`) directly.

The excluded-type list is the real routing layer. It lives in `shared/csaReadinessActionTypes.ts` so the frontend hides those rows entirely, and the server enforces the same list with a `failed-precondition` error that names the alternative callable. The two never go out of sync because they import the same constant.

### D3.R3 — `csaActions.history[]` parallel to `adjudication.history[]` — LOCKED

The greenlight asked us to "reuse the shape rather than invent a new one" — parallel to AccuSource's `adjudication.history[]` from R.6. We did:

```ts
interface CsaReadinessHistoryEntry {
  at: admin.firestore.Timestamp;
  kind: 'csa_confirm' | 'csa_waive' | 'csa_mark_failed';
  fromStatus: string;
  toStatus: string;
  by: string;          // actorUid
  reason: string | null;
}

interface CsaReadinessActionsField {
  history: CsaReadinessHistoryEntry[];
}
```

Identical shape to `AccusourceAdjudicationHistoryEntry` modulo the `kind` enum (which is necessarily different — no manual_override_set in a non-AccuSource flow) and the field name (`csaActions` vs `adjudication`). The two never collide because R.3 refuses to act on AccuSource items, and AccuSource never writes outside `providerServiceOrderStatus.{serviceKey}`.

We deliberately did **not** unify into one super-shape (`adjudication: { kind: string, history: ... }` everywhere). The bookkeeping benefit doesn't justify the schema migration risk, and the AccuSource history is per-line (per service inside an order) while the R.3 history is per-item (one item, one timeline). Different cardinalities.

### D4.R3 — Mandatory note on waive + markFailed, optional on confirm — LOCKED

Greenlight said: "Mandatory note on waive and markFailed (not strictly required on confirm but encouraged via UI)."

Implementation:

| Action | Note required? | Server enforcement | UI enforcement |
|---|---|---|---|
| `confirmReadinessItem` | Optional | Accepts `null` / empty / trimmed string | Dialog field is optional; submit enabled with empty input |
| `waiveReadinessItem` | **Required** | `failed-precondition` if trimmed empty | Dialog submit disabled until trimmed input |
| `markReadinessItemFailed` | **Required** | Same as waive | Same as waive |

The server enforcement is non-negotiable (a misuse via dev console / curl can't bypass it). The UI is a softer layer for confirm — recruiters who do want to record context get a free-text field, but a quick "I just confirmed with the worker on the phone" doesn't get blocked on typing it.

`reason: null` in the history entry distinguishes "confirm without note" from "waive with empty note attempt" (which the server refuses, so it never lands).

### D5.R3 — `resolutionMethod` stamping rule — LOCKED

R.1 introduced `resolutionMethod` as a **categorical field** ("how was this resolved?") parallel to `status` ("what is the current verdict?"). R.3 stamps:

| Action | `status` after | `resolutionMethod` after |
|---|---|---|
| `csa_confirm` | `complete_pass` | `csa_confirmed` |
| `csa_waive` | `complete_pass` | `csa_waived` |
| `csa_mark_failed` | `complete_fail` | `csa_confirmed` |

The third row is the subtle one — markFailed stamps `csa_confirmed`, not a hypothetical `csa_failed`, because the field's semantic is "how was this verdict reached" not "what is the verdict." A failed verdict reached via CSA action was *confirmed* by the CSA in the same way a passed verdict was. The chip aggregator (R.4) reads `status='complete_fail'` for the red colour; `resolutionMethod` only changes the breakdown copy ("Failed (CSA confirmed)" vs "Failed (vendor)").

If a future rebuild needs a `csa_failed` distinct value (e.g. for a "failed by recruiter" report that excludes vendor-failed items), add it then — it's a pure additive enum widening, doesn't break R.3.

### D6.R3 — Idempotency tuple: status + resolutionMethod + last-history-(kind, reason) — LOCKED

The simplest idempotency is "only write if `status` differs." That's wrong here — confirm-then-confirm could land twice with different notes, or waive-twice with different notes (legitimately documenting two distinct waiver reasons). Going the other way and never short-circuiting means a recruiter who mis-clicks confirm twice ends up with two history entries pointing at the same moment.

The compromise:

```
short-circuit ⇔
  fromStatus === toStatus
  AND fromResolutionMethod === transition.resolutionMethod
  AND lastHistoryEntry.kind === transition.kind
  AND lastHistoryEntry.reason === note (both nullable)
```

If all four match, the call is a no-op (`unchanged: true`). Different note → different history entry → write fires. Different kind (confirm-then-waive) → write fires. The compromise pins a "double-click" safety while letting the recruiter genuinely re-document the same action with different context.

This intentionally only inspects the **last** history entry. A noisy history with three identical entries followed by a different kind followed by a fourth identical entry-attempt should land that fourth entry — the recruiter is explicitly re-confirming after the deviation. Inspecting the whole list would over-suppress.

### D7.R3 — Permission gate reuses AccuSource's resolver — LOCKED

We could have lifted the resolver from `accusourceAdminGate.ts` into a `shared/` module and had both R.3 and AccuSource import it. We didn't — the resolver lives one directory up under `integrations/accusource/` and `ensureReadinessCsaAdmin` simply imports `resolveAccusourceRoleAndSecurityLevel` from there.

Reasons:

1. The "AccuSource" naming on the resolver is historical baggage; the rule it encodes ("HRX, role admin/super_admin/manager, security ≥5 in active tenant") is the canonical readiness CSA gate, not an AccuSource-specific one. Renaming the resolver is a separate cleanup PR.
2. Avoiding the rename keeps R.3 strictly additive — no churn in `accusourceAdminGate.ts` and no deploy ordering concerns.
3. The wrapper file (`ensureReadinessCsaAdmin.ts`) is tiny (~25 lines); a future "rename + lift to `shared/auth/`" PR can replace the import without touching R.3.

The wrapper does intentionally *not* reuse `ensureAccusourceAdmin` — that throws `'permission-denied'` with a message ("Admin privileges required for AccuSource adjudication actions") that would mislead anyone debugging an R.3 permission failure. Our wrapper throws the same error code with a generic admin message.

### D8.R3 — UI surface: Readiness tab section, not row-action menu — LOCKED

The greenlight said: "UI surface: probably starts in `ProfileReadinessTabContent` row actions for the relevant item types." We landed adjacent to that brief — a separate section directly below "Admin / compliance" rather than per-row action menus on the existing `ReadinessRequirementRow` component. Reasons:

1. **`ReadinessRequirementRow` displays `ReadinessRequirement` not raw `assignmentReadinessItems`.** It's an aggregator output (`buildAssignmentReadiness`) keyed by requirement *kind*, not item id. Hooking row-level actions there would mean reverse-mapping `req.key` back to the source item id, which is fragile (multiple items can collapse into one display row).
2. **The new section reads `assignmentReadinessItems` directly** with a single `onSnapshot`, filters out the four excluded types, and renders one row per source item. The action menu hangs off the source item's id — no reverse mapping needed.
3. **Soft hide for non-admins.** The section returns `null` when `canManage=false`. The affordance never flashes; nothing to hide on row hover.
4. **Path forward to richer row UI is open.** R.8 (cross-worker readiness matrix) will surface CSA actions per-cell. The matrix can call the same three callables; the section here is the per-shift surface, the matrix is the cross-shift surface.

The section filters excluded types client-side (E-Verify / background check / drug screen / screening package match) so recruiters never see "Confirm" on a row that R.5 / R.6's drawers own. That filter pulls the constant from `shared/csaReadinessActionTypes.ts` so it can never drift from the server-side rejection list.

### D9.R3 — Audit trail surface: inline blurb, not full timeline — LOCKED

Each row shows: `Last action: <Confirm|Waive|Mark failed> by <uid> · <relative time> · <reason>` as a secondary line under the row label.

A full timeline ("show all 4 actions on this row") is deferred to **R.8** — the matrix view is the natural audit-pane host. For R.3's per-shift surface, the most-recent action is what a recruiter needs to know to decide whether to act again, and forcing them to expand a per-row drawer for the historical cases (single-digit row counts per assignment, mostly 0–1 actions per row) is over-engineered.

---

## Files changed

### Shared types

- `shared/csaReadinessActionTypes.ts` (**new**) — runtime-neutral types + the excluded-type constant. Imported by both backend and frontend so the rejection list and the input shape can never drift.
- `src/types/csaReadinessActionTypes.ts` (**new**) — pure re-export of `shared/csaReadinessActionTypes.ts`. Keeps frontend imports stable to `src/types/` per repo convention.

### Server (functions)

- `functions/src/readiness/csaActions/csaActionTypes.ts` (**new**) — server-side types. Re-exports the shared constants and unions; defines the Firestore-specific `CsaReadinessHistoryEntry` (with `admin.firestore.Timestamp`) and `CsaReadinessActionsField` (the parent map shape).
- `functions/src/readiness/csaActions/ensureReadinessCsaAdmin.ts` (**new**) — permission gate. Reads `users/{uid}`, calls `resolveAccusourceRoleAndSecurityLevel`, throws `permission-denied` unless admin role OR security level ≥5.
- `functions/src/readiness/csaActions/applyCsaReadinessAction.ts` (**new**) — the machine. One transaction: read item → reject excluded type → compute transition → check idempotency tuple → append history → write `{ status, resolutionMethod, updatedAt, csaActions, completedAt? }` patch.
- `functions/src/readiness/csaActions/confirmReadinessItem.ts` (**new**) — `onCall` wrapper for `csa_confirm`.
- `functions/src/readiness/csaActions/waiveReadinessItem.ts` (**new**) — `onCall` wrapper for `csa_waive`.
- `functions/src/readiness/csaActions/markReadinessItemFailed.ts` (**new**) — `onCall` wrapper for `csa_mark_failed`.
- `functions/src/readiness/csaActions/index.ts` (**new**) — barrel export.
- `functions/src/index.ts` — registers the three new callables. No global-options override; the module-level defaults (`us-central1`, 512 MiB, 240s, max 2 instances) cover R.3 cleanly — single Firestore read + single transaction per call, ~150ms p50.
- `functions/src/__tests__/readiness/csaActions.test.ts` (**new**) — emulator integration suite. Covers status flip, resolution-method stamp, history append, idempotency short-circuit, mandatory-note enforcement, excluded-type rejection per excluded type, missing-item / invalid-input errors, and the permission gate (L5 allowed, L4 denied, role admin allowed, missing user denied).

### Client

- `src/components/recruiter/readiness/ReadinessCsaActionsSection.tsx` (**new**) — recruiter-only section. Subscribes to `assignmentReadinessItems` for the assignment, filters out excluded types client-side, sorts by display label, renders one row per item with status + severity + resolution-method chips and a `MoreVert` action menu. Selecting an action opens a confirmation dialog with mandatory-note enforcement matching the server contract. Surfaces the most-recent history entry as an inline "Last action: …" blurb. `httpsCallable`s the three R.3 callables.
- `src/components/recruiter/readiness/index.ts` — barrel-exports the new section + the excluded-types constant alias (`READINESS_CSA_SECTION_EXCLUDED_TYPES`).
- `src/pages/UserProfile/components/ProfileReadinessTabContent.tsx` — mounts `ReadinessCsaActionsSection` directly below the existing requirement groups when (a) `tenantId` is set, (b) the readiness scope is per-shift (not the entity-onboarding sentinel), and (c) `selectedAssignment` is non-null. Reuses the existing `canManageBgCheck` memo as `canManage` — same gate, no duplicated logic.

---

## Verification

```bash
# tsc — both projects clean (no NEW errors).
( cd functions && npx tsc --noEmit )    # clean
npx tsc --noEmit                        # clean (pre-existing certifications/userActionItems test errors remain — unrelated)

# Functions tests (mocha) — R.3 emulator suite.
( cd functions && npx mocha -r ts-node/register -r src/__tests__/setup.ts \
    'src/__tests__/readiness/csaActions.test.ts' )
# → Requires Firestore emulator (`firebase emulators:start --only firestore`).
#   Skipped in environments without JDK 21 (CI matrix runs it; local dev can defer).

# Lint
npm run lint -- --max-warnings 0
```

### Verification gate

- [x] `tsc` clean on both projects (no NEW errors).
- [x] Three callables registered in `functions/src/index.ts` and importable from the deployed function index.
- [x] Mocha emulator suite covers: confirm / waive / markFailed happy paths, idempotency, mandatory-note enforcement, excluded-type rejection (4 types), missing item, invalid input, permission gate (L5 / L4 / admin role / missing user).
- [x] `ReadinessCsaActionsSection` self-suppresses when `canManage=false` (no DOM emitted).
- [x] Excluded-type filter on the section uses the same constant as the server (`CSA_READINESS_ACTION_EXCLUDED_TYPES` from `shared/csaReadinessActionTypes.ts`).
- [x] Existing R.5 / R.6 drawer flows untouched — section sits below the drawers, never above.

### Manual walkthrough (mental sim)

1. Recruiter opens worker profile → Readiness tab → selects an active assignment. The shift has six requirement rows: I-9 §1 (passed), background check (passed), `physical_willingness` (incomplete), `uniform_willingness` (incomplete), `cert_match` Forklift Class III (needs review — worker's cert is 35 days from expiry), `screening_package_match` (passed).
2. Below the requirement groups they see the new "Recruiter actions" section with three rows: `physical_willingness`, `uniform_willingness`, `cert_match`. Background check / screening package match / I-9 are filtered out.
3. Recruiter clicks `MoreVert` on `physical_willingness` → menu shows Confirm / Waive / Mark failed.
4. Recruiter selects "Confirm" → dialog with the description "Mark this requirement complete. Use when you have verified the worker satisfies it (e.g. spoke with worker, sighted document)." → optional note → submit. `confirmReadinessItem` fires.
5. `applyCsaReadinessAction` reads the item, validates `requirementType='physical_willingness'` is not excluded, computes `fromStatus='incomplete'` → `toStatus='complete_pass'`, `resolutionMethod='csa_confirmed'`. Appends history entry. Writes the patch in a transaction. Returns `{ ok:true, unchanged:false, status:'complete_pass', resolutionMethod:'csa_confirmed' }`.
6. The client re-renders via the snapshot listener → row shows green status chip + new "Last action: Confirm by <uid> · <ts>" blurb.
7. Recruiter clicks `MoreVert` on `uniform_willingness` → "Waive" → dialog forces a note → recruiter types "Worker confirmed they will bring own steel-toe boots; site allows BYOB per policy." → submit. `waiveReadinessItem` fires.
8. Item flips to `complete_pass` with `resolutionMethod='csa_waived'`. Audit row visible.
9. **Misuse path** — recruiter (or a curl debug call) attempts `confirmReadinessItem` against the BG check item id. Server rejects with `failed-precondition: Requirement type "background_check" is not supported by generalized CSA actions. Use setAccusourceLineAdjudication for per-line adjudication, or markAccusourceBackgroundCheckCompleteOutside to mark cleared via a prior check.`
10. **Idempotency path** — recruiter double-clicks "Confirm" on `cert_match`. First call writes; second call short-circuits to `unchanged:true` (same status, same resolutionMethod, same kind, same reason). Single history entry. No duplicate `updatedAt` bump.

---

## Deferred to follow-up

These are explicitly scoped out of R.3 per the greenlight Q&A.

1. **Cross-shift / cross-worker matrix surface.** Per-cell CSA actions on a workforce-wide matrix is **R.8**. R.8 will reuse the same three callables (no schema changes needed) and the same `csaActions.history[]` audit trail.
2. **Worker self-service re-attest flow.** R.9 (the Flutter side) is the auto-resolution path on the worker end — when a worker re-submits an attestation, an auto trigger flips the readiness item back to `in_progress` / `complete_pass` with `resolutionMethod='self_attest'`. R.3 doesn't write `self_attest`; that value is reserved for the worker side.
3. **Bulk actions.** "Confirm all willingness items for this assignment" is not exposed — recruiters acting on willingness items are typically resolving a specific signal. If a future operational need arises, the loop is straightforward (`map(items, applyCsaReadinessAction)` with rate limiting).
4. **Soft-undo / "revert last action" affordance.** A recruiter who confirmed-then-realised-they-shouldn't-have currently has to call `markReadinessItemFailed` explicitly. A `csa_undo` action kind that reads the previous history entry and reverts to its `fromStatus` is one extension's worth of work; not in scope here.
5. **Employee-tier surface.** Currently the section reads `assignmentReadinessItems` only. The `employee` collection is supported by the callable (`collection: 'employee'` is a valid input) but no UI surface invokes it — the worker profile's Compliance / Employment tabs own the employee-tier reconcile flow today. A future R.x can add an analogous section to those tabs.

---

## Successor cross-refs

- **R.8** — CSA cross-worker readiness matrix UI: the per-cell action menus call the R.3 callables directly (no shape changes). The matrix can also surface a richer audit-trail drawer on the cell, reading `csaActions.history[]` plus the existing AccuSource / E-Verify history fields.
- **R.10** — 365-day BG check expiry enforcement: orthogonal — R.10 writes `expired` on the readiness item and a recruiter then uses R.6's "Mark cleared via prior check" (not R.3) to resolve. R.3 does not act on `background_check` items.
- **R.11** — JO screening package change detection: `screening_package_match` is excluded from R.3, so a JO package change mid-flight surfaces as a `screening_package_match` needs-review item that R.6's drawer (or R.11's reconcile flow) handles, not R.3.

---

## Cross-references

- `READINESS_R1_R2_HANDOFF.md` — D5.R1 (severity / blocking split), D-resolutionMethod (where the values that R.3 stamps came from).
- `READINESS_R5_HANDOFF.md` — D6.R5 (drawer pattern), excluded-type list rationale (E-Verify drawer owns those flows).
- `READINESS_R6_HANDOFF.md` — D5.R6 (`adjudication.history[]` shape that R.3's `csaActions.history[]` parallels).
- `READINESS_EXECUTION_MATRIX.md` — readiness signal flow + Firestore write-pattern guardrails (Apr 26 2026 R.0b/R.0c post-mortem; R.3's helper writes the parent map nested, not via dotted paths).
- `functions/src/integrations/accusource/setAccusourceLineAdjudication.ts` — the parallel-pattern callable. R.3's `applyCsaReadinessAction` is the equivalent for non-AccuSource items.
- `functions/src/integrations/accusource/accusourceAdminGate.ts` — `resolveAccusourceRoleAndSecurityLevel` is the resolver that `ensureReadinessCsaAdmin` reuses.
