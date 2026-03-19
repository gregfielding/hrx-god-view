# Phase 2 Systems Architecture

This document defines the **recommended** long-term architecture for five core systems. Implementation should be **additive and backward-compatible**. Do not break existing launch-ready systems or force schema changes that would destabilize current functionality.

**Principle:** If a recommendation conflicts with current database or code reality, preserve compatibility and choose the best practical path. This is a direction-setting document, not a forced rewrite.

---

## 1. System Boundaries & Data Ownership

### 1.1 Profile System
**Owns:** Reusable worker data (single source of truth for the person).

| Domain | Examples |
|--------|----------|
| Identity | Name, DOB, SSN (masked), preferred name |
| Contact | Email, phone, preferred channel |
| Address | Mailing, physical (current) |
| **Emergency contact** | Name, relationship, phone — **not an onboarding checklist item**; may be enforced by validation rules (e.g. before activation) |
| Experience | Work history, references |
| Education | Schools, degrees |
| Skills | Skills list (display; verification in Compliance) |
| Languages | Spoken/written |
| Resume | Uploads, parsed data |
| Preferences | Notifications, accessibility |

**Storage:** Primarily `users/{uid}` and tenant-scoped profile extensions. Emergency contact lives only in Profile; do not duplicate in onboarding.

---

### 1.2 Compliance System
**Owns:** Employment eligibility, screenings, signatures/acknowledgments, credentials/licenses/expiring docs. Compliance items are **first-class objects**.

| Domain | Examples |
|--------|----------|
| Employment eligibility | I-9, E-Verify |
| Screenings | Background check, drug screen, TB, etc. |
| Signatures / acknowledgments | Handbook signature, policy acknowledgments, contractor agreement |
| Credentials / licenses / expiring | Driver’s license, food handler card, CPR, work permit, visa/work authorization expiry, certifications |

**Storage:** `worker_compliance_items`. Admin: Compliance Library, Credential Types, Screening Types.

---

### 1.3 Benefits System
**Owns:** PTO acknowledgment, future leave programs, healthcare eligibility, offer/accept/decline, enrollment records.

| Domain | Examples |
|--------|----------|
| PTO | Policy acknowledgment, future leave programs |
| Healthcare (future) | Eligibility, offer, accept/decline |
| Other benefits | Dental, life, disability, 401k (future) |

**Not in onboarding checklist.** Benefits enrollment belongs here; handle as a separate system and flow.  
**Storage:** `worker_benefits`. Admin: Benefits Programs.

---

### 1.4 Payroll System
**Owns:** Entity-specific pay relationship state; supports both current (TempWorks) and future (Everee) modes.

| Domain | Examples |
|--------|----------|
| Pay relationship | Worker type, employment status |
| Payroll onboarding | Status, milestones (manually confirmed or provider-synced), provider IDs when integrated |
| Direct deposit / tax forms | Status only; actual data lives in payroll provider |
| Future | Pay history integration when provider supports it |

**Operating model (TempWorks-first):**  
While on TempWorks, **HRX is NOT the payroll system of record** and does **NOT** host the full payroll onboarding experience. Current model: admins manually confirm payroll/legal milestones in HRX; workers receive an onboarding email with a link to create their payroll account in TempWorks; the best worker-facing payroll action HRX provides is a **link to the TempWorks portal**. HRX tracks status, milestones, reminders, and visibility. HRX must **not** pretend to fully manage payroll onboarding until Everee (or another integrated provider) is in place.

Direct Deposit / Payroll Setup remain **operationally visible in onboarding**; **data ownership** stays with Payroll System / payroll provider.  
**Storage:** `worker_payroll_accounts` (or extension to entity_employments). Admin: Payroll Providers.

---

### 1.5 AI Signals Layer
**Owns:** Derived alerts, recommendations, risk flags only. Does **not** mutate source-of-truth records.

| Domain | Examples |
|--------|----------|
| Alerts | Expiring work permit, expiring driver’s license, missing credential |
| Readiness / risk | Screening due, background expiring |
| Benefits | Eligibility reached |
| Future | Matching, retention signals |

**Storage:** `worker_signals` — computed/derived; written by jobs or Cloud Functions. Admin: AI Signals / Alerts.

---

## 2. Critical Classification Rules (Preserve)

1. **Emergency Contact**  
   - **Not** an onboarding checklist item.  
   - Lives in **Profile**.  
   - May be enforced later by validation rules before activation; do not duplicate.

2. **Benefits Enrollment**  
   - **Not** an onboarding checklist item.  
   - Belongs to **Benefits** (PTO acknowledgment, healthcare offer/accept/decline, etc.).

3. **Direct Deposit / Payroll Setup**  
   - Can remain **operationally visible** in onboarding.  
   - **Data ownership** belongs to Payroll System / payroll provider integration.

4. **Compliance items**  
   - Treated as **first-class objects** (I-9, E-Verify, handbook signature, contractor agreement, driver’s license, food handler, CPR, work permit, visa/work auth expiry, background/drug/TB, etc.).

---

## 3. Proposed Firestore Structure (Recommendation; Preserve Compatibility)

Paths and field sets below are the **recommended direction**. Existing collections (`entity_employments`, `worker_onboarding`, `everify_cases`, `everee_workers`) are **unchanged**; new or extended structures are additive.

### 3.1 entity_employments (existing — extend only)

**Path (unchanged):** `tenants/{tenantId}/entity_employments/{userId}__{entityKey}`.

**Do not remove or rename existing fields.** Current usage includes: `tenantId`, `userId`, `entityId`, `entityKey`, `entityName`, `workerType`, `status`, `onboardingPipelineId`, `onboardingStartedAt`, `onboardingCompletedAt`, `terminatedAt`, `terminationReason`, `everifyRequired`, `backgroundRequired`, `drugScreenRequired`, `payrollStatus`, `everifyStatus`, `backgroundStatus`, `drugScreenStatus`, `active`, `createdAt`, `updatedAt`.

**Additive only (optional):**
| Field | Type | Notes |
|-------|------|-------|
| payrollAccountId | string? | Link to `worker_payroll_accounts` doc when that collection is used. |
| complianceSummary | map? | Cache: e.g. lastComputedAt, expiringCount, missingCount (denormalized from worker_compliance_items). |

**Compatibility:** Keep writing/reading existing fields as today. New fields are optional; backfill when building Phase 2.

---

### 3.2 worker_compliance_items (new collection)

**Path:** `tenants/{tid}/worker_compliance_items/{itemId}`  
**Document ID:** Auto-ID or deterministic (e.g. `{userId}_{entityKey}_{type}_{key}`).

Recommended shape (additive; omit fields until needed):

| Field | Type | Description |
|-------|------|-------------|
| tenantId | string | Tenant |
| userId | string | Worker user ID |
| entityId | string? | Optional entity scope |
| employmentId | string? | entity_employments doc ID (userId__entityKey) when scoped to employment |
| category | string | `eligibility` \| `screening` \| `acknowledgment` \| `credential` |
| type | string | Type/key: e.g. `i9`, `everify`, `drivers_license`, `food_handler`, `handbook`, `cpr`, `work_permit`, `background_check`, `drug_screen`, `policy_ack`, `ic_agreement`, `w9`, etc. |
| title | string? | Display title |
| required | boolean? | Whether required for role/entity |
| status | string | `not_started` \| `pending` \| `submitted` \| `in_review` \| `complete` \| `expired` \| `failed` \| `waived` |
| source | string? | `onboarding_package` \| `admin_manual` \| `job_order` \| `worker_upload` \| `integration` |
| documentIds | string[]? | References to stored documents |
| issuedAt | Timestamp? | When credential/item was issued |
| expiresAt | Timestamp? | For expiring credentials |
| renewalDueAt | Timestamp? | When renewal should be requested |
| verifiedAt | Timestamp? | When verified/completed |
| verifiedBy | string? | User ID or system that verified |
| notes | string? | Admin/recruiter notes |
| metadata | map? | Type-specific (e.g. packageId, caseId, state for DL) |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**Indexes (add as needed):** tenantId + userId; tenantId + userId + employmentId; tenantId + type + status; tenantId + expiresAt.

**Compatibility:** Existing onboarding pipeline and entity_employments status fields (everifyStatus, backgroundStatus, etc.) remain source of truth until sync jobs populate worker_compliance_items; then both can be kept in sync or migration path defined.

---

### 3.3 worker_benefits (new collection)

**Path:** `tenants/{tid}/worker_benefits/{benefitId}`  
**Document ID:** Auto or deterministic (e.g. `{userId}_{entityKey}_{programId}`).

| Field | Type | Description |
|-------|------|-------------|
| tenantId | string | Tenant |
| userId | string | Worker |
| entityId | string? | Optional entity scope |
| programType | string? | `pto` \| `healthcare` \| `dental` \| etc. |
| programId | string? | References Benefits Program (admin config) |
| eligibilityStatus | string? | `not_eligible` \| `eligible` \| `offered` \| `enrolled` \| `declined` \| `inactive` |
| offeredAt | Timestamp? | |
| acceptedAt | Timestamp? | |
| declinedAt | Timestamp? | |
| effectiveDate | Timestamp? | |
| endDate | Timestamp? | |
| source | string? | How the record was created |
| metadata | map? | Program-specific |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**Compatibility:** Purely additive. No existing benefits collections to migrate; do not add benefits enrollment to onboarding checklist.

---

### 3.4 worker_payroll_accounts (new collection; or extend entity_employments)

**Recommended path:** `tenants/{tid}/worker_payroll_accounts/{userId}__{entityKey}` (align with entity_employments doc ID for simple linking).

**Alternative:** Add payroll-specific fields to `entity_employments` if that keeps one source of truth. Current schema already has `payrollStatus` on entity_employments; Phase 2 can extend there or introduce worker_payroll_accounts. **Best practical path:** Add collection when building payroll abstraction; until then, entity_employments and everee_workers (for Everee entities) remain authoritative.

**Payroll must support both modes:**  
- **tempworks** (or **manual_tracking** / **portal_link_only**): HRX tracks status and milestones; admins manually confirm; worker gets link to TempWorks portal only.  
- **everee** (or **integrated**): Provider integration; status/milestones can be synced from provider where available.

| Field | Type | Description |
|-------|------|-------------|
| tenantId | string | Tenant |
| userId | string | Worker |
| entityId | string | Entity |
| entityKey | string | workforce \| select \| events |
| workerType | string | w2 \| 1099 |
| employmentStatus | string? | onboarding \| active \| inactive \| terminated |
| payrollProvider | string | `tempworks` \| `everee` \| `manual` |
| providerWorkerId | string? | External system worker ID (e.g. Everee when integrated) |
| payrollStatus | string | `not_started` \| `invite_sent` \| `account_created` \| `in_progress` \| `complete` \| `blocked` |
| payrollAccountLink | string? | URL for worker to access payroll portal (TempWorks onboarding link or Everee portal) |
| payrollCompletionSource | string? | `manual` \| `worker_confirmed` \| `provider_sync` (how completion was recorded) |
| directDepositStatus | string? | pending \| complete \| skipped |
| taxFormStatus | string? | w4_pending \| w4_complete \| w9_pending \| w9_complete |
| lastSyncAt | Timestamp? | From payroll provider (when integrated) |
| metadata | map? | |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**Compatibility:** Existing `everee_workers` path and Everee callables stay. worker_payroll_accounts can coexist and reflect provider-agnostic status; do not break everee_workers.

---

### Payroll-oriented milestones (admin manual confirmation)

These milestones should be supported in onboarding / payroll step (or entity workflow) so admins can confirm progress. Pipeline step is currently named **everee** but used for all payroll flows; milestones can be provider-agnostic for TempWorks and Everee.

**W-2:**  
- payroll invite sent  
- payroll account created  
- payroll setup complete  
- direct deposit setup complete  

**1099:**  
- payroll invite sent  
- payroll account created  
- payroll setup complete  
- direct deposit / banking info complete  

Where the pipeline or entity config uses different IDs (e.g. `everee_invite_sent`, `everee_setup_complete`), keep them for compatibility; add mapping or additional milestone IDs (e.g. `payroll_account_created`) so both TempWorks and Everee flows can be represented. No change to existing milestone behavior required; additive only.

---

### Worker-facing payroll UI (TempWorks-first)

Worker UI in HRX must **not** present a fake embedded payroll experience. For now it should only show:  
- payroll **status** (e.g. Not started, Invite sent, Account created, In progress, Complete)  
- payroll-related **milestone progress** (e.g. 2 of 4 complete)  
- a **button or link** to the TempWorks portal or onboarding link (configurable per entity/tenant)  

Do **not** build embedded payroll forms or pretend to host payroll onboarding until Everee (or another integrated provider) is live.

---

### 3.5 worker_signals (new collection)

**Path:** `tenants/{tid}/worker_signals/{signalId}`  
**Document ID:** Auto-ID recommended (signals are append-style; one worker can have many).

| Field | Type | Description |
|-------|------|-------------|
| tenantId | string | Tenant |
| userId | string | Worker |
| entityId | string? | Optional |
| employmentId | string? | entity_employments doc ID |
| signalType | string | `compliance_risk` \| `readiness` \| `benefits` \| `matching` \| `retention` |
| signalKey | string? | e.g. `expiring_drivers_license`, `work_permit_expiring`, `missing_food_handler`, `benefits_eligible` |
| severity | string | `info` \| `warning` \| `critical` |
| title | string | Short label |
| summary | string? | Longer description |
| recommendedAction | string? | Human-readable action |
| sourceSystems | string[]? | e.g. `['compliance','payroll']` |
| relatedRecordIds | map? | e.g. `{ worker_compliance_items: 'id1', entity_employments: 'id2' }` |
| detectedAt | Timestamp | When signal was generated |
| expiresAt | Timestamp? | When signal is stale |
| resolvedAt | Timestamp? | When dismissed or resolved (do not mutate source records) |
| metadata | map? | |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**Compatibility:** Read-only derived layer. Writers (scheduled functions or triggers) must only create/update worker_signals; never change worker_compliance_items, entity_employments, or user profile from a “signal” path.

---

## 4. Compatibility Strategy with Current Schema

- **entity_employments:** Remain the source of truth for employment status and onboarding linkage. Pipeline ID = `userId__entityKey`. All existing fields stay. Add only optional `payrollAccountId` and `complianceSummary` when implementing Phase 2 features.
- **worker_onboarding:** Stays as the operational onboarding pipeline (steps: i9, onboarding_forms, everee, e_verify, background_check, drug_screen). Do not remove or rename. Phase 2 can **sync** completion state into worker_compliance_items; pipeline remains the driver for recruiter/worker flow.
- **everify_cases:** E-Verify triggers that sync to worker_onboarding and entity_employments stay as-is. When worker_compliance_items exists, add a sync from E-Verify result into a compliance item (additive).
- **everee_workers:** Path `tenants/{tid}/everee_workers/{entityId}__{userId}` and existing Everee callables stay. worker_payroll_accounts (if introduced) can sit alongside and eventually reflect provider-agnostic status; do not break Everee reads/writes.
- **entities.onboardingWorkflowSteps:** Current entity checkboxes (handbook_sent, i9_completed, etc.) drive pipeline applicability. Keep; they define “what’s required” per entity. Compliance items store the **canonical** compliance state; onboarding UI can still show checklist derived from pipeline + entity config.

---

## 5. Onboarding Checklist Reclassification

Every current entity checklist item is classified as:

- **A.** Remain true onboarding (operational checklist; may also sync to Compliance/Payroll).
- **B.** Move to Profile (not onboarding).
- **C.** Move to Benefits (not onboarding).
- **D.** Move to Compliance long-term but may remain operationally visible in onboarding for now.

### 5.1 Independent Contractor (1099)

| Entity checklist item | Classification | Notes |
|-----------------------|----------------|-------|
| Independent Contractor Agreement Sent | **D** | Compliance (acknowledgment); remain visible in onboarding; long-term in worker_compliance_items. |
| Independent Contractor Agreement Signed | **D** | Same. |
| 1099 / W-9 Sent | **D** | Compliance/tax doc; remain in onboarding flow; data in Compliance/Payroll. |
| 1099 / W-9 Completed | **D** | Same. |
| Payroll Invite Sent | **A** | True onboarding; data ownership Payroll. |
| Payroll Setup Complete | **A** | Same. |
| W-9 Received | **D** | Compliance; remain visible in onboarding. |
| Direct Deposit / Banking Info (Contractor) | **A** + Payroll ownership | Operationally in onboarding; data ownership Payroll. |

### 5.2 W2 Employee

| Entity checklist item | Classification | Notes |
|-----------------------|----------------|-------|
| Handbook Sent | **D** | Compliance (acknowledgment); remain visible in onboarding. |
| Handbook Signed | **D** | Same. |
| I-9 Sent | **D** | Compliance (eligibility); remain in onboarding; canonical in worker_compliance_items. |
| I-9 Completed | **D** | Same. |
| E-Verify Sent | **D** | Compliance; remain in onboarding; sync from everify_cases. |
| E-Verify Completed | **D** | Same. |
| W-4 Sent | **D** | Tax form; remain in onboarding; tax form status in Payroll. |
| W-4 Completed | **D** | Same. |
| Direct Deposit Setup | **A** + Payroll ownership | Operationally in onboarding; data ownership Payroll. |
| **Emergency Contact Form** | **B** | **Profile only.** Remove from onboarding checklist; enforce via validation if needed. |
| **Benefits Enrollment** | **C** | **Benefits only.** Remove from onboarding checklist; handle in Benefits system. |
| Policy Acknowledgments (e.g. harassment, confidentiality) | **D** | Compliance; remain visible in onboarding. |
| Background Check Initiated | **D** | Compliance (screening); remain in onboarding. |
| Background Check Completed | **D** | Same. |

### 5.3 Summary

- **A (remain true onboarding):** Payroll Invite Sent, Payroll Setup Complete, Direct Deposit / Banking Info (Contractor), Direct Deposit Setup. Data ownership for pay/direct deposit/tax: Payroll.
- **B (Profile):** Emergency Contact Form only.
- **C (Benefits):** Benefits Enrollment only.
- **D (Compliance long-term; may stay visible in onboarding):** All I-9, E-Verify, handbook, policy acks, contractor agreement, W-9/W-4, background check (and drug screen when present). Onboarding UI can keep showing them; canonical state in worker_compliance_items when implemented.

---

## 6. Admin Placeholders (Phase 2)

Lightweight placeholder admin areas (already in Settings). Do not overbuild; do not destabilize existing screens.

| Area | Purpose |
|------|---------|
| Compliance Library | Templates, required items per entity/role, links to Credential Types. |
| Credential Types | Define credential types (license, certification, work permit, etc.) and expiry rules. |
| Screening Types | Background/drug screen packages and types. |
| Benefits Programs | Define benefit programs, eligibility rules, offer templates. |
| Payroll Providers | Configure provider mode (TempWorks = track only, portal link; Everee = integrated when available). Tenant/entity mappings and portal link URL. |
| AI Signals / Alerts | Configure signal rules and view alerts dashboard. |

---

## 7. Recommended Phase 2 Build Order

1. **Compliance foundation**  
   - Introduce `worker_compliance_items` and path helpers (already in firestorePaths).  
   - Implement Compliance Library, Credential Types, Screening Types (placeholders → real UI).  
   - Sync existing onboarding outcomes (I-9, E-Verify, background, drug screen) into compliance items; keep pipeline and entity_employments as-is.

2. **Payroll shape**  
   - Add `worker_payroll_accounts` (or extend entity_employments) and path helpers.  
   - Payroll Providers admin (placeholder → config).  
   - Support `payrollProvider: tempworks | everee | manual` for migration; link entity_employments to payroll account; do not break everee_workers.

3. **Profile**  
   - Ensure emergency contact lives only in Profile; remove from onboarding checklist if still present; add validation rules only if “required before activation” is required.

4. **Benefits**  
   - Implement `worker_benefits` and Benefits Programs config.  
   - No onboarding checklist changes; benefits flows built separately.

5. **AI Signals**  
   - Implement `worker_signals`; jobs/Functions to compute from compliance (and later benefits/payroll).  
   - Writers must not mutate source-of-truth records.  
   - AI Signals / Alerts admin (placeholder → dashboard + rules).

6. **entity_employments extensions**  
   - Add optional `payrollAccountId` and `complianceSummary` when needed for UX or reporting.

---

## 8. Compatibility Cautions / “Do Not Break”

- **entity_employments**  
  - Doc ID = `userId__entityKey`. Used by worker_onboarding pipeline and E-Verify sync. Do not change ID format or remove fields.

- **worker_onboarding**  
  - Pipeline steps and step IDs (i9, onboarding_forms, everee, e_verify, background_check, drug_screen) are referenced in Recruiter Onboarding and worker flows. Do not remove or rename steps.

- **everify_cases and E-Verify sync**  
  - Triggers that update worker_onboarding and entity_employments must keep working. Any new sync to worker_compliance_items must be additive.

- **everee_workers**  
  - Path uses `entityId__userId`. Everee callables and config read from entity doc and this collection. Do not remove or rename; worker_payroll_accounts should coexist.

- **entities.onboardingWorkflowSteps**  
  - Drives pipeline step applicability in workerOnboardingPipeline. Do not remove step IDs; reclassification (A/B/C/D) is about where data lives and what appears in checklist, not deleting entity config.

- **AI Signals**  
  - Only write to worker_signals. Do not mutate worker_compliance_items, entity_employments, or profile from signal-computation code.

---

## 9. Payroll clarification: TempWorks-first (architecture assumptions)

- **HRX is NOT payroll system of record** on TempWorks; it tracks status, milestones, reminders, and visibility only. Workers get a link to TempWorks to complete payroll onboarding.
- **Admin manual confirmation** of payroll/legal milestones is the current operating model; support `payrollCompletionSource: manual | worker_confirmed | provider_sync` so future Everee sync can be distinguished.
- **Worker UI:** Only show payroll status, milestone progress, and a link to the TempWorks portal (or onboarding link). Do not build fake embedded payroll UI until Everee (or another integrated provider) is live.
- **Onboarding milestone grouping:** Keep the existing single payroll step (pipeline step **everee**). No need to split into multiple steps. Ensure payroll milestone concepts (invite sent, account created, setup complete, direct deposit/banking complete) are representable: current entity workflow has `payroll_invite_sent`, `payroll_setup_complete`, `direct_deposit_*`; add **payroll_account_created** (or equivalent) to entity workflow options and/or pipeline step milestones where missing. Existing IDs (`everee_invite_sent`, `everee_setup_complete`) remain for compatibility; map to the same concepts in UI labels.

---

## 10. References

- Phase 1 onboarding: `docs/ONBOARDING_PHASE1_PLAN.md`
- Entity employments and pipeline: `functions/src/onboarding/workerOnboardingPipeline.ts`
- E-Verify sync: `functions/src/integrations/everify/everifyTriggers.ts`
- Everee: `functions/src/integrations/everee/` (evereeConfig, everee_workers paths)
- Firestore paths: `src/data/firestorePaths.ts`
- Entity workflow steps: `src/pages/TenantViews/settings/EntitiesPage.tsx` (`ONBOARDING_WORKFLOW_STEPS`)
