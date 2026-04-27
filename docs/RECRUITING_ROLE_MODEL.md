# Recruiting role model

This document defines the four-role operating model the Recruiting Department
is moving to, and how each role is represented in HRX. It supersedes the
single-concept "recruiter owns the worker" framing that drove
`recruiter-ownership-model.md` and the existing `resolveOwnership` resolver.

Source of operating principles: internal "Recruiting Department Role Structure"
brief (Greg, 2026). That document defines the roles and mission statements;
this one maps them to HRX data structures, resolver semantics, and migration
steps.

**Scope**

- **In scope:** the four roles, where role assignments live, how HRX
  resolves "who is the CSA / Scheduler for this record," and what changes in
  denormalized fields on workers, accounts, user groups, orders, and
  timesheets.
- **Out of scope (yet):** the Action Queue split across roles (deferred per
  Greg — revisit after the role model lands), any automation that routes
  work to role-holders.

---

## 1. The operating principle

> **Every order has exactly one owner at every stage.** Not every worker.
> A Systems Operator records reality. A Scheduler decides who works where.
> A Candidate Success Agent owns the worker relationship. A Payroll
> Coordinator owns hours.

Workers don't get "owned" by a single human in the old sense. They have a
Candidate Success Agent — a relationship, not authority — and an
ever-rotating cast of Schedulers who touched their shifts. The scalar
"primary recruiter" concept was the right shape for the old generalist
model; under the new model it narrows to specifically **CSA**.

---

## 2. The four roles

Each role has a mission, a scope, and a home for its assignments.

### 2.1 Candidate Success Agent (CSA)

- **Mission**: human voice of C1 for every worker. Welcome calls,
  ongoing support, first-shift follow-up, onboarding unblockers.
- **Scope**: per worker (derived via user group membership).
- **Assignment lives on**: `userGroup.roles.csaIds`.
- **Denormalized onto the worker**: `users.{uid}.primaryRecruiterId`
  (kept for continuity; semantically **narrows to CSA** under this model).

A worker's CSA is resolved by walking their user group memberships and
taking the first group with CSA assignments. Tenant default exists as a
last-resort fallback; "unassigned" is a legitimate resolved state for
workers who aren't in any group with a CSA.

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

### 2.5 Role overlap

One person can hold multiple roles. A small account might have the same
uid in both `userGroup.roles.csaIds` and `account.roles.schedulerIds`.
The role assignments are **independent fields** — we don't collapse them
into a union of "operator roles." Overlap shows up naturally in lookups
rather than being explicitly modeled.

---

## 3. Resolution tiers per role

Each role has its own tier walk. The resolver picks the most specific
non-empty tier. All tier walks end in "unassigned" (null) so the UI can
render a visible "Unassigned" badge rather than a silent blank.

### 3.1 CSA (per worker)

```
worker's user groups (ordered) → userGroup.roles.csaIds
  → (fallback) tenants/{tid}/settings/roleDefaults.csaFallbackIds
  → unassigned
```

A worker in multiple groups with multiple CSAs gets a deterministic
pick (earliest-created group first, or alphabetical on group id when
timestamps tie) plus a `visibleRecruiterIds`-style array of every CSA
across their groups — the primary is sticky, the visible list
re-derives on group membership changes.

### 3.2 Scheduler (per order)

```
jobOrder.recruiterAccountId → account.roles.schedulerIds
  → (fallback) tenants/{tid}/settings/roleDefaults.schedulerFallbackIds
  → unassigned
```

Multiple Schedulers on one account → same primary-plus-visibility
pattern as CSA. The primary is the Scheduler stamped onto the order; the
visibility list is every Scheduler on that account.

### 3.3 HRX Systems Operator (per tenant)

```
tenants/{tid}/settings/roleDefaults.hrxSystemsOperatorIds → unassigned
```

No per-record resolution. The tenant-level list is the answer.

### 3.4 Payroll Coordinator (per tenant, later per-record)

Same as HRX Systems Operator for now. When timesheets ship, we'll
either keep it tenant-level or introduce a per-account / per-entity
override (TBD during the Phase 6 design pass).

---

## 4. Schema additions

New fields, roughly in dependency order for implementation.

### 4.1 User group

```ts
userGroup.roles = {
  /** Candidate Success Agents responsible for this group's workers. */
  csaIds: string[];
};
```

The pre-existing `groupManagerIds` field is **not** the same thing and
doesn't get repurposed. `groupManagerIds` keeps whatever semantics it
has today (admin rights on the group); `roles.csaIds` is the new
CSA-specific list. If it turns out they're always identical in
practice, a later pass can collapse them — don't do it pre-emptively.

### 4.2 Account

```ts
account.roles = {
  /** Schedulers responsible for this account's orders. */
  schedulerIds: string[];
};
```

Pre-existing `account.associations.recruiterIds` stays. It's the
visibility list ("anyone who should see this account in their queue"),
not the role assignment. The Scheduler list is a subset of or
orthogonal to it — up to account admins.

### 4.3 Tenant

```ts
tenants/{tid}/settings/roleDefaults = {
  hrxSystemsOperatorIds: string[];
  payrollCoordinatorIds: string[];
  csaFallbackIds?: string[];      // used when a worker's groups have no CSA
  schedulerFallbackIds?: string[]; // used when an account has no Scheduler
};
```

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
users.{uid}.primaryRecruiterId   // KEEP — semantically narrows to CSA
```

No rename. Callers that already read this field continue to work; its
meaning tightens to "the worker's CSA, resolved via user groups." A
future pass can introduce `users.{uid}.candidateSuccessAgentUid` as a
clearer alias, but keeping the existing field avoids a migration of
every consumer on day one.

---

## 5. What changes for existing surfaces

### 5.1 The "Owner" block on the user profile header

Renamed to **"Candidate Success Agent"** (same data source:
`primaryRecruiterId`). "Unassigned" state is preserved — it's more
visible than silent absence.

### 5.2 The Job Order header

Add a **"Scheduler"** chip or line in the header, resolved from
`jobOrder.schedulerUid`. Click through goes to that recruiter's
profile, same as the CSA link on the worker header.

### 5.3 AccountWorkforce deactivation gate

Today's gate is security level 5/6/7 for the tenant. The role model
tightens this to: **any CSA for the account's groups OR any Scheduler
for the account**. Rationale: deactivating a worker from an account is
an operational call the relationship-owner or the order-owner should
make — security-level-5-as-generic-admin was the old model's
approximation.

Technical shape: the `setAccountWorkforceStatus` callable's gate
becomes a two-step check — role-resolver says "is this caller a CSA
for any group that contains this worker, or a Scheduler for this
account?" If either, allow. HRX still auto-qualifies.

### 5.4 `resolveOwnership` → `resolveRole`

Today's resolver returns one "recruiter." We add a sibling resolver
that takes a `role` parameter and does the tier walk specific to that
role (§3). Existing callers of `resolveOwnership` keep working; new
code uses `resolveRole(role, context)`. A future cleanup pass can
replace `resolveOwnership` with `resolveRole('candidate_success_agent',
...)` once every call site is updated.

### 5.5 Action Queue (`RecruiterMyQueue`)

Intentionally deferred. The current queue keeps working as-is. We
revisit after the role model lands, most likely splitting into a
role-aware queue (CSAs see worker items, Schedulers see order items,
Payroll sees timesheet items). Open question §7.

---

## 6. Migration plan

Six phases, small enough to land independently.

**Phase 1 — Doc + header rename.** This doc + change "Owner" label to
"Candidate Success Agent" on the user profile header. Zero data
changes, unblocks the rest.

**Phase 2 — Schema additions.** Add `userGroup.roles.csaIds`,
`account.roles.schedulerIds`,
`tenants/{tid}/settings/roleDefaults`. Empty by default — existing
behavior unchanged until admins populate them.

**Phase 3 — Role assignment UI.** Edit fields on the User Group
editor (CSAs) and Account editor (Schedulers). Tenant Settings gets a
"Role Defaults" section for the tenant-level lists. This is the first
human-visible change beyond the header rename.

**Phase 4 — Resolver and trigger updates.**
- Add `resolveRole(role, context)` alongside `resolveOwnership`.
- Update the `primaryRecruiterId` denorm trigger to prefer the new
  CSA resolution path when `userGroup.roles.csaIds` is populated,
  falling back to the legacy walk when it isn't. No breaking change.
- Add the `jobOrder.schedulerUid` denormalization trigger.

**Phase 5 — Surfaces.** Add the Scheduler chip to the Job Order
header. Tighten the `setAccountWorkforceStatus` gate (§5.3). Update
the doc-wide "primary recruiter" language on any screen where
"Candidate Success Agent" is more accurate.

**Phase 6 — Action Queue split.** Open-ended; design pass after 60
days of operating with the role model.

---

## 7. Open questions

- **Visibility list for CSAs across multiple groups.** If a worker is
  in three groups each with its own CSA, should the "primary CSA"
  be the earliest-created group's CSA, or the group the worker has
  been in longest, or explicitly configurable per tenant? Punting
  to "earliest-created group" as the default in Phase 4; revisit if
  recruiters complain.
- **Scheduler on orders where `recruiterAccountId` is a National
  parent.** National accounts are rare at the order level (child
  accounts own the orders), but if it ever happens, resolution
  walks parent.roles.schedulerIds as a fallback. Confirm during
  Phase 4 when we code the trigger.
- **Does the tenant `hrxSystemsOperatorIds` list gate any actions?**
  The role doc says the HRX Operator "owns data truth" but doesn't
  give the role any callable-level permissions we don't already
  have. Keeping it as a display/Slack-routing concept for now — no
  Firestore rule tightening.
- **When the Payroll Coordinator ships (Phase 6 of Workforce),
  does the role stay tenant-wide or narrow to per-hiring-entity?**
  Decide during Phase 6 design. Recorded here so the
  tenant-level default isn't read as permanent.

---

## 8. Relationship to existing docs

- **`docs/WORKFORCE_DOMAIN_MODEL.md`** — Workforce defines AccountWorkforce
  (worker-to-account relationship state). This doc defines which
  humans carry which roles against that workforce. The two are
  orthogonal: Workforce is data, role model is operator coverage.
- **`shared/resolveOwnership.ts`** (and `shared/actionItemOwnership.ts`)
  — old single-owner resolver. Keeps working for Phase 4; replaced
  incrementally by `resolveRole`.
- **`shared/workerPrimaryRecruiter.ts`** — helper that populates
  `users.{uid}.primaryRecruiterId`. Logic updates in Phase 4 to
  prefer the CSA tier walk.
- **`recruiter-ownership-model.md`** (referenced in older comments
  like `actionItemOwnership.ts`) — supersede. Keep the file for
  history; cite this one going forward.
