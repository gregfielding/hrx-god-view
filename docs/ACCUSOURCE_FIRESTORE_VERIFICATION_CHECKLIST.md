# AccuSource Firestore Verification Checklist

Practical validation checklist for Phase 2 create flow + webhook reconciliation.

## Preconditions

- Functions deployed: `testCreateAccusourceBackgroundCheck`, `createAccusourceBackgroundCheck`, `apiIntegrationsAccusourceWebhooks`
- Runtime env configured for AccuSource (`ACCUSOURCE_ENABLED`, API key/base URL, etc.)
- Test run order:
  1. callable create
  2. providerProfileId webhook
  3. clientId fallback webhook
  4. unmatched/negative webhook

---

## Phase 1: Callable create test

### Inspect paths

- Parent doc: `backgroundChecks/{backgroundCheckId}`
- Mirrored events: `backgroundChecks/{backgroundCheckId}/events/*`

### Fields that must exist (parent)

- `provider = "accusource"`
- `providerEnvironment` (`sandbox` or `production`)
- `clientId = "HRX-BGC-{backgroundCheckId}"`
- `providerClientId` (usually same as `clientId` unless provider overrides)
- `orderMode = "partial_profile"`
- `hrxStatus` in `{ "submitted", "awaiting_applicant" }` on success OR `"error"` on failure
- `createdAt`, `updatedAt`

### Fields that may be optional (parent)

- `providerProfileId` (required for successful provider create, absent on error)
- `providerStatus`
- `applicantPortalLink`
- `requestedPackageId`, `requestedPackageName`, `requestedServices`
- `jobOrderId`, `worksiteId`, `candidateId`, `accountId`, names
- `syncError` (should be `null` on success; populated on error)
- `lastSyncAt`

### Expected status transition

- `draft` (initial set) -> `submitted` or `awaiting_applicant`
- On provider failure: `draft` -> `error`

### Event expectations

- Must include `CREATE_DRAFT`
- Then either:
  - `CREATE_SUBMITTED` (success path), or
  - `CREATE_ERROR` (failure path)

### Mismatch criteria

- Missing `clientId` pattern `HRX-BGC-{backgroundCheckId}`
- `provider` not `accusource`
- Success return but `providerProfileId` missing
- Success return but no `CREATE_SUBMITTED` event
- `hrxStatus` not in expected success/error set

---

## Phase 2: ProviderProfileId webhook match

### Inspect paths

- Parent doc: `backgroundChecks/{backgroundCheckId}`
- Mirrored event: `backgroundChecks/{backgroundCheckId}/events/{eventId}`
- Global intake: `integrations_accusource_webhook_events/{eventId}`

### Fields that must exist/update

- Parent:
  - `lastWebhookType = "final_report_ready"` (for this test payload)
  - `lastWebhookAt` timestamp
  - `providerStatus = "report_ready"`
  - `hrxStatus = "report_ready"`
  - `finalReportReady = true`
  - `profileCompleted = true` (if payload indicates completed profile)
- Global intake:
  - `processingStatus = "processed"`
  - `matchedBackgroundCheckId = {backgroundCheckId}`
  - `providerProfileId` equals payload
- Mirrored event:
  - `type = "final_report_ready"` (or normalized event type used by your mapper)
  - `processingStatus = "processed"`

### Fields that may be optional

- `drugReportReady` (depends on payload/event type)
- `orderCompleted` (depends on payload/event type)
- `payload` snapshots

### Expected status transition

- Typical: `submitted|awaiting_applicant` -> `report_ready`

### Mismatch criteria

- Intake marked processed but parent not updated
- Parent updated but no mirrored event created
- `matchedBackgroundCheckId` missing/wrong despite providerProfileId match
- `lastWebhookType` not reflecting inbound event type

---

## Phase 3: ClientId fallback webhook match

### Inspect paths

- Parent doc: `backgroundChecks/{backgroundCheckId}`
- Mirrored event under parent
- Global intake event

### Fields that must exist/update

- Parent:
  - `lastWebhookType = "applicant_invited"` (for this payload)
  - `lastWebhookAt` timestamp
  - `providerStatus = "awaiting_applicant"`
  - `hrxStatus = "awaiting_applicant"`
- Global intake:
  - `processingStatus = "processed"`
  - `matchedBackgroundCheckId = {backgroundCheckId}`
  - `clientId` equals payload

### Fields that may be optional

- `applicantPortalLink` refreshed from payload if mapper supports it
- Other booleans unchanged from previous state unless payload maps them

### Expected status transition

- Usually: `submitted|report_ready` -> `awaiting_applicant` only if mapper allows this event to set it
- If business rule is "report_ready should not regress," this should be documented and enforced

### Mismatch criteria

- `clientId` payload exists but no matched parent record
- Intake shows processed with wrong `matchedBackgroundCheckId`
- Parent webhook stamps update but status fields remain stale against mapper rules

---

## Phase 4: Negative/unmatched webhook

### Inspect paths

- Global intake: `integrations_accusource_webhook_events/{eventId}`
- Parent doc: verify target `backgroundChecks/{backgroundCheckId}` did **not** change

### Fields that must exist/update

- Global intake:
  - `processingStatus = "ignored"`
  - `processingError = "no_background_check_match"`
  - `providerProfileId`/`clientId` captured from payload when present
- Parent:
  - No mutation to `lastWebhookAt`, `lastWebhookType`, `providerStatus`, `hrxStatus`

### Fields that may be optional

- Extra diagnostics in intake payload snapshot

### Expected status transition

- None on any parent `backgroundChecks` record

### Mismatch criteria

- Unmatched intake event updates any parent record
- Intake processing status not `ignored`
- Missing `processingError` reason for unmatched flow

---

## Expected created background check shape (reference)

`backgroundChecks/{backgroundCheckId}` expected shape for successful create:

- Identity/linkage:
  - `provider: "accusource"`
  - `providerEnvironment: "sandbox" | "production"`
  - `clientId: "HRX-BGC-{backgroundCheckId}"`
  - `providerClientId: string`
  - `providerProfileId: string`
  - `orderMode: "partial_profile"`
- HRX/provider state:
  - `hrxStatus: "submitted" | "awaiting_applicant" | "report_ready" | "error"` (depending on lifecycle)
  - `providerStatus: string | null`
  - `finalReportReady: boolean`
  - `drugReportReady: boolean`
  - `profileCompleted: boolean`
  - `orderCompleted: boolean`
- Candidate/account/job linkage:
  - `tenantId`, `accountId`, `accountName`
  - `candidateId`, `candidateName`, `applicantId`
  - `jobOrderId`, `worksiteId`
- Provider response:
  - `applicantPortalLink` (if returned)
  - `lastProviderProfileSnapshot` (raw provider payload if stored)
- Reconciliation/audit:
  - `lastWebhookAt`, `lastWebhookType`
  - `lastSyncAt`
  - `syncError`
  - `createdAt`, `updatedAt`

Subcollection:
- `backgroundChecks/{backgroundCheckId}/events/*` includes create/webhook event timeline

Global intake:
- `integrations_accusource_webhook_events/{eventId}` stores all inbound webhook attempts (processed/ignored/duplicate/error)

