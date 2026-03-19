# Onboarding Phase 1 — Admin QA

Quick reference for QA and admins testing the Phase 1 admin onboarding flow.

---

## 1. How to manually start onboarding

1. Go to **New Hires / Onboarding**: `/jobs/onboarding`.
2. In the **Trigger onboarding manually** card, enter:
   - **Worker UID** (required): the Firebase Auth `uid` of the worker.
   - **Entity ID** (optional): entity document ID if you want to tie the pipeline to a specific entity.
   - **Job Order ID** (optional): job order ID for context.
3. Click **Trigger onboarding**.
4. Backend callable `triggerWorkerOnboardingPipeline` runs: it resolves entity context (from entity ID or from job order’s account/location), creates or updates a `worker_onboarding` pipeline doc and a matching `entity_employments` doc. Pipeline ID = `userId__entityKey`.
5. The new (or updated) pipeline appears in the list below; filter by **Entity** if needed.

---

## 2. How auto-trigger onboarding occurs from confirmed assignment

- When a **worker** confirms an assignment (accept offer), `placementsApi` calls `ensureWorkerOnboardingPipeline` with `triggerSource: 'worker_confirmation'`.
- When a **recruiter** confirms an assignment for a worker, the same API calls `ensureWorkerOnboardingPipeline` with `triggerSource: 'recruiter_confirmation'`.
- In both cases the pipeline is created or updated for that worker + entity (entity comes from the assignment’s job order / account / location). The assignment ID is appended to the pipeline’s `assignmentIds` and the employment record is created or updated with `onboardingPipelineId` and optional `sourceAssignmentId`.
- No extra admin action is required; the pipeline appears on `/jobs/onboarding` and the employment appears on the worker’s User Profile → **Employment** tab.

---

## 3. How to select dummy packages

- On `/jobs/onboarding`, each pipeline card shows one **step card** per onboarding step (I-9, E-Verify, background check, drug screen, etc.).
- For **background check** and **drug screen** steps, a **package** dropdown is shown:
  - **Background**: “Select package” | “Dummy Background 1” | “Dummy Background 2”.
  - **Drug screen**: “Select package” | “Dummy Drug 1” | “Dummy Drug 2”.
- Select a package; it is saved via `updateWorkerOnboardingStepPackage` and the **package label** appears as a chip on the step (e.g. “Dummy Background 1”). This is for Phase 1 testing; real package IDs can be wired later.

---

## 4. How to mark payroll/legal milestones complete

- Steps **I-9**, **Onboarding forms**, and **Everee** have **milestones** (e.g. “I-9 sent”, “I-9 completed”, “Handbook sent”, “Payroll invite sent”, etc.).
- On each step card, click the **Milestones (x/y)** row to expand/collapse the checklist.
- Use the **checkboxes** to mark each milestone complete or incomplete; each toggle calls `updateWorkerOnboardingStepMilestone` and persists immediately.

---

## 5. How to move employment to active

- **Option A — From Employment tab:** Open the worker’s **User Profile** → **Employment** tab. For the relevant entity employment row, set **Employment status** to **active**. This calls `updateEntityEmploymentStatus`; the backend sets `hiredAt`, `onboardingCompletedAt`, and `active: true`.
- **Option B — From /jobs/onboarding:** The employment status is shown on each pipeline card; status changes are done from the Employment tab (or in a future iteration from the onboarding page). Completing all steps does not auto-set employment to active; an admin must set it to **active** when appropriate.

---

## 6. How to terminate or inactivate

- Open the worker’s **User Profile** → **Employment** tab.
- For the entity employment row, set **Employment status** to **inactive** or **terminated**.
- A dialog opens asking for an **optional termination reason**. Submit (or leave blank) to confirm. The callable `updateEntityEmploymentStatus` is called with `status` and optional `terminationReason`; the backend sets `terminatedAt` and stores `terminationReason` when provided.
- The Employment tab shows “Terminated: &lt;date&gt; — &lt;reason&gt;” when a reason was saved.

---

## 7. Expected Firestore docs involved

| Collection / path | Purpose |
|------------------|--------|
| `tenants/{tenantId}/worker_onboarding/{pipelineId}` | One doc per worker+entity pipeline. `pipelineId` = `userId__entityKey`. Fields: `userId`, `userName`, `entityId`, `entityKey`, `entityName`, `status`, `steps` (array with `id`, `title`, `status`, `workflowStatus`, `applicability`, `selectedPackageId`, `selectedPackageLabel`, `note`, `failureReason`, `milestones`, etc.), `assignmentIds`, `triggeredBy`, `createdAt`, `updatedAt`. |
| `tenants/{tenantId}/entity_employments/{employmentId}` | One doc per worker+entity employment; `employmentId` = same as `pipelineId` for the linked pipeline. Fields: `userId`, `entityId`, `entityKey`, `entityName`, `workerType`, `status` (onboarding \| active \| inactive \| terminated), `onboardingPipelineId`, `onboardingStartedAt`, `onboardingCompletedAt`, `hiredAt`, `terminatedAt`, `terminationReason`, `everifyRequired`, `backgroundRequired`, `drugScreenRequired`, `everifyStatus`, etc. |
| `tenants/{tenantId}/crm_companies/...` (accounts) | Account/location data used to resolve entity when triggering pipeline from job order. |
| Job orders / assignments | Assignment confirmation flows use assignment and job order to resolve entity and then create/update the pipeline and employment. |

---

## Callables used by admin Phase 1

- `triggerWorkerOnboardingPipeline` — manual trigger.
- `updateWorkerOnboardingStepPackage` — set background/drug package.
- `updateWorkerOnboardingStepWorkflow` — set step workflow status (ordered, complete, skipped, blocked, failed, etc.) and optional note/failure reason.
- `updateWorkerOnboardingStepMilestone` — toggle a payroll/legal milestone checkbox.
- `updateEntityEmploymentStatus` — set employment status (onboarding, active, inactive, terminated) and optional termination reason.

Admin Phase 1 is complete when the above flows work end-to-end and the Employment tab shows completion summary (e.g. “Onboarding complete” or “4 of 6 steps complete”) and termination reason where applicable.
