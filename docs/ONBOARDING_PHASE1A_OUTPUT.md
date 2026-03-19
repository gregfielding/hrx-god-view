# Phase 1A — Operationalize the Pipeline — Output Summary

## 1. Files changed

### Backend (functions)
- **`functions/src/onboarding/workerOnboardingPipeline.ts`**
  - Extended `PipelineStep` with `workflowStatus`, `orderedAt`, `skippedAt`, `completedAt`, `failureReason`, `note`, `milestones`.
  - Added `StepWorkflowStatus` type and `STEP_MILESTONES` (default checklist for i9, onboarding_forms, everee).
  - Pipeline creation now seeds `milestones` for i9, onboarding_forms, everee.
  - `updateWorkerOnboardingStepPackage`: sets `workflowStatus: "package_selected"` and `status: "in_progress"` when a package is selected.
  - New callables: `updateWorkerOnboardingStepWorkflow`, `updateWorkerOnboardingStepMilestone`, `updateEntityEmploymentStatus`.
- **`functions/src/index.ts`**
  - Exported `updateWorkerOnboardingStepWorkflow`, `updateWorkerOnboardingStepMilestone`, `updateEntityEmploymentStatus`.

### Frontend
- **`src/pages/RecruiterOnboarding.tsx`**
  - Fetches `entity_employments` per visible pipeline; shows entity name, employment status, worker type, progress (X/Y steps).
  - Step cards: applicability, status/workflowStatus, **package label** (persisted, visible after save).
  - Workflow actions: Mark ordered, Mark complete, In progress, Skip, Block, Fail (Skip/Block/Fail open note dialog).
  - Milestones: expandable checklist for i9, onboarding_forms, everee; checkbox toggles call `updateWorkerOnboardingStepMilestone`.
  - Dialog for note/failure reason when setting skipped/blocked/failed.
- **`src/pages/UserProfile/components/EmploymentTab.tsx`**
  - Shows timestamps: onboarding started, onboarding completed, hired, terminated.
  - Employment status dropdown: onboarding | active | inactive | terminated; calls `updateEntityEmploymentStatus`.

---

## 2. Step-level status model

- **Display status** (unchanged): `status` remains `not_started` | `in_progress` | `complete` | `blocked` for pipeline progress and UI.
- **Operational workflow** (new): `workflowStatus` on each step:
  - `not_started` | `pending_package` | `package_selected` | `ordered` | `awaiting_worker` | `scheduled` | `in_progress` | `complete` | `blocked` | `skipped` | `failed` | `canceled`
- **Supporting fields**: `orderedAt`, `skippedAt`, `completedAt`, `failureReason`, `note`; `selectedPackageId` / `selectedPackageLabel` (existing).
- **Mapping**: When admin sets `workflowStatus` via `updateWorkerOnboardingStepWorkflow`, backend sets `status = workflowStatusToStepStatus(workflowStatus)` (e.g. complete → complete, skipped/blocked/failed/canceled → blocked, ordered/…/in_progress → in_progress).
- Package selection sets `workflowStatus: "package_selected"` and `status: "in_progress"` so package is clearly reflected in step state and survives refresh.

---

## 3. Payroll/legal milestones

- **Representation**: Sub-items as **milestones** on the pipeline step:
  - **i9**: I-9 sent, I-9 completed.
  - **onboarding_forms**: Handbook/manual sent, Handbook/manual signed, Tax forms, Contractor agreement sent/signed, Payroll setup, Direct deposit, Emergency contact.
  - **everee**: Payroll invite sent, Payroll setup complete.
- **Storage**: `steps[].milestones` = `Array<{ id, label, completed, completedAt?, completedBy? }>`.
- **Seeding**: When a new pipeline is created, steps that have entries in `STEP_MILESTONES` get a `milestones` array with `completed: false`.
- **Admin UI**: On `/jobs/onboarding`, steps with milestones show an expandable “Milestones (x/y)” row; toggling a checkbox calls `updateWorkerOnboardingStepMilestone` and persists immediately.

---

## 4. Changes on /jobs/onboarding

- **Card header**: Entity name, entity key, user name, user id; employment status chip (from `entity_employments`), worker type chip, progress chip (e.g. “3 / 6 steps”), assignment-linked chip.
- **Per-step block**: Step title; applicability + status/workflowStatus chips; **selected package label** (e.g. “Dummy Background 1”) when set; package dropdown (Select package / Dummy Background 1 / 2, Dummy Drug 1 / 2); workflow action buttons (Mark ordered, Mark complete, In progress, Skip, Block, Fail); “Cycle status” for legacy status toggle.
- **Note/reason**: Choosing Skip, Block, or Fail opens a dialog to enter note/failure reason; submit calls `updateWorkerOnboardingStepWorkflow` with `note` and/or `failureReason`.
- **Milestones**: Expandable section per step (i9, onboarding_forms, everee) with checkboxes; each toggle calls `updateWorkerOnboardingStepMilestone`.
- **Entity filter**: Dropdown (All / workforce / select / events) still filters the list by `entityKey`.

---

## 5. Entity employment status transitions

- **Statuses**: `onboarding` | `active` | `inactive` | `terminated`.
- **Callable**: `updateEntityEmploymentStatus(tenantId, employmentId, status, terminationReason?)`.
- **Rules**:
  - New employment created as `onboarding` when pipeline is triggered (unchanged).
  - Admin can set **active**: backend sets `hiredAt`, `onboardingCompletedAt`, `active: true`.
  - Admin can set **terminated** or **inactive**: backend sets `terminatedAt`; optional `terminationReason` stored.
- **UI**: User Profile → Employment tab shows status dropdown per record; changing it calls the callable. Timestamps (onboarding started/completed, hired, terminated) displayed when present.

---

## 6. Still missing before calling admin Phase 1 “done”

- **Automatic employment → active**: No automatic transition from `onboarding` to `active` when pipeline status becomes “complete”; admin must set it. Optional follow-up: trigger or rule to suggest or set active when pipeline is complete.
- **Termination reason in UI**: Employment tab does not prompt for `terminationReason` when status is set to terminated; backend accepts it but UI only passes `null`. Optional: add a small dialog or field for reason when selecting “terminated”.
- **E-Verify / background / drug status on employment**: `everifyStatus` is synced from E-Verify; `backgroundStatus` / `drugScreenStatus` are not yet updated from pipeline step workflow (could be synced when step is marked complete/failed).
- **Index for entity_employments**: Query by `userId` is a single-field equality query; no composite index required. If you later query by status or entityKey, add indexes as needed.
- **Worker-facing employment UI**: Out of scope for Phase 1A; worker app still does not show entity employment list or status.
