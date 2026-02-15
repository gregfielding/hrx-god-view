# Career vs. Gig: Applications, Placements, and Assignments

This document captures the intended model for **Career** vs. **Gig** positions and how placements and assignments should be built with that context. Use it when changing apply flows, PlacementsTab, assignments API, or messaging.

---

## Mental model

| | **Career** | **Gig** |
|---|------------|--------|
| **What the applicant is applying to** | The **job** (position/role). There may be multiple shifts (e.g. Mon–Fri, different locations), but the application is to the job. | **Specific shift(s)**. Each shift is a distinct thing to apply to (e.g. “Oct 19 shift”, “Oct 20 shift”). |
| **Placement** | Placing a worker on the job; shift selection is about *which* schedule/location. | Placing a worker on **one specific shift**. Each shift is a separate placement opportunity. |
| **Assignment** | One assignment can represent “hired for this job” (possibly with a primary or first shift). | One assignment **per shift**. Assigning to Shift A and Shift B = two assignments (A and B). |

---

## What we already do (and should keep)

### Backend (placementsApi, Firestore)

- **Placements** are keyed and stored **per shift**: `placementId = shiftId__userId`. So for both Career and Gig, “placed” is always “placed on this shift.”
- **Assignments** are created **per shift**: `assignmentId = shiftId__userId`. Creating an assignment requires `shiftId`; each (shift, user) pair has at most one assignment.
- **resolveApplicationForAssignment** links an assignment to an application by matching `userId`, `jobOrderId`, and either `shiftId` or `shiftIds` (array-contains). So when we assign someone to a shift, we find the application that targeted that shift (or those shifts) and link it.

This is the right data model for both Career and Gig: **placements and assignments are always shift-scoped.**

### PlacementsTab (recruiter UI)

- Recruiter **must select a shift** before seeing or managing placements/assignments. All “Assignments” and “Place” actions are in the context of that shift.
- Placements and assignments are queried by `shiftId`. So for Gigs (many shifts), the recruiter works shift-by-shift; for Career (often one or few shifts), same flow.

So **Career is already correct**: job-level application, placements/assignments built per shift with that context. **Gigs use the same shift-centric model**, which matches “applicants apply to each shift.”

---

## Extra consideration for Gigs

These are the areas where we should explicitly design and implement with the “Gig = apply to each shift” model in mind.

### 1. Apply flow (worker)

- **Career:** Applying to the job is enough; shift can be refined later or implied.
- **Gig:** The applicant should be applying to **specific shift(s)**. We should:
  - **Require** that for Gig postings, the worker selects at least one shift (or explicit “I’m applying to this shift”) before submit. If the UI shows “Available Shifts” with “Apply” per shift, ensure that selection is persisted and sent (e.g. `selectedShifts` / `shiftIds`) and that we don’t allow submit without at least one shift for Gigs.
  - Persist `shiftId` / `shiftIds` (and optionally `shiftAssignments` or per-shift status) on the application so that when we create an assignment for a given shift, we can match and update the right application (we already do this in `resolveApplicationForAssignment`).

### 2. Application document shape

- **Current:** One application doc per (user, job posting): e.g. `userId_jobId`. For Gigs, we store `shiftId` or `shiftIds` (and sometimes `shiftAssignments`) on that doc.
- **Acceptable:** One doc with `shiftIds` is enough as long as:
  - We never create an assignment for a shift the user didn’t apply to (we only assign when we found an application that has that `shiftId` or `shiftIds` containing it).
  - Recruiter-facing and worker-facing UIs can show “Applied to Shift A, B” and “Accepted for Shift A” etc. (per-shift status can be derived from assignments linked to that application).
- **Optional future:** For very clear per-shift lifecycle, we could introduce a separate “application per (user, job, shift)” for Gigs; that would be a larger change and is not required if the above is enforced and displayed correctly.

### 3. Creating placements/assignments for Gigs

- **Placements:** Already correct. Placing = “place this worker on **this** shift.” Placement ID `shiftId__userId` enforces one placement per (shift, user).
- **Assignments:** Already correct. `placementsCreateAssignments` takes `shiftId` and creates one assignment per (shift, user). For Gigs, assigning the same worker to two shifts = two calls (or two entries in `userIds` for two different shift contexts in the UI) = two assignments.
- **Linking back to application:** When creating an assignment for a Gig shift, we must only link to an application that actually targeted that shift (`shiftId` or `shiftIds`). We already do this in `resolveApplicationForAssignment`. If no such application exists (e.g. manual assign without prior application), we can still create the assignment; optionally we could create a “manual” or system application record for that shift so the model stays consistent.

### 4. Messaging and copy

- **Career:** “Your assignment is confirmed”, “your new job”, “assignment details” are appropriate.
- **Gig:** Consider shift-specific wording where it helps: e.g. “Your **shift** on [date] at [location] is confirmed”, “View details for this **shift**”, so it’s clear they were accepted for a specific shift, not the whole job. Template variables (e.g. `shiftDate`, `shiftTime`, `assignmentUrl`) already support this; we can add or prefer copy that says “shift” when `jobOrderType === 'gig'`.

### 5. Recruiter UX for Gigs

- PlacementsTab already works per shift. For Gigs, the recruiter sees many shifts; they pick a shift and then see who’s placed/assigned for **that** shift. No change needed to the “placements and assignments are built with this context” idea—they already are.
- Optional: When viewing a worker who applied to multiple Gig shifts, showing “Applied to 3 shifts; assigned to 2” (or per-shift badges) can make the “apply per shift” / “assign per shift” model obvious.

---

## Summary

| Area | Career | Gig |
|------|--------|-----|
| Application | To the **job**; shift can be single or multiple. | To **specific shift(s)**; require at least one shift selected at apply. |
| Placement | Per shift (shiftId__userId). | Per shift (same). |
| Assignment | Per shift (shiftId__userId). | Per shift (same). |
| Backend | Already shift-centric; keep as is. | Same; ensure assignment only links to application that targeted that shift. |
| Messaging | Job/assignment wording. | Prefer “shift” wording where helpful. |

**Bottom line:** Career is already correct. For Gigs, the main “extra consideration” is: **(1) enforce and persist shift selection at apply time, (2) keep linking assignments to applications that targeted that shift, and (3) use shift-oriented copy in messaging when jobOrderType is gig.**
