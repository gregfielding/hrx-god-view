# Onboarding Phase 1 — Implementation Plan

## 1. Proposed Firestore schema for entity_employments

**Path:** `tenants/{tenantId}/entity_employments/{userId}__{entityKey}`

**Document ID:** `userId` and `entityKey` concatenated with `__`. `entityKey` is one of: `workforce` | `select` | `events` (derived from entity name).

| Field | Type | Description |
|-------|------|-------------|
| tenantId | string | Tenant ID |
| userId | string | Worker user ID |
| entityId | string | Firestore entity document ID (e.g. from `tenants/{tid}/entities/{id}`) |
| entityKey | string | Canonical key: `workforce` \| `select` \| `events` |
| entityName | string | Display name of entity |
| workerType | string | `w2` \| `1099` (from entity at creation time) |
| status | string | `onboarding` \| `active` \| `inactive` \| `terminated` |
| onboardingPipelineId | string | `userId__entityKey` — links to `worker_onboarding` doc |
| onboardingStartedAt | Timestamp | First time onboarding was triggered |
| onboardingCompletedAt | Timestamp | When pipeline status became complete (optional, can derive from pipeline) |
| hiredAt | Timestamp | When moved to active (optional for Phase 1) |
| terminatedAt | Timestamp | When terminated |
| terminationReason | string | Optional |
| sourceAssignmentId | string | Assignment that triggered onboarding (optional) |
| sourceJobOrderId | string | Job order that triggered onboarding (optional) |
| everifyRequired | boolean | From entity at creation |
| backgroundRequired | boolean | Derived / set when pipeline has background step required |
| drugScreenRequired | boolean | Derived / set when pipeline has drug_screen step required |
| payrollStatus | string | Optional: pending, complete, etc. |
| everifyStatus | string | Optional: pending, complete, failed, etc. (synced from E-Verify case) |
| backgroundStatus | string | Optional: pending, ordered, complete, etc. |
| drugScreenStatus | string | Optional: pending, ordered, complete, etc. |
| active | boolean | Convenience: true when status is active |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

**Indexes:** None required for Phase 1 beyond single-doc reads by `tenantId` and doc ID. Optional: collection group or composite for "all employments for user" (client can query `where('userId', '==', uid)` if needed).

---

## 2. Mapping: entity onboardingWorkflowSteps → 6 canonical pipeline steps

**Entity config:** `OnboardingWorkflowStepsConfig` = `Record<string, boolean>` (stepId → enabled). Stored on `tenants/{tid}/entities/{entityId}.onboardingWorkflowSteps`.

**Workflow step IDs (compliance-only; from EntitiesPage):**

- 1099: `ic_agreement_sent`, `ic_agreement_signed`, `1099_sent`, `1099_completed`, `payroll_invite_sent`, `payroll_setup_complete`, `w9_received`, `direct_deposit_contractor`
- W2: `handbook_sent`, `handbook_signed`, `i9_sent`, `i9_completed`, `everify_sent`, `everify_completed`, `w4_sent`, `w4_completed`, `direct_deposit_w2`, `policy_acknowledgments`, `background_initiated`, `background_completed`  
  *(Excluded from checklist: `emergency_contact` — profile only; `benefits_enrollment` — separate future module.)*

**Canonical 6 steps:** `i9` | `onboarding_forms` | `everee` | `e_verify` | `background_check` | `drug_screen`

**Applicability:** `required` | `not_required` | `pending`

| Canonical step | Entity checkbox IDs that map to it | Applicability rule |
|----------------|-----------------------------------|--------------------|
| **i9** | `i9_sent`, `i9_completed` | **required** if any checked. **not_required** if entity.workerType === '1099' and neither checked. **pending** if W2/BOTH and neither checked. |
| **onboarding_forms** | `handbook_sent`, `handbook_signed`, `w4_sent`, `w4_completed`, `policy_acknowledgments`, `ic_agreement_sent`, `ic_agreement_signed`, `1099_sent`, `1099_completed`, `w9_received`, `direct_deposit_contractor`, `direct_deposit_w2` (compliance-only; no emergency_contact or benefits_enrollment) | **required** if any checked. **not_required** if none checked. |
| **everee** | `payroll_invite_sent`, `payroll_setup_complete` | **required** if any checked. **not_required** if none. |
| **e_verify** | `everify_sent`, `everify_completed` + entity.everifyRequired | **required** if entity.everifyRequired or any of the two checked. **not_required** if 1099 and not required. **pending** otherwise. |
| **background_check** | `background_initiated`, `background_completed` | **required** if any checked. **not_required** if none. When required, package selection can be **pending** until admin selects dummy package (stored on step). |
| **drug_screen** | (no checkbox in 24) | **not_required** by default. **pending** when we want admin to select dummy package (e.g. when entity typically requires drug screen). For Phase 1: **pending** if entity has any W2 steps; else **not_required**. |

**Implementation note:** When creating/updating pipeline, backend loads entity doc (by entityId or entityKey), reads `onboardingWorkflowSteps` and `workerType` / `everifyRequired`, computes applicability per canonical step, and writes `steps[].applicability` on the pipeline document.

---

## 3. Exact admin UI changes (file paths + routes)

| Change | File(s) | Route / Location |
|--------|---------|------------------|
| **Employment section on User Profile** | `src/pages/UserProfile/index.tsx` (add tab + content), new `src/pages/UserProfile/components/EmploymentTab.tsx` (or `EntityEmploymentsSection.tsx`) | Tab "Employment" on `/users/:uid`. Shows one row/card per `entity_employments` for that user. Each row: entity name, worker type, status chip, onboarding progress, started/completed dates, "Open onboarding" → `/jobs/onboarding?pipelineId=...` or deep link. |
| **Recruiter Onboarding page** | `src/pages/RecruiterOnboarding.tsx` | `/jobs/onboarding`. Enhance: filter/view by entity; show employment status; per-step select dummy package for background_check and drug_screen; mark step ordered/awaiting/scheduled/complete/failed/skipped; manual step override for payroll/legal. |
| **Legacy onboarding de-emphasize** | `src/pages/UserProfile/components/OnboardingTab.tsx` (and possibly UserProfile index where Onboarding tab is shown) | Add banner/note: "Legacy onboarding. For entity-based onboarding, use the Employment tab and New Hires / Onboarding." |
| **Firestore paths** | `src/data/firestorePaths.ts` | Add `entityEmployments(tid)`, `entityEmployment(tid, docId)` for `tenants/{tid}/entity_employments/{userId}__{entityKey}`. |

**Routes:** No new top-level routes. Employment is a new tab on existing User Profile. Onboarding page is existing `/jobs/onboarding`.

---

## 4. Exact build order for implementation

1. **Backend: entity_employments + pipeline ID alignment**
   - Standardize pipeline doc ID to `userId__entityKey` (not entityId) in `workerOnboardingPipeline.ts`.
   - Add `entity_employments` collection write in `ensureWorkerOnboardingPipeline` (upsert by `userId__entityKey`), set status `onboarding`, set `onboardingPipelineId`, `onboardingStartedAt` on first create.
   - Add Firestore path helpers in `firestorePaths.ts` (and functions equivalent if needed).

2. **Backend: entity settings → pipeline applicability**
   - In `ensureWorkerOnboardingPipeline`, load entity doc(s) for tenant (by entityId or by entityKey via entities collection).
   - Compute applicability for each of the 6 steps from entity `onboardingWorkflowSteps` + `workerType` + `everifyRequired` using the mapping table above.
   - Write initial `steps` with `applicability` set. When pipeline already exists, optionally recompute applicability on trigger (or only on create).

3. **Backend: dummy package support**
   - Extend pipeline step shape to allow `selectedPackageId` (or `packageId`) and optionally `packageLabel` for `background_check` and `drug_screen`. Add callable or extend `updateWorkerOnboardingStepStatus` to set selected package (e.g. "Dummy Background 1", "Dummy Drug 1"). Store in pipeline step or in a small `stepOverrides` map.

4. **Admin UI: Employment tab on User Profile**
   - Add "Employment" tab to UserProfile (visible for admin/recruiter).
   - New component: fetch `entity_employments` for this user (tenant-scoped query by userId), display cards with entity name, status, onboarding progress, "Open onboarding" link.

5. **Recruiter Onboarding page enhancements**
   - View/filter by entity (entityKey or entityId).
   - Per pipeline step (background_check, drug_screen): dropdown to select dummy package; store on step.
   - Step status already supports not_started / in_progress / complete / blocked; add or use existing way to mark ordered/awaiting/scheduled/skipped (can map to status or add `subStatus`/`orderStatus`).
   - "Open onboarding" from User Profile Employment tab links to `/jobs/onboarding` with pipelineId so recruiter can land on the right pipeline.

6. **E-Verify alignment**
   - When E-Verify case status changes (existing trigger or handler), update corresponding pipeline step `e_verify` status and `entity_employments.everifyStatus` for the matching user+entity. Identify pipeline by userId + entity (from case or from employment record).

7. **Legacy onboarding**
   - Add short banner/note on OnboardingTab (and/or where legacy onboarding is shown) that entity-based onboarding is the active system; link to Employment tab and New Hires / Onboarding.

---

## 5. Migration / compatibility concerns with legacy onboarding

- **Legacy fields on `users/{uid}`:** `employeeOnboardStatus`, `contractorOnboardStatus`, `onboardingTasks`, etc. Remain unchanged. Do not remove. Do not expand. New entity onboarding does not write to these.
- **Pipeline ID change:** Current code uses `scopeId = entityContext.entityId || entityContext.entityKey`, so pipelineId can be `userId__<entityId>`. Phase 1 standardizes to `userId__entityKey`. **Migration:** Existing pipelines with doc ID `userId__<entityId>` will not be found if we only look up by `userId__entityKey`. Options: (a) support both lookups (try entityKey first, then by entityId) when reading; (b) one-time migration script to duplicate or rename docs from `userId__entityId` to `userId__entityKey` (risky). **Recommendation:** Use `userId__entityKey` for all new pipelines and for entity_employments; when reading, if we have entityId we can resolve entityKey from entity doc and use that for pipeline ID. Existing pipelines with old ID format can continue to be listed on Recruiter Onboarding; new triggers create new docs with new ID. Optionally add a fallback in Recruiter Onboarding to show pipelines by either ID pattern.
- **Backward compatibility:** Recruiter Onboarding page already lists all docs in `worker_onboarding`; so existing pipelines (old ID) still appear. Employment tab only shows `entity_employments` docs; workers with only legacy onboarding will have no employment rows until they are triggered again or admin triggers manually (then new pipeline + employment record created with entityKey ID).
- **Everee / E-Verify:** No schema change to existing E-Verify or Everee integrations. Only wire E-Verify case lifecycle to update pipeline step and entity_employments.everifyStatus.

---

## Next: Implementation

Proceeding in the order above. Files to create/change:

- `functions/src/onboarding/workerOnboardingPipeline.ts` — pipelineId by entityKey; entity_employments upsert; load entity and compute applicability.
- `functions/src/onboarding/entityEmployments.ts` (new) — optional helper for employment upsert and E-Verify status update.
- `src/data/firestorePaths.ts` — entityEmployments paths.
- `src/pages/UserProfile/components/EmploymentTab.tsx` (new) — Employment section.
- `src/pages/UserProfile/index.tsx` — add Employment tab.
- `src/pages/RecruiterOnboarding.tsx` — entity filter, dummy package dropdowns, step package storage.
- `src/pages/UserProfile/components/OnboardingTab.tsx` — legacy banner.
- E-Verify trigger/handler — update pipeline + entity_employments when case status changes (locate in everifyTriggers or everifyEligibility).
