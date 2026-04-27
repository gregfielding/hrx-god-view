# Application listener & trigger dependency map (Sprint 2)

## Client (`onSnapshot`)

| Location | Collection / query | Purpose |
|----------|-------------------|---------|
| `src/components/recruiter/PlacementsTab.tsx` | `tenants/{tid}/assignments`, `tenants/{tid}/placements` (and variants) | Assignment/placement status for labor pool UI — **not** application documents. |
| `src/pages/RecruiterJobOrderDetail.tsx` | `tenants/{tid}/assignments` where `jobOrderId` | Assignment status chips on Applications tab. |

Application lists on job order detail and Placements use **one-shot** `getDocs` on tenant `applications` (PR4: tenant-only; no nested merge), not real-time listeners on `applications`.

## Cloud Functions (Firestore triggers)

### Tenant `applications` only

| Export / file | Document pattern |
|---------------|------------------|
| `onApplicationCreated`, `onApplicationStatusChanged` | `functions/src/applicationSmsTriggers.ts` → `tenants/{tenantId}/applications/{applicationId}` |
| `onApplicationCreatedPush` | `functions/src/triggers/onApplicationCreatedPush.ts` |
| `onApplicationWithdrawnOrDeletedCascadeAssignments` | `functions/src/shiftAssignmentCascades.ts` |
| `autoWithdrawApplicationsOnHire` | `functions/src/autoWithdrawApplicationsOnHire.ts` |
| `recruiterNotificationOnTenantApplicationCreated` | `functions/src/recruiterDashboardNotifications.ts` |

### Nested `job_orders/.../applications` (removed)

**PR5:** `recruiterNotificationOnJobOrderApplicationCreated` was **deleted** (no Cloud Function on nested application creates).

### Collection group / ad hoc reads

| File | Notes |
|------|--------|
| `functions/src/completeRequirementsReminder.ts` | `collectionGroup('applications')` — sees both tenant and nested paths. |

## Sprint 3+ notes

- New job-linked applications write to tenant `applications` only; **`recruiterNotificationOnTenantApplicationCreated`** handles recruiter dashboard notifications.
- Nested path: no create trigger (PR5). No client teardown of nested application docs (PR6).
