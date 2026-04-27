# HRX / C1 Onboarding Architecture (Tenant-Scoped Firestore) — Cursor Build Doc

Owner: Greg / HRX One  
Date: 2026-02-17  
Status: Build Spec (Phase 1)

> **Key clarification:** All collections described below are **tenant-scoped** under:
>
> `tenants/{tenantId}/...`
>
> This keeps multi-tenant isolation clean and avoids global collections.

---

## 0) Goals

Build an onboarding system that:

1. Supports **multiple Entities (Employers of Record)** per tenant.
2. Drives onboarding from **Job Order → Assignment → Onboarding Instance** (inheritance).
3. Allows a worker to be active under **multiple entities simultaneously**.
4. Creates **worker-facing steps** + **internal (recruiter/hr/payroll) tasks** + **automated reminders**.
5. Is built **provider-agnostic** so we can later integrate:
   - **E-Verify API**
   - **Background checks API**
   - **Everee** (payroll onboarding/export, later)

Phase 1 focuses on the core data model + workflow engine + UI.

---

## 1) Domain Definitions (Top-Down)

### Entity (Employer of Record)
An Entity is the legal employer/contracting party for a worker on a given assignment.

Examples:
- **C1 Events LLC** → 1099 contractors (no I-9; contractor agreement; WC info; contractor-safe handbook)
- **C1 Workforce LLC** → W-2 (no E-Verify states)
- **C1 Select LLC** → W-2 (E-Verify required)

### Requirement Package (Compliance Package)
Reusable template that defines:
- Worker steps (forms, uploads, acknowledgements, e-sign)
- Internal steps (tasks for recruiter/hr/payroll)
- Documents (e-sign / upload / acknowledge)
- Checks (background/drug)
- Blocking rules (what gates “Ready to Start”)

### Job Order
Chooses:
- Entity (required)
- Requirement package (defaulted from entity, overrideable)
- Job-specific add-ons (site orientation, specific background/drug)

### Assignment
Inheritance point (enforcement point):
- Assignment copies entityId + requirementPackageId at creation time
- Assignment references an **Onboarding Instance** which contains a resolved snapshot for audit.

### User Employment Profile (per entity)
A worker may have multiple concurrent “employment profiles” (one per entity).
This tracks entity-level compliance state and enables doc reuse rules.

---

## 2) Firestore Paths (Tenant-Scoped)

All paths below are scoped:

`tenants/{tenantId}/<collection>/<docId>`

### 2.1 Entities
`tenants/{tenantId}/entities/{entityId}`

```ts
{
  name: string,                      // "C1 Workforce LLC"
  entityCode: string,                // used in payroll export: "C1WF"
  workerType: "W2"|"1099"|"BOTH",
  everifyRequired: boolean,

  defaultRequirementPackageId: string | null,

  legalName?: string,
  address?: {
    line1?: string, line2?: string, city?: string, state?: string, zip?: string
  },

  supportEmail?: string,

  wcCarrierInfo?: {
    carrierName?: string,
    policyNumber?: string,
    phone?: string,
    pdfUrl?: string
  },

  // behavior toggles
  allowRehireReuseDocs?: boolean,
  i9Required?: boolean,
  w4Required?: boolean,

  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

### 2.2 Requirement Packages
`tenants/{tenantId}/requirementPackages/{packageId}`

```ts
{
  name: string,                      // "W2 E-Verify", "1099 Events Contractor"
  workerType: "W2"|"1099",
  everifyRequired: boolean,

  steps: StepTemplate[],
  documents: DocumentTemplate[],
  checks: CheckTemplate[],

  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

### 2.3 Job Orders
`tenants/{tenantId}/jobOrders/{jobOrderId}`

Add these fields:

```ts
{
  entityId: string,                    // REQUIRED
  requirementPackageId?: string | null,// default = entity.defaultRequirementPackageId

  // job-specific overrides (optional)
  requiredChecksOverride?: CheckTemplate[],
  requiredDocsOverride?: DocumentTemplate[],
  onboardingOverrides?: Partial<OnboardingRules>,

  ...
}
```

---

### 2.4 Assignments
`tenants/{tenantId}/assignments/{assignmentId}`

Add these fields:

```ts
{
  userId: string,
  jobOrderId: string,

  entityId: string,                   // copied from JobOrder at assignment creation
  requirementPackageId: string,       // resolved at creation time
  onboardingInstanceId?: string,

  status: "pending_onboarding"|"ready"|"active"|"ended",
  ...
}
```

---

### 2.5 User Employments (per entity)
Deterministic ID recommended:

`employmentId = ${userId}_${entityId}`

Path:
`tenants/{tenantId}/userEmployments/{employmentId}`

```ts
{
  userId: string,
  entityId: string,

  workerType: "W2"|"1099",
  status: "active"|"inactive"|"blocked",

  // entity-level compliance summary
  i9Status?: "not_required"|"required"|"in_progress"|"complete"|"expired",
  w4Status?: "not_required"|"required"|"in_progress"|"complete"|"expired",

  everifyCaseStatus?: "not_required"|"not_started"|"in_progress"|"verified"|"tcn_issued"|"failed"|"error",

  completedDocKeys?: string[],         // e.g., ["contractor_agreement_v3", "handbook_ack_2026"]
  updatedAt: Timestamp
}
```

---

### 2.6 Onboarding Instances (assignment-scoped run)
Recommended ID:
- simplest: `instanceId = assignmentId`
- or: `${userId}_${assignmentId}_${entityId}` if you want extra uniqueness

Path:
`tenants/{tenantId}/onboardingInstances/{instanceId}`

```ts
{
  userId: string,
  assignmentId: string,
  jobOrderId: string,

  entityId: string,
  requirementPackageId: string,

  status: "not_started"|"in_progress"|"completed"|"blocked",
  percentComplete: number,

  // snapshots for audit (IMPORTANT)
  resolvedSteps: StepInstance[],
  resolvedDocuments: DocumentInstance[],
  resolvedChecks: CheckInstance[],

  startedAt?: Timestamp,
  completedAt?: Timestamp,

  createdBy: { userId: string, role?: string },
  updatedAt: Timestamp,
  createdAt: Timestamp
}
```

#### Events subcollection (append-only)
`tenants/{tenantId}/onboardingInstances/{instanceId}/events/{eventId}`

```ts
{
  type: string,               // "step_completed", "message_sent", "task_created", "doc_signed", ...
  key?: string,               // stepKey / docKey / checkKey
  messageId?: string,
  taskId?: string,
  actor?: { userId?: string, system?: boolean },
  payload?: any,
  createdAt: Timestamp
}
```

This is the canonical “Logs drive behavior” record for onboarding.

---

### 2.7 Signature Envelopes (provider-agnostic)
`tenants/{tenantId}/signatureEnvelopes/{envelopeId}`

```ts
{
  userId: string,
  assignmentId: string,
  entityId: string,
  onboardingInstanceId: string,

  documentKey: string,    // "contractor_agreement_v3"
  provider: "docusign"|"dropboxsign"|"adobe"|"other",

  status: "created"|"sent"|"viewed"|"signed"|"declined"|"error",
  signingUrl?: string,

  signedPdfPath?: string, // Cloud Storage path
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Flutter will open `signingUrl` in a WebView. Provider webhooks update status.

---

## 3) Template Types

### 3.1 StepTemplate
Stored in requirementPackages.

```ts
type StepTemplate = {
  key: string,                          // "i9", "w4", "direct_deposit", "contractor_agreement"
  title: string,
  audience: "worker"|"internal"|"both",

  assigneeRole?: "recruiter"|"hr"|"payroll",   // internal side
  workerAction?: "fill_form"|"upload"|"esign"|"acknowledge"|"none",

  required: boolean,
  blocking: boolean,                    // blocks "Ready to Start"

  duePolicy?: {
    offsetHours: number,
    from: "assignmentCreated"|"startDate"
  },

  triggers?: {
    onStart?: Trigger[],
    onComplete?: Trigger[],
    reminders?: ReminderPolicy[]
  }
}
```

### 3.2 DocumentTemplate
```ts
type DocumentTemplate = {
  key: string,                           // "handbook_ack_2026", "contractor_agreement_v3"
  title: string,
  required: boolean,
  blocking: boolean,

  mode: "esign"|"upload"|"acknowledge",
  templateRef?: { provider?: string, templateId?: string },
  storagePathHint?: string               // where uploads land
}
```

### 3.3 CheckTemplate
```ts
type CheckTemplate = {
  key: string,                           // "background_standard", "drug_5panel"
  title: string,
  required: boolean,
  blocking: boolean,

  provider: "none"|"backgroundVendor"|"drugVendor",
  providerConfig?: any
}
```

### 3.4 Trigger + ReminderPolicy
Triggers reuse your existing Messaging + Tasks systems.

```ts
type Trigger =
  | { type: "createTask", taskType: string, assigneeRole: "recruiter"|"hr"|"payroll", priority?: "low"|"med"|"high" }
  | { type: "sendMessage", channel: "sms"|"email"|"push", templateKey: string }
  | { type: "setField", path: string, value: any }
  | { type: "enqueueCheck", checkKey: string };

type ReminderPolicy = {
  cadence: "every24h"|"every48h"|"custom",
  maxSends: number,
  stopWhenCompleted: boolean,
  messageTemplateKey: string
};
```

---

## 4) Resolver Rules (How requirements flow down)

**Resolver runs when an Assignment is created**:

1. Load JobOrder.
2. Resolve:
   - `entityId = jobOrder.entityId` (required)
   - `requirementPackageId = jobOrder.requirementPackageId ?? entity.defaultRequirementPackageId`
3. Load Requirement Package.
4. Merge overrides:
   - `resolvedChecks = package.checks + jobOrder.requiredChecksOverride?`
   - `resolvedDocuments = package.documents + jobOrder.requiredDocsOverride?`
   - `resolvedSteps = package.steps` with optional onboardingOverrides
5. Create/Upsert userEmployments doc for that entity.
6. Create onboardingInstance with **resolved snapshots**.
7. Fire triggers:
   - internal tasks
   - initial worker message
   - reminder scheduling via Cloud Tasks

> **Important:** “Start Onboarding” modal (W2 vs 1099) becomes an admin override tool, not the default.  
> Default onboarding is **assignment-driven**.

---

## 5) Workflow Engine (Functions + Cloud Tasks)

### 5.1 Function Triggers (Phase 1)
- `onAssignmentCreated` → `startOnboardingForAssignment(tenantId, assignmentId)`
- `onOnboardingStepCompleted` → recompute status + percent + run onComplete triggers
- `onDocumentSigned / Uploaded / Acknowledged` → update doc instance + run triggers
- `onCheckStatusUpdated` → update check instance + recompute readiness

### 5.2 Gating: “Ready to Start”
A single evaluator function:
- reads onboardingInstance
- if all **required + blocking** items are complete, then:
  - set `assignments/{id}.status = "ready"`
  - optionally notify recruiter + worker

### 5.3 Idempotency / Dedupe
Every automated action must be idempotent.

Recommended dedupe key scheme:
- `onboarding:{instanceId}:{itemKey}:{event}:{actionType}`

Store dedupe evidence as an event doc in:
- `tenants/{tenantId}/onboardingInstances/{instanceId}/events/...`

If the key exists, skip.

---

## 6) UI Plan (Phase 1)

### 6.1 Settings → Company Setup
Add a new tab: **Entities**
- Table: name, workerType, E-Verify, entityCode, default package
- CRUD entity detail

Add/extend: **Requirement Packages**
- CRUD packages
- Simple builder: steps / docs / checks

### 6.2 Job Order UI
Add:
- Entity selector (required)
- Requirement package selector (defaults from entity)
- Checks & docs overrides (Advanced)

### 6.3 User Details → Onboarding Tab (your current UI)
Render from onboardingInstance:
- Banner: Entity + Package + status + % complete
- Documents list (required chips, status)
- Checks list (status)
- Worker steps
- Internal tasks (linked to your tasks system)

---

## 7) External Integrations (Phase 2+ — later)

We will design provider adapters once Phase 1 is stable.

### 7.1 E-Verify API
Add fields to:
- `userEmployments` (entity-level everifyCaseStatus)
- or `onboardingInstances.resolvedChecks` for an `everify` check.

Likely add:
- `tenants/{tenantId}/integrations/everify` config doc
- `tenants/{tenantId}/everifyCases/{caseId}` for audit + webhook-like updates

### 7.2 Background Checks API
Use `resolvedChecks[]` with provider + providerConfig.
Add:
- `tenants/{tenantId}/backgroundChecks/{checkId}` for vendor payload + statuses

### 7.3 Everee (payroll onboarding / export)
Entity-level payroll exports will use:
- assignment.entityId → entity.entityCode
- userEmployments + onboarding completion signals

Likely add:
- `tenants/{tenantId}/integrations/everee` config
- `tenants/{tenantId}/payrollExports/{exportId}` logs + results

---

## 8) Build Order (Cursor Tasks)

1. **Schema + Types**
   - Add tenant-scoped collections: entities, requirementPackages, userEmployments, onboardingInstances, signatureEnvelopes
   - Add new fields to jobOrders + assignments
   - Add TS interfaces for templates + instances

2. **Settings UI**
   - Entities CRUD
   - Requirement Packages CRUD + basic builder UI

3. **Job Order UI**
   - Entity + Package pickers
   - Persist to Firestore

4. **Resolver Function**
   - `startOnboardingForAssignment()` creates onboardingInstance snapshot
   - Upserts userEmployments
   - Writes assignment.onboardingInstanceId

5. **Onboarding UI**
   - Read onboardingInstance; render docs/checks/steps and completion state

6. **Triggers**
   - Create internal tasks via your tasks system
   - Send messages via your existing queue-first messaging (sms/email/push)
   - Schedule reminders (Cloud Tasks)

7. **Readiness Evaluator**
   - Set assignment.status="ready" when blocking requirements complete

8. **E-sign (stub)**
   - signatureEnvelopes model + “Create signing link” stub UI
   - webhook handler placeholders (provider later)

---

## 9) Notes / Guardrails

- **Snapshots are required.** If packages change later, existing onboarding instances must remain auditable.
- Keep onboarding instance small enough for Firestore doc limits:
  - If steps/docs/checks could get large, move them to subcollections:
    - `.../steps/{stepId}`, `.../docs/{docId}`, `.../checks/{checkId}`
- Prefer “append-only events” for debugging and analytics.
- Default onboarding should be **assignment-driven** to avoid confusing W2 vs 1099 selection.

---

## 10) Next Questions (Optional, not blocking Phase 1)

- Do we need per-state rules (e.g., I-9/E-Verify only in certain states)?
- Do we require re-onboarding when handbook versions change?
- What “blocking” rules should be role-based (e.g., allow HR override to mark complete)?
- Which steps belong in worker app (Flutter) vs admin app only?

