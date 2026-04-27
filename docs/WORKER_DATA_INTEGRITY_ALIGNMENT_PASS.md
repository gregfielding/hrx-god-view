# Worker Data Integrity Alignment Pass

This pass prioritizes backend/data integrity and core workflow reliability across:

1. Job Readiness write-model alignment (top priority)
2. Notifications + Inbox contract alignment
3. Assignment accept/decline flow validation and auditability

## 1) Canonical Schema (Current Target)

### A. Worker readiness/profile writes (`users/{uid}`)

- `workerProfile.skills: string[] | FieldValue`
- `workerProfile.languages: string[] | FieldValue`
- `workerProfile.experience.educationLevel: string`
- `workerProfile.experience.level: string`
- `workerProfile.credentials.certifications: Array<{name?: string, ...}> | FieldValue`
- `workerProfile.readiness.responses.{requirementId}.value: string`
- `workerProfile.readiness.responses.{requirementId}.answeredAt: Timestamp`
- `workerProfile.readiness.requirementsAcks.{ackKey}: string`
- `workerAttestations.backgroundCheckWillingness: string`
- `workerAttestations.drugScreeningWillingness: string`
- `workerAttestations.eVerifyWillingness: string`
- `workerAttestations.additionalScreenings.{screeningKey}: string`

Legacy compatibility remains active (dual-write), including:
- `skills`, `languages`, `educationLevel`, `experienceLevel`, `certifications`
- `comfortablePassBackground`, `comfortablePassDrug`, `comfortableEVerify`
- `requirementsAcks`, `additionalScreenings`
- `jobReadinessEngineResponses`

### B. Worker notifications (`users/{uid}/notifications/{notificationId}`)

Existing canonical core:
- `uid`, `tenantId`, `type`, `category`, `title`, `body`, `createdAt`, `readAt`, `deepLink`

Contract hardening fields added in this pass:
- `schemaVersion: 1`
- `routing: { deepLink, ctaUrl, entityId, threadId }`
- `delivery: { inbox?: {...}, push?: {...}, sms?: {...} }`
- `deliveryStatus: "inbox_written" | "queued" | "sent" | "failed"`

Notes:
- Inbox durability is still primary (write always first).
- Push status now records `sent`/`failed` attempts at document level.

### C. Assignment decision audit (`tenants/{tenantId}/applications/{applicationId}`)

- `lastAssignmentDecision: {`
  - `decision: "accept" | "decline"`
  - `assignmentId: string`
  - `shiftId: string | null`
  - `entryPoint: "accept_button" | "decline_button" | "offer_confirmation_drawer" | "unknown"`
  - `byUid: string`
  - `at: Timestamp`
- `}`

`workerOfferConfirmation` remains canonical for acceptance acknowledgement state.

## 2) Old -> New Mapping (This Pass)

### Job Readiness / Worker profile writes

- `skills` -> `workerProfile.skills` (dual-write retained)
- `languages` -> `workerProfile.languages` (dual-write retained)
- `educationLevel` -> `workerProfile.experience.educationLevel` (dual-write retained)
- `experienceLevel` -> `workerProfile.experience.level` (dual-write retained)
- `certifications` -> `workerProfile.credentials.certifications` (dual-write retained)
- `comfortablePassBackground` -> `workerAttestations.backgroundCheckWillingness`
- `comfortablePassDrug` -> `workerAttestations.drugScreeningWillingness`
- `comfortableEVerify` -> `workerAttestations.eVerifyWillingness`
- `requirementsAcks` -> `workerProfile.readiness.requirementsAcks` (dual-write retained)
- `additionalScreenings` -> `workerAttestations.additionalScreenings` (dual-write retained)

### Notifications/inbox fields

- `deepLink` + `ctaUrl` + `entityId` + `threadId` (flat) -> retained + normalized under `routing`
- implicit state/no delivery structure -> explicit `delivery` + `deliveryStatus`

### Assignment accept/decline traceability

- implicit client action path only -> explicit `lastAssignmentDecision` audit record on application doc
- accept activity logging already existed; decline now logs activity via `logAssignmentUpdateActivity(..., "declined")`

## 3) Entry Point Validation Notes

Validated accept/decline paths in `JobPostingDetail`:
- Accept from confirmation drawer:
  - persists `workerOfferConfirmation`
  - routes through shared `handleAssignmentDecision("accept")`
  - writes `lastAssignmentDecision` with `entryPoint = "offer_confirmation_drawer"`
- Decline button paths:
  - route through shared `handleAssignmentDecision("decline")`
  - write `lastAssignmentDecision` with `entryPoint = "decline_button"`
  - now logs decline assignment activity

## 4) Legacy Fields Still Active (Intentional)

To avoid breaking current reads/UI, the following are still written:
- top-level profile fields (`skills`, `languages`, `educationLevel`, `experienceLevel`, `certifications`)
- top-level willingness and requirement keys (`comfortable*`, `requirementsAcks`, `additionalScreenings`)
- `jobReadinessEngineResponses`

These should be removed only after read-path retirement and migration verification.

## 5) Known Risks / Incomplete Areas

1. Read-side legacy dependency remains
- Several readiness/profile readers still reference top-level legacy fields in fallback chains.
- Dual-write is active, but full source-of-truth flip is not complete.

2. Notification producer variance
- Some older notification producers may not yet set enriched metadata for routing/entity details.
- Frontend now supports both legacy flat fields and new `routing` envelope.

3. Push delivery semantics
- Notification durability is guaranteed via inbox write first.
- Push failures are recorded and do not currently fail the entire function call (intentional reliability tradeoff).

4. Assignment decision auditing coverage
- This pass adds structured decision audit writes in worker-facing job detail flow.
- Other assignment decision entry points (if any outside this flow) should be audited to emit the same `lastAssignmentDecision` contract.

## 6) Recommended Next Integrity Pass

1. Read-model retirement pass
- Move readiness/profile reads to canonical-only with explicit temporary fallback adapter.

2. Notification contract enforcement
- Add shared server-side validator for notification docs (schemaVersion/routing/delivery).
- Backfill recent notification docs for `routing` and `deliveryStatus`.

3. Assignment decision consistency
- Standardize audit writes in all callable/function entry points (not only this page flow).
- Add server-side activity log guarantee for both accept and decline outcomes.
