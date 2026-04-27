# Canonical Job Order / Assignment model (locked)

**Status:** Approved architecture rulebook. Sprint 1+ execution aligns code and data to this document.

## Canonical objects

| Object | Path / anchor | Role |
|--------|----------------|------|
| Company | `tenants/{tid}/crm_companies/{companyId}` | Canonical CRM company |
| Location (worksite) | `tenants/{tid}/crm_companies/{companyId}/locations/{locationId}` | Canonical worksite of record |
| Account | `tenants/{tid}/accounts/{accountId}` | Canonical operational customer |
| Job order | `tenants/{tid}/job_orders/{jobOrderId}` | Canonical staffing request / fulfillment center when posting is linked |
| Shift | `tenants/{tid}/job_orders/{jobOrderId}/shifts/{shiftId}` | Canonical shift |
| Posting | `tenants/{tid}/job_postings/{postId}` | Canonical acquisition / marketing surface |
| Application | `tenants/{tid}/applications/{applicationId}` | Canonical application (only collection for lifecycle) |
| Assignment | `tenants/{tid}/assignments/{assignmentId}` | Canonical worker-facing outcome |
| Placement | `tenants/{tid}/placements/{placementId}` | Supporting / minimal staging |
| User group | `tenants/{tid}/userGroups/{groupId}` | Canonical labor pool / targeting |
| Nested applications | `job_orders/.../applications` | Legacy — drain only |
| `users.{applicationIds}` | Index / projection | Not authoritative |

## Invariants

1. **Linked:** At most one **open** application per `(tenantId, userId, jobOrderId)` when `jobOrderId` is set.
2. **Standalone:** At most one **open** application per `(tenantId, userId, postId)` when `jobOrderId` is null.
3. **Terminal application statuses (duplicate prevention):** `accepted`, `rejected`, `withdrawn`. **`accepted` is terminal** for duplicate-open on the same user×JO unless a future reapply rule is added.
4. **Posting linked:** Job order owns fulfillment; posting owns attribution (`postId` on application), not pipeline state.
5. **Assignments:** Created at placement time; `pending` → worker confirmation → `confirmed` / `in_progress` / etc.
6. **Worker schedule:** Assignment row + shift lookup.

## Job order lock event (default)

**First publish / first open for fulfillment** snapshots inherited operational details (PPE, uniform, instructions, etc.) onto the job order per field policy in this spec.

## Lifecycle enums (locked)

- **Application:** `submitted` | `under_review` | `interview` | `offer_pending` | `accepted` | `rejected` | `withdrawn` | `waitlisted`
- **Assignment:** `pending` | `confirmed` | `in_progress` | `completed` | `cancelled` (legacy strings map via `assignmentStatusNormalize`)
- **Placement (optional):** `active` | `superseded`
- **Posting:** `draft` | `posted` | `paused` | `closed`
- **Job order:** `draft` | `open` | `on_hold` | `cancelled` | `filled` | `completed`

## Shared modules

- Web: `shared/applicationStatus.ts` → `src/utils/applicationStatusNormalize.ts`
- Functions: `functions/src/utils/applicationStatusNormalize.ts` (**keep in sync** with `shared/applicationStatus.ts`)

## Sprint scope

See `docs/APPLICATION_STORAGE_MIGRATION.md` for phased migration. Sprint 1 does **not** move nested applications or listeners.
