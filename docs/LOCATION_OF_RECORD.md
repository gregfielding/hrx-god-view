# Location of record

## Canonical worksite

**Source of truth:** `tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}`

## Mirrors / legacy (not independent truths)

- `tenants/{tid}/crm_locations/{id}` — mirror / index; do not edit without syncing to canonical
- `tenants/{tid}/company_locations` — projection / fast listing
- `tenants/{tid}/locations/{id}` — legacy or derived geo; **do not** use as sole source for new assignment geo after migration (see `placementsApi` roadmap)

## Job order / assignment

- Job order stores `companyId`, `worksiteId` (location id), and denormalized address for display
- New assignment rows should resolve lat/lng from **canonical** location doc (post–Sprint 1 work)

## Sprint 1

No code changes to location resolution — documentation only.
