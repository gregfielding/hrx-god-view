# HRX Worker App — “Go Live in 60 Minutes” Cursor Instructions (v1)

**Goal:** Make the worker-facing C1 experience *truthful, non-placeholder, and shippable* within ~1 hour.  
**Scope:** Worker routes only (`/c1/workers/*`, `/c1/jobs-board`, worker job posting detail).  
**Explicitly out-of-scope for this hour:** Everee integration, FCM notifications, worker inbox messaging backend.

---

## 0) Ground rules for this sprint (do not violate)
1. **No fake data anywhere in worker UI.** If not wired, show an empty state (“Nothing yet”) and hide counts/metrics.
2. **Hide/Remove Everee references** (copy, provider labels, CTAs) until Everee is real.
3. **No “Coming soon” dialogs** on core worker pages (Dashboard, Job Readiness, Documents, Applications, Assignments, Jobs Board). Replace with either working behavior or “Not available yet” (no CTA).
4. **URLs must be correct and stable** (no broken routes, no placeholders like `/todo`).
5. **Worker scope only:** Do not change recruiter/admin flows except where shared utilities are imported (safe).

---

## 1) Route/URL double-checks (hard requirements)
Verify these routes exist and render:

### Worker main nav
- Dashboard → `/c1/workers/dashboard`
- My Assignments → `/c1/workers/assignments`
- Notifications → `/c1/workers/notifications` (ok to be empty state)
- Inbox → `/c1/workers/inbox` (ok to be empty state)
- Applications → `/c1/workers/applications`
- Jobs Board → `/c1/jobs-board`
- Job Readiness → `/c1/workers/profile` (label can remain “Job Readiness” in nav)
- My Documents → `/c1/workers/documents`
- Support → `/c1/workers/support` (or your existing support route — confirm)

### Deep links (must not 404)
- Assignment detail from list: `/c1/assignments/:assignmentId` (already referenced)
- Job posting detail from Jobs Board (whatever your app uses; confirm link target)
- Application detail (optional; if you don’t have it, don’t link to it)

**Action for Cursor:**  
Search for these strings and confirm they match actual router configuration:
- `"/c1/workers/dashboard"`
- `"/c1/workers/assignments"`
- `"/c1/workers/notifications"`
- `"/c1/workers/inbox"`
- `"/c1/workers/applications"`
- `"/c1/jobs-board"`
- `"/c1/workers/profile"`
- `"/c1/workers/documents"`
- `"/c1/workers/support"`
- `"/c1/assignments/"`

If any route is missing, either:
- create a minimal page with truthful empty state, or
- remove the nav item for now (prefer keeping it with an empty state).

---

## 2) Remove/hide Everee references (for now)
We *will* integrate Everee later. For this launch, **no Everee branding, no “Complete in Everee,” no “View in Everee,” no provider=everee chips**.

### Files likely involved
- `src/pages/c1/workers/documents.tsx`
- `src/components/worker/documents/DocRecordCard.tsx`
- `src/types/onboarding.ts`
- `src/utils/onboardingExpiration.ts`
- `src/utils/complianceSummary.ts`

### Required changes
1. **Rename copy that mentions Everee**
   - Remove any text like:
     - “Complete in Everee”
     - “View in Everee”
     - “Complete in Everee or upload here”
2. **Hide provider labels**
   - If `DocRecordCard` shows “Everee / HRX” provider badges, remove them or hide them.
3. **Disable Everee CTAs**
   - If checklist items have `viewUrl` pointing to Everee, do **not** render a “View” link.  
   - For v1, only render:
     - `Upload` / `Replace` for HRX-handled files
     - Or no CTA (read-only) for admin-ordered screenings
4. **Keep the data model fields** (fine to keep types with `provider`) — just don’t expose in UI.

**Outcome:** Worker docs/compliance looks like an HRX system, not “Everee soon.”

---

## 3) Kill all placeholder metrics & “—” values on worker surfaces
### A) Worker Dashboard
File: `src/pages/c1/workers/dashboard.tsx` (or wherever dashboard page is)

**Find and remove:**
- Any `useMock...` hooks feeding dashboard
- Any hard-coded “72%” readiness
- Any “—” placeholder counts

**Replace with:**
- **Hiring Score**: show only if `getUserScore(userDoc)` returns a number; else show “Not available yet”
- **Documents/Compliance**: show “Incomplete” if checklist exists and percent < 100; else “All set” if 100; else “Not started”
- **Applications**: show count from `users/{uid}.applicationIds.length` OR from `applicationData` keys (prefer `applicationIds`)
- **Messages/Updates**: change card label to “Support” or hide card entirely until messaging exists

**If any metric cannot be computed:**  
Hide the metric value and show subtext “Will appear after your profile updates.”

### B) Job Readiness page
File: `src/pages/c1/workers/profile.tsx`

- Ensure hero uses **Hiring Score** only (global score).
- If score missing: show neutral state (“Score pending”), not 0%.
- Prompts should only show when a field is missing (already implemented).
- Prompts must map to real accordion sections (already implemented).

### C) Documents page
File: `src/pages/c1/workers/documents.tsx`

- Remove mock checklist items that pretend Everee documents exist.
- If there is no real checklist in Firestore yet, show:
  - “Compliance checklist not available yet.”
  - “Your recruiter will request anything needed.”

**Do not show a “0% Compliance” chip unless checklist actually exists.**  
If checklist is empty/missing, hide the % and show “Not started”.

---

## 4) Documents UX (truthful v1 structure)
Worker Documents should have **three tabs**, but they must not lie:

### Tabs (v1)
1. **Compliance**  
   - Only show items you can truly track *right now* from Firestore user doc.
   - If checklist not implemented in Firestore yet: show empty state + explanation.

2. **Credentials**  
   - Resume upload (working) using existing upload flow
   - Certifications list + add/replace (working) using existing flow
   - Expiration UI only if you actually store `expiresAt` per certification record; otherwise hide expiration chips.

3. **Job Files**  
   - Real, read-only: show staff instructions attachments from job orders (already wired via hook).
   - If none: empty state.

### Important: Work Eligibility is NOT a document
- Remove it from documents upload requirements.
- It can appear in profile/application, not in Documents “Required uploads”.

---

## 5) Make uploads real (no placeholders)
Your existing upload paths (already built previously) must be used. Ensure worker docs page calls them.

### Resume upload
- Storage: `users/${uid}/resume/...` (or whatever your existing implementation is)
- Firestore: `users/{uid}.resume = { fileUrl, fileName, uploadedAt, ... }`

### Certifications upload
- Storage: `users/${uid}/certifications/${certSlug}/${Date.now()}-${file.name}`
- Firestore: `users/{uid}.certifications[]` array with `name, fileUrl, fileName, uploadedAt, (optional expiresAt)`

**Cursor action:**  
In worker documents components, replace any “Coming soon” click handler with calls to the already-built upload helpers/components. If those helpers live in:
- `LicensesAndCertsTab.tsx`
- `RequirementsAcknowledgementStep.tsx`
extract a shared helper like `uploadWorkerCertification()` and reuse it in worker page.

**Acceptance:** Resume and Certs can be uploaded from worker UI with no dialogs.

---

## 6) Notifications + Inbox pages (ship empty but clean)
### Notifications page
Route: `/c1/workers/notifications`

- Keep tabs/pills if you want, but show:
  - “No notifications yet.”
  - “We’ll notify you about applications, documents, and shifts here.”

### Inbox page
Route: `/c1/workers/inbox`

- Empty state only:
  - “No conversations yet.”
  - “If you need help, contact Support.”

**Do not show mock conversations.**  
**Do not show send box** if backend not built.

---

## 7) Jobs Board: ensure Apply flows are correct and Job Score writes happen
Route: `/c1/jobs-board`

- Clicking **Apply Now** should lead to:
  - quick apply OR wizard
- Confirm wizard writes `applications/{appId}.jobScoreSummary` when job has requirementPackId (already implemented).
- If a job has a requirement pack but application creation path doesn’t compute jobScoreSummary, fix it now.

**Acceptance:** Apply works end-to-end for at least 1 job post.

---

## 8) Final QA checklist (15 minutes)
Do these manual checks locally:

### Auth
- Log in as a worker user
- Confirm no console errors on any worker page

### Dashboard
- Hiring Score doesn’t show fake values
- Docs/Compliance doesn’t show 0% unless checklist exists
- Applications count is real

### Job Readiness
- Prompts jump-scroll to correct accordion
- No “Coming soon”

### Documents
- Compliance: either real checklist or clean empty state
- Credentials: resume upload works, cert upload works
- Job Files: real files show if present, else empty state

### Applications
- List renders and statuses show
- No broken links

### Assignments
- Page loads and view details link doesn’t 404 (or hide link if detail route not ready)

### Notifications + Inbox
- Clean empty states, no fake content

---

## 9) Ship checklist (last 5 minutes)
- Run: `npm run lint` and `npm run build`
- Fix any remaining “no-var-requires” / TS overload / unused imports
- Deploy (whatever your normal pipeline is)

---

## Notes for Cursor (important)
- Prefer **hiding UI** over showing placeholder numbers.
- Keep types and utilities for Everee in codebase if already merged, but **do not show the brand or CTAs** in worker UI.
- Any “0%” or “—” visible in screenshots should be removed or replaced with “Not available yet” + hidden progress bars.

---

## Deliverables
When you finish, reply with:
1. The list of files changed
2. Confirmation that each worker route above renders without mocks
3. A short summary of any remaining known gaps (1–3 bullets max)
