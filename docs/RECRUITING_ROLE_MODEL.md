# Recruiting role model

This document defines the operating model the Recruiting Department is
moving to, and how each role is represented in HRX. It supersedes the
single-concept "recruiter owns the worker" framing that drove
`recruiter-ownership-model.md` and the existing `resolveOwnership` resolver.

Source of operating principles: internal "Recruiting Department Role Structure"
brief (Greg, 2026). That document defines the roles and mission statements;
this one maps them to HRX data structures, resolver semantics, and migration
steps.

> **Changelog — model simplification (2026-05).**
>
> The earlier draft of this model named four record-scoped roles
> (CSA + Scheduler) and treated CSA as the durable per-worker
> relationship. That overlapped uncomfortably with the existing
> Recruiter role. The model is now simplified to:
>
> - **Two record-scoped roles** with durable per-worker meaning:
>   - **Recruiter** — durable per-worker relationship (the original
>     `primaryRecruiterId` semantic, untouched).
>   - **Scheduler** — order/account-scoped, unchanged.
> - **One narrow specialty**:
>   - **Onboarding Specialist** — formerly known as "Candidate Success
>     Agent (CSA)". Renamed and narrowed to a single function:
>     making welcome / onboarding calls to new workers in their group.
>     Per user group only. **No tenant-level fallback.**
> - **Two tenant-level roles**: HRX Systems Operator, Payroll
>   Coordinator (unchanged).
>
> Practically: anywhere this doc previously said "CSA" or "Candidate
> Success Agent" in the durable per-worker sense, the role is now
> **Recruiter**. Anywhere the previous CSA wording referred to the
> welcome-call function, the role is now **Onboarding Specialist**.
> The schema field on user groups was renamed
> `userGroup.roles.csaIds` → `userGroup.roles.onboardingSpecialistIds`,
> and the tenant default `csaFallbackIds` was deleted.

**Scope**

- **In scope:** the role model, where role assignments live, how HRX
  resolves "who is the Recruiter / Onboarding Specialist / Scheduler
  for this record," and what changes in denormalized fields on workers,
  accounts, user groups, orders, and timesheets.
- **Out of scope (yet):** the Action Queue split across roles (deferred
  per Greg — revisit after the role model lands), any automation that
  routes work to role-holders.

---

## 1. The operating principle

> **Every order has exactly one owner at every stage.** Not every worker.
> A Systems Operator records reality. A Scheduler decides who works where.
> A Recruiter owns the durable worker relationship. An Onboarding
> Specialist owns the welcome / onboarding-call function for new
> workers in their group. A Payroll Coordinator owns hours.

Workers don't get "owned" by a single human in the old sense. They have a
**Recruiter** (a durable per-worker relationship), they may have an
**Onboarding Specialist** during their first weeks (resolved via user
group membership, narrowly responsible for welcome calls), and they
have an ever-rotating cast of Schedulers who touched their shifts. The
scalar `primaryRecruiterId` continues to mean **Recruiter** under this
model — that's the durable per-worker tie.

---

## 2. The roles

Each role has a mission, a scope, and a home for its assignments.

### 2.1 Onboarding Specialist

- **Mission**: make welcome / onboarding calls to new workers in their
  group. The human voice that greets a new worker in their first week.
- **Scope**: per user group. No durable per-worker ownership — that's
  the Recruiter.
- **Assignment lives on**: `userGroup.roles.onboardingSpecialistIds`.
- **Denormalized onto the worker**: none. There is no scalar field
  for "this worker's Onboarding Specialist." The role is resolved live
  from group membership at action-queue read time.

A worker's Onboarding Specialist (when one applies) is resolved by
walking their user group memberships and taking the first group with
non-empty `roles.onboardingSpecialistIds`. **There is no tenant-level
fallback.** "Unassigned" is a legitimate resolved state for workers
who aren't in any group with an Onboarding Specialist.

### 2.2 Scheduler

- **Mission**: own every incoming customer order from receipt to
  fill-or-decline; day-of customer contact.
- **Scope**: per order (and, by extension, per account — a Scheduler
  effectively owns the account's order flow).
- **Assignment lives on**: `account.roles.schedulerIds`.
- **Denormalized onto the order**: `jobOrder.schedulerUid` (stamped at
  creation and on account-role changes).

Workers do **not** have a durable relationship with a Scheduler — the
Scheduler is touched transitively through whichever shift a worker is on
right now. We do not denormalize a Scheduler scalar onto the worker doc.

### 2.3 HRX Systems Operator

- **Mission**: make HRX mirror reality. Enter and maintain customers,
  locations, orders, postings, shifts.
- **Scope**: tenant-wide. Usually one or two people.
- **Assignment lives on**: `tenants/{tid}/settings/roleDefaults.hrxSystemsOperatorIds`.
- **Denormalized onto records**: none. The role is tenant-level.

### 2.4 Payroll Coordinator

- **Mission**: timesheet accuracy end-to-end.
- **Scope**: tenant-wide initially; may split per-entity or per-account
  later (Phase 6 of Workforce — see
  `docs/WORKFORCE_DOMAIN_MODEL.md` §5.4 and §9).
- **Assignment lives on**:
  `tenants/{tid}/settings/roleDefaults.payrollCoordinatorIds`.
- **Denormalized onto timesheets**: future — not modeled yet. When we
  build timesheets, `timesheet.payrollCoordinatorUid` gets stamped at
  create time the same way `jobOrder.schedulerUid` is.

### 2.5 Recruiter (per-worker durable relationship)

- **Mission**: the worker's durable point-of-contact inside HRX.
  Recruiters carry the relationship across assignments and
  re-engagements; they own the longitudinal "this is the human I work
  with at C1" channel.
- **Scope**: per worker. Modeled as a scalar
  `users.{uid}.primaryRecruiterId`.
- **Assignment lives on**: `users.{uid}.primaryRecruiterId` (existing
  scalar, semantics unchanged).
- **Resolver**: existing `resolveOwnership` / `workerPrimaryRecruiter`
  helpers. **No changes** under this model — the Recruiter role is
  not in `resolveRole`'s scope.

The Recruiter and Onboarding Specialist roles can overlap in practice
(the same human may do welcome calls for their own workers), but the
fields are independent. The Onboarding Specialist resolver does not
read `primaryRecruiterId`, and the Recruiter resolver does not read
`onboardingSpecialistIds`.

### 2.6 Role overlap

One person can hold multiple roles. A small account might have the same
uid in `userGroup.roles.onboardingSpecialistIds`,
`account.roles.schedulerIds`, and `users.{workerUid}.primaryRecruiterId`.
The role assignments are **independent fields** — we don't collapse
them into a union of "operator roles." Overlap shows up naturally in
lookups rather than being explicitly modeled.

---

## 3. Resolution tiers per role

Each role has its own tier walk. The resolver picks the most specific
non-empty tier. All tier walks end in "unassigned" (null) so the UI can
render a visible "Unassigned" badge rather than a silent blank.

### 3.1 Onboarding Specialist (per worker via user group)

```
worker's user groups (ordered) → userGroup.roles.onboardingSpecialistIds
  → unassigned
```

**One tier only.** No tenant-level fallback — the Onboarding
Specialist function is intentionally local to the group, and a worker
whose groups have no Onboarding Specialist resolves to "Unassigned"
rather than to a tenant-default human.

A worker in multiple groups with multiple Onboarding Specialists gets
a deterministic pick (earliest-created group first, or alphabetical on
group id when timestamps tie) plus a visibility array of every
Onboarding Specialist across their groups.

### 3.2 Scheduler (per order)

```
jobOrder.recruiterAccountId → account.roles.schedulerIds
  → (fallback) tenants/{tid}/settings/roleDefaults.schedulerFallbackIds
  → unassigned
```

Multiple Schedulers on one account → primary-plus-visibility pattern.
The primary is the Scheduler stamped onto the order; the visibility
list is every Scheduler on that account.

### 3.3 HRX Systems Operator (per tenant)

```
tenants/{tid}/settings/roleDefaults.hrxSystemsOperatorIds → unassigned
```

No per-record resolution. The tenant-level list is the answer.

### 3.4 Payroll Coordinator (per tenant, later per-record)

Same as HRX Systems Operator for now. When timesheets ship, we'll
either keep it tenant-level or introduce a per-account / per-entity
override (TBD during the Phase 6 design pass).

### 3.5 Recruiter (per worker)

Resolved by the legacy `resolveOwnership` resolver and persisted as
`users.{uid}.primaryRecruiterId`. Not part of `resolveRole`. Outside
the scope of this rewrite — see `recruiter-ownership-model.md` and
`shared/workerPrimaryRecruiter.ts`.

---

## 4. Schema additions

New fields, roughly in dependency order for implementation.

### 4.1 User group

```ts
userGroup.roles = {
  /**
   * Onboarding Specialists responsible for welcome calls to new
   * workers in this group. Per-group scope only.
   */
  onboardingSpecialistIds: string[];
};
```

**Defensive read pattern** during the rename transition window: every
call site that reads this field reads
`group.roles?.onboardingSpecialistIds ?? group.roles?.csaIds ?? []`.
The legacy `roles.csaIds` is left in place by the migration script and
removed by a separate cleanup PR after the transition soak.

The pre-existing `groupManagerIds` field is **not** the same thing and
doesn't get repurposed. `groupManagerIds` keeps whatever semantics it
has today (admin rights on the group); `roles.onboardingSpecialistIds`
is the new Onboarding-Specialist-specific list.

### 4.2 Account

```ts
account.roles = {
  /** Schedulers responsible for this account's orders. */
  schedulerIds: string[];
};
```

Pre-existing `account.associations.recruiterIds` stays. It's the
visibility list ("anyone who should see this account in their queue"),
not the role assignment.

### 4.3 Tenant

```ts
tenants/{tid}/settings/roleDefaults = {
  hrxSystemsOperatorIds: string[];
  payrollCoordinatorIds: string[];
  schedulerFallbackIds?: string[]; // used when an account has no Scheduler
};
```

**No `csaFallbackIds`.** The Onboarding Specialist role is intentionally
group-scoped and does not have a tenant-level fallback. If a tenant
needs a tenant-wide welcome-calls list, that's a separate role
(tracked as a future ticket).

Lives under `settings/` rather than as a top-level tenant field — same
path pattern as existing tenant config docs.

### 4.4 Job order

```ts
jobOrder.schedulerUid?: string;
```

Stamped at order creation from the account's Scheduler list; kept in
sync when the account's roster changes via a trigger. Null when no
Scheduler resolves.

### 4.5 User doc (denormalization, minimal change)

```ts
users.{uid}.primaryRecruiterId   // KEEP — unchanged. This is the Recruiter.
```

No rename, no semantic shift. This field continues to mean the
worker's durable Recruiter relationship. Any earlier draft of this
doc that suggested narrowing this scalar to "the worker's CSA" is
superseded.

---

## 5. What changes for existing surfaces

### 5.1 The "Owner" block on the user profile header

**No change** — the user profile header continues to show the
**Recruiter** (`primaryRecruiterId`). The earlier draft proposed
renaming this block to "Candidate Success Agent"; that prescription
was withdrawn when the model was simplified.

### 5.2 The Job Order header

Add a **"Scheduler"** chip or line in the header, resolved from
`jobOrder.schedulerUid`. Click through goes to that recruiter's
profile.

### 5.3 AccountWorkforce deactivation gate

The role-model gate is: **any Onboarding Specialist for any user
group containing this worker, OR any Scheduler for the account, OR
HRX auto-qualifies, OR (legacy fallback) tenant security level
5/6/7**. Defensive read of
`userGroup.roles.onboardingSpecialistIds ?? userGroup.roles.csaIds`
lets the gate continue working through the rename transition.

The legacy security-level fallback is kept so tenants that haven't
populated Onboarding Specialists / Schedulers yet don't lose the
ability to deactivate.

### 5.4 `resolveOwnership` → `resolveRole`

`resolveOwnership` continues to own per-worker Recruiter resolution.
`resolveRole(role, context)` handles the new role model:
`'onboarding_specialist'`, `'scheduler'`, `'hrx_systems_operator'`,
`'payroll_coordinator'`. The two resolvers do not share state and do
not call each other.

### 5.5 Action Queue (`RecruiterMyQueue`)

Intentionally deferred. The current queue keeps working as-is. We
revisit after the role model lands, most likely splitting into a
role-aware queue (Onboarding Specialists see their group's onboarding
items, Schedulers see order items, Payroll sees timesheet items).

---

## 6. Migration plan

Phases sized to land independently.

**Phase 2 — Schema additions.** Add
`userGroup.roles.onboardingSpecialistIds` and
`account.roles.schedulerIds`, plus
`tenants/{tid}/settings/roleDefaults` (without
`csaFallbackIds`). Empty by default — existing behavior unchanged
until admins populate them.

> Phase 1 (the doc + header rename) is dropped under the simplified
> model. The user profile header continues to show Recruiter, so
> there's nothing to rename there.

**Phase 3 — Role assignment UI.** Edit fields on the User Group
editor (Onboarding Specialists) and Account editor (Schedulers).
Tenant Settings gets a "Role Defaults" section for the tenant-level
lists. This is the first human-visible change.

**Phase 4 — Resolver and trigger updates.**
- Add `resolveRole(role, context)` alongside `resolveOwnership`.
- Add the `jobOrder.schedulerUid` denormalization trigger.
- Onboarding Specialist resolution is read live at action-queue read
  time; no scalar denorm field on the worker.

**Phase 5 — Surfaces.** Add the Scheduler chip to the Job Order
header. Tighten the `setAccountWorkforceStatus` gate (§5.3). Surface
the Onboarding Specialist action queue at `/staff-onboarding`.

**Phase 6 — Action Queue split.** Open-ended; design pass after 60
days of operating with the role model.

---

## 7. Open questions

- **Visibility list for Onboarding Specialists across multiple groups.**
  If a worker is in three groups each with its own Onboarding
  Specialist, the "primary" is the earliest-created group's
  Onboarding Specialist. Revisit if the picker proves confusing in
  practice.
- **Scheduler on orders where `recruiterAccountId` is a National
  parent.** National accounts are rare at the order level (child
  accounts own the orders), but if it ever happens, resolution
  walks parent.roles.schedulerIds as a fallback. Confirm during
  Phase 4 when we code the trigger.
- **Does the tenant `hrxSystemsOperatorIds` list gate any actions?**
  Keeping it as a display/Slack-routing concept for now — no
  Firestore rule tightening.
- **When the Payroll Coordinator ships (Phase 6 of Workforce),
  does the role stay tenant-wide or narrow to per-hiring-entity?**
  Decide during Phase 6 design.

---

## 8. Relationship to existing docs

- **`docs/WORKFORCE_DOMAIN_MODEL.md`** — Workforce defines AccountWorkforce
  (worker-to-account relationship state). This doc defines which
  humans carry which roles against that workforce. The two are
  orthogonal: Workforce is data, role model is operator coverage.
- **`shared/resolveOwnership.ts`** (and `shared/actionItemOwnership.ts`)
  — owns per-worker Recruiter resolution. Untouched by the
  Onboarding Specialist rename.
- **`shared/workerPrimaryRecruiter.ts`** — helper that populates
  `users.{uid}.primaryRecruiterId`. Untouched.
- **`recruiter-ownership-model.md`** (referenced in older comments
  like `actionItemOwnership.ts`) — supersede. Keep the file for
  history; cite this one going forward.
- **`docs/ONBOARDING_SPECIALIST_RENAME_CURSOR_BRIEF.md`** — the
  rename PR brief. References this doc as the canonical role model.
