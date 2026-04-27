# HRX E‑Verify (Stage → Prod) Master Plan (v1)
*Scope: design + implementation plan for HRX One’s E‑Verify integration aligned to your Entity → Requirement Package → Onboarding system. This doc assumes tenant‑scoped Firestore and Cloud Functions.*

---

## 0) Goals & non‑goals

### Goals
- Build a **compliance‑safe** E‑Verify integration that:
  - Triggers only when legally allowed (post‑hire, I‑9 completed, within required window).
  - Stores only **low‑risk** E‑Verify artifacts (case number, status, timestamps, audit events).
  - Fits HRX’s **Entity** model (C1 Events 1099, C1 Workforce W‑2 no E‑Verify, C1 Select W‑2 + E‑Verify).
- Provide:
  1. Full compliance pipeline (I‑9 → E‑Verify → notices → closure)
  2. Cursor‑ready build spec for backend module
  3. UI mapping (admin + worker where applicable)
  4. Multi‑state operational notes + compliance guardrails
- Ensure **critical lookup fields** exist on every Firestore doc for fast queries and audit.

### Non‑goals (for now)
- Storing I‑9 images, documents, SSNs, A‑Numbers in HRX.
- Implementing final production go‑live steps (EAAT completion + production credentials) beyond scaffolding.
- Implementing payroll onboarding (Everee) or background checks in this doc (but we design extension points).

---

## 1) Canonical compliance pipeline (end‑to‑end)

### 1.1 Definitions (HRX terms)
- **Entity**: Employer of Record (EOR) configuration (W‑2 vs 1099, E‑Verify required, FEIN, state accounts).
- **Requirement Package**: A named bundle of onboarding requirements (docs + checks + tasks).
- **Job Order / Shift**: Defines Entity + Requirement Package + any checks/screens.
- **Assignment**: The worker placement. Inherits entityId + requirementPackageId snapshot into onboarding.
- **Onboarding Instance**: Resolved requirements for a worker for a specific assignment/employment context.
- **User Employment**: Worker’s relationship to an Entity (a worker can have multiple employments across entities).

### 1.2 High‑level pipeline
1) **Assignment created** (or worker hired)  
2) **Onboarding Instance resolved** from (Job Order → Assignment → Entity + Requirement Package)  
3) Worker completes onboarding steps (docs, forms)  
4) **I‑9 completed** (in external provider or HRX form workflow)  
5) **E‑Verify eligibility check** (W‑2 only, entity everifyRequired, within timing window)  
6) **Create E‑Verify case** (Stage/Prod Web Services via Cloud Function adapter)  
7) **Monitor case** (polling + scheduled checks)  
8) Handle outcomes:
   - Employment Authorized → close case + mark requirement satisfied
   - Tentative Nonconfirmation (TNC) → generate/serve notices + tasks
   - Final Nonconfirmation / DHS Verification in Process / etc. → process per rules, tasks, alerts
9) **Close & archive**: append‑only events + final status snapshot

### 1.3 Trigger rules (must be enforced server‑side)
**E‑Verify case creation is allowed ONLY when:**
- Worker is **W‑2** for this employment/entity (not 1099).
- Worker is in a **hired/placed** state (Assignment status indicates hired/active or “confirmed”).
- I‑9 is marked **Completed** (I‑9 Section 1 and Section 2 complete).
- A start date exists.
- **Entity.everifyRequired = true** (or job/order/assignment overrides require it).
- Within compliance window (commonly “within 3 business days of start date” — implement as a configurable window on entity/policy).

### 1.4 TNC workflow (operational design)
When a case returns **Tentative Nonconfirmation**:
- HRX creates:
  - an **onboarding requirement** “Resolve TNC”
  - internal tasks for recruiter/HR
  - worker notification + instruction message (templated)
- HRX stores:
  - case status changes
  - deadlines (referral date confirmation due)
  - which notice documents were generated/acknowledged
- HRX does **not** store sensitive identity details; it stores:
  - case number
  - outcome status
  - timestamps
  - “notice packet” references (PDF generated/stored)

### 1.5 Storage boundaries (privacy & risk)
**Do not store in HRX (ever):**
- SSN
- images of identity documents
- A‑Number / passport number, etc.
- I‑9 document copies (unless you explicitly decide and harden security; recommended: store in external I‑9 provider)

**Allowed to store:**
- E‑Verify case number
- case status
- timestamps (created, last checked, closed)
- limited metadata: employer/company ids, hiring site id, entity id
- audit events (append‑only)

---

## 2) Firestore data model (tenant‑scoped) + required lookup fields

> All collections are under: `tenants/{tenantId}/…`

### 2.1 Global doc field conventions (required on ALL docs)
Add these to every new doc type, even if redundant:
- `tenantId` (string)
- `entityId` (string | null)
- `userId` (string | null) — Firebase Auth UID
- `jobOrderId` (string | null)
- `shiftId` (string | null)
- `assignmentId` (string | null)
- `userEmploymentId` (string | null)
- `onboardingInstanceId` (string | null)
- `createdAt`, `updatedAt` (server timestamps)
- Optional search helpers:
  - `searchKeywords` (array) for admin lookup
  - `status` (string enum)
  - `active` (bool)

### 2.2 Collections (core)
- `entities/{entityId}`
- `requirement_packages/{packageId}`
- `onboarding_library_items/{itemId}` (or `onboarding_items`)
- `onboarding_instances/{instanceId}`
- `user_employments/{employmentId}`
- `signature_envelopes/{envelopeId}` (Phase 1C for e‑sign)
- `everify_cases/{caseId}` (this doc)

### 2.3 `entities/{entityId}` (extend Phase 1B/1C)
Recommended fields:
- `tenantId`
- `name`, `legalName`
- `entityCode` (payroll export)
- `workerType`: `'W2'|'1099'|'BOTH'`
- `everifyRequired`: boolean
- **Tax & compliance master data**
  - `federalEin` (store masked or last4 if you want; consider encryption if storing full)
  - `mailingAddress` (object)
  - `operatingStates`: string[] (e.g., ['NV','TX','AZ','CA'])
  - `stateRegistrations`: map by state with:
    - `sosEntityNumber`
    - `employmentDeptAccountNumber`
    - `sutaAccountNumber`
    - `withholdingAccountNumber`
    - `notes`
    - `documents` (refs to stored PDFs)
- **Accounting**
  - `defaultGlCode` / `defaultCostCenter`
  - `glMappings` (optional map; see Section 6)
- **Workers comp (baseline)**
  - `wcPolicy` (carrier, policyNumber, effective dates — non-sensitive)
  - `wcCodesRepoRef` (optional pointer if you build central WC code/rate library)
- `defaultRequirementPackageId`
- `supportEmail`
- `active`

### 2.4 `user_employments/{employmentId}`
Represents a worker’s employment relationship to an Entity (can be multiple per user).
Fields:
- required lookups: `tenantId`, `userId`, `entityId`
- `workerType`: `'W2'|'1099'` (resolved)
- `status`: `'draft'|'active'|'terminated'|'inactive'`
- `startDate`, `endDate`
- `currentAssignmentId` (optional)
- `i9Status`: `'not_started'|'in_progress'|'completed'|'expired'`
- `i9Provider`: `'internal'|'external'`
- `i9CompletedAt`
- `everifyStatus`: `'not_required'|'ready'|'submitted'|'pending'|'authorized'|'tnc'|'fcnc'|'closed'|'error'`
- `everifyCaseId` (latest/active)
- `everifySubmittedAt`
- `createdAt`, `updatedAt`

### 2.5 `everify_cases/{caseId}` (new)
Fields:
- required lookups:
  - `tenantId`, `entityId`, `userId`
  - `userEmploymentId`, `assignmentId`, `jobOrderId`, `shiftId`
- `environment`: `'stage'|'prod'`
- `everifyCompanyId` (stage/prod company id)
- `everifyCaseNumber` (when returned)
- `status` (normalized HRX status enum):
  - `'draft'|'ready'|'submitted'|'pending'|'employment_authorized'|'tnc'|'dhs_verification_in_process'|'further_action_required'|'final_nonconfirmation'|'closed'|'error'`
- `providerStatus` (raw provider status string)
- `submittedAt`, `lastCheckedAt`, `closedAt`
- `deadlines`:
  - `tncResponseDueAt` (if applicable)
  - `referralDueAt`
- `warnings`: string[] (non-fatal)
- `error`:
  - `code`, `message`, `raw` (sanitize)
- `requestHash` (string) — hash of key inputs to dedupe
- `raw` (object) — **redacted** raw response subset; do not store sensitive fields
- `createdAt`, `updatedAt`

Subcollections:
- `everify_cases/{caseId}/events/{eventId}` (append-only)
  - `tenantId`, `entityId`, `userId`, `userEmploymentId`, `assignmentId`
  - `type` (e.g., `CASE_SUBMITTED`, `STATUS_CHANGED`, `TNC_NOTICE_GENERATED`, `ERROR`)
  - `at` timestamp
  - `actor` (`system` or `adminUserId`)
  - `data` (redacted)

### 2.6 `onboarding_instances/{instanceId}` (E‑Verify requirement integration)
Add a requirement item like:
- `type: 'everify'`
- `required: true/false`
- `status: 'not_started'|'blocked'|'in_progress'|'completed'|'failed'`
- `blockingReasons`: string[]
- `links`:
  - `everifyCaseId`
  - `userEmploymentId`

---

## 3) Backend module spec (Cursor‑ready)

### 3.1 Module boundaries
Create a provider‑agnostic integration layer:

- `functions/src/integrations/everify/`
  - `everifyClient.ts` (HTTP/SOAP wrapper, auth, retries)
  - `everifyAdapter.ts` (maps HRX inputs → provider payloads; maps provider statuses → HRX enums)
  - `everifyService.ts` (createCase, getCase, closeCase, pollCase)
  - `everifyTriggers.ts` (Firestore triggers / callable functions)
  - `everifySchemas.ts` (zod schemas for responses; redaction helpers)
  - `everifyConfig.ts` (env config, endpoints: stage/prod)
  - `everifyRedaction.ts` (strip sensitive fields)
  - `everifyErrors.ts` (normalized error codes)

### 3.2 Configuration (Firebase Functions config / secrets)
- `EVERIFY_ENV`: `stage|prod`
- `EVERIFY_BASE_URL_STAGE`: `https://stage-everify.uscis.gov/api/v31`
- `EVERIFY_BASE_URL_PROD`: (set later)
- Credentials (store in Secret Manager):
  - `EVERIFY_WS_USER`
  - `EVERIFY_WS_PASSWORD`
- Optional:
  - `EVERIFY_TIMEOUT_MS`
  - `EVERIFY_MAX_RETRIES`

### 3.3 Public entry points (Cloud Functions)
**Callable**
1) `everifyCreateCase`
- Input:
  - `tenantId`, `entityId`, `userEmploymentId` (preferred) OR `assignmentId`
- Server resolves all needed lookups (never trust client for sensitive routing)
- Validates eligibility rules (Section 1.3)
- Creates `everify_cases` doc status `submitted`/`pending`
- Writes event(s)
- Returns normalized response

2) `everifyGetCaseStatus`
- Input: `tenantId`, `caseId`
- Returns normalized status + lastCheckedAt

**Firestore triggers**
3) `onUserEmploymentUpdated_everify`
- Trigger: update on `user_employments/{employmentId}`
- If transitions to `i9Status=completed` AND `everifyStatus` indicates required/ready:
  - enqueue a job to create case (Cloud Tasks)
- Dedupe by checking existing open case or requestHash

4) `scheduledEverifyPoller`
- Runs every X minutes (configurable)
- Queries open cases (`status in ['submitted','pending','tnc','dhs_verification_in_process','further_action_required']`)
- Polls provider
- Writes status changes + events
- Creates tasks/notifications when entering TNC or other action-needed states

### 3.4 Dedupe & idempotency
- Compute `requestHash` from:
  - tenantId, entityId, userEmploymentId, startDate, and any required identity token references
- If an open case exists with same requestHash → return existing case
- Never create more than one open case per `userEmploymentId` unless forced override

### 3.5 Redaction rules (must implement)
Before storing `raw`:
- remove any fields that could include:
  - SSN, document numbers, A‑Number, etc.
- store only:
  - case number, status, timestamps, error codes, and non-sensitive metadata

### 3.6 Permissions / rules (conceptual)
- Admin roles only can:
  - create case
  - view case details beyond status
- Worker may view:
  - high-level status (“In progress”, “Action required”) and next steps
  - their own generated notices if applicable

---

## 4) UI mapping (Admin + Worker)

### 4.1 Settings (Entities)
Add sections:
- **Compliance**
  - E‑Verify Required (toggle)
  - Operating States (multi-select)
  - State registrations (table + doc attachments)
  - Default hiring site (optional)
- **Accounting**
  - Default GL / Cost Center
  - Optional GL mapping matrix
- **Workers Comp**
  - Carrier/policy baseline
  - Link to WC code/rate library (future)

### 4.2 Onboarding Library
- Add item type: `E-Verify`
  - prerequisites: I‑9 complete, W‑2, entity everifyRequired
  - completion condition: case status authorized/closed
- Add notice templates (TNC packet placeholders)

### 4.3 Requirement Packages
- “W2 + E‑Verify” includes:
  - I‑9
  - E‑Verify
  - handbook acknowledgment
  - direct deposit (external Everee later)

### 4.4 Job Order UI
- Required fields:
  - `entityId`
  - `requirementPackageId`
  - optional: `everifyOverride` (rare)
- Display:
  - “This job uses C1 Select LLC (E‑Verify required)”

### 4.5 Assignment / Worker profile (Admin)
Add “Compliance” card:
- I‑9 status chip
- E‑Verify status chip (tooltip: last checked, case number admins only)
- CTA:
  - “Create E‑Verify Case” (eligible and no case)
  - “View notices” (if TNC)

### 4.6 TNC UI flow (Admin)
When TNC:
- Banner: “Action required: TNC”
- Checklist:
  - Generate notice packet (PDF)
  - Record employee informed date
  - Record employee decision
  - Referral Date Confirmation steps
- Tasks auto-created for HR/recruiter
- Timeline from `everify_cases/{caseId}/events`

### 4.7 Worker-facing (Companion / web)
Only show:
- status
- next steps
- links to notices and acknowledgement buttons (no sensitive identity fields)

---

## 5) Multi‑state compliance notes (operational reality)

### 5.1 Requirements vary
Driven by:
- entity policy (C1 Select always)
- worksite state or client contract
Model via:
- entity defaults + jobOrder/requirement package selection

### 5.2 Central repository for state artifacts
Use Entity as the source of truth:
- state registration numbers + PDFs
- renewal dates / reminders (future)

Suggested subcollection:
- `entities/{entityId}/state_accounts/{stateCode}`

### 5.3 Hiring sites / locations
Decide a canonical field:
- `hiringSiteId` per entity or per location
Derive from job order locationId where possible.

### 5.4 Timing windows & business days
Implement:
- `entity.policy.everifyWindowBusinessDays = 3`
Business-day calculator:
- skip weekends
- (future) support federal holidays
If outside window:
- block auto-case creation
- create admin task “E‑Verify late — manual review”
- allow override with audit + reason

---

## 6) Accounting + Workers Comp (extension points)

### 6.1 GL / cost center
- `defaultGlCode`, `defaultCostCenter`
Optional mapping:
- `entities/{entityId}/gl_mappings/{mappingId}`
  - keys: companyId/locationId/jobOrderType/jobTitle → glCode/costCenter

### 6.2 Workers comp
- Entity stores policy baseline
- WC code + rate should be selected at Job Order (or derived from a central repo)
Proposed central repo:
- `tenants/{tenantId}/wc_codes/{codeId}`
Job Order fields:
- `wcCodeId`, `wcRate` snapshot
Assignment inherits snapshot for reporting/export

---

## 7) Implementation plan (sequence)

### Phase A — Data + UI (no E‑Verify creds)
1) Extend Entity master data UI (operating states, registrations, GL/cost center, WC policy)
2) Add Onboarding Library Item type: `E-Verify`
3) Add Requirement Packages UI to include E‑Verify + I‑9
4) Enforce Job Orders require `entityId` + `requirementPackageId`
5) Ensure Assignment creation copies `entityId` + `requirementPackageId`

### Phase B — Backend scaffolding
6) Add collections + types: `everify_cases`, events
7) Implement `everifyService` skeleton with redaction + status normalization
8) Implement triggers:
   - `user_employments` update (I‑9 completed → queue create case)
   - scheduled poller
9) Add admin UI “Compliance” card + status chips

### Phase C — Connect to Stage
10) Configure secrets for stage WS user/password
11) Implement actual API calls per ICA
12) Validate E2E: create case, poll status, TNC flow, closure

### Phase D — Production readiness (later)
13) EAAT scenarios
14) Production credentials
15) Monitoring/alerts, security hardening, audit reporting

---

## 8) “Critical lookup fields everywhere” checklist

Ensure these are present on every relevant doc:
- `tenantId`
- `entityId`
- `userId`
- `jobOrderId`
- `assignmentId`
- `userEmploymentId`
- `onboardingInstanceId`
- `status`
- `createdAt`, `updatedAt`

Docs:
- entities
- requirement_packages
- onboarding_library_items
- job_orders (+ shifts)
- applications
- assignments
- user_employments
- onboarding_instances
- everify_cases (+ events)
- signature_envelopes (+ events)

---

## 9) Ready-for-Cursor prompts (copy/paste)

### Prompt A — Firestore types + rules
“Implement `tenants/{tenantId}/everify_cases` and `everify_cases/{caseId}/events`. Add required lookup fields (tenantId, entityId, userId, userEmploymentId, assignmentId, jobOrderId, shiftId). Add TS types and update Firestore rules: admin read/write; worker read only for their own high-level status fields.”

### Prompt B — Backend scaffolding
“Create `functions/src/integrations/everify/*` with service/adapter/redaction/schemas. Implement callable `everifyCreateCase` (eligibility validation + stub provider call) and scheduled poller stub. All writes should append an event.”

### Prompt C — UI compliance card
“Add ‘Compliance’ card to Assignment/User detail pages: I‑9 status chip + E‑Verify status chip (tooltip: lastCheckedAt; case number admin-only). Add admin-only button ‘Create E‑Verify Case’ enabled only when eligibility rules pass.”

---

## 10) Open questions (capture)
- Store FEIN full vs masked/encrypted (recommend: masked or encrypted + strict ACL)
- I‑9 provider decision and how “I‑9 completed” is asserted
- Employer Agent mode (running E‑Verify for client employers) — if yes, add clientCompanyId/agent fields
- Hiring site modeling strategy (entity default vs location-based)
