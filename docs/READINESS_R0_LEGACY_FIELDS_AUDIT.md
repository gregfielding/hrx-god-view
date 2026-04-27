# Readiness R.0 — Legacy JO Fields Audit (deferred from R.0d)

**Status:** Stub. Not yet started. Created as part of PR 1 (R.0a + R.0d) per the spec's verify checklist.
**Parent:** `docs/READINESS_R0_HANDOFF.md`
**Owner:** TBD — pick one up after PR 1 lands.

---

## Why this ticket exists

R.0d narrowed its scope to soft-deprecate three confirmed-unused JO fields (`drugScreeningPanels`, `additionalTrainingRequired`, `onboardingRequirements`). Three more fields originally listed in the planning doc were deferred here because they may carry **informational legacy data** that should be migrated, not destroyed.

Hard-removing without an audit risks losing context the recruiting team still cares about. This ticket walks each field, decides its fate, and either soft-deprecates (parallel to R.0d) or proposes a migration plan.

---

## Fields to audit

| Field | Conceptual fate (per planning doc) | What we don't know yet |
|---|---|---|
| `siteSpecificOrientation` | "Informational, not readiness." Greg's note from the planning conversation. | Does the field exist on any JO doc with non-empty data? If yes, where is it surfaced today, and who consumes it? |
| `vehicleRequirements` | "Informational for us to know but not readiness." | Same — exists with data? Surfaced where? Used by anyone? |
| `healthAttestations` | "Part of Additional Screenings now." Implies migration into `additionalScreenings`, not destruction. | Exists with data? Schema of existing entries? Map cleanly to `additionalScreenings` items? |

---

## Audit checklist (per field)

For each of the three fields:

1. **Existence check.** Run a Firestore scan across `tenants/{tid}/job_orders/*` (and any nested compliance subpaths if applicable) for the field. Report: count of JOs with the field present, count with non-empty value, sample of distinct values.
2. **Type/schema review.** Confirm the actual data shape (is it a string? array? object?) vs what the TypeScript type currently claims.
3. **Consumer audit.** `rg` for read sites in:
   - `src/` (forms, displays, derivations, API responses)
   - `functions/src/` (triggers, webhooks, exports, AI prompt builders)
   - Reports / analytics surfaces (any dashboards, exports)
4. **Decision matrix:**
   - If **field doesn't exist on any JO** → soft-deprecate (drop from type + form input if any) following the R.0d pattern.
   - If **field exists with data but no live consumers** → soft-deprecate; flag for the same 90-day hard-remove follow-up.
   - If **field exists with data and live consumers** → keep as informational (rename / re-locate if needed; explicitly document "informational, not readiness"); leave the type alone but document so it's not mistaken for readiness input.
   - If **field exists with data that maps to an active field** (the `healthAttestations` → `additionalScreenings` hypothesis) → propose a migration: shape of the mapping, idempotency, how to handle conflicts on JOs that have both populated.

---

## Deliverables

- Audit report per field (a short doc or this file expanded with findings).
- For any field where the decision is "soft-deprecate" → a follow-up PR mirroring R.0d's pattern (`@deprecated` JSDoc, write-surface removal, no migration).
- For any field where the decision is "migrate" → a separate ticket scoping the migration, owner, dry-run, rollout plan.

---

## Bonus: also catch these `drugScreeningPanels` write surfaces in the 90-day sweep

PR 1's narrowed scope deliberately removed only the four write surfaces in the spec (`JobOrderForm`, `DealStageForms`, `AccountOrderDetailsForm`, `RequirementsSummary` in the drawer). During the audit the following **additional `drugScreeningPanels` write surfaces** were discovered — all in jobs-board / public-post derivation paths. They write empty arrays `[]` (so they're functionally inert post-R.0d), but they keep the field name alive on new `job_postings` docs:

| File | Lines | Notes |
|---|---|---|
| `src/components/JobPostForm.tsx` | 252, 425, 1143, 1363 | Public posting form — initializes `drugScreeningPanels: []` in form state and submit payloads |
| `src/components/recruiter/PostToJobsBoardDialog.tsx` | 82, 145 | Post-to-board dialog seed |
| `src/components/recruiter/GigJobsBoardToggle.tsx` | 287, 334 | Gig board toggle initializer |
| `src/pages/TenantViews/JobsBoard.tsx` | 404, 877, 948, 1219, 1380, 2090 | Recruiter jobs board (multiple post creation paths) |
| `src/services/recruiter/jobsBoardService.ts` | 772, 952 | Service-layer derivation when creating a post from a JO |
| `src/utils/fieldOptions.ts` | 90 | `getOptionsForField` switch case (currently no live caller after R.0d) |

Strip these in the 90-day hard-remove follow-up alongside the type field itself. None of them are doing anything useful today.

---

## Cross-references

- `docs/READINESS_R0_HANDOFF.md` — parent (R.0a + R.0d landed in PR 1)
- Planning doc: "Readiness System Rebuild — Planning Notes" (April 2026)
