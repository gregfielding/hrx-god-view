# Application storage migration playbook

**Canonical collection:** `tenants/{tenantId}/applications/{applicationId}`

**Legacy:** `tenants/{tenantId}/job_orders/{jobOrderId}/applications/{applicationId}`

## Phases (post–Sprint 1)

| Phase | Work |
|-------|------|
| 0 | Sprint 1: path helpers, shared status contract, docs, read-only validator |
| 1 | Dual-write (optional, short) if triggers require nested path |
| 2 | Dual-read: tenant first, nested fallback |
| 3 | Backfill nested → tenant |
| 4 | Move Cloud Function listeners to tenant `applications` |
| 5 | Remove nested writes; nested read-only then archive/delete |

## Sprint 1 safeguards (no execution)

- **Dual-read / dual-write:** not started
- **Backfill:** not started
- **Validator:** `npm run validate:applications -- --tenantId=<TID>` (`scripts/validateApplicationsInvariants.ts`) — duplicate open apps, optional `--user-scan-max=N` for `user.applicationIds` orphans. Set `GCLOUD_PROJECT` (or pass a service account with project). Exit **2** if duplicate opens found (report-only).

## Firestore indexes (checklist)

Add when queries ship (not required for Sprint 1 validator full scan):

- `applications`: `jobOrderId` + `userId` (composite, if filtering both)
- `applications`: `postId` or `jobId` + `userId` for standalone checks
- `applications`: `array-contains` on `shiftIds` + `userId` if needed

Document `firestore.indexes.json` updates in the PR that introduces each query.
