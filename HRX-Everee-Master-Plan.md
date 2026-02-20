# HRX ↔ Everee Master Plan (Foundation Now, Turn‑On Later)

**Audience:** HRX One engineering + ops  
**Goal:** Build a *thorough* Everee integration that supports:
- **Worker self‑service onboarding inside HRX** (web + Flutter app) using Everee embedded onboarding
- **Worker payroll visibility inside HRX** (pay history, pay statements, leave balances, etc.)
- **Admin timecards & payment submission inside HRX** (shifts/hours → payroll processing)
- **3 Everee company instances** mapped to HRX Entities: **C1 Workforce**, **C1 Select**, **C1 Events**
- **Clean identity mapping** between HRX users and Everee workers using **Firebase UID as the canonical external ID** (not email)

This doc is written so you can treat Everee integration as “designed and ready,” with implementation split into:
1) **Foundation now** (safe without credentials)  
2) **Sandbox turn‑on & test** (when creds arrive)  
3) **Production hardening & go‑live**

---

## 0) Key Everee facts (from Everee docs)

### 0.1 Company Instances (multiple EINs)
Everee runs **each legal business entity/EIN** in its own **Company instance**. That means you will have **three instances** and therefore three `x-everee-tenant-id` values. citeturn7view0

### 0.2 API tokens are backend-only
Everee API tokens **must not be shipped to browsers or mobile apps**; Everee will reject browser-originated requests. All Everee calls must be made from HRX backend (Cloud Functions) and exposed to clients via HRX callables/HTTP endpoints. citeturn8view0

### 0.3 Auth headers
Everee uses two headers for API requests:
- `authorization: basic <token or base64(token)>`
- `x-everee-tenant-id: <companyTenantId>` citeturn8view0

### 0.4 Embedded onboarding experience
Everee worker onboarding is typically done through **Embed Components**:
- Create a Worker record first (contractor or employee)
- Create an Embed Component session with `experienceType="ONBOARDING"` and show the returned URL in a WebView/iframe
- Track completion via both:
  - Component event `WORKER_ONBOARDING_COMPLETE`
  - Server webhook `worker.onboarding-completed` citeturn7view1turn7view4

Everee explicitly recommends storing an attribute in your DB to avoid repeatedly querying Everee. citeturn7view1

### 0.5 Timesheets + Payables + Worker payment history
Everee’s API surface includes:
- **Timesheets API** (shifts on a worker timesheet) citeturn7view2
- **Payables API** (one-time or batch payables, prepare for payout) citeturn7view3
- **Worker payment history & pay statements** endpoints citeturn7view2turn8view2

### 0.6 Webhooks are retrying + must be idempotent
Everee retries webhook deliveries, and you may receive duplicates. Implement a fast 2xx response and dedupe by the event `id`. citeturn7view5

---

## 1) HRX integration goals & user stories

### 1.1 Worker (web + Flutter)
1) **“Complete payroll setup”** inside HRX
   - Choose payroll entity based on assignment/job order entity rules (C1 Workforce/C1 Select/C1 Events)
   - Launch embedded Everee onboarding in-app
   - Confirm completion and unlock work/assignment readiness

2) **“See my pay history”** inside HRX
   - Show pay history items
   - View/download pay statements
   - (Later) show W‑2/W‑9, W‑4/W‑9 info, payment preferences, leave balances

3) **“See timecards”** (optional first release)
   - Show hours submitted/approved per shift/pay period
   - Show PTO/leave balances (if used)

### 1.2 Admin (Recruiting / Payroll / Ops)
1) **Create/verify Everee worker linkage** (per entity)
2) **Enter timecards** (hours worked)
3) **Submit timecards/payables for payout**
4) **Reconcile payroll**
   - Identify missing onboarding
   - Identify missing work location / position / comp defaults
   - Trace HRX assignment → Everee timesheet shifts → pay statement

### 1.3 Onboarding completion flags: manual today, automatic when Everee is live

HRX has **three entities** (Employers of Record) that map 1:1 to the **three Everee company instances / EINs**:
- **C1 Workforce LLC** (W‑2) → Everee Instance #1  
- **C1 Select LLC** (W‑2) → Everee Instance #2  
- **C1 Events LLC** (1099) → Everee Instance #3  

Each entity has its own **Onboarding Workflow** in Settings (e.g. Overview, Cost Centers, Compliance, Onboarding Workflow, Export / Integrations). Onboarding steps can include confirmations such as:
- Payroll setup complete  
- Direct deposit details entered  
- Tax forms complete  
- etc.  

**Before Everee is live:**  
- Use **manual checkboxes** in the onboarding process so admins or workers can mark these steps complete (e.g. “Payroll setup complete”, “Direct deposit entered”).  
- These flags drive readiness, assignment eligibility, and reporting.  
- Stored per user and per entity (or per onboarding instance) in your existing onboarding/readiness model.

**Once Everee is live:**  
- The **same** flags/checkboxes should be set to **true automatically** when Everee confirms completion.  
- Source of truth: Everee webhook `worker.onboarding-completed` and/or `everee_workers` doc with `status: 'onboarding_complete'`.  
- When the webhook is processed (or when `everee_workers` is updated), HRX updates the corresponding onboarding completion flags for that `tenantId + entityId + userId` so that:  
  - The same UI (e.g. “Payroll setup complete”) shows as checked.  
  - No change is required to downstream logic that checks those flags for readiness or assignment eligibility.  

**Design rule:** Model onboarding completion so the **field names and semantics** are the same whether set manually or by Everee. Use a single source (e.g. `user_employments` or `onboarding_instances` with a `payrollSetupComplete` and/or `directDepositComplete` per entity) and have the Everee webhook handler write to those same fields when `worker.onboarding-completed` fires for that entity.

---

## 2) Architectural principles (best practices for payroll integrations)

### 2.1 Treat Everee as the system of record for payroll PII
- Everee will store the sensitive payroll onboarding data (tax forms, bank, identifiers).
- HRX should store **only linkage + operational metadata**:
  - `evereeWorkerId`, `evereeTenantId`, `entityId`, `userId`, onboarding status, lastSyncAt, etc.
- HRX should display pay stubs and statements by **proxying Everee** from backend, not copying full documents.

This aligns with Everee’s “API tokens are not publishable” warning and helps minimize compliance footprint. citeturn8view0

### 2.2 Canonical identity mapping uses Firebase UID
**Do not rely on email** as the primary key (it can change; workers can have multiple emails; and you have multi-entity relationships).

Instead:
- When creating Everee workers, always set `externalWorkerId = <firebaseUid>` (or the closest Everee-supported equivalent).
- Store Everee’s returned `workerId` in Firestore for each HRX user and entity.

Everee’s docs mention that creating sessions requires a worker ID or “external worker ID” that Everee knows. citeturn7view1

### 2.3 Multi-entity reality: a user can exist in multiple Everee instances
A worker can simultaneously be:
- W‑2 under **C1 Workforce**
- W‑2 under **C1 Select**
- 1099 under **C1 Events**

So your mapping must be **per tenantId + entityId + userId**, not just per user.

### 2.4 Webhook-first, poller-second
- Use **webhooks** for “state changed” events (onboarding complete, payroll processed, etc.)
- Use **polling/sync** only for:
  - backfills
  - “stuck” detection
  - user-requested refresh
  - resilience when webhooks fail

Everee explicitly describes webhook retries and duplicate delivery risk; implement idempotency. citeturn7view5

### 2.5 Idempotency everywhere
- Each “create worker”, “create embedded URL”, “push shift”, “create payable” should be idempotent from HRX’s perspective:
  - deterministic IDs where possible
  - request hashes
  - dedupe guards (open objects, latest processed event id, etc.)

---

## 3) Data model (tenant-scoped, entity-aware)

All collections are under:  
`/tenants/{tenantId}/...`

> **Important:** every doc should include lookup fields: `tenantId`, `entityId`, `userId` (and when relevant: `assignmentId`, `jobOrderId`, `shiftId`, `userEmploymentId`, etc.) for fast querying and audit.

### 3.1 Entity → Everee instance mapping
**Collection:** `tenants/{tenantId}/entities/{entityId}` *(already exists in your Entity work)*

Add Everee fields:
- `payrollProvider: 'everee' | 'none' | ...`
- `evereeEnabled: boolean`
- `evereeTenantId: string` *(Everee “Company tenant ID” / instance identifier)* citeturn8view0turn7view0
- `evereeEnvironment: 'sandbox' | 'production'` *(or derive from project/env)*
- `evereeApiBaseUrl?: string` *(if Everee offers env-specific URLs)*
- `evereeConfig?: { defaultWorkLocationId?, defaultApprovalGroupId?, ... }`

**Secrets (server-only):**
- `EVEREE_API_TOKEN_<ENTITY_CODE>` (or a JSON mapping secret)
- If Everee uses one token per company instance, store per instance.

### 3.2 User ↔ Everee worker linkage (per entity)
**Collection:** `tenants/{tenantId}/everee_workers/{evereeWorkerLinkId}`  
**Doc id recommendation:** `${entityId}__${userId}` (deterministic)

Fields:
- `tenantId`
- `entityId`
- `userId`
- `firebaseUid` (same as userId if that’s your UID)
- `externalWorkerId` = `firebaseUid` *(canonical)*
- `evereeTenantId`
- `evereeWorkerId` *(returned by Everee)*
- `workerType: 'employee' | 'contractor'` *(W‑2 vs 1099)*
- `status: 'not_created' | 'created' | 'onboarding_started' | 'onboarding_complete' | 'error'`
- `onboarding: { startedAt?, completedAt?, lastEventId?, lastWebhookAt? }`
- `lastSyncAt`
- `createdAt`, `updatedAt`

### 3.3 Embedded sessions (optional but helpful)
**Collection:** `tenants/{tenantId}/everee_embed_sessions/{sessionId}`

Fields:
- `tenantId`, `entityId`, `userId`, `evereeWorkerId`, `evereeTenantId`
- `experienceType: 'ONBOARDING' | 'PAY_CARD' | ...`
- `experienceVersion` (e.g. Everee docs show onboarding versions) citeturn7view1
- `status: 'created' | 'presented' | 'dismissed' | 'completed' | 'expired'`
- `urlCreatedAt`, `expiresAt?` *(if applicable)*
- `createdAt`, `updatedAt`

> Everee warns that session tokens can expire and are one-time use; keep sessions ephemeral and create them right before displaying. citeturn7view4

### 3.4 Timesheets mirror (optional)
**Collection:** `tenants/{tenantId}/everee_timesheets/{docId}`
- Often unnecessary if HRX already stores timesheets; consider storing only Everee shift IDs for reconciliation.

Fields:
- `tenantId`, `entityId`, `userId`, `assignmentId`, `shiftId`
- `evereeWorkerId`, `evereeTenantId`
- `evereeShiftId`
- `workDate`, `startTime`, `endTime`, `minutes`, `earningsType`
- `status: 'pushed' | 'updated' | 'locked' | 'error'`
- `rawWhitelisted?` *(no PII)*
- `createdAt`, `updatedAt`

### 3.5 Payroll history cache (read-through)
**Collection:** `tenants/{tenantId}/everee_pay_history_cache/{cacheId}`
Doc id: `${entityId}__${userId}__${YYYYMM}` or similar.

Fields:
- `tenantId`, `entityId`, `userId`, `evereeWorkerId`, `evereeTenantId`
- `range: { start, end }`
- `items: [...]` *(whitelist fields needed for UI)*
- `fetchedAt`
- TTL policy: 24h–72h

Everee supports retrieving worker pay history via API. citeturn8view2

### 3.6 Webhook events log (append-only)
**Collection:** `tenants/{tenantId}/everee_webhook_events/{eventId}`

Fields:
- `tenantId`
- `provider: 'everee'`
- `eventId` *(from Everee webhook payload `id`)*
- `eventType`
- `entityId`, `evereeTenantId`, `evereeWorkerId`, `userId` (if resolvable)
- `receivedAt`
- `processedAt?`
- `status: 'received' | 'processed' | 'skipped' | 'error'`
- `error? { code, message }`
- `rawWhitelisted` *(do not store PII)*

Idempotency: if `eventId` exists, skip and respond 2xx. citeturn7view5

---

## 4) Integration surfaces in HRX (what you build)

### 4.1 Backend module layout (Cloud Functions)
Add a new integration module mirroring your E‑Verify pattern:

`functions/src/integrations/everee/`
- `evereeConfig.ts`
  - resolve entity → evereeTenantId + baseUrl
  - resolve per-entity secret/token reference
- `evereeAuth.ts`
  - builds headers: `authorization: basic ...`, `x-everee-tenant-id: ...` citeturn8view0
- `evereeHttp.ts`
  - shared request wrapper, retries, timeouts, structured errors
- `evereeSchemas.ts`
  - zod schemas for requests/responses you use
  - status enums (onboarding, timesheet, payable, payment history)
- `evereeService.ts`
  - business methods (createWorkerIfNeeded, createOnboardingSession, pushShift, listPayHistory, getPayStatement, etc.)
- `evereeWebhooks.ts`
  - webhook handler + signature verification (see Everee webhook security docs)
- `evereeSync.ts`
  - pollers/backfills (optional)
- `evereeCallables.ts`
  - admin + worker-facing callable endpoints

### 4.2 Client UX modules (web + Flutter)

#### Worker: “Payroll Setup” module
- Detect whether worker needs Everee onboarding for the entity required by their assignment
- Button: “Complete payroll setup”
  - Calls HRX callable: `evereeCreateOnboardingSession`
  - Receives `url`
  - Opens embedded experience:
    - Web: iframe
    - Flutter: `webview_flutter`
- Listen for component events:
  - `WORKER_ONBOARDING_COMPLETE` → optimistic UI update citeturn7view4turn7view1
  - `DISMISS` → close modal
- Server webhook will confirm completion and update Firestore.

#### Worker: “My Pay” module
- Pay history list (proxied by HRX backend from Everee Worker Payment History API) citeturn8view2turn7view2
- Pay statement viewer/download (proxied)
- Leave balances (if enabled) via API list endpoints citeturn7view2

#### Admin: “Timesheets & Payroll” module
- Timecard grid from HRX (authoritative)
- “Send to payroll” action:
  - pushes shifts to Everee Timesheets API (create/update shifts) citeturn7view2
  - or uses Payables API for one-off payments citeturn7view3
- “Prepare for payout / Submit” according to Everee workflow (Payables guide) citeturn7view3

---

## 5) End-to-end workflow designs

### 5.1 Worker onboarding (entity-aware)
**Trigger:** Worker has an assignment that requires payroll under Entity X.

1) HRX resolves the required entity from assignment/job order (your existing pattern).
2) HRX ensures `everee_workers/{entityId}__{userId}` exists:
   - If not: call Everee API to create worker (employee vs contractor)
   - Set `externalWorkerId = firebaseUid`
   - Save `evereeWorkerId`
3) HRX creates embedded experience session:
   - `experienceType="ONBOARDING"` (and version per docs) citeturn7view1
4) Worker completes onboarding in embedded flow.
5) HRX receives:
   - Component event: `WORKER_ONBOARDING_COMPLETE` (fast UX update) citeturn7view4
   - Webhook event: `worker.onboarding-completed` (source of truth) citeturn7view1
6) HRX updates:
   - `everee_workers` status `onboarding_complete`
   - **Same onboarding completion flags** used by manual checkboxes (e.g. payroll setup complete, direct deposit entered) on `user_employments` / `onboarding_instances` so the UI and readiness logic stay identical; see §1.3.
   - optional: create internal “Payroll setup complete” event

### 5.2 Timecards → Payroll
**Trigger:** Admin approves timecard for pay period (or per shift).

Two viable patterns (choose one first, support both later):

**A) Timesheets-first (best for regular hourly W‑2)**
- Create shifts on worker timesheet in Everee (create/update/delete shift endpoints) citeturn7view2
- When pay period closes, Everee processes payroll from those timecards

**B) Payables-first (best for one-off / gig / adjustments)**
- Create payable items (single or bulk)
- Prepare payable items for payout (batch) citeturn7view3

For HRX:
- Keep HRX timecards as source of truth.
- Everee becomes the payment processor/source of record for pay statements.

### 5.3 Worker payroll history in HRX
- HRX backend queries Everee “Retrieve a worker’s pay history” endpoint citeturn8view2
- HRX returns a whitelisted payload to client (no tokens exposed)
- Optional: cache results in `everee_pay_history_cache` to reduce API load.

---

## 6) Webhooks: what to implement now (foundation)

Everee has specific guidance:
- respond quickly with 2xx
- expect duplicates and dedupe by webhook `id`
- Everee retries with backoff for days citeturn7view5

### 6.1 Webhook handler (Cloud Functions HTTPS)
- `POST /everee/webhook` (region + auth)
- Verify signature (follow Everee’s webhook security/auth docs)
- Immediately write `everee_webhook_events/{eventId}` with status=received
- Ack 2xx **fast**
- Process async (Cloud Tasks) using eventId
  - resolve tenantId/entityId by evereeTenantId or metadata in payload
  - update worker onboarding status, payments, etc.

---

## 7) “Foundation now” implementation plan (no creds required)

### Phase F0 — Schema + paths + UI placeholders (1–2 days)
1) Add Firestore path helpers:
- `p.evereeWorkers(tid)`, `p.evereeWorker(tid, entityId, userId)`
- `p.evereeEmbedSessions(...)`
- `p.evereeWebhookEvents(...)`
- `p.evereePayHistoryCache(...)`

2) Add TS types in:
- `src/types/integrations/everee.ts`
- `functions/src/integrations/everee/evereeSchemas.ts`

3) Extend Entities settings UI:
- Add “Payroll provider” section in Entities detail:
  - provider dropdown: none / everee
  - evereeEnabled toggle
  - evereeTenantId input
  - (optional) baseUrl override
- Add “Test Everee config” button (admin-only) that validates fields exist (no real API call yet)

### Phase F1 — Backend scaffolding (safe stubs) (2–4 days)
1) Create module files:
- `evereeConfig.ts` (resolve entity config)
- `evereeAuth.ts` (header builder, but uses placeholder token from Secret Manager)
- `evereeHttp.ts` (request wrapper w/ stub mode)
- `evereeService.ts` (methods, stub returns)
- `evereeCallables.ts` (wire callable endpoints, stubbed)

2) Implement callable contract (even stubbed):
- `evereeEnsureWorker({ tenantId, entityId, userId })`
- `evereeCreateOnboardingSession({ tenantId, entityId, userId })`
- `evereeGetPayHistory({ tenantId, entityId, userId, range? })`
- `evereeGetPayStatement({ tenantId, entityId, userId, statementId })`
- `evereeAdminPushShift({ tenantId, entityId, userId, shiftPayload })`
- `evereeAdminPreparePayout({ tenantId, entityId, payPeriodId })`
- `evereePing({ tenantId, entityId })` (returns config ok in stub)

3) Add Firestore rules placeholders:
- Read/write to Everee internal docs:
  - admins full access
  - recruiters/ops limited
  - workers read only their linkage + public payroll mirror (if you add one)

### Phase F2 — Worker UI wiring (behind feature flag) (2–4 days)
1) Add “Payroll Setup” panel in worker profile / Companion:
- show readiness: onboarded / not onboarded
- button calls `evereeCreateOnboardingSession`
- open returned URL in webview/iframe
- listen for events (web + Flutter)

2) Add “My Pay” panel:
- show pay history list
- “View statement” loads statement details via callable

> Everything is behind `FEATURE_EVEREE=true` and/or entity.evereeEnabled.

---

## 8) “Turn-on & test” plan (when sandbox creds arrive)

### Phase S1 — Secrets + ping (same day)
- Store Everee API tokens in Secret Manager (never in client) citeturn8view0
- Add `x-everee-tenant-id` per entity (C1 Workforce/Select/Events) citeturn8view0turn7view0
- Implement `evereePing` to call a lightweight endpoint (e.g., list work locations or search workers) and verify auth

### Phase S2 — Create worker + onboarding session (1–3 days)
- Implement:
  - create contractor/employee endpoints (for embedded onboarding) citeturn7view1turn7view2
  - create embedded experience URL post citeturn7view2
- Save `evereeWorkerId` in `everee_workers`
- Launch onboarding embed in web + Flutter
- Listen for:
  - Component event `WORKER_ONBOARDING_COMPLETE` citeturn7view4
  - Webhook `worker.onboarding-completed` citeturn7view1

### Phase S3 — Webhooks (2–5 days)
- Implement webhook endpoint per Everee docs (fast 2xx + idempotent) citeturn7view5
- Validate signature/auth
- Map events:
  - onboarding complete → update `everee_workers.status`
  - payment processed → update/pay history cache invalidation

### Phase S4 — Timesheets or Payables (choose first) (3–10 days)
Pick the most important first for C1:
- If you need **hourly W‑2**: implement Timesheets shifts create/update/list citeturn7view2
- If you need **1099 gig payouts**: implement Payables bulk + prepare payout citeturn7view3

---

## 9) Production hardening & go-live

### 9.1 Security & privacy
- Never store or log:
  - bank account numbers
  - taxpayer identifiers
  - documents/images
- Use whitelist storage for any `raw` provider payloads.
- Secrets only in Secret Manager.
- Strict admin-only callables for payouts.

### 9.2 Reliability
- Cloud Tasks for:
  - webhook processing
  - bulk timesheet pushes
  - payout preparation
- Idempotency keys:
  - webhook event `id` citeturn7view5
  - deterministic link docs `${entityId}__${userId}`
  - shift doc mapping `${assignmentId}__${shiftId}`

### 9.3 Observability
- Add `everee_logs` collection for:
  - request summary (no PII)
  - response status
  - latency
  - retry count
  - correlationId (tenantId/entityId/userId)

### 9.4 Admin reconciliation screens
- “Everee Ops” page similar to your E‑Verify Ops:
  - filter by entity
  - list workers missing onboarding
  - list recent webhook failures
  - list unpushed shifts/payables

---

## 10) Decisions to confirm (so the build stays crisp)

1) **W‑2 hours flow**: Timesheets-first vs Payables-first (choose one for MVP)
2) **Contractor (C1 Events)**: do you want to push gig payouts via Payables or still use Timesheets?
3) **Work locations & WC codes**:
   - Everee has work location and WC class endpoints available citeturn7view2
   - decide whether HRX will sync HRX Locations → Everee Work Locations (recommended)
4) **Approval groups**:
   - If you use Everee approval groups, define mapping rules (entity default vs job order override)

---

## 11) Concrete next steps (recommended)

### Do now (before creds)
- Implement Phase F0/F1/F2 as described (schema, UI fields, backend stubs, feature flags)
- Add Everee config to Entities detail (tenant-scoped)
- Add linkage collection `everee_workers` with deterministic doc ids
- Add worker-facing “Payroll setup” UX that can run using stub URLs (or disabled until session callable returns URL)

### Do when creds arrive
- Implement real auth headers and token storage
- Implement create worker + create embedded onboarding session
- Implement webhook endpoint + idempotent processor
- Implement pay history proxy and pay statement proxy
- Implement one payroll flow (Timesheets or Payables) end-to-end in sandbox

---

## Appendix A — Mapping HRX Entities → Everee Company Instances

| HRX Entity | Worker type(s) | Everee company instance? | Notes |
|---|---:|---:|---|
| C1 Workforce LLC | W‑2 | Yes (Instance #1) | Non‑E‑Verify states |
| C1 Select LLC | W‑2 | Yes (Instance #2) | E‑Verify states |
| C1 Events LLC | 1099 contractors | Yes (Instance #3) | Use contractor onboarding path |

This structure is consistent with Everee’s “each EIN has one Company instance” model. citeturn7view0

---

## Appendix B — Embed component event handling reminders

Everee component event payload shape includes:
- `eventType`
- error fields
- `eventHandlerName` citeturn7view4

Key events you should handle:
- `MESSAGE_PORT_REGISTERED` (ready)
- `WORKER_ONBOARDING_COMPLETE`
- `DISMISS` citeturn7view4turn7view1

Also heed Everee’s note about token/session expiration and one-time use. citeturn7view4
