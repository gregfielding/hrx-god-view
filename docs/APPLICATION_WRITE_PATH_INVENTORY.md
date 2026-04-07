# Application write-path inventory

Canonical storage is `tenants/{tenantId}/applications/{applicationId}`. Legacy nested job-linked docs under `tenants/{tenantId}/job_orders/{jobOrderId}/applications` are not used by the app (PR4–PR6). Recruiter UI and job-order teardown do not read or delete that path.

## Phase 2 service

| Area | Behavior |
|------|----------|
| `src/services/phase2/applicationService.ts` | Job-linked **creates** and **reads / updates / deletes** use tenant `applications` only. **`getApplicationsByJobOrder`** queries tenant `applications` by `jobOrderId` (no nested merge). |

## Nested path (legacy)

| Area | Behavior |
|------|----------|
| Historical nested docs | Not used by HRX client code after PR6. Ops may still use `consolidation:scan-nested` to confirm empty subcollections in a project. |

## Tenant-level (canonical)

| Area | Behavior |
|------|----------|
| `src/components/apply/Wizard.tsx` | Submitted applications are written to `tenants/{tid}/applications`. |
| `src/utils/quickApplicationSubmit.ts` | `setDoc` to `tenants/{tid}/applications/{id}`. |
| `src/pages/RecruiterJobOrderDetail.tsx` | Manual add / switch-job flows create or update tenant `applications`. Applicant table loads from tenant `applications` only. |
| `functions/src/placementsApi.ts` | Placement/assignment flows create or reference tenant `applications`. |

## Client-only merge metadata (removed)

Previously `applicationDualReadMerge.ts` merged tenant + nested snapshots for display. **Removed (PR4).** Use `consolidation:scan-nested` and sprint consolidation docs for ops history.
