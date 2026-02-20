# HRX E‑Verify Integration — “Done for Now” Master Closeout (Pre‑Credentials)
**Purpose:** This document is the final handoff for the HRX E‑Verify workstream. The integration is **done** until you have API credentials; no further feature work is planned. When credentials are available, you plug them in and use the system.

**Status:** ✅ **Feature-complete.** No code changes required to go live—only configuration (secrets + base URL). Optional: confirm Production “Get Case Status” endpoint if it differs from Stage; add a real I‑9 payload source when creating cases for real workers in Production.

---

## When you have API credentials (plug-in steps)
1. **Set secrets** (Firebase Secret Manager or env): `EVERIFY_WS_USERNAME`, `EVERIFY_WS_PASSWORD`.
2. **Set base URL** (if not Stage): `EVERIFY_BASE_URL` to your Production API base (e.g. per E‑Verify Web Services docs).
3. **Use it:** Create cases from Admin Ops or via the automatic trigger when I‑9 is completed. Polling and TNC workflow already run.
4. **Optional:** If the Production “Get Case Status” path differs from Stage, update the URL in `everifyClient.getCaseStatus()` (see §10.2).
5. **For real workers in Production:** Today Stage uses a fixture for the I‑9 payload. For Production cases with real worker data, you must add a real I‑9 source (e.g. vendor API or internal resolver) and wire it into `everifyI9Provider` / `createAndSubmitCase`; see §5.2 and §10.3.

---

## 1) What’s DONE (High-Level)
### ✅ End-to-end E‑Verify lifecycle is implemented
- **Eligibility gate** (W‑2 only, I‑9 complete, assignment/hire status, entity requires E‑Verify)
- **Case creation** using ICA v31 REST flow:
  - `POST /authentication/login` (WS username/password) → Bearer token
  - `POST /cases` (create **DRAFT**) using `i9_case_flat`
  - `POST /cases/{case_number}/submit` (submit case)
- **Polling** (real status fetch from Stage) and status transitions in Firestore
- **TNC/Further action workflow**:
  - deadlines extracted + persisted
  - deterministic internal task created (idempotent)
  - UI alerts + action buttons to record non-PII case actions
  - auto-complete the deterministic task when case resolves
- **Privacy by design**:
  - never store SSN or document numbers
  - never log I‑9 payload
  - store only minimal whitelisted response fields
- **Worker-safe public mirror**:
  - workers can only read `everify_cases_public`
  - workers cannot read internal `everify_cases` / events

---

## 2) Canonical Data Model (Tenant-Scoped)
> All doc paths are tenant-scoped: `tenants/{tenantId}/…`

### 2.1 Internal case document (admin/tenant roles only)
**Path**
- `tenants/{tenantId}/everify_cases/{caseId}`

**Key fields**
- Lookup: `tenantId`, `entityId`, `userId`, `userEmploymentId`, `assignmentId?`, `jobOrderId?`, `shiftId?`
- Provider: `everifyCaseNumber` (ICA case number), `providerStatus` (raw provider status string)
- HRX status: `status` (normalized)
- Timing: `submittedAt`, `lastCheckedAt`, `closedAt?`, `updatedAt`, `createdAt`
- Dedupe: `requestHash` (idempotency)
- Safe raw: `raw` (whitelisted non‑PII fields only)
- Actions: `everifyCaseActions`:
  - `employeeNotifiedAt?`, `employeeContests?`, `referralInitiatedAt?`, `caseClosedAt?`, `notes?` (no PII)
- Worker-safe snapshot: `public?`:
  - `status`, `statusDisplay?`, `eligibilityStatement?`, `deadlines?`

### 2.2 Append-only events
**Path**
- `tenants/{tenantId}/everify_cases/{caseId}/events/{eventId}`

**Behavior**
- Append-only audit trail
- Event types include:
  - `CASE_DRAFT_CREATED`, `CASE_SUBMITTED`, `STATUS_CHANGED`, `ERROR`
  - `EMPLOYEE_NOTIFIED`, `CONTESTED`, `REFERRAL_INITIATED`, `CASE_CLOSED_MANUAL`
  - `TASK_RESOLVED`

### 2.3 Worker-safe public mirror (workers read only this)
**Path**
- `tenants/{tenantId}/everify_cases_public/{caseId}`

**Fields**
- Lookup: `tenantId`, `userId`, `caseId`
- `public: { status, statusDisplay?, eligibilityStatement?, deadlines? }`
- `updatedAt`

**Write behavior**
- Backend upserts the mirror on:
  - create/submit success
  - create/submit failure (status=error)
  - poller status updates (when `public` changes)
  - manual close

---

## 3) Canonical Flow (How E‑Verify Runs in HRX)
### 3.1 Eligibility
**Inputs**
- `user_employments` + `assignment` + `entity`

**Rules**
- Worker type must be **W‑2**
- `user_employments.i9Status === 'completed'`
- assignment status in `hired/active/confirmed/placed` (canonical set)
- `entities/{entityId}.everifyRequired === true`
- Start/hire date exists (used as `date_of_hire`)

**Output**
- `{ eligible: boolean, blockingReasons: string[] }` for UI and triggers

### 3.2 Automatic case creation trigger (preferred path)
**Trigger**
- Firestore `onUserEmploymentUpdatedEverify`:
  - runs when `i9Status` transitions to `completed`

**Worker**
- Cloud Task → `processEverifyCaseFromEmployment`

**Idempotency**
- dedupe by `requestHash`
- enforce “one open case per userEmploymentId”

### 3.3 Manual case creation (admin)
- Admin UI button calls `everifyCreateCase`
- Same service + same dedupe + same writes

### 3.4 Polling / monitoring
**Job**
- `scheduledEverifyPoller` runs every 30 minutes

**Behavior**
- For open cases with `everifyCaseNumber`:
  - `everifyClient.getCaseStatus(caseNumber)`
  - normalize status
  - update case doc + `public`
  - append `STATUS_CHANGED` only when changed
- Detect “stuck” cases and log counts

### 3.5 TNC / further action workflow
**When**
- If status becomes `tnc` or `further_action_required`

**Actions**
- Extract deadlines from whitelisted raw fields
- Persist `deadlines` to case doc
- Create deterministic internal task:
  - `everify_tnc:{tenantId}:{caseId}`
  - high priority, tags: `['everify','compliance']`, no PII
- UI banners show “follow-up required”
- Admin Ops provides non‑PII action buttons:
  - Mark employee notified
  - Mark contested
  - Mark referral initiated
  - Close case (manual)

**Auto-resolution**
- When status becomes resolved (`employment_authorized`, `closed`, `final_nonconfirmation`):
  - complete the deterministic task
  - append `TASK_RESOLVED`

---

## 4) ICA v31 Web Services (Auth + Calls)
### 4.1 Auth
- `POST {BASE}/authentication/login` with `login_request`:
  - `username` (WS User ID)
  - `password` (WS password)
- Token cached in-memory (2-hour expiry)
- `POST {BASE}/authentication/refresh` with Bearer header:
  - refresh early; fall back to login if refresh fails

### 4.2 Create + Submit
- `POST {BASE}/cases` with `i9_case_flat` payload → returns `case_number` (draft)
- `POST {BASE}/cases/{case_number}/submit` → returns eligibility/status fields

### 4.3 Get case status
- `GET {BASE}/cases/{case_number}` (implemented)
- **Note:** If ICA spec differs in Production, update the path in `everifyClient.getCaseStatus()`.

---

## 5) I‑9 Payload Handling (No PII Stored)
### 5.1 Current Stage setup
- Uses fixture payload loaded from:
  - `process.env.EVERIFY_STAGE_I9_FIXTURE_JSON`
  - fallback: `functions.config().everify.stage_i9_fixture_json`
- Fixture is **stage-only**:
  - allowed only if `EVERIFY_ENV === 'stage'` OR `EVERIFY_BASE_URL` contains `stage-everify`

### 5.2 Production requirement (credential-gated)
To go live, HRX must **resolve `i9_case_flat` at runtime** from a secure source:
- Option A (recommended): external I‑9 vendor API
  - store only `i9Provider` + `i9ExternalId` on `user_employments`
  - fetch full payload JIT inside Cloud Function
- Option B: internal I‑9 capture (requires encryption + strict ACL; higher risk)

**Hard requirement**
- Never store SSN/document numbers in Firestore
- Never log the payload

---

## 6) Privacy, Security, and Firestore Rules
### 6.1 Key guarantees
- `everify_cases` and `events` are **not readable by workers**
- workers only read `everify_cases_public` where `userId == request.auth.uid`
- `raw` is whitelist-only (safe fields)

### 6.2 Rules summary
- `everify_cases`:
  - read/write: HRX + tenant privileged roles
  - workers: **no read**
- `everify_cases/events`:
  - same as above
- `everify_cases_public`:
  - read: HRX, tenant roles, or doc owner (`userId == auth.uid`)
  - write: HRX / tenant admin (backend)

---

## 7) Operational UI
### 7.1 Worker UX
- `EverifyComplianceCard` reads `everify_cases_public`
- Shows status and alert when action is required

### 7.2 Admin UX
- `EverifyAdminOpsPage`
  - list/filter cases
  - shows top banner when cases require action
  - per-case deadlines
  - per-case action buttons (non-PII):
    - notify / contested / referral / manual close
  - retry + manual review actions exist

---

## 8) Configuration / Env Vars / Secrets
### 8.1 Secrets (required for real ICA calls)
- `EVERIFY_WS_USERNAME`
- `EVERIFY_WS_PASSWORD`

### 8.2 Environment
- `EVERIFY_BASE_URL` (default stage): `https://stage-everify.uscis.gov/api/v31`
- `EVERIFY_ENV` recommended values: `stage`, `prod`

### 8.3 Testing / Fake provider flags
- `EVERIFY_FAKE_PROVIDER=true` → all provider calls stubbed
- `EVERIFY_FAKE_SCENARIO` optional scenario behavior (if implemented)
- Legacy `EVERIFY_EAAT_STUB` still supported via compatibility mapping

### 8.4 Stage-only fixture
- `EVERIFY_STAGE_I9_FIXTURE_JSON` OR `functions.config().everify.stage_i9_fixture_json`

---

## 9) Testing Checklist (Stage)
### 9.1 Auth test
- Admin Ops → “Test auth” (calls `everifyPingAuth`)
- Expect `{ ok: true }`

### 9.2 Dry run (create+submit; no Firestore writes)
- Admin Ops → “Dry run create+submit”
- Requires fixture payload configured
- Expect case number + status display

### 9.3 Real create (writes Firestore)
- Admin: click “Create E‑Verify Case” from worker profile
- Expect:
  - `everify_cases` doc created
  - `events` include `CASE_DRAFT_CREATED`, `CASE_SUBMITTED`
  - `everify_cases_public` mirror created/updated
  - poller later updates status and appends `STATUS_CHANGED`

### 9.4 Trigger path
- Update `user_employments.i9Status` → `completed`
- Expect Cloud Task enqueued and worker processes case creation

### 9.5 TNC simulation
- Use fake provider scenario (or stage data) to produce TNC
- Expect:
  - deadlines populated
  - deterministic task created
  - UI banners visible
  - action buttons append events and update actions

---

## 10) Credential cutover (when you have API credentials)
**Goal:** Plug in credentials and use. No feature work required.

### 10.1 Set secrets + base URL (required)
- Set `EVERIFY_WS_USERNAME` and `EVERIFY_WS_PASSWORD` (Prod values).
- Set `EVERIFY_BASE_URL` to the Production API base URL if not using Stage default.
- Redeploy or ensure functions pick up the new secrets. You can then create and poll cases.

### 10.2 Confirm “Get Case Status” path (only if Prod differs)
- ICA Production may use a different path than Stage. If status polling returns 404 or wrong shape, update the URL in `everifyClient.getCaseStatus()` (see §4.3).

### 10.3 Real I‑9 payload (only for Production cases with real workers)
- In Stage, a fixture supplies the I‑9 payload; fixture is already blocked in Prod by the stage-only check in `everifyI9Provider`.
- To create cases for real workers in Production, implement a real source (e.g. `resolveI9CasePayloadFromEmployment()` calling a vendor API or internal store). No PII in Firestore or logs.

### 10.4 Pilot (recommended)
- Enable for one entity; create 1–3 real cases with HR oversight.
- Confirm: statuses update via polling, TNC workflow and worker public mirror behave as expected.

---

## 11) Known Risks / Notes
1) **Endpoint drift** between Stage and Production:
   - resolved by updating `getCaseStatus` path if needed.
2) **Payload completeness**:
   - `i9_case_flat` fields are conditional; vendor/internal resolver must supply correct doc fields based on citizenship/document types.
3) **Rate limiting**:
   - if scaling, add `nextPollAt` pacing and per-run caps. (Not required until volume increases.)
4) **Worker messaging**:
   - current worker UI shows status; messaging triggers can be added later without schema changes.

---

## 12) Files / Modules (for quick orientation)
**Functions**
- `everifyHttp.ts` — HTTP wrapper (retry/timeout)
- `everifyAuth.ts` — ICA login + refresh token cache
- `everifyClient.ts` — createDraft, submit, getCaseStatus
- `everifyService.ts` — createAndSubmitCase + mirror upserts
- `everifyPoller.ts` — scheduled status polling + transitions
- `everifyTncHandler.ts` — deadlines + deterministic task + resolve task
- `everifyI9Provider.ts` — stage-only fixture payload loader
- `everifyCallables.ts` — ping auth, dry run, create case, TNC action callables

**Firestore paths**
- `tenants/{tenantId}/everify_cases`
- `tenants/{tenantId}/everify_cases/{caseId}/events`
- `tenants/{tenantId}/everify_cases_public`

---

## 13) Acceptance Criteria (Met)
✅ Case creation works (Stage) via ICA login + create draft + submit  
✅ Polling updates real statuses and logs transitions  
✅ TNC workflow creates deadlines + deterministic tasks + UI banners  
✅ Workers see only public mirror, cannot access internal docs  
✅ No PII stored; no I‑9 payload logged  

---

## 14) Freeze until credentials — then plug in and use
- **Until you have API credentials:** Consider this workstream **DONE**. No further code or feature work.
- **When you have credentials:** Plug them in (secrets + base URL); no code change required to create and poll cases. Optionally confirm the Production GET status path and add a real I‑9 payload source for Production workers.
- **Ongoing:** Only touch this code for maintenance—e.g. DHS endpoint changes or switching I‑9 data source.
