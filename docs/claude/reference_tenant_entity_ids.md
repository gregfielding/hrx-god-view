# tenant entity ids

> Hardcoded production constants for the C1 Staffing tenant and its hiring entities — referenced in scripts, suppression logic, Everee routing, and deep links

The primary production tenant and its hiring entities:

- **Tenant**: `BCiP2bQ9CgVOCTfV6MhD` (C1 Staffing, LLC-SE)
- **Firebase project**: `hrx1-d3beb`
- **Custom domains**: `hrxone.com` (worker-facing — psychologically reads as the canonical app), `app.hrxone.com` (callable convention used by `inviteUser`/`resendInviteV2`). Both route to the same Firebase Hosting deploy.

Entities at `tenants/BCiP2bQ9CgVOCTfV6MhD/entities/`:

| Entity ID | Type | `evereeTenantId` | Notes |
|-----------|------|------------------|-------|
| `c1_select_llc` | W-2 + E-Verify | `"3133"` | `defaultRequirementPackageId: "w2_everify"` |
| `c1_events_llc` | 1099 contractor | `"3138"` | Events-only requirements (`ic_agreement`, no FUTA/SUTA) |
| `c1_workforce_llc` | W-2 no E-Verify | `null` | Not yet wired to Everee |

Hiring-entity scoping is derived from entity-name substring in `shared/seedEmployeeReadinessItems.ts` (`BASELINE_SELECT_REQUIREMENTS` / `BASELINE_EVENTS_REQUIREMENTS` / `BASELINE_WORKFORCE_REQUIREMENTS`).

Everee API surfaces:
- `https://api.everee.com/api/v2/...` — payables, workers, orgs.
- `https://api.everee.com/integration/v1/labor/...` — timesheets.
- Auth: HTTP Basic + `x-everee-tenant-id` header. The tenant id comes from the entity above.

Worker-facing deep-link convention: `https://hrxone.com/setup-password?oobCode=...&continueUrl=/c1/workers/payroll/{evereeTenantId}` — the trailing `evereeTenantId` skips the entity-picker step for the worker.
