# HRX × SourceDirect (AccuSource) Background Check Integration Spec
**Cursor Build Spec**

## Purpose
Build the first production-grade HRX integration with **SourceDirect / AccuSource** so HRX can:

- create and manage background check orders
- track status changes in near real time
- store and display webhook activity
- retrieve and store final reports and drug reports
- support recruiter, admin, and compliance workflows inside HRX

This spec assumes:
- HRX is the operational system of record
- SourceDirect is the screening provider
- HRX uses Firestore / Cloud Functions / existing admin UI patterns
- HRX will use its own internal Firestore document IDs as canonical IDs
- SourceDirect IDs are stored as mapped external IDs

---

## Product Architecture Principle

### HRX should own:
- candidate workflow
- account / customer context
- job order / worksite context
- internal background-check record
- recruiter UI
- timeline / activity log
- compliance state in HRX
- attachments / downloaded report references
- resend / retry / error handling logic

### SourceDirect should own:
- screening execution
- applicant portal completion
- service/vendor processing
- final report generation
- drug report generation
- provider-side webhook events

---

## Integration Goals

### Primary goals
1. Create a background check request from HRX
2. Send the request to SourceDirect using API v2
3. Store provider IDs and status mappings in Firestore
4. Receive webhook events from SourceDirect
5. Update the HRX record in near real time
6. Download / store final report and drug report when ready
7. Present a clean HRX UI for recruiters and admins

### Secondary goals
1. Support both package-based ordering and configurable service-based futures
2. Support partial applicant portal flows when needed
3. Support full profile creation when HRX has all required data
4. Support pre-adverse action workflow later
5. Build a clean abstraction for additional screening vendors later

---

## Canonical ID Strategy

### HRX canonical identifier
Use the **HRX Firestore document ID** as the canonical internal background-check ID.

Example:
```text
backgroundChecks/{backgroundCheckId}
```

### External identifiers to store
Each background check should also store:
- `provider = 'accusource'`
- `providerProfileId`
- `providerClientId`
- `providerOrderIds[]` if needed
- `providerCompanyId` if useful
- package / service identifiers from SourceDirect

### Important rule
Do **not** use the SourceDirect profile ID as the primary key in HRX.

Use:
- HRX ID for internal references
- SourceDirect IDs for external mapping

### Recommended `clientId`
When creating the SourceDirect profile, send an HRX-originated `clientId`.

Recommended format:
```text
HRX-BGC-{backgroundCheckId}
```

This gives you simple reconciliation between systems.

---

## Firestore Data Model

## 1) Parent background check record
Suggested path:
```text
backgroundChecks/{backgroundCheckId}
```

If your architecture is tenant-scoped, adapt accordingly:
```text
tenants/{tenantId}/backgroundChecks/{backgroundCheckId}
```

### Suggested document shape
```ts
{
  id: string;

  provider: 'accusource';
  providerEnvironment: 'production' | 'sandbox';

  // HRX relationships
  tenantId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  candidateId?: string | null;
  candidateName?: string | null;
  applicantId?: string | null;
  jobOrderId?: string | null;
  worksiteId?: string | null;

  // Internal tracking
  clientId: string; // HRX-BGC-{id}
  createdBy?: string | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;

  // SourceDirect mapping
  providerProfileId?: string | null;
  providerPackageId?: string | null;
  providerPackageName?: string | null;
  providerDecisionSourceId?: string | null;
  providerAccountingCodeId?: string | null;

  // Ordering mode
  orderMode: 'partial_profile' | 'full_profile';
  requestedServices?: string[] | null;
  requestedServiceNames?: string[] | null;

  // Status
  hrxStatus:
    | 'draft'
    | 'queued'
    | 'submitted'
    | 'awaiting_applicant'
    | 'in_progress'
    | 'report_ready'
    | 'drug_report_ready'
    | 'completed'
    | 'canceled'
    | 'error';

  providerStatus?: string | null;
  providerStatusId?: string | number | null;

  finalReportReady: boolean;
  drugReportReady: boolean;
  profileCompleted: boolean;
  orderCompleted: boolean;

  // Sync tracking
  lastWebhookAt?: Timestamp | null;
  lastSyncAt?: Timestamp | null;
  lastWebhookType?: string | null;
  syncError?: string | null;

  // Report storage references
  finalReportStoragePath?: string | null;
  drugReportStoragePath?: string | null;
  finalReportDownloadedAt?: Timestamp | null;
  drugReportDownloadedAt?: Timestamp | null;

  // Raw provider payload snapshots if needed
  lastProviderProfileSnapshot?: any;
}
```

---

## 2) Event log subcollection
Suggested path:
```text
backgroundChecks/{backgroundCheckId}/events/{eventId}
```

### Event document shape
```ts
{
  id: string;
  type: string;
  receivedAt: Timestamp;
  processedAt?: Timestamp | null;
  source: 'accusource_webhook' | 'accusource_poll' | 'manual_sync';
  providerProfileId?: string | null;
  providerOrderId?: string | null;
  providerServiceId?: string | null;
  payload: any;
  processingStatus: 'received' | 'processed' | 'ignored' | 'error';
  processingError?: string | null;
}
```

### Why keep all events
Do not just overwrite the parent document.

Keep all webhook events because they give you:
- auditability
- debugging
- recruiter timeline visibility
- future compliance evidence
- replay ability if processing fails

---

## 3) Activity log integration
If HRX already has a general activity system, also write normalized activities such as:
- Background check ordered
- Applicant portal link generated
- Profile completed
- Final report ready
- Drug report ready
- Service status changed
- Report downloaded
- Sync error

---

## Environment Strategy

Support at least:
```ts
type SourceDirectEnv = 'sandbox' | 'production'
```

Use env-based runtime config:
- base URL
- auth credentials
- webhook signing / verification settings if applicable
- storage bucket paths
- debug logging behavior

### Suggested config keys
```text
ACCUSOURCE_ENV
ACCUSOURCE_BASE_URL
ACCUSOURCE_CLIENT_ID
ACCUSOURCE_CLIENT_SECRET
ACCUSOURCE_COMPANY_ID
ACCUSOURCE_WEBHOOK_SECRET
```

---

## API Modules to Build

Create a provider folder such as:
```text
/functions/src/integrations/accusource/
```

### Suggested files
```text
accusourceClient.ts
accusourceAuth.ts
accusourceProfiles.ts
accusourceReports.ts
accusourceFiles.ts
accusourceWebhooks.ts
accusourceMapper.ts
accusourceTypes.ts
accusourceSync.ts
```

### Responsibilities

#### `accusourceClient.ts`
- low-level HTTP client
- auth headers
- base URL selection
- retry / timeout config
- common error handling

#### `accusourceAuth.ts`
- token retrieval / refresh logic if needed
- central auth utility

#### `accusourceProfiles.ts`
- create partial profile
- create full profile
- get profile by ID
- list profiles if needed

#### `accusourceReports.ts`
- download final report
- download drug report

#### `accusourceFiles.ts`
- upload files if needed later
- list files
- download file attachments

#### `accusourceWebhooks.ts`
- parse inbound events
- normalize event names
- route processing logic

#### `accusourceMapper.ts`
- map provider payloads to HRX models
- normalize statuses
- normalize timestamps / IDs

#### `accusourceSync.ts`
- manual profile sync
- report fetch after webhook receipt
- retry logic

---

## Ordering Modes

Support both ordering strategies in architecture now.

## A) Partial profile flow
Use when HRX does not yet have all required candidate data.

### Flow
1. HRX creates internal `backgroundChecks/{id}` record
2. HRX calls SourceDirect partial profile creation endpoint
3. SourceDirect returns profile info / partial link context
4. HRX stores `providerProfileId`
5. Candidate completes applicant portal flow
6. SourceDirect sends webhook updates
7. HRX updates status accordingly

### Use cases
- candidate still needs to enter SSN / DOB / consent / disclosures
- applicant must complete provider-hosted intake

---

## B) Full profile flow
Use when HRX already has all required data and consent workflow is complete.

### Flow
1. HRX creates internal record
2. HRX submits full profile with package / orders
3. HRX stores profile mapping
4. HRX waits for webhook updates
5. HRX fetches final reports when ready

### Use cases
- highly structured internal onboarding flow
- enough data collected in HRX
- approved package logic defined

---

## Recommended first implementation
Start with:
1. **Partial profile flow**
2. Webhook handling
3. Final / drug report retrieval
4. Recruiter UI

That gives you fast practical value with lower implementation risk.

---

## Webhooks to Configure First

In SourceDirect portal, prioritize these webhook events:

### Must-have
- `Profile Completed`
- `Final Report Ready`
- `Drug Report Ready`
- `Service Status Changes`
- `Profile Data Changes`

### Recommended secondary events
- `Order Completed`
- `Report Completed`
- `Drug Order Updates`
- `Partial Profile Link`

### Initial endpoint recommendation
Use a single HRX endpoint:
```text
POST /api/integrations/accusource/webhooks
```

Then dispatch internally by webhook type.

### Why one endpoint
- simpler configuration in SourceDirect
- centralized logging
- easier auth / verification
- easier replay and debugging

---

## Webhook Processing Design

## 1) Receive event
At the HTTP handler:
- validate request
- parse type
- write raw event to logs / Firestore
- return 200 quickly after safe acceptance
- process downstream in code / queue pattern if needed

## 2) Find matching background check
Primary match order:
1. `providerProfileId`
2. `clientId`
3. fallback lookup strategy if necessary

## 3) Append event record
Write to:
```text
backgroundChecks/{id}/events/{eventId}
```

## 4) Update parent record
Examples:
- set `profileCompleted = true`
- set `finalReportReady = true`
- set `drugReportReady = true`
- update `providerStatus`
- update `hrxStatus`
- update `lastWebhookAt`
- update `lastWebhookType`

## 5) Trigger downstream actions
For key events:
- fetch latest profile snapshot
- fetch report PDF
- store report file in Cloud Storage / Firebase Storage
- create activity log
- notify recruiter if desired

---

## Suggested HRX Status Mapping

### Internal `hrxStatus`
Recommended lifecycle:
- `draft`
- `queued`
- `submitted`
- `awaiting_applicant`
- `in_progress`
- `report_ready`
- `drug_report_ready`
- `completed`
- `canceled`
- `error`

### Mapping logic examples
- After partial/full create succeeds → `submitted`
- If partial profile link issued and applicant action required → `awaiting_applicant`
- If service status changes begin → `in_progress`
- If final report ready only → `report_ready`
- If drug report ready only → `drug_report_ready`
- If all required reports/services complete → `completed`
- If provider returns unrecoverable failure → `error`

### Important
Do not depend on one provider status value only.
Use a normalized HRX status and keep raw provider status in separate fields.

---

## Report Retrieval Strategy

When receiving:
- `Final Report Ready`
- `Drug Report Ready`

HRX should:

1. confirm the parent record exists
2. log the event
3. call the relevant report download endpoint
4. store the file in Firebase Storage / Cloud Storage
5. update the parent document with:
   - storage path
   - downloaded timestamp
   - readiness flag
6. create recruiter/compliance activity entry

### Suggested storage path
```text
background-checks/{backgroundCheckId}/final-report.pdf
background-checks/{backgroundCheckId}/drug-report.pdf
```

If provider returns non-PDF content, preserve correct file extension/type.

---

## HRX Admin / Recruiter UI

## Recommended module placement
Build this as a first-class HRX module tied to:
- candidate profile
- account / customer
- job order
- compliance workflows

### Suggested tabs or sections on a background-check detail page
- Overview
- Timeline
- Services
- Reports
- Raw Provider Data (admin-only)
- Sync / Debug (admin-only)

### Overview section
Show:
- candidate
- account
- job order / worksite
- provider
- package / requested services
- created date
- current HRX status
- provider status
- profile completed
- final report ready
- drug report ready

### Timeline section
Show all normalized events:
- ordered
- applicant completed profile
- service updates
- report ready
- report downloaded
- sync errors

### Reports section
Show:
- final report download/view
- drug report download/view
- timestamps

### Debug/admin section
Show:
- providerProfileId
- clientId
- last webhook type
- last webhook timestamp
- sync error
- raw payload snapshots if useful

---

## Permissions

Recommended:
- recruiter / compliance / admin roles can view assigned records
- only privileged users can:
  - manually resync
  - download raw provider attachments if sensitive
  - view raw provider payloads
  - retry failed processing
  - configure package/order logic

If HRX has security levels, map this to existing security system.

---

## Recommended First Build Scope

### Phase 1
1. Firestore schema
2. SourceDirect HTTP client
3. Partial profile creation
4. Single webhook endpoint
5. Event log write
6. Parent status updates
7. Final/drug report fetch and storage
8. Read-only background-check detail page
9. Candidate/account/job-order links

### Phase 2
1. Full profile creation
2. Package selection UI
3. Service-level status UI
4. Manual sync / retry
5. Report preview UX
6. Compliance notifications

### Phase 3
1. Pre-adverse action support
2. File upload support
3. multi-provider abstraction
4. advanced package rules by account/worksite
5. decision source workflows

---

## Cloud Functions / Endpoint Suggestions

### Public HTTPS webhook
```text
POST /api/integrations/accusource/webhooks
```

### Callable / internal admin functions
```text
createAccusourceBackgroundCheck()
syncAccusourceProfile()
downloadAccusourceFinalReport()
downloadAccusourceDrugReport()
retryAccusourceWebhookProcessing()
```

### Scheduled functions
Optional:
```text
accusourceBackfillSyncJob
```
Use only as a safety net, not as the primary status strategy.

---

## Error Handling Rules

### General principles
- never silently swallow webhook failures
- always log raw payload first if safe
- always preserve an event trail
- do not mark parent record complete unless required conditions are met
- do not assume webhook ordering is perfect

### Recommended error states
If report download fails after a `Final Report Ready` webhook:
- keep `finalReportReady = true`
- set `syncError`
- add event log with processing error
- allow manual retry

### Idempotency
Webhook processing must be idempotent.
If the same webhook arrives twice:
- do not duplicate side effects
- safe-upsert event records
- safe-update parent record

---

## Security / Compliance Notes

### Sensitive data
Background check data is sensitive.
Keep strict controls around:
- raw report storage
- raw payload access
- file downloads
- debug views

### Storage rules
Restrict storage access to authorized roles only.

### Firestore rules
Restrict:
- parent background check docs
- event logs
- raw provider payload snapshots

### Server enforcement
Any function that downloads or returns report files should verify user permissions server-side.

---

## Mapping to Accounts / Worksites / Customers

HRX should support account/worksite-specific rules.
Store rule references on the account or worksite such as:
- default package ID
- package label
- whether drug screening required
- whether partial or full profile flow required
- compliance escalation rules

This lets HRX evolve into the screening orchestration layer.

---

## Recommended UI Labels

### Module name
Use:
- `Background Checks`
or
- `Screenings`

### Row/table columns
- Candidate
- Account
- Worksite
- Package
- Status
- Final Report
- Drug Report
- Updated

### Detail page actions
- Refresh Status
- View Final Report
- View Drug Report
- Open Provider Profile (admin)
- Retry Sync (admin)

---

## What Not To Build Yet
Do not overbuild in version 1.

Avoid for now:
- provider-agnostic abstraction layers that slow shipping
- too many package-management screens
- automated adverse action flows before basics work
- custom PDF parsing
- complex analytics dashboards
- candidate self-service report viewer unless needed

Ship the operational backbone first.

---

## Acceptance Criteria

This phase is successful when:

1. HRX can create a background-check record internally
2. HRX can create a SourceDirect profile (starting with partial profile is acceptable)
3. HRX stores `clientId` and `providerProfileId`
4. SourceDirect webhook events hit HRX successfully
5. HRX logs each event in Firestore
6. HRX updates parent status fields correctly
7. HRX can fetch and store final reports
8. HRX can fetch and store drug reports
9. Recruiters/admins can view the status and timeline inside HRX
10. Failed webhook/report sync attempts are visible and retryable

---

## Final Note to Cursor
Build this as a durable operational integration, not a one-off API hookup.

HRX should become the internal system that explains:
- what was ordered
- who it belongs to
- what is still pending
- what completed
- where the report is
- what happened at each step

SourceDirect is the provider.
HRX is the platform.
