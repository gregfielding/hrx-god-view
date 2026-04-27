# Staffing Launch Canonical Contract (Web/Admin/Backend)

Last updated: 2026-03-12

This document is the launch source of truth for staffing data contracts used by web/admin/backend.
Flutter/mobile should align to this document.

## Canonical Collection Paths

- Job postings: `tenants/{tenantId}/job_postings/{postId}`
- Applications: `tenants/{tenantId}/applications/{applicationId}`
- Assignments: `tenants/{tenantId}/assignments/{assignmentId}`
- Shifts: `tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}`
- Placements (recruiter queue): `tenants/{tenantId}/placements/{placementId}`

## Canonical Identity Rules

### Job postings
- Canonical identity: Firestore doc id (`postId`) in `job_postings`.
- Cross-reference fields used downstream: `jobOrderId`, `jobType`, `companyName`, `worksiteName`.

### Applications
- Canonical identity field: `applicationId` is the Firestore doc id.
- Current creation patterns (both are live):
  - Worker apply flow: deterministic id `${userId}_${jobId}`.
  - Assignment/manual backend flow: Firestore auto-id.
- Canonical linkage fields (do not infer from id):
  - `userId` (or legacy alias `candidateId`)
  - `jobId`/`postId` (job posting id)
  - `jobOrderId`
  - `shiftId` and/or `shiftIds` (gig/day matching)
  - `assignmentId` when linked

### Assignments
- Canonical identity (launch rule):
  - Day-scoped: `${shiftId}__${userId}__${yyyy-mm-dd}` for gig/day-specific assignments.
  - Legacy fallback accepted for older records: `${shiftId}__${userId}`.
- Canonical linkage fields:
  - `tenantId`, `jobOrderId`, `shiftId`, `userId`
  - `startDate`, `endDate`
  - `applicationId`, `jobPostId`

## Canonical Status Vocabularies

### Application statuses (worker-facing staffing lifecycle)
- `draft`
- `in_progress`
- `submitted`
- `waitlisted`
- `rejected`
- `offer`
- `accepted` (placement-linked acceptance state)
- `confirmed`
- `withdrawn`
- `deleted` (admin removal state)

Notes:
- `accepted` and `confirmed` both exist in live flows.
- `accepted` is used by placement/assignment linkage.
- `confirmed` is used when worker/recruiter confirms assignment.

### Assignment statuses
- `proposed`
- `confirmed`
- `active`
- `completed`
- `declined`
- `cancelled` (canonical spelling)
- `canceled` (legacy spelling still observed; treat as alias)

## Gig Shift/Day Contract (Launch)

- Gig assignment identity is day-specific and must include date in doc id.
- Assignment creation must prevent duplicates across:
  - canonical day-scoped id
  - legacy id fallback
- Application-to-assignment matching must use shift linkage fields:
  - `shiftId`
  - `shiftIds` (array)

## Notification Dedupe Contract (Launch)

- Dedupe persistence path: `tenants/{tenantId}/notification_dedupe/{dedupeKey}`
- Required dedupe dimensions:
  - entity id (`applicationId` or `assignmentId`)
  - event type (created/status changed)
  - transition key (`oldStatus -> newStatus`) and update token

## Remaining Drift Risks (Known)

- Dual application id creation strategy (deterministic + auto-id) is still active.
- Application status dual-vocabulary (`accepted` + `confirmed`) remains live.
- Assignment status alias `canceled` may still appear on older records.
- Legacy docs/examples may still reference only `${userId}_${jobId}` as the application id pattern.

## Launch-Safe Admin Surface Guidance

- Launch-safe primary recruiter routes:
  - `/jobs/job-orders`
  - `/jobs/job-orders/:jobOrderId`
  - `/jobs/jobs-board`
- Legacy recruiter-prefixed routes should be treated as redirects only:
  - `/recruiter/*` routes are compatibility paths and should not be used for training or SOPs.
