# Canonical onboarding step matrix (three hiring entities)

This document defines a **canonical onboarding information architecture** for **C1 Select LLC**, **C1 Workforce LLC**, and **C1 Events LLC**, aligned with the **current-state** backend (`entity_employments` + `worker_onboarding` per `entityKey`, assignment snapshots in `onboarding_instances`, E-Verify storage in `user_employments` + `everify_cases`).

It is **not a visual design**; it fixes **step groups, mini-steps, audiences, blocking intent, and status ownership** for UI and future consolidation.

---

## 0. C1 product rule: E-Verify is **Select-only** onboarding (not a global subsystem)

**Architecture correction (canonical):**

- **C1 Select LLC** — **100%** of Select workers go through **Work authorization** onboarding: **I-9 + E-Verify** as one **native, blocking** track inside Select employment. E-Verify is **not** a separate “compliance product” in the worker or admin mind model for Select; it is **part of Select onboarding**.
- **C1 Workforce LLC** — **No E-Verify** in the employment/onboarding UX. Work authorization for W-2 Workforce is **I-9 only** (and related W-2 legal steps). Do **not** show E-Verify rows, tabs, or peer panels on Workforce employment surfaces.
- **C1 Events LLC** — **No E-Verify** (1099 / contractor model). No Work authorization block that implies USCIS E-Verify; contractor tax and IC agreement live under **forms & policies**.

**Backend (unchanged for now):** Case creation, triggers, and eligibility still use **`user_employments`** and **`everify_cases`**. Those collections remain the **storage and detail / ops** layer. **UX and readiness** treat E-Verify as **embedded in Select onboarding** only; admins manage case detail through the same data but **in context of Select employment**, not as a third parallel “E-Verify app” for every entity.

**Data hygiene:** Configure **`entities.everifyRequired: true`** only on **Select** entity documents (and keep **false** on Workforce and Events). The eligibility layer already gates on `everifyRequired`; aligning config avoids accidental case creation for non-Select entities.

**Code / UI alignment:** Worker progress and readiness counts **exclude** the `e_verify` pipeline step for **`entityKey` `workforce` and `events`** (see [`src/utils/onboardingPipelineProgress.ts`](../src/utils/onboardingPipelineProgress.ts) and worker employment detail).

---

## 0.1 How the three entities map in code today

| Hiring entity (product) | `entityKey` (pipeline / employment doc id suffix) | Resolved from |
|-------------------------|---------------------------------------------------|---------------|
| C1 Select LLC | `select` | Substring `"select"` in `entities.{id}.name` / `legalName` / `title` ([`deriveEntityKeyFromName`](../functions/src/onboarding/workerOnboardingPipeline.ts)) |
| C1 Events LLC | `events` | Substring `"event"` in entity name |
| C1 Workforce LLC | `workforce` | **Default** when name does not match select/events |

**W2 vs 1099** and **which workflow checkboxes apply** still come from the Firestore **entity** document (`workerType`, `onboardingWorkflowSteps`). **E-Verify applicability in the product** is **not** “any entity with a flag” — it is **Select-only** in UX; **`everifyRequired`** should match that rule.

**Canonical employment + pipeline documents (one row per worker per `entityKey`):**

- `tenants/{tenantId}/entity_employments/{userId}__{entityKey}`
- `tenants/{tenantId}/worker_onboarding/{userId}__{entityKey}`

**Assignment-scoped requirement snapshot (per placement):**

- `tenants/{tenantId}/onboarding_instances/{assignmentId}` (id = assignment id)
- `tenants/{tenantId}/assignments/{assignmentId}` (denormalized `onboardingStatus`, `onboardingPercent`, `onboardingInstanceId`, etc.)

---

## 1. Major step groups (taxonomy)

These **groups** are the stable buckets for UI navigation. Entity sections below state which apply.

| Group ID | Label | Purpose |
|----------|--------|---------|
| `work_authorization` | Work authorization | **Select:** I-9 + E-Verify (blocking Select track). **Workforce (W-2):** I-9 only. **Events:** not shown as USCIS work auth (use contractor/forms groups). |
| `forms_and_policies` | Forms, handbook & policies | TempWorks / tax / handbook / PTO-benefits acknowledgements (as configured); IC agreement + W-9 for Events |
| `payroll` | Payroll setup | Everee invite, account, completion (when entity uses Everee for that worker) |
| `screenings` | Screenings | Background, drug (and other checks as ordered) |
| `assignment_requirements` | Job / assignment requirements | Snapshot from requirement package + signatures for **this** assignment |
| `internal_readiness` | Internal / admin readiness | Recruiter verification, packet review, manual gates not stored elsewhere |

---

## 2. Mini-step catalog (canonical definitions)

Each row is a **mini-step** you can show in UI. **Blocking** = recommended gating for “cleared to start / in good standing” unless product explicitly relaxes it.

**Legend — owner (status source of truth):**

- **WO** = `worker_onboarding` (`steps[].milestones[]`, `steps[].status`, `tasks[]`)
- **EE** = `entity_employments` (summary fields: `status`, `everifyStatus` on **Select only** in UX, flags)
- **OI** = `onboarding_instances` (`resolvedSteps` / `resolvedDocuments` / `resolvedChecks`, `status`, `percentComplete`)
- **UE** = `user_employments` (especially `i9Status`, employment dates — **detail spine** for E-Verify automation)
- **EV** = `everify_cases` (+ optional `everify_cases_public`) — **Select onboarding detail**, not a peer surface for Workforce/Events
- **BG** = `backgroundChecks` (AccuSource integration; top-level collection in current implementation)
- **PR** = payroll: `worker_payroll_accounts` (+ Everee linkage docs under `everee_*` per [`firestorePaths.ts`](../src/data/firestorePaths.ts))
- **SIG** = `signature_envelopes` (tenant-scoped)

### 2.1 Group: `work_authorization`

| Mini-step ID | Label | Worker | Admin | Auto/provider | Blocking (typical) | Owner(s) | **Select** | **Workforce** | **Events** |
|--------------|-------|--------|-------|---------------|-------------------|----------|------------|---------------|------------|
| `i9_worker_complete` | Worker completes I-9 Section 1 (or equivalent flow) | ✓ | | | Yes (W-2) | WO + UE | ✓ | ✓ | N/A (1099 default) |
| `i9_employer_verify` | Employer completes / verifies I-9 | | ✓ | | Yes (W-2) | WO | ✓ | ✓ | N/A |
| `i9_completed_flag` | I-9 marked complete for compliance / E-Verify gate | | ✓ | | Yes (Select + Workforce W-2) | **UE** | ✓ | ✓ | N/A |
| `everify_case_opened` | E-Verify case created | | ✓ | ✓ (enqueue + USCIS) | **Yes (Select only)** | **EV**, WO `e_verify`, **EE** mirror | ✓ | **Hidden / N/A** | **Hidden / N/A** |
| `everify_resolved` | E-Verify closed / employment authorized (or terminal state) | ✓ (summary, **Select only**) | ✓ | ✓ poller | **Yes (Select only)** | **EV**, WO, EE | ✓ | **Hidden / N/A** | **Hidden / N/A** |

### 2.2 Group: `forms_and_policies`

| Mini-step ID | Label | Worker | Admin | Auto/provider | Blocking (typical) | Owner(s) | Implementation |
|--------------|-------|--------|-------|---------------|-------------------|----------|----------------|
| `tempworks_forms` | TempWorks / HRIS onboarding forms | ✓ | | | Often yes | WO task `worker_forms`; step `onboarding_forms` | **Partial** |
| `handbook_sent` / `handbook_signed` | Handbook send / acknowledge or sign | ✓ | ✓ | ✓ if e-sign | Often yes | WO milestones; **SIG** if e-sign | **Partial** |
| `tax_w4_w9` | W-4 / state tax / W-9 as applicable | ✓ | ✓ | | Yes for paid work | WO milestones; entity keys | **Partial** |
| `policy_acknowledgments` | PTO / benefits / policy acks (non-benefits enrollment) | ✓ | | | Varies | Entity `onboardingWorkflowSteps`; **OI** | **Partial** |
| `ic_agreement_sent` / `ic_agreement_signed` | Independent contractor agreement (Events) | ✓ | ✓ | ✓ e-sign | Yes (1099 Events) | WO milestones; **SIG**; **OI** | **Partial** |
| `packet_recruiter_review` | Recruiter completes onboarding packet review | | ✓ | | Often yes | WO task `recruiter_finalize` | **Partial** |

### 2.3 Group: `payroll`

| Mini-step ID | Label | Worker | Admin | Auto/provider | Blocking (typical) | Owner(s) | Implementation |
|--------------|-------|--------|-------|---------------|-------------------|----------|----------------|
| `payroll_invite` | Payroll provider invite sent | | ✓ | ✓ Everee | Often yes | WO step `everee` + milestones; **PR** | **Partial** |
| `payroll_account_created` | Worker creates payroll account | ✓ | | | Often yes | WO milestones; **PR** | **Partial** |
| `payroll_setup_complete` | Payroll onboarding complete / DD effective | ✓ | | ✓ webhook | Often yes | WO `everee` step; **PR** | **Partial** |
| `direct_deposit` | Direct deposit captured (if not only via Everee) | ✓ | | | Varies | WO milestone under `onboarding_forms` | **Partial** |

### 2.4 Group: `screenings`

| Mini-step ID | Label | Worker | Admin | Auto/provider | Blocking (typical) | Owner(s) | Implementation |
|--------------|-------|--------|-------|---------------|-------------------|----------|----------------|
| `bg_package_selected` | Background package chosen | | ✓ | | If required | WO `background_check` | **Partial** |
| `bg_ordered` | Background order placed | | ✓ | ✓ AccuSource | If required | **BG**; **OI** | **Implemented** path |
| `bg_worker_action` | Worker completes portal / site visit | ✓ | | ✓ vendor | If required | **BG** | **Partial** |
| `bg_result` | Result / adjudication recorded | | ✓ | ✓ webhooks | If required | **BG** | **Implemented** |
| `drug_package_selected` | Drug screen package chosen | | ✓ | | If required | WO `drug_screen` | **Partial** |
| `drug_ordered` / `drug_completed` | Drug screen ordered / completed | ✓ | ✓ | ✓ vendor | If required | **BG** or parallel orders | **Partial** |

### 2.5 Group: `assignment_requirements`

| Mini-step ID | Label | Worker | Admin | Auto/provider | Blocking (typical) | Owner(s) | Implementation |
|--------------|-------|--------|-------|---------------|-------------------|----------|----------------|
| `req_snapshot_applied` | Requirement package resolved to this assignment | | | ✓ on assign | — | **OI** + **assignments** | **Implemented** |
| `doc_esign` | Specific assigned document e-signed | ✓ | | ✓ provider | Per template | **SIG** + **OI** | **Partial** |
| `doc_ack` | Acknowledgement-only doc | ✓ | | | Per template | **OI** | **Partial** |
| `check_from_package` | Check row from package | ✓ | ✓ | | Per template | **OI** | **Spec / partial** |

### 2.6 Group: `internal_readiness`

| Mini-step ID | Label | Worker | Admin | Auto/provider | Blocking (typical) | Owner(s) | Implementation |
|--------------|-------|--------|-------|---------------|-------------------|----------|----------------|
| `employment_status_active` | Employment moved from onboarding to active | | ✓ | | Operational | **EE** `status` | **Implemented** |
| `readiness_evaluated` | Derived readiness for home/dashboard | ✓ (outcome) | ✓ | ✓ client + optional CF | Informational | **users** snapshot; `getWorkerReadiness` | **Partial** |

---

## 3. C1 Select LLC (`entityKey: select`)

**Canonical product defaults:** W-2, **`everifyRequired: true`** on the Select entity doc, background/drug per role, Everee when used.

### 3.1 Major groups in scope

| Group | In scope | Notes |
|-------|----------|--------|
| `work_authorization` | **Yes** | **Blocking:** I-9 + **E-Verify** as unified Select track (UI: one section). |
| `forms_and_policies` | **Yes** | W-2 tax + handbook + policies via package + WO milestones |
| `payroll` | **Yes** | Everee when entity uses it |
| `screenings` | **Yes** | BG + drug per configuration |
| `assignment_requirements` | **Yes** | Per Select placement |
| `internal_readiness` | **Yes** | Recruiter verification |

### 3.2 Mini-step matrix (Select) — required path

| Mini-step | Worker | Admin | Auto | Blocking | Owner |
|-----------|--------|-------|------|----------|-------|
| `i9_*` | ✓ | ✓ | | Yes | WO, **UE** |
| `everify_*` | ✓ (summary) | ✓ | ✓ | Yes | **EV**, WO, **UE**, EE |
| `tempworks_forms`, `handbook_*`, `tax_*`, `policy_*` | ✓ | ✓ | ✓ | Often | WO, OI, SIG |
| `ic_agreement_*` | **N/A** (W-2 default) | | | | |
| `payroll_*`, `direct_deposit` | ✓ | ✓ | ✓ | Often | WO, PR |
| `bg_*` / `drug_*` | ✓ | ✓ | ✓ | If required | WO, **BG**, OI |
| Assignment / doc rows | ✓ | ✓ | ✓ | Per item | OI, SIG |

### 3.3 Select — implementation summary

- **Implemented:** pipeline, **OI**, E-Verify stack (gated), **UE** + **EV** storage, sync to WO/EE, AccuSource, signatures.  
- **Partial:** mini-step granularity in WO; unified “Work authorization” admin layout vs legacy compliance tabs.  
- **UX direction:** Surface **`user_employments` / `everify_cases`** **inside** Select employment **Work authorization** (not as a standalone global E-Verify panel for Select users).

---

## 4. C1 Workforce LLC (`entityKey: workforce`)

**Canonical product defaults:** W-2 staffing/gig; **no E-Verify** in product or UX. **`everifyRequired: false`**. Work authorization = **I-9 only**.

### 4.1 Major groups in scope

| Group | In scope | Notes |
|-------|----------|--------|
| `work_authorization` | **Yes (I-9 only)** | **Do not** show E-Verify labels, rows, or blocking rules for Workforce. |
| `forms_and_policies` | **Yes** | Same as Select for W-2 forms |
| `payroll` | **Yes** | Everee when used |
| `screenings` | **Yes** | BG + drug per configuration (`drug_screen` may be `pending` until configured) |
| `assignment_requirements` | **Yes** | Per assignment |
| `internal_readiness` | **Yes** | Same |

### 4.2 Mini-step matrix (Workforce)

| Mini-step | Notes |
|-----------|--------|
| `i9_*` | **Required** for W-2 Workforce (same as Select minus E-Verify) |
| `everify_*` | **Out of UX scope** — exclude from progress, readiness, and employment detail; no peer “E-Verify” section |
| `ic_agreement_*` | **N/A** for default W-2 |
| Other groups | Same as Select §3.2 |

### 4.3 Workforce — implementation summary

- **Backend:** Pipeline doc may still contain an `e_verify` step with `not_required` or legacy data; **UI and progress helpers ignore `e_verify` for `entityKey === 'workforce'`**.  
- **Admin:** Backgrounds / screening tables may still list non–E-Verify items; **do not** frame E-Verify as part of Workforce onboarding.

---

## 5. C1 Events LLC (`entityKey: events`)

**Canonical product defaults:** **1099**; **no I-9, no E-Verify** in UX. IC agreement + W-9; drug typically off; BG optional.

### 5.1 Major groups in scope

| Group | In scope | Notes |
|-------|----------|--------|
| `work_authorization` | **No (USCIS)** | Do **not** show “Work authorization (I-9 / E-Verify)” for Events. Use **forms & policies** for contractor legal steps. |
| `forms_and_policies` | **Yes** | IC agreement, W-9, acknowledgements |
| `payroll` | **Often yes** | Contractor pay / Everee when configured |
| `screenings` | **Optional** | BG if required; drug usually off |
| `assignment_requirements` | **Yes** | Per event assignment |
| `internal_readiness` | **Yes** | Packet review as needed |

### 5.2 Mini-step matrix (Events)

| Mini-step | Notes |
|-----------|--------|
| `i9_*`, `everify_*` | **Out of UX scope** (pipeline may mark `not_required`) |
| `ic_agreement_*`, `tax_w4_w9` (W-9) | **Core** |
| `payroll_*`, `bg_*` | As configured |

### 5.3 Events — implementation summary

- **UI:** Worker employment detail **omits** the Work authorization block (or uses contractor-specific copy only — product choice); **no E-Verify** strings.  
- **Progress:** `e_verify` excluded from counts for `entityKey === 'events'`.

---

## 6. Canonical UI data model (information architecture only)

### 6.1 Principles

1. **One employment card per `entity_employments` row** — anchor for “relationship with this legal employer.”
2. **One compliance pipeline view** from **`worker_onboarding`** for major steps — **filter presentation by `entityKey`**: **never** treat E-Verify as a peer track for Workforce or Events.
3. **Assignment requirements** from **`onboarding_instances`** + **assignment** + **signature_envelopes** when focused on a placement.
4. **E-Verify (Select only):** Detail data still lives in **`user_employments`** + **`everify_cases`**, but the **worker and admin experience** presents them **only under Select employment → Work authorization**, alongside I-9 status — **not** as a separate global subsystem title for all entities.
5. **Screenings:** **`backgroundChecks`** (and related) remain the detail SoT for vendor screenings; separate from the Select E-Verify track.

### 6.2 A. Worker — “My Employment” canonical model

```ts
interface WorkerEmploymentCard {
  employmentId: string;
  entityId: string | null;
  entityName: string;
  entityKey: 'workforce' | 'select' | 'events';

  lifecycleStatus: 'onboarding' | 'active' | 'inactive' | 'terminated';
  workerType: 'w2' | '1099';

  pipelineId: string;
  pipelineSummary: {
    overallStatus: 'not_started' | 'in_progress' | 'complete';
    /** Include e_verify only when entityKey === 'select' (and applicability required/pending). */
    steps: Array<{
      stepId: string;
      title: string;
      applicability: 'required' | 'not_required' | 'pending';
      status: string;
      blockingForStart: boolean;
    }>;
  };

  openWorkerTasks: Array<{ id: string; stepId: string; title: string; status: string }>;

  /** Select only — derived from everify_cases / EE mirror */
  workAuthorization?: {
    i9Summary?: { status: string };
    everifySummary?: { statusDisplay: string } | null;
  };

  payrollSummary?: { accountId: string; status: string; portalUrl?: string } | null;
  complianceHighlights?: Array<{ type: string; status: string; expiresAt?: string }>;
}
```

**Worker UI rules:**

- **`entityKey === 'select'`:** Show **Work authorization** section: **I-9** + **E-Verify**; show `everifyStatus` / public case summary only here.  
- **`entityKey === 'workforce'`:** Show **Work authorization** section: **I-9 only** (no E-Verify row or copy).  
- **`entityKey === 'events'`:** **No** USCIS work authorization section; contractor/forms content only.

### 6.3 B. Admin — user record → entity employment detail

```ts
interface AdminEntityEmploymentDetail {
  employmentId: string;
  userId: string;
  tenantId: string;

  entity: {
    id: string | null;
    name: string;
    /** Should be true only for Select in C1 canon */
    everifyRequired: boolean;
    workerType: string;
    entityKey: 'workforce' | 'select' | 'events';
  };

  lifecycle: { /* ... */ };

  pipeline: { /* steps, tasks — admin sees full doc; UI hides e_verify for non-Select */ };

  /** Select only: load and show in Work authorization section */
  workAuthorizationDetail?: {
    userEmployments: Array<{ id: string; entityId?: string; i9Status?: string; startDate?: string; currentAssignmentId?: string }>;
    everifyCases: Array<{ id: string; status: string; userEmploymentId?: string; assignmentId?: string }>;
  };

  backgroundChecks: Array<{ id: string; hrxStatus?: string; packageLabel?: string }>;
  payrollAccount?: { id: string; status: string };
  assignments: Array<{ assignmentId: string; jobOrderId: string; status: string; onboardingInstanceId: string | null; /* ... */ }>;
}
```

**Admin UI rules:**

- For **Select** employment: single **Work authorization** area = I-9 (from **UE** + WO) + E-Verify cases (**EV**), actions (create case, retry) **in this context**.  
- For **Workforce / Events:** **omit** E-Verify panels from entity employment detail; do not imply workers must complete E-Verify.  
- **BackgroundsComplianceTab** (or successor) may remain a **technical ops** surface for screenings; **onboarding IA** should not treat “E-Verify” as symmetric with “background” for **all** entities — only **Select** combines E-Verify into onboarding.

### 6.4 Readiness logic (canonical)

- **Progress denominator:** Count only steps that apply to the entity, and **exclude `e_verify` entirely** for `workforce` and `events`** (implemented in [`onboardingPipelineProgress.ts`](../src/utils/onboardingPipelineProgress.ts)). Also exclude steps with `applicability === 'not_required'`.  
- **Blocking:** For **Select**, an open or failed **E-Verify** case blocks “ready” when product requires authorization. For **Workforce/Events**, **never** block readiness on `everify_cases` or `e_verify` step state.  
- **Compliance items:** If `worker_compliance_items` (or user-level lists) include an E-Verify type for a **non-Select** employment, treat as **data anomaly** or legacy — **UI should not surface** as required Workforce/Events onboarding (product may clean up or filter by `entityKey`).

---

## 7. Blocking policy (canonical recommendation)

| Condition | Blocking for “ready / cleared” |
|-----------|--------------------------------|
| `worker_onboarding.steps[].applicability === 'required'` AND step not `complete` | Yes **if** step is in scope for entity (see §6.4 for `e_verify`) |
| **Select:** **EV** open in non-terminal status | Yes |
| **Workforce / Events:** **EV** or `e_verify` | **No** (out of scope) |
| **OI** item `required && blocking` | Yes for assignment-specific readiness |
| **BG** actionable states | Yes when screening required |

---

## 8. Employment detail screen architecture (worker)

**Select — onboarding state:**

1. Header (entity, status, W-2).  
2. **Onboarding progress** card: **Work authorization** (I-9 row, E-Verify row) → **Forms & payroll** → **Screenings**.  
3. Payroll card, compliance card as today.  
4. **Documents & instructions:** E-Verify line **only for Select** when status exists.

**Workforce — onboarding state:**

1. Header.  
2. **Onboarding progress:** **Work authorization** (**I-9 only**) → **Forms & payroll** → **Screenings** (no E-Verify row).  
3. Remaining cards; **no** E-Verify in documents section.

**Events — onboarding state:**

1. Header (1099).  
2. **Onboarding progress:** **No** USCIS work authorization block → **Forms & payroll** → **Screenings**.  
3. No E-Verify copy.

---

## 9. Related docs

- [`ONBOARDING_STEP_APPLICABILITY.md`](./ONBOARDING_STEP_APPLICABILITY.md)  
- [`EVerify_IMPLEMENTATION_SUMMARY.md`](./EVerify_IMPLEMENTATION_SUMMARY.md) — backend + **Select-only UX alignment**  
- [`docs/ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md`](./ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md)  
- [`Onboarding-Tenant-Scoped-Architecture.md`](../Onboarding-Tenant-Scoped-Architecture.md) — historical spec

---

*Canonical matrix for UI IA and backend alignment. E-Verify is Select-native onboarding, not a universal peer subsystem.*
