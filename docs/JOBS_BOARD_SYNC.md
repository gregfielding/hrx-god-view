# Jobs Board — Posting and Shift Sync

## Problem

Job postings are stored as snapshot documents in `tenants/{tenantId}/job_postings`. When you change the **job order** in the admin (e.g. extend end date, add or edit shifts), those changes were not reflected on the public jobs board because the board was reading only the stored posting document.

## Fix (implemented)

### 1. Read-time enrichment (Public Jobs Board)

When the public jobs board loads, for each **post that has a linked job order** (`jobOrderId`):

- The app fetches the **current job order** and uses its **startDate** and **endDate** for the listing.
- So the card always shows the current date range (e.g. extended to 3/21) without any manual sync.

**Code:** `PublicJobsBoard.tsx` — in both the single-tenant and multi-tenant load paths, we fetch the job order when `post.jobOrderId` exists and set `startDate` / `endDate` from the job order on the converted post.

### 2. Shifts on the detail page

The **job detail page** (when a candidate clicks a job) already loads **shifts dynamically** from the job order’s `shifts` subcollection via `JobsBoardService.fetchActiveShiftsForJobOrder`. So new or updated shifts (e.g. a new Wednesday 3/18 shift) appear as soon as the detail page loads — no sync needed.

### 3. Syncing stored postings when shifts change (admin)

When an admin **adds, edits, or deletes a shift** in the Shift Setup tab, we now call:

- `JobsBoardService.syncJobOrderToLinkedPostings(tenantId, jobOrderId)`

This updates all linked job postings with:

- Current **startDate** and **endDate** from the job order
- Current **shifts** (via existing `syncShiftsToPosting`)

So the stored posting documents stay in sync for other readers (e.g. admin post list) and for consistency.

**Code:** `ShiftSetupTab.tsx` — after successful shift create/update/delete we call `syncJobOrderToLinkedPostings`.

### 4. Service method

- **`syncJobOrderToLinkedPostings(tenantId, jobOrderId)`**  
  Fetches the job order, finds all postings linked to that job order, and updates each with current dates and (for gig jobs) current shifts. Safe to call after any job order or shift change; non-fatal on error because the public board enriches at read time.

## Summary

| Change type              | Where it’s reflected |
|--------------------------|----------------------|
| Job order end date (e.g. 3/21) | Public board list (read-time enrichment) |
| New shift (e.g. 3/18)    | Detail page (dynamic shifts) + stored posting (after sync in Shift Setup) |
| Edit/delete shift        | Stored posting updated by sync in Shift Setup; detail page always reads live shifts |

## Suggested admin UI improvements

1. **Shift Setup tab**  
   - Short note: “Changes to shifts (and job order dates) are synced to the jobs board. Candidates will see updated dates and shifts when they view the listing.”

2. **Job order dates (start/end)**  
   - If the job order’s start/end date is edited elsewhere (e.g. Overview or a deal form), the **public board already shows current dates** on next load. Optionally add a “Refresh jobs board preview” or a note: “Date range shown on the jobs board is taken from this job order.”

3. **“Sync to jobs board” (optional)**  
   - For peace of mind, add a button that calls `syncJobOrderToLinkedPostings` so admins can manually trigger a sync after editing the job order (e.g. after changing dates in another tab). Not required for correctness because of read-time enrichment.

4. **Clarify “posting” vs “job order”**  
   - In admin copy, clarify that “posting” is the jobs board listing and it stays in sync with the job order’s dates and shifts so candidates always see current information.
