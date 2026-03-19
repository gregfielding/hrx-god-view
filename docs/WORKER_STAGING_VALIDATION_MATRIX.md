# Worker Staging Validation Matrix (Launch Hardening Pass)

## Scope

This pass is a **code-level + build-level validation** pass in cleanup mode.  
Runtime staging execution is still required for final sign-off on delivery channels and data-state transitions.

Execution runbook:
- `docs/WORKER_STAGING_VALIDATION_RUNBOOK.md`

## Summary

| Scenario | Status | Confidence | Notes |
|---|---|---|---|
| A. Career happy path | Partial | Medium | Route/state coverage present; requires runtime confirm for end-to-end staffing transitions. |
| B. Gig happy path | Partial | Medium | Day-scoped ID logic exists; requires runtime confirm on multi-day edge cases. |
| C. Offer accept/decline | Partial | Medium | Accept/decline URLs and routes validated in code; SMS sequencing still needs live verification. |
| D. Cancel after confirm | Partial | Medium | Reminder/assignment trigger paths exist; requires runtime confirm of suppression/cancel behavior. |
| E. Reminder send visibility | Partial | Medium | Reminder docs/logging paths implemented; requires staging check of scheduled dispatch records. |
| F. Assignment detail correctness | Partial | Medium-High | Source/precedence logic present; needs live sample verification with real assignment docs. |
| G. Web fallback deep links | Pass (code/build) | High | Critical routes resolve and build passes; runtime click-test in staging still recommended. |

## Scenario Detail

### A) Career happy path
- **Expected admin state:** application -> offer/proposed -> confirmed assignment.
- **Expected worker web state:** applications and assignments screens reflect current status.
- **Expected backend state:** assignment document transitions and related notifications/reminders.
- **Expected notifications:** offer/confirmation/reminder messages routed with canonical URLs.
- **Reviewed paths:** `functions/src/placementsApi.ts`, `src/pages/UserApplications.tsx`, `src/pages/AssignmentDetails.tsx`.
- **Status:** Partial (requires runtime execution in staging).

### B) Gig happy path
- **Expected admin state:** worker appears only on selected day/shift where applicable.
- **Expected worker web state:** gig assignment details show worker-specific schedule/day only.
- **Expected backend state:** day-scoped assignment identity and mapping consistency.
- **Expected notifications:** day-specific links route correctly.
- **Reviewed paths:** `functions/src/placementsApi.ts`, `src/pages/AssignmentDetails.tsx`.
- **Status:** Partial (runtime day-scoped validation still required).

### C) Offer / accept / decline
- **Expected admin state:** proposed -> confirmed/declined consistent across surfaces.
- **Expected worker web state:** accept/decline flow and resulting destination behavior are coherent.
- **Expected backend state:** assignment/application updates and message triggers fire once.
- **Expected notifications:** no contradictory waitlist/confirm collisions.
- **Reviewed paths:** `functions/src/placementsApi.ts`, `functions/src/utils/templateVariableResolver.ts`, `functions/src/messaging/messageAutomationRulesApi.ts`.
- **Status:** Partial (runtime messaging verification required).

### D) Cancel after confirm
- **Expected admin state:** cancelled reflected consistently.
- **Expected worker web state:** assignment detail/list reflects cancellation.
- **Expected backend state:** pending reminders cancelled/suppressed.
- **Expected notifications:** no post-cancel reminder delivery.
- **Reviewed paths:** `functions/src/workerShiftRemindersV2.ts`, `functions/src/workerShiftReminders.ts`.
- **Status:** Partial (needs staging runtime proof).

### E) Reminder send visibility
- **Expected admin/backend state:** reminder docs show pending/processing/sent/cancelled/failed with metadata.
- **Expected worker-visible behavior:** SMS/push linked to assignment details.
- **Reviewed paths:** `functions/src/workerShiftRemindersV2.ts`, reminder QA docs already added.
- **Status:** Partial (requires observing actual scheduled docs + logs in staging).

### F) Assignment detail correctness
- **Expected worker state:** worker-specific schedule only, recruiter contact visible, resolved instructions/uniform/requirements.
- **Reviewed paths:** `src/pages/AssignmentDetails.tsx` (staff-instruction precedence and source resolution logic).
- **Status:** Partial (requires sampling real gig + career assignments in staging).

### G) Web fallback deep links
- **Expected behavior:** if app is not installed, links open valid web routes with no 404.
- **Validated routes:**  
  - `/c1/workers/assignments/:assignmentId`  
  - `/c1/workers/applications/:applicationId`  
  - `/c1/jobs/:postId`
- **Cleanup in this pass:** worker documents route now redirects to profile (`/c1/workers/documents` -> `/c1/workers/profile`).
- **Reviewed paths:** `src/App.tsx`, `src/pages/UserApplications.tsx`.
- **Status:** Pass (code/build). Runtime click test still recommended.

## Cleanup Changes Applied In This Pass

1. Worker documents deep-link dead-end removed:
   - `src/App.tsx`
   - `/c1/workers/documents` now redirects to `/c1/workers/profile`.
2. Dashboard status-card legacy documents target normalized:
   - `src/components/worker/dashboard/WorkerDashboardStatusCards.tsx`
   - card target changed to `/c1/workers/profile`.
3. Canonical helper usage tightened in messaging test/sample generation:
   - `functions/src/messaging/messageAutomationRulesApi.ts`
   - now uses `buildWorkerAssignmentResponseUrl` / `buildWorkerAssignmentUrl`.

## Manual Staging Checks Required Before Launch Lock

1. Run all seven scenarios with a known test worker and capture pass/fail.
2. Confirm no Inbox entry points remain in worker UX paths.
3. Confirm reminder docs transition through expected statuses on real confirmed assignments.
4. Click-test deep links from SMS on mobile devices (installed/uninstalled app behavior).
