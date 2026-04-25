# Readiness Model

**Status: Canonical** — change this doc *before* changing types, seed runners, or UI.

This doc names the three readiness scopes that operate on every worker in the system, fixes their item composition per hiring entity, and assigns the role responsible for each.

It exists because we kept conflating "is this worker fully onboarded?" with "is this worker ready to start *this* job?" — those are different questions with different owners and different data shapes. Three named buckets, three crisp owners, no overlap.

For mini-step level detail (which exact field on which exact doc backs each item), see [`CANONICAL_ONBOARDING_STEP_MATRIX.md`](./CANONICAL_ONBOARDING_STEP_MATRIX.md). This doc sits one level above that.

---

## 1. The three buckets

| # | Bucket | Scope | Owner | Gates what? |
|---|--------|-------|-------|-------------|
| 1 | **Worker Profile Readiness** | Per worker (one set per `users/{uid}`) | The **worker themselves** (via the C1 mobile app) | Nothing hard. UX completion meter on Home; influences AI scoring weights. |
| 2 | **Employee/Contractor Readiness** | Per `(worker, hiring entity)` — one set per `entity_employments` doc | The **CSA** for the worker's user group | Whether the worker can be **paid** under that hiring entity. Workers can be placed without it complete; they cannot start payable work. |
| 3 | **Job Readiness** | Per assignment (snapshotted from the job order's requirement package) | The **CSA** for the worker's user group | Whether the worker can **start** *this specific* assignment. |

Buckets are mutually exclusive. An item lives in exactly one bucket. If you ever find yourself adding the same item to two buckets, the framing is wrong — escalate before coding.

---

## 2. Worker Profile Readiness

**Purpose**: Make sure the worker record is real, contactable, and complete enough to score and surface to recruiters.

**Owner**: The worker. Surfaced on the C1 mobile app's Home screen as a percent-complete meter.

**Gating**: None. A worker with 50% profile readiness can still apply, be placed, and start jobs. Profile readiness only affects:
- AI scoring weights (lower readiness → lower confidence)
- Recruiter sort signals ("Sort by profile completeness")
- The Home checklist's `Next: <label>` CTA

**Items** (locked Apr 2026 — extend by editing this doc and `WORKER_READINESS_DATA_CONTRACT.md` together):

- `profile_photo`
- `phone_verified`
- `address_confirmed`
- `emergency_contact`
- `bio`
- `work_experience` (≥1 entry)
- `education`
- `skills` (≥3 selected)
- `availability_preferences`
- `resume` (uploaded; optional but high-impact)
- `transportation`
- `languages`

**Source of truth**: `users/{uid}.workerProfile.readiness.homeSnapshot` (see [`WORKER_READINESS_DATA_CONTRACT.md`](./WORKER_READINESS_DATA_CONTRACT.md)).

**Note on naming**: Some of these items currently appear in `BASELINE_W2_REQUIREMENTS` / `BASELINE_1099_REQUIREMENTS` in `shared/seedEmployeeReadinessItems.ts` (e.g. `profile_photo`, `phone_verified`, `emergency_contact`, `address_confirmed`). That's a misclassification we should clean up — those items belong **here**, not in Employee Readiness. See §6.

---

## 3. Employee/Contractor Readiness

**Purpose**: Make sure the worker can be legally paid by a specific C1 hiring entity. Distinct per entity because the legal requirements differ.

**Owner**: The CSA for the worker's user group. The CSA is responsible for chasing down each item until the set is complete for every entity the worker is employed under.

**Gating**: A worker can be **placed** on a job order before this is complete. They **cannot start payable work** for that hiring entity until it is. The Scheduler is responsible for not starting workers who aren't Employee-Ready for the entity backing the job order.

**Three hiring entities, three item sets**:

### 3.1 C1 Events LLC — 1099 contractor

| Item | Backed by |
|------|-----------|
| `ic_agreement` | Independent Contractor Agreement signed (e-sign envelope) |
| `tax_w9` | W-9 on file |
| `tax_1099_consent` | Consent to receive 1099 electronically |
| `handbook_acknowledgement` | Contractor handbook acknowledged |
| `payroll_setup` | Direct deposit / payment method configured (no Everee for contractors as of Apr 2026) |

No I-9. No E-Verify. No W-4.

### 3.2 C1 Select LLC — W2 employee with E-Verify

| Item | Backed by |
|------|-----------|
| `i9_section_1` | Worker completes I-9 §1 |
| `i9_section_2` | Employer completes I-9 §2 |
| `e_verify` | E-Verify case opened and resolved (authorized / final non-confirmation / etc.) |
| `tax_w4` | Federal + state W-4 on file |
| `handbook_acknowledgement` | Employee handbook acknowledged |
| `payroll_setup` | Everee profile invited + activated; direct deposit configured |

E-Verify is **Select-only**. See [`EVerify_IMPLEMENTATION_SUMMARY.md`](./EVerify_IMPLEMENTATION_SUMMARY.md) and [`CANONICAL_ONBOARDING_STEP_MATRIX.md` §0](./CANONICAL_ONBOARDING_STEP_MATRIX.md).

### 3.3 C1 Workforce LLC — W2 employee, no E-Verify

| Item | Backed by |
|------|-----------|
| `i9_section_1` | Worker completes I-9 §1 |
| `i9_section_2` | Employer completes I-9 §2 |
| `tax_w4` | Federal + state W-4 on file |
| `handbook_acknowledgement` | Employee handbook acknowledged |
| `payroll_setup` | Payroll configured (TempWorks / Everee / etc. depending on tenant) |

Same as Select minus the E-Verify case.

**Source of truth**:
- Schema: `EmployeeReadinessItem` in `shared/employeeReadinessItem.ts`
- Item lists per entity: `BASELINE_1099_REQUIREMENTS` and `BASELINE_W2_REQUIREMENTS` in `shared/seedEmployeeReadinessItems.ts`. **These need to be pruned to match this doc** (see §6).
- Doc storage: `tenants/{tid}/employee_readiness/{entityEmploymentId}__{itemId}` (one doc per item per entity employment).
- Seed runner: `functions/src/readiness/seedEmployeeReadinessItemsRunner.ts`, fired on `entity_employments` create.

---

## 4. Job Readiness

**Purpose**: Make sure the worker meets the specific requirements *this* job order imposes — beyond what's required to be employed at all.

**Owner**: The CSA for the worker's user group. The CSA owns both the worker-side resolution (ordering background checks, recording certifications) AND ensuring the worker meets the JO's requirements before they're assigned. The Scheduler is responsible for *defining* a JO's requirement package on the JO itself, but resolving readiness items for an assigned worker is CSA work — it lives on the CSA's Action Queue, not the Scheduler's.

**Gating**: A worker **cannot start** an assignment until every Job Readiness item is `complete` (or `waived` with a recorded reason).

**Per-job-order, snapshotted to the assignment**:

Job Readiness items are defined on the **job order** in a `requirementPackage` (and the explicit `requiredCertifications`, `requiredScreenings`, `requiredSkills`, `requiredEducation` arrays on `tenants/{tid}/job_orders/{joId}`). When an assignment is created, the JO's requirement set is snapshotted into `tenants/{tid}/onboarding_instances/{assignmentId}.resolvedSteps` / `resolvedDocuments` / `resolvedChecks`. **The snapshot is the source of truth from that point on** — changes to the JO's requirements after the fact do not retroactively re-gate existing assignments.

**Item categories** (each JO can specify any combination):

- **Screenings** — background check (national, county, employment), drug test, MVR, OFAC/SAM, etc. Backed by `backgroundChecks` (AccuSource integration) and `onboarding_instances.resolvedChecks`.
- **Certifications** — forklift, OSHA-10, ServSafe, Food Handler, RBS, etc. Backed by `users/{uid}.certifications[]` cross-referenced against `requiredCertifications` on the JO.
- **Licenses** — driver's license class A/B/CDL endorsements, professional licenses. Backed by `users/{uid}.licenses[]`.
- **Skills** — manual lift to N lbs, specific equipment proficiency. Soft-match against `users/{uid}.skills[]`. Often non-blocking ("preferred"); JO marks which are required.
- **Education** — high school diploma, college degree, specific coursework. Backed by `users/{uid}.education[]`.
- **Job-specific signed documents** — site safety acknowledgements, NDAs, client-specific policy attestations. Backed by `signature_envelopes` and `onboarding_instances.resolvedDocuments`.

**Source of truth**:
- Schema: `AssignmentReadinessItem` in `shared/assignmentReadinessItem.ts`
- JO definition fields: `requirementPackage`, `requiredCertifications`, `requiredScreenings`, `requiredSkills`, `requiredEducation` on `tenants/{tid}/job_orders/{joId}`
- Per-assignment snapshot: `tenants/{tid}/onboarding_instances/{assignmentId}` (`resolvedSteps`, `resolvedDocuments`, `resolvedChecks`)
- Doc storage: `tenants/{tid}/assignment_readiness/{assignmentId}__{itemId}`
- Seed runner: `functions/src/readiness/onAssignmentCreatedAutoSeed.ts`

---

## 5. Cross-cutting principles

**One source of truth per item**. No item should require checking two collections to determine status. If you find yourself writing `(a.complete || b.complete)`, the item's storage is wrong.

**Snapshotting is permanent**. When a JO's requirement package is snapshotted onto an assignment at creation time, that snapshot is what governs that assignment forever. Changing the JO's requirements only affects *future* assignments. Same principle as the AccountWorkforce hiring entity stamp.

**Waivers are first-class**. Every readiness item supports a `waived` status with a recorded actor, reason, and timestamp. Waivers are an audit trail, not a workaround — admins use them when something is met by alternative means (e.g. a worker has a fresh background check from another tenant they bring with them).

**Status enum** (locked — matches `EmployeeReadinessItemStatus` in `shared/employeeReadinessItemV1.ts`):
- `incomplete` — applies but not started
- `in_progress` — submitted / vendor order placed; waiting on result
- `complete_pass` — satisfied with a positive verdict (E-Verify authorized, handbook signed, bank attached)
- `complete_fail` — satisfied with a negative verdict (E-Verify FNC, background FAIL). **Blocks placement** unless waived.
- `needs_review` — vendor signal needs admin adjudication (AccuSource DISCREPANCY, E-Verify TNC)
- `expired` — previously `complete_pass` but `expiresAt` has passed
- `blocked` — upstream blocker (missing prereq, worker terminated)
- `not_applicable` — doesn't apply for this worker × entity (e.g. 1099 contractor skips W-4)
- `complete` — *deprecated*; legacy "done" state for items created before pass/fail split. Readers treat as `complete_pass`. New writes must use the explicit pass/fail values.

The five pass/fail/review/expired/blocked states distinguish what the same vendor verdict (e.g. AccuSource result) means for the recruiter's next action — the simpler `missing|complete|failed` triple loses that signal.

---

## 6. Codified follow-ups

- **Profile basics stay in Employee Readiness baselines.** The four items (`profile_photo`, `phone_verified`, `emergency_contact`, `address_confirmed`) appear in both buckets by design — they're high-impact for the worker side (Home snapshot) AND required by C1 as an employer to be able to contact and identify the employee. The bucket separation is about **owner and gating semantics**, not item set exclusivity. The Worker Profile Readiness bucket is a UX completion view of these items; Employee Readiness gates payable work on them.
- **Three baselines, picked by hiring entity.** Replaced the W2/1099 split with three explicit baselines (Select / Workforce / Events) keyed off the entity's `entityKey` (`'select'` / `'workforce'` / `'events'`). The `everifyRequired` trim is now an override on top of the chosen baseline (lets a tenant disable E-Verify on Select for testing, or enable it on Workforce in the rare cases that's needed) rather than the primary mechanism. Landed Apr 2026.
- **`ic_agreement` requirement type.** Added to `EmployeeReadinessRequirementType` so the Events baseline can require it explicitly. Worker actor, blocking. Landed Apr 2026.

## 6.1 Queued — not yet landed

- **`failed` status as a hard placement block** with a distinct visual signal. Today a `complete_fail` readiness item only blocks placement if some upstream process transitions the `entity_employments` status to `'blocked'` — the state deriver doesn't read readiness items directly. Plan: extend `deriveOverallWorkerState` to accept a `hasFailedReadinessItem` signal and force `'blocked'` when true; surface a more specific tooltip on `WorkforceReadinessChip` when the cause is a failed item; teach the Scheduler-facing surfaces (Calendar tooltips, ShiftSetup, Placements) to surface failed-readiness as a hard blocker with an explicit waiver path.
- **Drop deprecated `BASELINE_W2_REQUIREMENTS` / `BASELINE_1099_REQUIREMENTS` aliases** once all callers reference the new three-baseline names.

---

## 7. Change protocol

1. Edit this doc first. Run the change by Greg before any code lands.
2. Update the relevant TypeScript types in `shared/`.
3. Update the seed runners under `functions/src/readiness/`.
4. Update the UI consumers (Workforce tab readiness chip, Action Queue items, Worker Home checklist).
5. Run the appropriate `.scratch/` reconciliation script if existing data needs backfilling.

Items added without going through this protocol drift back into the "two-bucket confusion" we just got out of. Don't.

---

## 8. References

- [`CANONICAL_ONBOARDING_STEP_MATRIX.md`](./CANONICAL_ONBOARDING_STEP_MATRIX.md) — mini-step level detail per group per entity
- [`EVerify_IMPLEMENTATION_SUMMARY.md`](./EVerify_IMPLEMENTATION_SUMMARY.md) — why E-Verify is Select-only
- [`WORKER_READINESS_DATA_CONTRACT.md`](./WORKER_READINESS_DATA_CONTRACT.md) — Worker Profile Readiness data shape
- [`WORKFORCE_DOMAIN_MODEL.md`](./WORKFORCE_DOMAIN_MODEL.md) — engagementType + AccountWorkforce (the layer that consumes Employee Readiness)
- [`RECRUITING_ROLE_MODEL.md`](./RECRUITING_ROLE_MODEL.md) — CSA / Scheduler / HRX Operator / Payroll Coordinator definitions
