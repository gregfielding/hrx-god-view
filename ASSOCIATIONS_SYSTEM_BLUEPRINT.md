# Associations System Blueprint

Living reference for how entity connections (associations) are modeled, written, read, and synchronized across the platform.

## Goals
- Single source of truth for UI reads: deal document `associations` map (observed via onSnapshot)
- Fast filtering/querying via denormalized ID arrays
- Symmetric writes (deal ↔ entity reverse index), with Cloud Functions keeping snapshots fresh
- Minimal, render‑only snapshots; no deep nesting
- Idempotent migrations and rebuilders for recovery

## Entities and Types
- Entities: `deal`, `company`, `contact`, `salesperson` (user), `location`
- Association types (plural keys on a deal): `companies`, `contacts`, `salespeople`, `locations`

## Association Entry (applies to every type)
```json
{
  "id": "string",                 // entity id
  "tenantId": "string",
  "type": "company|contact|salesperson|location",
  "snapshot": { /* type-specific render fields only */ },
  "isPrimary": true,
  "relationship": "owner|member|stakeholder",
  "addedBy": "uid",
  "addedAt": "timestamp",
  "updatedAt": "timestamp",
  "removedBy": "uid?",            // soft-delete optional
  "removedAt": "timestamp?",
  "source": "ui|import|api",
  "schemaVersion": 1,
  "confidence": 1.0                // optional for auto-enrichment
}
```

### Per-type snapshot schemas (lean)

Salesperson `snapshot`:
```json
{
  "displayName": "string",
  "firstName": "string?",
  "lastName": "string?",
  "email": "string?",
  "phone": "string?",
  "departmentId": "string?",
  "locationIds": ["string"],
  "jobTitle": "string?",
  "membership": {                  // current-tenant membership only
    "tenantId": "string",
    "status": "active|inactive",
    "securityLevel": 3,
    "role": "Tenant?"
  },
  "integrations": {                // optional; include only if needed for UI badges
    "gmail": true,
    "calendar": true,
    "lastVerifiedAt": "timestamp"
  },
  "avatarUrl": "string?"
}
```

Contact `snapshot`:
```json
{
  "fullName": "string",
  "firstName": "string?",
  "lastName": "string?",
  "email": "string?",
  "phone": "string?",
  "title": "string?",
  "linkedInUrl": "string?",
  "companyId": "string",
  "companyName": "string",
  "preferredName": "string?",
  "avatarUrl": "string?",
  "isDecisionMaker": false,
  "level": "user|manager|executive?"
}
```

Company `snapshot`:
```json
{
  "name": "string",
  "domain": "parkerplastics.net?",
  "website": "https://...?",
  "phone": "string?",
  "industry": "string?",
  "city": "string?",
  "state": "string?",
  "logoUrl": "string?",
  "logoStoragePath": "string?",
  "lastLogoUpdatedAt": "timestamp?"
}
```

Location `snapshot`:
```json
{
  "companyId": "string",
  "companyName": "string",
  "nickname": "string?",
  "name": "string?",
  "addressLine1": "string?",
  "city": "string",
  "state": "string",
  "zipCode": "string?",
  "country": "string?",
  "coordinates": { "lat": 0, "lng": 0 },
  "isHq": false
}
```

## Deal Document Shape (source of truth for UI)
```json
{
  "associations": {
    "companies":   [AssocEntry<CompanySnapshot>],
    "contacts":    [AssocEntry<ContactSnapshot>],
    "salespeople": [AssocEntry<SalespersonSnapshot>],
    "locations":   [AssocEntry<LocationSnapshot>]
  },
  "companyIds":    ["string"],     // denormalized ID arrays for fast filters
  "contactIds":    ["string"],
  "salespersonIds": ["string"],
  "locationIds":   ["string"],
  "primaryCompanyId": "string?",
  "lastSnapshotRefreshedAt": "timestamp",
  "snapshotFingerprint": "hash?"
}
```

## Reverse Index (on each associated entity)
- `users/{uid}.associations.deals: [{ dealId, addedAt, updatedAt }]`
- `tenants/{t}/crm_contacts/{id}.associations.deals: [...]`
- `tenants/{t}/crm_companies/{id}.associations.deals: [...]`
- `tenants/{t}/crm_companies/{cid}/locations/{lid}.associations.deals: [...]`

This enables fan‑out updates when an entity changes.

## Write Flows

Add association (UI or API):
1) UI calls `manageAssociations` callable with add action
2) Callable appends `AssocEntry` to `deal.associations.<type>` and updates denormalized arrays
3) Callable appends `{dealId}` to entity reverse index `associations.deals`

Remove association:
1) UI calls `manageAssociations` callable with remove action
2) Callable removes from deal and entity reverse index
3) Callable recomputes denormalized arrays/primary flags

All write helpers are idempotent (dedupe by `id`).

## Triggers and Jobs

Cloud Functions:
- onWrite(User/Contact/Company/Location):
  - Read `associations.deals` and update each deal’s corresponding `snapshot` + `updatedAt`
- onWrite(Deal associations arrays):
  - Maintain denormalized ID arrays and primary fields
- Callable rebuilders:
  - `rebuildDealAssociations(dealId)`
  - `rebuildEntityReverseIndex(entityRef)`
- Optional nightly job to refresh stale snapshots (e.g., >30 days)

## Query & UI Read Patterns
- Lists/filters use denormalized ID arrays (e.g., `where('companyIds', 'array-contains', companyId)`).
- Detail panels read from `deal.associations` only (onSnapshot).
- If snapshots missing, UI may fall back to a single read and enqueue a rebuild.

## Conventions
- Flat arrays per type (no company→contacts nesting)
- All IDs are strings; camelCase field names
- Keep snapshots small and render-focused; volatile fields only when needed
- Soft-delete support via `removedAt/removedBy`

## Migration Strategy (high level)
1) Prepare: ship dual-write triggers and dual-read UI (feature flags)
2) Build reverse indexes from legacy links
3) Backfill `deal.associations` snapshots + ID arrays (include company `logoUrl`)
4) Verify and sample-check; emit JSON/CSV reports
5) Flip reads per-tenant; monitor
6) Clean up legacy-only fields after stability window

Scripts are idempotent, chunked, and resumable, with `migrationVersion` and `migratedAt` markers.

## Versioning & Change Management
- `schemaVersion` on entries
- Additive changes only; deprecate fields behind flags
- Keep this document updated alongside function/UI changes

## Troubleshooting Checklist
- Missing associations in UI: check `deal.associations` exists and `companyIds/contactIds/...` populated
- Stale names/emails: confirm entity `associations.deals` and trigger logs for fan-out updates
- Filters slow: ensure denormalized arrays are present and indexed
- Conflicts: verify idempotency in write helpers and dedupe by `id`

---
Owner: Platform/CRM
Last updated: 2025-08-12
Scope: All tenants

