# Workforce domain model

This document defines **Workforce** as a first-class domain concept for HRX — the central source of truth for "who's committed to working for this account, right now, and where are they in their work lifecycle."

It replaces the ad-hoc "Active Workers" tab (a single table listing active assignments) with a structured model that supports scheduled vs. standing vs. inactive workforce, hierarchical account scoping (national → child → location), and future layers for timesheets and compliance overlays.

**Scope**

- **What's in scope:** the Workforce tab on Account / Location detail pages, the underlying data model, the triggers that maintain it, and how parent/child account aggregation works.
- **What's out of scope (yet, but accounted for):** timesheet/payroll structures, compliance readiness rendering, assignment-outcome capture UX. Those are separate tracks that consume the Workforce model defined here.

---

## 1. Core insight

Workforce is not one list. It's a set of **lenses** over two primitives:

1. **Assignment** — the moment-in-time commitment a worker has made to a specific shift. This is temporal: before the shift, it's a promise; during the shift, it's in-flight; after the shift, it has an outcome.
2. **AccountWorkforce** — a durable, scope-local record that says "this worker is part of the workforce for this account." This is relational: it survives individual shift outcomes and captures the longer-running "is this person on our CORT Gaylord roster?" truth.

Every view the UI renders — Scheduled, Active, Inactive, Timesheets, Compliance — is a combination of those two.

---

## 2. Primitive one: Assignment

Assignments already exist at `tenants/{tid}/assignments/{assignmentId}`. This section formalizes the status vocabulary Workforce depends on.

### 2.1 Status vocabulary

```ts
/** Lifecycle of a single assignment. */
type AssignmentStatus =
  | 'pending'              // recruiter placed the worker; offer not yet accepted
  | 'confirmed'            // worker accepted — committed to work (enters Workforce)
  | 'active'               // shift window has started; worker is currently on-shift
  | 'completed'            // worker finished the shift as expected
  | 'no_show'              // worker did not arrive for the shift
  | 'left_early'           // worker arrived but left before the shift ended
  | 'cancelled_business'   // account or HRX cancelled the assignment (no fault of worker)
  | 'cancelled_worker'     // worker withdrew before or at the shift start
  | 'cancelled';           // legacy bucket; migrated forward into the two above
```

### 2.2 Outcome fields

When an assignment reaches a terminal status (`completed`, `no_show`, `left_early`, `cancelled_*`), we capture audit + business fields:

```ts
type AssignmentOutcome = {
  outcomeStatus: Extract<
    AssignmentStatus,
    'completed' | 'no_show' | 'left_early' | 'cancelled_business' | 'cancelled_worker'
  >;
  outcomeAt: Timestamp;     // when the outcome was recorded
  outcomeBy: string;        // uid of recruiter/system that recorded it
  outcomeNotes?: string;    // free-text reason (esp. for left_early / cancellations)

  /** Only set when outcomeStatus === 'left_early' or 'completed' — feeds timesheets. */
  hoursWorked?: number;

  /** Only set when outcomeStatus === 'no_show'. True when a late show-up counted as a no-show per account policy. */
  lateGraceApplied?: boolean;
};
```

These fields are additive — existing assignments without them continue to work.

### 2.3 Transitions that matter for Workforce

- `pending → confirmed`: enters Workforce (triggers AccountWorkforce creation — see §3.4).
- `confirmed → active → completed/no_show/left_early`: shift lifecycle. These transitions do **not** remove a worker from Workforce on their own. Deactivation is manual (see §3.5).
- `confirmed → cancelled_*`: removes the assignment from Scheduled view but leaves AccountWorkforce untouched.

---

## 3. Primitive two: AccountWorkforce

A new collection `tenants/{tid}/account_workforce/{accountId}__{workerId}` that records the durable relationship between a worker and an account.

### 3.1 Schema

```ts
type AccountWorkforceStatus = 'active' | 'inactive';

type AccountWorkforceDeactivationReason =
  | 'no_show'                // repeated no-shows
  | 'left_early_repeat'      // repeated left-early incidents
  | 'client_requested'       // client asked us to replace or remove
  | 'performance'            // quality/behavior concerns
  | 'attendance'             // punctuality / reliability issues
  | 'policy'                 // violated account or HRX policy
  | 'worker_request'         // worker asked to be removed from this account
  | 'other';

type AccountWorkforce = {
  tenantId: string;
  accountId: string;         // the scope — always a child or standalone account (see §4)
  workerId: string;

  status: AccountWorkforceStatus;

  /**
   * Denormalized from the account's hiring entity
   * (`account.hiringEntityId → entity.engagementType`). The entity is the
   * authoritative source; this field is a cache for query speed so views
   * like "all active 1099 workers across the tenant" don't have to join
   * through entities row by row. A hiring-entity change on an account
   * triggers a backfill pass to rewrite this field across affected docs.
   */
  engagementType?: 'w2' | '1099';

  /** First time this worker confirmed an assignment for this account. Stable once set. */
  firstConfirmedAt: Timestamp;

  /** Last shift date on an assignment for this account (any outcome). Updated by triggers. */
  lastShiftAt?: Timestamp;

  /** Counts for quick display on Active / Inactive views. */
  totalShifts?: number;           // completed + left_early + no_show
  completedShifts?: number;       // completed only

  /** When status === 'inactive'. */
  deactivatedAt?: Timestamp;
  deactivatedBy?: string;         // recruiter uid
  deactivationReason?: AccountWorkforceDeactivationReason;
  deactivationNotes?: string;

  /** When status flipped back from inactive → active. */
  reactivatedAt?: Timestamp;
  reactivatedBy?: string;
  reactivationNotes?: string;

  /**
   * Structured safety-net flags. Today only `CONFIRMED_WHILE_INACTIVE` fires
   * — see §3.4(4). Future codes (e.g. `ENTITY_CHANGED`) use the same shape.
   * Cleared on reactivation or when the recruiter resolves the blocker.
   */
  blockers?: Array<{
    code: 'CONFIRMED_WHILE_INACTIVE';
    assignmentId: string;
    at: Timestamp;
  }>;

  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

### 3.2 Document id

Composite: `${accountId}__${workerId}`. Stable. Lets us hit the doc directly from any context where both ids are known, with no query.

### 3.3 Status semantics

- **`active`** (default after creation) — worker is part of the workforce for this account. They appear in the Active view and are eligible for future placements here.
- **`inactive`** — worker has been manually deactivated for this account. They no longer appear in Active. Existing confirmed future assignments are **not** auto-cancelled — the recruiter handles that side separately. The inactive state blocks **new** placements in the UI (ownership policy) rather than retroactively unwinding history.

### 3.4 Entry: `confirmed` → AccountWorkforce.active

A Cloud Functions trigger on `tenants/{tid}/assignments/{id}` writes:

1. On every assignment write, if `status === 'confirmed'`, compute `accountId = <jobOrder>.recruiterAccountId` (or resolve via the JO doc when the assignment doesn't carry it).
2. If no `account_workforce/{accountId}__{workerId}` doc exists, create one with `status: 'active'`, `firstConfirmedAt: now`, counters at zero.
3. If one already exists with `status: 'active'`, leave it alone (idempotent).
4. If one exists with `status: 'inactive'`, do **not** auto-reject the confirm and do **not** auto-reactivate the record. By the time we see the confirmation, the worker has already committed — silently invalidating that would be worse UX than surfacing it for review. Instead: append a blocker to the AccountWorkforce doc (`{ code: 'CONFIRMED_WHILE_INACTIVE', assignmentId, at: now }`) and leave `status` as `inactive`. The blocker renders as an alert row on the Inactive view with two actions: "Cancel the assignment" or "Reactivate worker." The primary defense against this state is the ownership/placement gate — if we got here, that gate failed, and the blocker is the safety net.

### 3.5 Deactivation: manual only

There is no automatic deactivation in v1. A user with **tenant security level 5, 6, or 7** clicks "Deactivate for this account" from the worker's row on the Active view. The dialog:

1. Requires a reason (one of the codes in §3.1) and accepts optional free-text notes.
2. Lists the worker's currently confirmed future assignments for this account, with a "Cancel these future assignments" checkbox **checked by default**. Recruiters in practice won't remember to hunt down future shifts separately — leaving them scheduled while the worker is deactivated is exactly the ghost-shift pattern this field is meant to prevent. The recruiter can uncheck it if they have a reason to leave the assignments in place (e.g. the worker can still finish out this week before being deactivated going forward), but the default does the safe thing.

On submit, the callable writes:

```ts
{
  status: 'inactive',
  deactivatedAt: now,
  deactivatedBy: recruiterUid,
  deactivationReason,
  deactivationNotes,
}
```

…and, if the checkbox stayed checked, transitions each listed future assignment to `cancelled_business` with `outcomeNotes` referencing the deactivation.

Auto-flagging (not auto-deactivating) is a separate concern — the Inactive candidates lens in §5.6 surfaces workers worth reviewing but never flips state on their behalf.

### 3.6 Reactivation

Mirror operation: "Reactivate" writes `status: 'active'`, `reactivatedAt/By/Notes`, clears `deactivatedAt` and reason fields.

### 3.7 Counter maintenance

A secondary trigger on assignment outcome transitions updates `lastShiftAt`, `totalShifts`, `completedShifts` on the corresponding AccountWorkforce doc. These are denormalizations for display only — they don't gate any logic.

---

## 4. Scope and the account hierarchy

AccountWorkforce is always scoped to the **account that owns the job order**. In practice this is always a child account or a standalone account — never a national parent.

### 4.1 Why child-scope

A client saying "replace the guy at CORT Gaylord" should not cascade into "ban him from CORT Baltimore." Recruiter experience at different venues is independent. Scoping at the child preserves that independence and mirrors how job orders are already pinned (`jobOrder.recruiterAccountId`).

### 4.2 Parent view = union

When a recruiter opens Workforce on a National account (parent), the UI unions AccountWorkforce docs across all `account.childAccountIds` (plus any self-orders where `recruiterAccountId === parent.id`, for legacy data). The grouped-by-sub-account view pattern we shipped for the Job Orders tab applies directly — one group per child, parent-orders under a "(National)" group at top.

### 4.3 Location-level view

"Account → Location → Workforce" is a further filter on top of child-scope. AccountWorkforce is still keyed to the child account; the view adds an assignment-level filter `jo.worksiteId === thisLocationId`. No extra storage, just a where-clause in the query that feeds the Scheduled / Active lists.

### 4.4 Cross-child worker

A worker who works Gaylord, Baltimore, and Arlington has **three** AccountWorkforce docs with independent status. The National parent view shows them three times (once per child group). This is intentional — it lets a recruiter see "this person is active at Gaylord but we deactivated them at Baltimore" at a glance.

---

## 5. Views (Workforce tab sub-tabs)

Every view is a query over the two primitives. The sub-tabs on the Workforce tab:

### 5.1 Scheduled

**Forward-looking.** Assignments with `status === 'confirmed'` and shift date `>= today`, joined to worker data.

- Primary sort: next shift datetime ascending.
- Filters: Today / This week / This month; by sub-account (via the grouping pattern); by worker name.
- Columns: worker, shift, start datetime, sub-account, readiness chips (see §5.6).

**Scheduled intentionally excludes placements (placed but not yet confirmed).** Workforce is defined by commitment; placements are probability. Coverage visibility — "who might arrive, what shifts are still open" — is an operational question that already has a home on the Calendar tab and the Placements tab of each job order. Mixing the two on Scheduled would make the counts lie (a placement that expires without a confirm flickers in and then vanishes) and blur the domain definition this whole doc is built around. If recruiters eventually want one-click coverage visibility from Workforce, the right answer is a deep-link to Calendar / Placements, not a toggle inside Scheduled.

### 5.2 Active

**Relationship view.** All `account_workforce` docs for this scope with `status === 'active'`.

- Primary sort: `lastShiftAt` descending (most recently active first), falling back to `firstConfirmedAt` for workers who haven't shown up yet.
- Columns: worker, last shift, total shifts, next scheduled shift (computed from Scheduled view data), sub-account, readiness chips.
- Row action: **Deactivate for this account** (opens reason + notes dialog — §3.5).

### 5.3 Inactive

**Banned-for-this-scope view.** All `account_workforce` docs with `status === 'inactive'`.

- Columns: worker, deactivation date, deactivated by, reason, notes, last shift.
- Row action: **Reactivate** (opens notes dialog — §3.6).

### 5.4 Timesheets *(future)*

**Pay-period view.** For the selected pay period, all assignments with `outcomeStatus ∈ {'completed', 'left_early'}` grouped by worker. Derived entirely from Assignment — does not need AccountWorkforce. The sub-tab belongs here because pay is a consequence of being in the workforce, and recruiters expect to find it next to the roster.

Placeholder in v1. The full data model for timesheets lives in its own doc when we're ready to build.

### 5.5 Compliance / Readiness overlay

**Cross-cutting view.** Not a list of its own — a filter over Active + "scheduled to start soon" (Scheduled ∩ `firstConfirmedAt < 14 days ago`) that surfaces workers with readiness gaps (screening, I-9, onboarding, expiring creds, new account requirements).

This layer consumes existing `employeeReadinessItem` / `assignmentReadinessItem` data from the readiness architecture. It is a read-only projection for the Workforce tab; it does not write back.

### 5.6 Inactive candidates *(decision surface, not stored state)*

A secondary surface within the Active view — not a sub-tab. A small "At risk" callout chip on workers whose recent assignment history suggests recruiter review:

- Most recent outcome was `no_show` in the last N days.
- Two or more `left_early` outcomes in the last 30 days.
- Client or account flagged them (future, tied to account-level notes).

The chip opens a dialog with "Deactivate with reason…" prefilled. No auto state change. This is §3.5 made discoverable.

---

## 6. Triggers and writes

Cloud Functions that maintain the Workforce model:

### 6.1 `onAssignmentWriteMaintainAccountWorkforce`

Listens: `onDocumentWritten('tenants/{tid}/assignments/{id}')`.

Does:

1. Resolves `accountId` from `assignment.recruiterAccountId` or via JO lookup.
2. On `pending → confirmed`, creates `account_workforce/{accountId}__{workerId}` if absent (see §3.4).
3. On any outcome write (`completed`, `no_show`, `left_early`), updates counters + `lastShiftAt`.
4. Idempotent by design — a re-write of the same status is a no-op.

### 6.2 `setAccountWorkforceStatus` (callable)

Deactivate or reactivate from the Workforce tab UI. Permission: **tenant security level 5, 6, or 7** on the account's tenant (standard admin/manager/recruiter class). No per-account ownership check — if a user has admin-class access to the tenant, they can deactivate any worker for any account in it. The `deactivatedBy` audit field preserves who did it.

Inputs:
- `tenantId`, `accountId`, `workerId` — identifies the AccountWorkforce doc.
- `nextStatus: 'active' | 'inactive'`.
- When `inactive`: required `deactivationReason`, optional `deactivationNotes`, optional `cancelFutureAssignmentIds?: string[]` — the assignment ids the recruiter chose to cancel in the dialog (§3.5). The callable cascades each to `cancelled_business` with `outcomeNotes` referencing the deactivation.
- When `active`: optional `reactivationNotes`. Clears deactivation fields and any `blockers` of code `CONFIRMED_WHILE_INACTIVE`.

Writes the status transition + audit fields from §3.5 / §3.6 atomically with the optional cascade.

### 6.3 `seedAccountWorkforceBackfill` (one-time scratch script)

One-off migration to generate `account_workforce` docs from historical confirmed assignments. Walks `assignments` collectionGroup, groups by `(recruiterAccountId, userId)`, emits one doc per pair with `firstConfirmedAt` set to the earliest confirmed date, `lastShiftAt` to the most recent shift, counters rolled up. Idempotent — safe to re-run.

Lives in `.scratch/` per project conventions.

---

## 7. Firestore rules (sketch)

- **Read** `tenants/{tid}/account_workforce/{id}`: any user with tenant security level 5, 6, or 7, plus HRX. Workers can read their own doc (`resource.data.workerId == request.auth.uid`).
- **Create / update / delete**: server-only. All mutations flow through the callables in §6. The `setAccountWorkforceStatus` callable performs its own security-level check on the request auth before writing, so Firestore rules just need to block direct client writes.

Exact rule shapes follow the patterns in `firestore.rules` for existing tenant subcollections.

---

## 8. Migration plan

Phased so we can land the UI without waiting on the full backend.

**Phase 1 — Data model and backfill.** Define `account_workforce` shape, write the backfill script, run it against staging then prod. Output: durable docs for every historical active worker.

**Phase 2 — Triggers.** Ship `onAssignmentWriteMaintainAccountWorkforce` + `setAccountWorkforceStatus`. Output: the collection stays current and is writable from the UI.

**Phase 3 — Workforce tab: Scheduled + Active + Inactive.** Rebuild the Active Workers tab (already renamed to Workforce) as three sub-tabs driven by queries from §5.1–5.3. Sub-account grouping from the Job Orders tab pattern is reused.

**Phase 4 — Assignment outcome UX.** Add the shift-complete / no-show / left-early capture surface (today this is happening in the Placements tab for Gig shifts; Career needs parity). Fills in the outcome fields from §2.2.

**Phase 5 — Compliance overlay.** Wire readiness chips into the Scheduled and Active rows using existing `employeeReadinessItem` snapshots.

**Phase 6 — Timesheets.** Separate design doc; Workforce provides the entry point only.

---

## 9. Decisions and open questions

### 9.1 Resolved (captured in the body)

- **Contractor / 1099 modeling.** Single `account_workforce` collection. Engagement class is an attribute of the account's hiring entity (C1 Events → 1099, C1 Select and C1 Workforce → W2), resolved transitively via `accountWorkforce.accountId → account.hiringEntityId → entity.engagementType`. Denormalized onto the AccountWorkforce doc for query speed with a backfill path if an account's hiring entity ever changes. See §3.1 and §10.
- **Confirmed assignment on inactive AccountWorkforce.** Don't auto-reject and don't auto-reactivate. Write a `CONFIRMED_WHILE_INACTIVE` blocker on the doc; let the recruiter decide (cancel the shift or reactivate the worker) via the Inactive view. See §3.1, §3.4(4).
- **Scheduled granularity.** Confirmed assignments only. Placements are excluded, no toggle. Coverage visibility belongs on the Calendar and Placements tabs. See §5.1.
- **Deactivation cascade.** The deactivation dialog lists the worker's future confirmed assignments for this account and cancels them by default (checkbox, recruiter can opt out). Prevents ghost shifts. See §3.5.
- **Deactivation permission.** Tenant security level 5, 6, or 7 on the account's tenant. No per-account ownership check. See §3.5, §6.2, §7.
- **Deactivation reasons.** Seven codes locked: `no_show`, `left_early_repeat`, `client_requested`, `performance`, `attendance`, `policy`, `worker_request`, `other`. See §3.1.

### 9.2 Still open

- **Timesheet pay period model.** Weekly, biweekly, per-event? Affects the shape of §5.4 when we build it. Deferred until Phase 6.
- **Cross-tenant workers.** Not supported by the model — a worker's AccountWorkforce docs are scoped to a single tenant. Documenting this as a deliberate boundary; if multi-tenant workforce membership ever becomes a product requirement, it needs its own design pass.

---

## 10. Relationship to existing models

- **`actionItemOwnership`** (ownership model): governs which recruiter owns the worker / account. Workforce consumes this for the "Deactivate for this account" permission check — we do not duplicate ownership resolution here.
- **`employeeReadinessItem` / `assignmentReadinessItem`**: consumed read-only by the Compliance overlay (§5.5). Workforce does not write readiness state.
- **`placement` / `assignment`**: Workforce depends on assignments (§2). Placements are one step upstream — not part of Workforce until they're confirmed.
- **`user_employments` / `entity_employments`**: an employment record is the hiring entity side (C1 Select LLC, C1 Workforce LLC, C1 Events, etc.). AccountWorkforce is the customer-account side. A worker at CORT Gaylord has one `entity_employments` doc per hiring entity they've been employed by, and a separate `account_workforce` doc per customer account they've worked at. The two are parallel and should never be conflated.

- **Engagement class (W2 vs 1099) is entity-driven.** Every account has exactly one hiring entity. Every hiring entity has a fixed engagement class: C1 Events books 1099 contractors only; C1 Select and C1 Workforce book W2 employees only. AccountWorkforce reads engagement class transitively through the account's `hiringEntityId`, which means the same physical worker can legitimately show up as W2 on one AccountWorkforce doc (a C1 Select account) and 1099 on another (a C1 Events account) without contradiction. The denormalized `engagementType` field in §3.1 is a cache of this derivation for query speed — the entity doc is authoritative.

- **Labor Pool search**: when a recruiter searches for workers for Account Y, workers who are Inactive at some other Account X should still surface, but with a quiet "Inactive at N account(s)" chip on the row. The chip opens a tooltip listing the accounts + reasons so the recruiter has context before placing. This is consumer-side behavior, not a Workforce-model change — AccountWorkforce remains the source of truth and the Labor Pool query just joins against it. Scheduled for Phase 5 alongside the compliance overlay.

---

## 11. Naming

"Workforce" is the user-facing term. Internally:

- Collection: `account_workforce`
- Doc shape: `AccountWorkforce` (`src/types/accountWorkforce.ts`)
- Callable: `setAccountWorkforceStatus`
- Trigger: `onAssignmentWriteMaintainAccountWorkforce`

Avoid "active workers" as an API term — it collides with the `status: 'active'` concept on individual assignments and the standing-relationship `status: 'active'` on AccountWorkforce. The UI tab is called Workforce; the filter within it is called "Active."
