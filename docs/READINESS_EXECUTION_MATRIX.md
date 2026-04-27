# Readiness Execution Matrix

**Status: Canonical** — this is the single source of truth for how every readiness signal flows from data source to user-visible status. Every new readiness item, vendor integration, or requirement matcher updates this doc *first*.

**Supersedes / absorbs the relevant operational sections of**:
- `READINESS_MODEL.md` (kept — that's the high-level framing; this is the execution detail)
- `WORKER_READINESS_DATA_CONTRACT.md` (kept — Worker Profile readiness data shape)
- `WORKER_READINESS_TRIGGER_MATRIX.md` (folded into §3 here)
- `READINESS_PLACEMENT_CERTS_AND_REQUIRED_ROW_GAP.md` (folded into §4 here)

For the conceptual framing of the three buckets and their owners, see [`READINESS_MODEL.md`](./READINESS_MODEL.md). This doc starts where that one ends.

---

## 1. Why this doc exists

The architecture today has the right *intention* (one canonical readiness layer that drives the CSA Action Queue) but execution is fragmented. An audit of every readiness item revealed a consistent pattern: data flows update vendor-facing collections (`backgroundChecks`, `everify_cases`, `worker_onboarding`, `entity_employments`, `user_employments`) but **the canonical `employee_readiness_items` collection is auto-seeded once and never updated**. Same hole, four different vendors.

Job Readiness is worse: of seven requirement categories the JO type declares (certs, licenses, skills, education, languages, experience, screening package), only certifications have a real matcher. Skills, education, languages, and experience are declared on JOs and **never matched against worker records**.

This doc lays out, item by item, what *should* happen and what *currently* happens. The "Implementation status" line on each item is the bulletproof part: every gap is named, every fix is a row in the roadmap.

---

## 2. Status enum (canonical)

The single status enum every readiness item must use is `EmployeeReadinessItemStatus`, defined in `shared/employeeReadinessItemV1.ts`. Same values for `AssignmentReadinessItem`. **Vendor-specific status fields exist as raw signals; the canonical status is what the matrix reflects.**

| Status | Meaning | UI severity |
|--------|---------|-------------|
| `incomplete` | Applies but not started | gray |
| `in_progress` | Submitted / vendor order placed; awaiting result | warning |
| `complete_pass` | Resolved positively | success |
| `complete_fail` | Resolved negatively. **Blocks placement** unless waived. | error |
| `needs_review` | Vendor signal needs admin adjudication (DISCREPANCY, TNC) | warning |
| `expired` | Was `complete_pass`; underlying record aged out | warning |
| `blocked` | Upstream blocker (missing prereq, terminated worker) | error |
| `not_applicable` | Doesn't apply for this worker × entity (e.g. 1099 skips W-4) | hidden |
| `complete` | *Deprecated* — pre-pass/fail-split items. Read as `complete_pass`. | success |

---

## 3. Employee Readiness — item-by-item

One subsection per `EmployeeReadinessRequirementType`. Each block carries the same eight dimensions:

- **Applies to**: which entity types include this item
- **Source field**: where the underlying fact lives in Firestore
- **Status field**: where the canonical status lives (`employee_readiness_items` doc + the relevant subfield)
- **Trigger**: what causes a status change (today)
- **Auto-resolve rule**: pure logic that maps source → status (the spec)
- **Worker label / surface**: how it appears in the worker app
- **CSA label / surface**: how it appears in the admin app
- **Action Item link**: shared spine between worker + CSA views
- **Implementation status**: ✅ Done / ⚠️ Partial / ❌ Missing, with one-line note

### 3.1 `i9_section_1`

- **Applies to**: Select, Workforce
- **Source field**: `tenants/{tid}/worker_onboarding/{userId}__{entityKey}.steps[i9_section_1].status` + `tenants/{tid}/user_employments/{empId}.i9Status`
- **Status field**: `tenants/{tid}/employee_readiness_items/{workerUid}__{entityId}__i9_section_1.status`
- **Trigger** (spec): worker submits I-9 §1 in mobile app → onboarding pipeline writes `steps[i9_section_1].status='completed'`
- **Auto-resolve rule** (spec): `worker_onboarding.steps[i9_section_1].status === 'completed'` → readiness item `complete_pass`
- **Worker label / surface**: "Complete Form I-9, Section 1" — Home checklist + employment detail
- **CSA label / surface**: "I-9 Section 1 — Daniel Sanchez (CORT)" — Action Queue, Workforce tab readiness chip
- **Action Item link**: shared. One Action Item; routed to worker (actor='worker'); CSA sees as visibility item
- **Implementation status**: ❌ **Missing** — readiness item never updates; no trigger reads `worker_onboarding.steps[i9_section_1]` and writes the readiness item

### 3.2 `i9_section_2`

- **Applies to**: Select, Workforce
- **Source field**: `tenants/{tid}/worker_onboarding/{userId}__{entityKey}.steps[i9_section_2].status` + `tenants/{tid}/user_employments/{empId}.i9Status` (only flips to `'completed'` when both sections done)
- **Status field**: `tenants/{tid}/employee_readiness_items/{workerUid}__{entityId}__i9_section_2.status`
- **Trigger** (spec): CSA marks §2 complete in admin UI
- **Auto-resolve rule** (spec): `worker_onboarding.steps[i9_section_2].status === 'completed'` → readiness item `complete_pass`
- **Worker label / surface**: not shown (recruiter action)
- **CSA label / surface**: "Verify I-9 Section 2 — Daniel Sanchez" — Action Queue
- **Action Item link**: routed to CSA (actor='recruiter')
- **Implementation status**: ❌ **Missing AND no review surface**. Two parallel UIs exist:
  - `RecruiterOnboarding.tsx` (`/jobs/onboarding`) edits `worker_onboarding.steps[].status` directly
  - `updateExternalOnboardingStepVerification()` callable edits `worker_onboarding.externalOnboardingSteps[i9_employee_section]`

  Neither writes to the readiness item. There is **no surface** that lets a CSA mark §2 complete from the Action Queue.

### 3.3 `e_verify`

- **Applies to**: Select only
- **Source field**: `tenants/{tid}/everify_cases/{caseId}.hrxStatus` (mirrored to `entity_employments.everifyStatus`)
- **Status field**: `tenants/{tid}/employee_readiness_items/{workerUid}__{entityId}__e_verify.status`
- **Trigger** (today): `scheduledEverifyPoller` (`functions/src/integrations/everify/everifyPoller.ts`) runs hourly, calls USCIS `getCaseStatus` for open cases, updates case status. Then `syncEverifyStatusToPipelineAndEmployment` updates `worker_onboarding.steps[e_verify]` and `entity_employments.everifyStatus`. **Readiness item is NOT touched.**
- **Auto-resolve rule** (spec): map `everify_cases.hrxStatus` → readiness status per §5.2
- **Worker label / surface**: not shown to worker (employer-side compliance)
- **CSA label / surface**: "E-Verify case for Daniel Sanchez — TNC needs review" — Action Queue + Workforce tab readiness chip
- **Action Item link**: routed to CSA (actor='system' for monitoring; flips to actor='recruiter' on TNC)
- **Implementation status**: ❌ **Missing**. The TNC handler (`everifyTncHandler.ts`) creates a generic `tasks/{id}` doc but doesn't touch the readiness item. FNC closes the task but doesn't flip the readiness item to `complete_fail`.

### 3.4 `tax_w4`

- **Applies to**: Select, Workforce
- **Source field**: TempWorks integration (form upload) **or** signature envelope (`signature_envelopes`) **or** `worker_onboarding.externalOnboardingSteps[tax_withholding_forms]`
- **Status field**: `tenants/{tid}/employee_readiness_items/{workerUid}__{entityId}__tax_w4.status`
- **Trigger** (today): CSA marks complete via `updateExternalOnboardingStepVerification()` callable on `tax_withholding_forms` step. **Readiness item not touched.**
- **Auto-resolve rule** (spec): `externalOnboardingSteps.tax_withholding_forms.status === 'completed'` → readiness item `complete_pass`
- **Worker label / surface**: "Submit your W-4 tax forms" — Home checklist
- **CSA label / surface**: "Verify W-4 — Daniel Sanchez" — Action Queue (visibility tier)
- **Action Item link**: shared. Worker actor; CSA sees as visibility
- **Implementation status**: ❌ **Missing**. CSA verification path exists but doesn't propagate to readiness item.

### 3.5 `tax_w9`

- **Applies to**: Events (1099)
- **Source field**: signature envelope or external form upload, surfaced on `worker_onboarding.externalOnboardingSteps[contractor_tax_form_w9]`
- **Status field**: `tenants/{tid}/employee_readiness_items/{workerUid}__{entityId}__tax_w9.status`
- **Trigger / Auto-resolve / Surfaces**: same shape as `tax_w4` (3.4) but on the W-9 step
- **Implementation status**: ❌ **Missing** — same gap as 3.4

### 3.6 `tax_1099_consent`

- **Applies to**: Events
- **Source field**: signature envelope on consent form
- **Status field**: `employee_readiness_items.../tax_1099_consent.status`
- **Trigger** (today): worker signs envelope → envelope status updates. **Readiness item not touched.**
- **Auto-resolve rule** (spec): envelope status `'signed'` → readiness item `complete_pass`
- **Worker label / surface**: "Consent to electronic 1099 delivery" — Home checklist
- **CSA label / surface**: "1099 consent — Daniel Sanchez" — Action Queue
- **Implementation status**: ❌ **Missing**

### 3.7 `handbook_acknowledgement`

- **Applies to**: Select, Workforce, Events
- **Source field**: signature envelope **or** `worker_onboarding.externalOnboardingSteps[handbook_acknowledgment].status`
- **Status field**: `employee_readiness_items.../handbook_acknowledgement.status`
- **Trigger** (today): CSA verifies via `updateExternalOnboardingStepVerification()`. **Readiness item not touched.**
- **Auto-resolve rule** (spec): `externalOnboardingSteps.handbook_acknowledgment.status === 'completed'` → readiness item `complete_pass`
- **Implementation status**: ❌ **Missing**

### 3.8 `ic_agreement`

- **Applies to**: Events only
- **Source field**: signature envelope (`signature_envelopes/{envelopeId}`) for IC agreement template
- **Status field**: `employee_readiness_items.../ic_agreement.status`
- **Trigger** (today): worker signs → envelope status updates. **Readiness item not touched.**
- **Auto-resolve rule** (spec): envelope status `'signed'` → readiness item `complete_pass`
- **Worker label / surface**: "Sign your Independent Contractor Agreement" — Home checklist
- **CSA label / surface**: "IC Agreement — Daniel Sanchez (Events)" — Action Queue
- **Implementation status**: ❌ **Missing**. Item type was just added to the seed runner; the auto-resolve is unwired.

### 3.9 `direct_deposit`

- **Applies to**: Select, Workforce, Events
- **Source field**: Everee (`tenants/{tid}/everee_workers/{entityId}__{userId}.bankAccount.verified`) **or** equivalent for non-Everee tenants
- **Status field**: `employee_readiness_items.../direct_deposit.status`
- **Trigger** (today): Everee webhook → `onEvereeWebhookEventCreated` → updates `everee_workers/{x}` and `user_employments.payrollOnboardingCompletedAt`. **Readiness item not touched.**
- **Auto-resolve rule** (spec): `everee_workers.bankAccount.verified === true` → readiness item `complete_pass`
- **Implementation status**: ❌ **Missing**

### 3.10 `everee_profile`

- **Applies to**: Select, Workforce (and Events when payroll provider is Everee)
- **Source field**: `tenants/{tid}/everee_workers/{entityId}__{userId}.status` + `tenants/{tid}/user_employments/{empId}.evereeOnboardingStatus`
- **Status field**: `employee_readiness_items.../everee_profile.status`
- **Trigger** (today): Everee webhook `worker.onboarding-completed` → sets `everee_workers.status='onboarding_complete'` and `user_employments.evereeOnboardingStatus='complete'`. **Readiness item not touched.**
- **Auto-resolve rule** (spec): `user_employments.evereeOnboardingStatus === 'complete'` → readiness item `complete_pass`
- **Implementation status**: ❌ **Missing**

### 3.11 `policy_acknowledgement`

- **Applies to**: All entities
- **Source field**: signature envelope or `worker_onboarding.externalOnboardingSteps[policy_acknowledgments].status`
- **Trigger / Auto-resolve / Surfaces**: same shape as 3.7
- **Implementation status**: ❌ **Missing**

### 3.12 `profile_photo`, `phone_verified`, `emergency_contact`, `address_confirmed`

These four are dual-bucketed (Worker Profile Readiness for the worker-app meter; Employee Readiness for entity-level gating). Same source field for both lenses; same status; different presentation.

- **Source fields**:
  - `profile_photo` → `users/{uid}.profilePhotoUrl !== null`
  - `phone_verified` → `users/{uid}.phoneVerifiedAt !== null`
  - `emergency_contact` → `users/{uid}.emergencyContact?.name && .phone`
  - `address_confirmed` → `users/{uid}.address.coordinates !== null` (geocoded)
- **Status field** (Employee lens): `employee_readiness_items.../{type}.status`
- **Status field** (Worker lens): computed in `users/{uid}.workerProfile.readiness.homeSnapshot`
- **Trigger** (today): worker app writes the source field directly. **Employee Readiness item not touched.**
- **Auto-resolve rule** (spec): source field `truthy` → readiness item `complete_pass`
- **Implementation status**: ⚠️ **Partial** — Worker Profile lens computed correctly via `homeSnapshot`; Employee lens (`employee_readiness_items.{type}`) never updates.

### 3.13 `background_check` (Employee tier — entity-level)

- **Applies to**: All entities (per tenant config)
- **Source field**: `tenants/{tid}/backgroundChecks/{checkId}.hrxStatus` + `providerServiceOrderStatus.{serviceId}.adjudication.autoVerdict`
- **Status field**: `employee_readiness_items.../background_check.status`
- **Trigger** (today): AccuSource webhook → `apiIntegrationsAccusourceWebhooks` → updates `backgroundChecks` doc + per-service adjudication. AssignmentReadiness picks up changes via `assignmentReadinessOnBackgroundCheckWrite` trigger. **Employee Readiness item not touched.**
- **Auto-resolve rule** (spec): see §5.1 for the AccuSource verdict mapping
- **Implementation status**: ❌ **Missing** for Employee Readiness; ✅ Done for AssignmentReadiness path (different trigger updates a different readiness collection)

### 3.14 `drug_screen`

- **Applies to**: All entities (per tenant config)
- **Source field**: same `backgroundChecks` collection (no separate doc; per-service line on the same order)
- **Implementation status**: ❌ **Missing** — same gap as 3.13

---

## 4. Job Readiness — requirement-by-requirement

One row per JO requirement category. Each entry shows the JO field, the User field, the matching strategy, and the implementation gap.

### 4.1 Certifications

- **JO field**: `tenants/{tid}/job_orders/{joId}.requiredCertifications: string[]` (+ optional `requiredCertificationComplianceIds[]`)
- **User field**: `users/{uid}.certifications[]` (typed via `CertificationRecordV1` with `expirationDate`, `review.status`, `recordStatus`)
- **Match strategy**: `evaluateCertificationRequirement()` in `src/utils/certifications/evaluateCertificationRequirement.ts` — checks expiration (30-day "expiring soon" window), review status (approved/pending/rejected), evidence requirements
- **Auto-resolve rule**: cert exists with `review.status==='approved'`, `expirationDate > now`, matches required type → pass; expired or pending review → fail/needs_review
- **AssignmentReadinessItem seeded**: ✅ `required_certification` (one per required cert), per `onAssignmentCreatedAutoSeed.ts:149`
- **Implementation status**: ⚠️ **Partial**. The matcher is well-built and integrated into AssignmentReadiness seeding. Gap: legacy `checkMissingCertifications()` is still called by some surfaces and does fuzzy string match WITHOUT expiration check. Two matchers, drifting.

### 4.2 Licenses

- **JO field**: `requiredLicenses: string[]`
- **User field**: undefined as a typed shape — folded into `certifications[]` array as a string
- **Match strategy**: piggybacked on `checkMissingCertifications()` — string match against the combined cert+license array
- **AssignmentReadinessItem seeded**: ❌ no separate `license_match` item type
- **Implementation status**: ❌ **Missing**. No separate License interface, no expiration tracking, no class/endorsement model. CDL Class A and a Forklift cert are matched the same way (string).

### 4.3 Skills

- **JO field**: `skillsRequired?: string[]`
- **User field**: `users/{uid}.skills?: any[]` (untyped)
- **Match strategy**: **none exists**
- **AssignmentReadinessItem seeded**: ❌ no `skill_match` item type
- **Implementation status**: ❌ **Missing**. The field exists on JOs and is never read. A worker without a required skill can be placed silently.

### 4.4 Education

- **JO field**: `educationRequired?: string` (freeform)
- **User field**: `users/{uid}.educationLevel?: string` (freeform)
- **Match strategy**: **none exists**. Both fields are unstructured freeform — no ordinal hierarchy ("HS or higher", "Bachelor or higher").
- **AssignmentReadinessItem seeded**: ❌ no `education_match`
- **Implementation status**: ❌ **Missing**. Schema work needed first (structured education-level enum) before a matcher is even possible.

### 4.5 Languages

- **JO field**: `languagesRequired?: string[]`
- **User field**: `users/{uid}.languages?: string[]`
- **Match strategy**: **none exists**. No proficiency level (basic / fluent / native) on either side.
- **AssignmentReadinessItem seeded**: ❌ no `language_match`
- **Implementation status**: ❌ **Missing**

### 4.6 Experience

- **JO field**: `experienceRequired?: string` (freeform, e.g. "5 years warehouse")
- **User field**: `users/{uid}.workerProfile.experience.workHistory[]` + `previousRoles[]`
- **Match strategy**: **none exists**. No years-of-experience extraction or role-keyword matching.
- **AssignmentReadinessItem seeded**: ❌ no `experience_match`
- **Implementation status**: ❌ **Missing**. Schema work needed (parsed years + role taxonomy) before matching.

### 4.7 Screening package (background / drug)

- **JO field**: `screeningPackageId?: string` (e.g. "CORT_PLUS"), `screeningPackageName?: string`
- **User field**: existing `backgroundChecks/*` records, with `requestedPackageId`
- **Match strategy**: `evaluateScreeningSatisfiedServer()` in `functions/src/compliance/screeningAutomationShared.ts` — checks completion + package equivalency + expiration validity
- **Auto-resolve rule**: worker has a `complete_pass` background record where `requestedPackageId` matches (or is equivalent to) JO's `screeningPackageId`, and the record's expiration window is current
- **AssignmentReadinessItem seeded**: ⚠️ generic `background_check` item with no package ID stamped on it
- **Implementation status**: ⚠️ **Partial**. Server-side matcher exists but isn't wired into AssignmentReadiness seeding. The `background_check` item just asks "does any check exist?" — a worker with a CORT_BASIC check can match a JO requiring CORT_PLUS without warning.

### 4.8 PPE acknowledgement, safety briefing, orientation, shift confirmation

- **JO fields**: `requiredPpe[]`, `safetyBriefingRequired`, `orientationRequired`, plus implicit shift confirmation
- **AssignmentReadinessItem seeded**: ✅ `ppe_acknowledgement`, `safety_briefing`, `orientation`, `shift_confirmation`
- **Match strategy**: signature envelope (PPE), worker confirmation (shift), CSA verification (briefing/orientation)
- **Implementation status**: ⚠️ **Partial**. Items get seeded but the auto-resolve from envelope completion → readiness item status isn't wired (same root cause as Employee Readiness items).

---

## 5. Vendor status translation tables

Each vendor's raw status enum mapped to the canonical `EmployeeReadinessItemStatus`. **These mappings are the spec for Phase A reconciliation triggers.**

### 5.1 AccuSource → readiness status

AccuSource provides two signals: a doc-level `hrxStatus` (vendor flow state) and per-service-line `adjudication.autoVerdict` (the actual verdict from `classifyAutoVerdict()` in `accusourceAdjudication.ts`).

The verdict is the authoritative signal for readiness; `hrxStatus` is informational.

| AccuSource signal | Readiness status |
|-------------------|------------------|
| `hrxStatus = 'draft' / 'submitted' / 'awaiting_applicant'` | `in_progress` |
| `hrxStatus = 'in_progress' / 'report_ready' / 'drug_report_ready'` | `in_progress` |
| `hrxStatus = 'completed'` AND **all** services `autoVerdict='PASSED'` | `complete_pass` |
| `hrxStatus = 'completed'` AND **any** service `autoVerdict='FAILED'` | `complete_fail` |
| `hrxStatus = 'completed'` AND **any** service `autoVerdict='NEEDS_REVIEW'` | `needs_review` |
| `hrxStatus = 'canceled'` | `not_applicable` |
| `hrxStatus = 'error'` | `needs_review` (admin investigates) |
| `markedCompleteOutsideHrx === true` | `complete_pass` (pre-adjudicated as PASSED in the marker callable) |

**Drug screens are the same** — they share the `backgroundChecks` collection and per-service-line adjudication.

### 5.2 E-Verify → readiness status

USCIS case state is mapped to `everify_cases.hrxStatus` by `mapProviderStatusToHrx()` in `everifyAdapter.ts`. Then we map that to readiness status:

| `everify_cases.hrxStatus` | Readiness status |
|----------------------------|-------------------|
| `draft` / `ready` | `incomplete` |
| `submitted` / `pending` / `dhs_verification_in_process` | `in_progress` |
| `tnc` / `further_action_required` | `needs_review` |
| `employment_authorized` | `complete_pass` |
| `final_nonconfirmation` | `complete_fail` |
| `closed` (without authorization) | `complete_fail` |
| `closure_duplicate` | `not_applicable` (case dedup'd into another) |
| `error` | `needs_review` |

### 5.3 Everee → readiness status

Two readiness items consume Everee signals: `everee_profile` (overall onboarding state) and `direct_deposit` (bank verification specifically).

| Everee signal | `everee_profile` | `direct_deposit` |
|---------------|-------------------|--------------------|
| `everee_workers.status` not yet set | `incomplete` | `incomplete` |
| `everee_workers.status === 'invited'` | `in_progress` | `in_progress` |
| `everee_workers.status === 'in_progress'` | `in_progress` | `in_progress` |
| `everee_workers.status === 'onboarding_complete'` AND `bankAccount.verified === true` | `complete_pass` | `complete_pass` |
| `everee_workers.status === 'onboarding_complete'` AND `bankAccount.verified !== true` | `complete_pass` | `in_progress` |
| `everee_workers.status === 'failed' / 'rejected'` | `needs_review` | `needs_review` |

### 5.4 `worker_onboarding` step status → readiness status

Several readiness items derive from CSA-verified `worker_onboarding.externalOnboardingSteps[stepKey]` writes (via the `updateExternalOnboardingStepVerification` callable):

| `externalOnboardingSteps.{stepKey}.status` | Readiness status |
|--------------------------------------------|-------------------|
| not set / `'pending'` | `incomplete` |
| `'in_progress'` | `in_progress` |
| `'completed'` | `complete_pass` |
| `'failed'` / `'rejected'` | `complete_fail` |
| `'needs_review'` | `needs_review` |

Step keys mapped to readiness item types:
- `tax_withholding_forms` → `tax_w4`
- `contractor_tax_form_w9` → `tax_w9`
- `tax_1099_consent_form` → `tax_1099_consent`
- `handbook_acknowledgment` → `handbook_acknowledgement`
- `ic_agreement_form` → `ic_agreement`
- `policy_acknowledgments` → `policy_acknowledgement`
- `payroll_onboarding` → `everee_profile`
- `direct_deposit_setup` → `direct_deposit`

---

## 6. The holes (severity ranked)

### 🔴 Critical — system claims to do this but doesn't

1. **EmployeeReadinessItem is orphaned across all four vendor / source flows.** AccuSource webhook, E-Verify poller, Everee webhook, `worker_onboarding` step writes — none of them update `employee_readiness_items`. The CSA Action Queue based on these items is permanently stale.
2. **JO requirement matching missing for skills, education, languages, experience.** Fields declared on the JO; zero matchers; zero AssignmentReadinessItem types created. A worker missing any of these can be placed silently.
3. **Two parallel onboarding systems with no sync.** `worker_onboarding` (pipeline view at `/jobs/onboarding`) and `employee_readiness_items` (Action Queue) operate independently. Edits in one are invisible in the other.
4. **No CSA review surface for I-9 §2.** The readiness item exists with `actor='recruiter'` but no UI lets a CSA mark §2 complete *from the readiness item*. They have to go to the legacy onboarding pipeline page, which doesn't update the readiness item.

### 🟠 High — materially affects CSA / Scheduler work

5. **No expiration check on certs (legacy matcher) or licenses.** `checkMissingCertifications()` does fuzzy string match without expiration. The newer `evaluateCertificationRequirement()` does check, but both matchers are still in use.
6. **Background package matching is "any check exists"**, not "the right package exists". JO declares `screeningPackageId='CORT_PLUS'`, worker has a CORT_BASIC check, system says ✅.
7. **AssignmentReadiness snapshot is built once and never refreshed.** If a cert expires after placement, snapshot still shows cleared.
8. **Licenses don't have a typed shape.** Stored as strings. No class/endorsement, no expiration, no separate matcher.
9. **TNC creates a generic Task but doesn't flip the readiness item to `needs_review`.** CSA sees the item as "incomplete" in the queue while a separate task sits in a different list.

### 🟡 Medium — visible inconsistencies

10. **AccuSource verdicts exist per-service-line and never aggregate.** `providerServiceOrderStatus.{x}.adjudication.autoVerdict` carries the real signal but no top-level `backgroundChecks.overallVerdict` exists.
11. **Status enum mismatches.** `HrxBackgroundCheckStatus` (9 values), `EverifyHrxStatus` (12 values), `worker_onboarding.steps.status` (different again), `EmployeeReadinessItemStatus` (10 values, the canonical). No translation layer.
12. **Drug screens collapse into background check docs.** Same `backgroundChecks` doc; hard to track per-service readiness independently.
13. **Worker Profile readiness items duplicate Employee Readiness items** for `profile_photo`, `phone_verified`, `emergency_contact`, `address_confirmed`. Worker lens computed correctly via `homeSnapshot`; Employee lens never updates. Worker thinks it's done; CSA's queue says it isn't.

### 🟢 Low — code quality drift

14. **`checkMissingCertifications` (legacy) and `evaluateCertificationRequirement` (canonical) coexist.** Audit calls and migrate.
15. **`worker_onboarding.steps[]` and `worker_onboarding.externalOnboardingSteps[]` are two parallel state holders** within the same doc.

---

## 7. Roadmap

Build order: **E → A → B → C → D**.

### Phase E — Status enum normalization (foundation)

**Goal**: One translation layer. Every vendor / source enum maps to `EmployeeReadinessItemStatus` via a single pure function per source, located in `shared/`.

**Deliverables**:
- `shared/readinessStatusFromAccuSource.ts` — pure function `accuSourceToReadinessStatus(record): EmployeeReadinessItemStatus` per §5.1
- `shared/readinessStatusFromEverify.ts` — per §5.2
- `shared/readinessStatusFromEveree.ts` — per §5.3
- `shared/readinessStatusFromOnboardingStep.ts` — per §5.4

Unit tests for each (these are pure; coverage should be 100%). No Firestore writes in Phase E — just the spec made executable. Phases A/C/D will import these.

**Closes**: hole #11 (status enum mismatches).

### Phase A — Reconciliation triggers (one per source)

**Goal**: Bridge the four orphaned data flows back into `employee_readiness_items`. Each trigger reads its source collection on write, looks up the matching readiness item by `(workerUid, entityId, requirementType)`, and updates `.status` using the Phase E translator. Atomic, idempotent.

**Deliverables**:
- `functions/src/readiness/onBackgroundCheckWriteUpdateReadiness.ts` — fires on `backgroundChecks/{x}` write; updates the matching `background_check` and `drug_screen` items per entity employment
- `functions/src/readiness/onEverifyCaseWriteUpdateReadiness.ts` — fires on `everify_cases/{x}` write; updates the `e_verify` item
- `functions/src/readiness/onEvereeWorkerWriteUpdateReadiness.ts` — fires on `everee_workers/{x}` write; updates `everee_profile` and `direct_deposit`
- `functions/src/readiness/onOnboardingStepVerifiedUpdateReadiness.ts` — fires on `worker_onboarding/{x}` write; updates the readiness item for whatever step changed
- `functions/src/readiness/onUserFieldChangeUpdateReadiness.ts` — fires on `users/{uid}` write; updates `profile_photo`, `phone_verified`, `emergency_contact`, `address_confirmed` Employee tier items

Each trigger is small (~80 lines): listener → resolve worker × entity → look up readiness item → run translator → write status if changed. Audit-log every status transition.

**Closes**: holes #1, #4 (partially), #9, #13.

### Phase B — Job requirement matchers

**Goal**: Central pure functions for every JO requirement type. One location, one matcher per category, fully tested.

**Deliverables**:
- Schema work first:
  - Structured education-level enum (`'high_school' | 'associate' | 'bachelor' | 'master' | 'doctorate'` + `'none'`) on User and JO
  - Structured language proficiency (`{ language: string, level: 'basic' | 'conversational' | 'fluent' | 'native' }`)
  - License interface separate from certifications, with class/endorsement/expiration
- `shared/jobRequirementMatchers/matchCertifications.ts` — consolidates `evaluateCertificationRequirement()` with expiration; deprecates `checkMissingCertifications()`
- `shared/jobRequirementMatchers/matchLicenses.ts` — uses new License type
- `shared/jobRequirementMatchers/matchSkills.ts` — exact + tokenized substring; configurable strictness on JO
- `shared/jobRequirementMatchers/matchEducation.ts` — ordinal threshold against the new level enum
- `shared/jobRequirementMatchers/matchLanguages.ts` — required level per language
- `shared/jobRequirementMatchers/matchScreeningPackage.ts` — wraps `evaluateScreeningSatisfiedServer` with the readiness item shape
- `shared/jobRequirementMatchers/matchExperience.ts` — needs years-of-experience extraction; deferred to Phase B.2 if scope creeps

Then update `onAssignmentCreatedAutoSeed.ts` to seed the corresponding `*_match` item types: `cert_match`, `license_match`, `skill_match`, `education_match`, `language_match`, `experience_match`. Each uses the matcher above; status is computed at seed time using the worker's current record.

**Closes**: holes #2, #5, #6, #8, #14.

### Phase C — AssignmentReadiness snapshot refresh

**Goal**: When a worker's underlying record changes (cert expires, background check goes stale), the placement snapshot recomputes. Today the snapshot is frozen at assignment creation.

**Deliverables**:
- `functions/src/readiness/onUserCertificationChangeRefreshAssignments.ts` — fires on `users/{uid}.certifications` change; finds active assignments; recomputes affected readiness items
- Scheduled `dailyReconcileExpiredCerts` — sweeps daily for certs that crossed `expirationDate`; flips affected items to `expired`
- Same pattern for license expiration, background check expiration

**Closes**: hole #7.

### Phase D — Surfaces + parallel-system reconciliation

**Goal**: CSA single-pane-of-glass view. The two parallel systems (`worker_onboarding` and `employee_readiness_items`) reconciled. I-9 §2 review surface inside the Action Queue.

**Deliverables**:
- `RecruiterOnboarding.tsx` deprecated or migrated to a read-only pipeline visualization; CSA edits happen via Action Queue items
- New Action Queue surface for I-9 §2 specifically: list, detail drawer, "Mark §2 complete" callable that writes to BOTH `worker_onboarding.steps` AND `employee_readiness_items` (single transaction)
- `WorkerReadinessSummary.tsx` — single-screen view: worker × entity matrix showing every Employee Readiness item across every entity, grouped by status; replaces "look at five tabs to know if Daniel is ready"
- `JobQualificationCheck.tsx` — single-screen view per JO: "who in the labor pool is qualified?" using Phase B matchers; replaces visual inspection

**Closes**: holes #3, #4 (fully), #10, #15.

---

## 8. Change protocol

When you add a readiness item, vendor integration, or requirement matcher:

1. **Update this matrix first.** Add the row in §3 or §4. Map the vendor enum in §5.
2. **Write the Phase E translator** (pure, tested) before any Firestore code.
3. **Land the Phase A trigger** that bridges the source to the readiness item.
4. **Surface the item** in the CSA Action Queue and, if applicable, the worker app's Home checklist.

Skipping any of these steps recreates the orphan-item problem this doc exists to fix. Don't.

### Firestore write-pattern guardrails (post Apr 2026 R.0b/R.0c incident)

Server-side Cloud Functions and CLI scripts that write partial patches to user/profile docs:

- **Default to `userRef.update(patch)`** when `patch` keys are dotted-string field paths (e.g. `'workerAttestations.eVerifyWillingness'`). The Admin SDK interprets dotted strings under `update()` as nested field paths.
- **Do NOT use `userRef.set(patch, { merge: true })` with dotted-string keys.** The Admin SDK writes those as LITERAL top-level fields with embedded dots — the Web Client SDK's opposite-semantics for the same syntax was the root cause of the R.0b/R.0c data corruption (~10,700 garbage fields across 1,175 users, since cleaned).
- If you specifically need create-or-merge semantics, use `set(data, { merge: true })` with **fully nested patch objects** (no dotted-string keys at any level).
- The integration test at `functions/src/__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts` pins this semantic in CI; do not weaken it.

See the **Apr 26 2026 post-mortem** in [`READINESS_R0_HANDOFF.md`](./READINESS_R0_HANDOFF.md) for the full incident write-up.

---

## 9. References

- [`READINESS_MODEL.md`](./READINESS_MODEL.md) — three-bucket conceptual framing
- [`CANONICAL_ONBOARDING_STEP_MATRIX.md`](./CANONICAL_ONBOARDING_STEP_MATRIX.md) — mini-step level detail per group per entity
- [`EVerify_IMPLEMENTATION_SUMMARY.md`](./EVerify_IMPLEMENTATION_SUMMARY.md) — why E-Verify is Select-only
- [`WORKER_READINESS_DATA_CONTRACT.md`](./WORKER_READINESS_DATA_CONTRACT.md) — Worker Profile Readiness data shape
- [`WORKFORCE_DOMAIN_MODEL.md`](./WORKFORCE_DOMAIN_MODEL.md) — engagementType + AccountWorkforce
- [`RECRUITING_ROLE_MODEL.md`](./RECRUITING_ROLE_MODEL.md) — CSA / Scheduler / HRX Operator definitions
- [`READINESS_R0_HANDOFF.md`](./READINESS_R0_HANDOFF.md) — R.0 foundation handoff + Apr 26 2026 SDK-semantic post-mortem (R.0b/R.0c incident)
- [`READINESS_R5_HANDOFF.md`](./READINESS_R5_HANDOFF.md) — E-Verify TNC contestation flow + drawer pattern + chip `caseId` propagation
- [`READINESS_R6_HANDOFF.md`](./READINESS_R6_HANDOFF.md) — AccuSource adjudication drawer reusing the R.5 drawer pattern + chip `caseId` propagation extended to `background_check` / `drug_screen`
- [`READINESS_R3_HANDOFF.md`](./READINESS_R3_HANDOFF.md) — generalized CSA action callables (`confirmReadinessItem` / `waiveReadinessItem` / `markReadinessItemFailed`) for non-vendor readiness items, `csaActions.history[]` audit trail parallel to AccuSource's, `resolutionMethod` writer for `csa_confirmed` / `csa_waived`
