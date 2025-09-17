# Phase 1.5 — UI Sync with New Firestore Structure
**Objective:** Point the **web/admin UI** at the Phase‑1 collections you’ve implemented and retire reads from legacy paths. This is the “close the loop” step before Phase 2.

> Canonical tenant branch
```
tenants/{tenantId}
  crm_companies/{accountId}
    locations/{locationId}
    crm_contacts/{contactId}
    crm_deals/{dealId}
  jobOrders/{jobOrderId}
  jobBoardPosts/{postId}
  applications/{applicationId}
  userGroups/{groupId}
  counters/jobOrderNumber
```
All new writes/reads must use these paths.

---

## A) Global Guardrail (Don’t regress)
### A1. Feature flag
- `appConfig.flags.NEW_DATA_MODEL = true` (default in dev/staging).
- Gate legacy list pages behind `!NEW_DATA_MODEL` (read-only if needed).

### A2. Read/Write wrappers
Create `src/data/firestorePaths.ts`:
```ts
export const p = {
  tenant: (tid:string) => `tenants/${tid}`,
  accounts: (tid:string) => `tenants/${tid}/crm_companies`,
  account: (tid:string,id:string) => `tenants/${tid}/crm_companies/${id}`,
  accountLocations: (tid:string,accId:string) => `tenants/${tid}/crm_companies/${accId}/locations`,
  deals: (tid:string,accId:string) => `tenants/${tid}/crm_companies/${accId}/crm_deals`,
  jobOrders: (tid:string) => `tenants/${tid}/jobOrders`,
  jobOrder: (tid:string,id:string) => `tenants/${tid}/jobOrders/${id}`,
  applications: (tid:string) => `tenants/${tid}/applications`,
  userGroups: (tid:string) => `tenants/${tid}/userGroups`,
  counters: (tid:string) => `tenants/${tid}/counters`,
  jobOrderCounter: (tid:string) => `tenants/${tid}/counters/jobOrderNumber`,
};
```
**Lint rule:** ban raw string paths to Firestore—import these helpers instead.

---

## B) Draft Job Order → Single Form (Deal Details)
### B1. Replace the accordion with a single clean form
- Component: `DealDraftJobOrderForm.tsx`
- Sections (in this order):
  1) **Account & Location** (account auto-filled; location picker reading `accountLocations`)
  2) **Basics**: `name`, `description`, `status` preset to `open`
  3) **Headcount & Dates**: `workersNeeded`, `dateOpened` (default `now`), `startDate`, `endDate`
  4) **Pay/Bill & WC**: `payRate`, `billRate`, `wcCode`, `wcRate`
  5) **Posting**: `boardVisibility: hidden|all|groups`, `groupIds[]`, `showPayRateOnBoard`, `showShiftTimes`
  6) **Requirements**: `licenses[]`, `drugScreen{required,panel}`, `backgroundCheck{required,package}`, `skills[]`, `experience`, `languages[]`, `education`, `physicalRequirements[]`, `ppe[]`, `training[]`
  7) **Operations**: `timesheetMethod`, `checkInInstructions`, `checkInContactId`
  8) **Owners**: `recruiterIds[]`

> Persist form state on the **Deal** as `draftJobOrder` (so sales can exit and come back).

### B2. “Generate Job Order” action
- Server call flow:
  1. `reserveNextJobOrderNumber(tenantId)`
  2. Build payload from `draftJobOrder` + denorm refs (`tenantId`, `accountId`, `locationId`)
  3. Create doc at `p.jobOrders(tid)`
  4. Write back to Deal: `jobOrderId`, and **do not** auto-set `won` unless configured

**UI feedback:**
- Toast on success: “Job Order JO‑#### created”
- Link to the new JO detail page

**Smoke tests:**
- Missing required fields → inline errors
- Created JO has `tenantId` and `jobOrderNumber`

---

## C) Recruiter → Job Orders UI
### C1. List
- Query: `where('tenantId','==',tid)` + optional `status` filter; orderBy `dateOpened desc`
- Columns: **JO #**, **Title**, **Account**, **Location**, **Status**, **Requested/Filled**, **Recruiter(s)**, **Opened**
- Row actions: **Open**, **Quick Change Status**, **Copy link**

### C2. Detail
- Tabs: **Overview** | **Applications** | **Assignments** | **Activity**
- Overview shows all fields read-only with inline edit for common fields (status, headcount, dates, board visibility).

---

## D) Applications UI (tenant-level authoritative)
### D1. Create Application
- Sources:
  - From a **Job Board Post** → app has `postId` and (optionally) `jobOrderId`
  - From **sourcing** → app has no `postId`, may have `jobOrderId`
- Path: `p.applications(tid)`
- Required: `tenantId`, `status='new'`, `submittedAt=now`

### D2. List/Filter
- List page filters by: `status`, `jobOrderId` (optional), `postId` (optional), `date`
- From JO detail → deep link filter `jobOrderId = currentJoId`

### D3. Stage changes
- Inline stage chips: `new → reviewed → interview → offered → hired | rejected`
- On move to **hired** → prompt to create **Assignment** (see E).

---

## E) Assignments UI (hire → employee on this JO)
### E1. Create Assignment
- Modal fields: `candidateId`, `startDate`, optional `endDate`, `jobTitle`
- Auto-fill: `accountId`, `locationId` from JO (denorm)
- Write to `tenants/{t}/assignments` (authoritative)

### E2. Show on JO detail
- Subsection showing active assignments for this JO: query `assignments` by `jobOrderId`

---

## F) Job Board Posts (optional in Phase 1.5, enabled for tests)
### F1. Create Post
- Form at `Recruiter → Job Board`: `title`, `description`, `visibility`, `groupIds[]`, optional `jobOrderId`
- Save to `tenants/{t}/jobBoardPosts`

### F2. Visible in Companion (future)
- Leave a TODO to hook visibility rules in Flutter later.

---

## G) User Groups (manual)
### G1. Groups List & Detail
- List groups at `p.userGroups(tid)`, create/edit `name`, `description`
- Detail: add/remove `candidateIds` via search modal

### G2. Gate visibility
- In JO/Post forms, when `visibility='groups'`, enforce at least one `groupId` selected

---

## H) Counters & Labels
- Show `jobOrderNumber` as **JO‑####** (padding from your counter config)
- Chip colors for **Status**; tooltips for “Opened x days ago (MM/DD/YYYY)”

---

## I) Auditing & Telemetry
- On every **write** to JO, Application, Assignment:
  - Log: `{actor, tenantId, path, before?, after}` to console + optional `monitoring/events` collection
- Warn if any write hits legacy paths (regex match and console.error)

---

## J) Routing & Access
- New routes (examples):  
  - `/recruiter/job-orders`  
  - `/recruiter/job-orders/:id`  
  - `/recruiter/applications`  
  - `/recruiter/groups`
- Guard routes by role (`recruiter` or `admin`) and tenant match

---

## K) Firestore Rules Delta (if you split roles)
Add a minimal role check under tenant scope:
```rules
function hasRole(tenantId, allowed) {
  return request.auth.token.tenantId == tenantId &&
         allowed.hasAny(request.auth.token.roles);
}
match /tenants/{tenantId}/{coll=**}/{doc} {
  allow read: if request.auth!=null && request.auth.token.tenantId==tenantId;
  allow write: if hasRole(tenantId, ['admin','recruiter']);
}
```
*(Adjust to your claims model.)*

---

## L) Indexes (UI queries)
- jobOrders: `(tenantId asc, status asc, dateOpened desc)`
- applications: `(tenantId asc, jobOrderId asc, status asc, submittedAt desc)`
- assignments: `(tenantId asc, jobOrderId asc, status asc, startDate desc)`

Deploy: `firebase deploy --only firestore:indexes`

---

## M) QA Script (manual test)
1. Create Deal → fill Draft Job Order → **Generate Job Order**  
2. Verify JO doc: correct path, `tenantId`, `jobOrderNumber`, `accountId`  
3. Create generic **Job Board Post** → submit Application (no `jobOrderId`)  
4. Create JO‑specific **Post** → submit Application (with `jobOrderId`)  
5. Move Application to **hired** → create **Assignment**  
6. JO detail shows assignment; Recruiter list shows JO with correct counts  
7. Toggle `boardVisibility` to `groups` and verify UI enforces `groupIds`

---

## N) Anti‑Regression Checklist
- [ ] No component imports raw Firestore strings (must use `firestorePaths.ts`)  
- [ ] No new writes to legacy `recruiter_*` or top‑level `jobOrders`  
- [ ] All new docs include `tenantId`  
- [ ] Lists/filters don’t trigger “index required” errors  
- [ ] Rules block cross‑tenant reads/writes

---

**Done with Phase 1.5** → you’re ready for **Phase 2 (Recruiter power features, compliance, automation)**.
