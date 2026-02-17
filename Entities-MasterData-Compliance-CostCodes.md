# Entity Master Data + Compliance + Cost Codes (Phase 1B Extension)
## Cursor Upload — Schema + UI + Future Hooks

Owner: Greg Fielding / HRX One  
Date: 2026-02-17  
Goal: Extend Entities to serve as the **single source of truth** for:
- GL / cost center codes (accounting exports)
- Jurisdictions / operating states (compliance + registrations)
- Central repository for state filing docs + state account numbers
- Workers’ Comp *base* info (carrier/policy) + future plan for WC class codes & rates

This doc is designed to integrate cleanly with the existing tenant-scoped structure and your current Entities UI.

---

## 0) Design Constraints & Principles

1) **Sensitive data separation**
   - FEIN, bank/ACH, and any credential-like values should live in a `private` subdoc (or encrypted store) and be unreadable to most users.
2) **Entities are legal employers / contracting parties**
   - All compliance records are tied to an entity + state.
3) **Job Orders select WC class codes + rates**
   - WC codes/rates are chosen per job order; entity provides defaults and carrier info.
4) **Versioned docs**
   - State registrations often have PDFs/letters; store as documents with metadata and Storage paths.

---

## 1) Firestore Collections (Tenant-Scoped)

Existing:
- `tenants/{tenantId}/entities/{entityId}`

Add (recommended):
- `tenants/{tenantId}/entities/{entityId}/private/finance` (doc)          ✅ sensitive
- `tenants/{tenantId}/entities/{entityId}/private/tax` (doc)              ✅ sensitive
- `tenants/{tenantId}/entity_cost_centers/{costCenterId}`                 ✅ reusable GL/cost codes
- `tenants/{tenantId}/entity_jurisdictions/{jurisdictionId}`              ✅ entity + state registrations
- `tenants/{tenantId}/compliance_documents/{docId}`                       ✅ state filings / registrations
- `tenants/{tenantId}/workers_comp/{wcId}`                                ✅ carrier + policy + documents
- `tenants/{tenantId}/workers_comp_class_codes/{classCodeId}`             ✅ central WC code/rate repo (Phase 2)
- `tenants/{tenantId}/workers_comp_rate_sets/{rateSetId}`                 ✅ rates by state/entity (Phase 2)

> You can start with only `entity_cost_centers`, `entity_jurisdictions`, `compliance_documents`, and `workers_comp`.
> WC class codes/rate sets can be added later without breaking anything.

---

## 2) Entities Schema Additions (Public Fields)

Path:
`tenants/{tenantId}/entities/{entityId}`

### 2.1 Public fields to add (safe + useful)
```ts
type EntityPublic = {
  name: string;
  entityCode: string; // payroll/export code (e.g., C1SL)
  workerType: "W2" | "1099" | "BOTH";
  everifyRequired: boolean;
  defaultRequirementPackageId?: string | null;

  legalName?: string;
  dbaName?: string;
  entityType?: "LLC" | "Inc" | "LP" | "SoleProp" | "Other";
  formationState?: string; // "NV", "CA", etc.
  active: boolean;

  // Addresses (non-sensitive)
  addresses?: Array<{
    type: "mailing" | "physical" | "registered_agent";
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
  }>;

  // Contacts (non-sensitive)
  contacts?: {
    supportEmail?: string;
    supportPhone?: string;
    hrContactName?: string;
    hrContactEmail?: string;
    payrollContactEmail?: string;
  };

  // High-level workers comp summary (non-sensitive)
  workersCompSummary?: {
    carrierName?: string;
    policyNumberMasked?: string; // e.g., "****1234"
    claimsPhone?: string;
    wcInfoDocId?: string; // links to compliance_documents or workers_comp doc
  };

  // References to defaults for accounting
  defaultCostCenterId?: string | null; // links to entity_cost_centers
  defaultGlCompanyCode?: string | null; // optional simple field

  updatedAt: Timestamp;
  createdAt: Timestamp;
};
```

---

## 3) Private Entity Data (Sensitive)

### 3.1 Tax doc (FEIN, etc.)
Path:
`tenants/{tenantId}/entities/{entityId}/private/tax`

```ts
type EntityTaxPrivate = {
  fein?: string;           // optional; avoid if possible
  feinLast4?: string;
  feinMasked?: string;     // "XX-XXX1234"
  hasFeinOnFile?: boolean;

  updatedAt: Timestamp;
};
```

### 3.2 Finance doc (banking credentials, etc.)
Path:
`tenants/{tenantId}/entities/{entityId}/private/finance`

```ts
type EntityFinancePrivate = {
  // do NOT store ACH/bank info unless encrypted + strictly limited
  accountingSystem?: "quickbooks" | "netsuite" | "other";
  notes?: string;

  updatedAt: Timestamp;
};
```

**Rules expectation:** Only HRX/admin roles can read/write `private/*`.

---

## 4) GL / Cost Center Codes

### 4.1 Reusable codes repo
Path:
`tenants/{tenantId}/entity_cost_centers/{costCenterId}`

```ts
type EntityCostCenter = {
  name: string;                // "C1 Select - NV W2", "C1 Events - 1099"
  entityId?: string | null;    // optional: scoped to entity or tenant-wide
  glCompanyCode?: string;      // "C1SL"
  glLocationCode?: string;     // optional
  costCenterCode: string;      // "CC-104"
  departmentCode?: string;     // optional
  projectCode?: string;        // optional

  active: boolean;
  tags?: string[];             // ["NV", "W2"]
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

### 4.2 Job Order integration (Phase 2+)
Add to job orders:
- `costCenterId?: string`
- `glCompanyCode?: string` (optional denorm)

---

## 5) Jurisdictions / Operating States (Entity compliance)

This becomes your single source of truth for:
- Secretary of State registrations (foreign qualification)
- Employment department account numbers
- State tax IDs (SUI, withholding, etc.)
- E-Verify requirement by state (optional)
- Associated documents

### 5.1 Entity jurisdiction doc
Path:
`tenants/{tenantId}/entity_jurisdictions/{jurisdictionId}`

Recommended ID:
`{entityId}__{state}`

```ts
type EntityJurisdiction = {
  entityId: string;
  state: string; // "NV", "CA", "TX", "AZ"

  status: "active" | "pending" | "inactive" | "not_registered";

  // Secretary of State
  sos?: {
    filingNumber?: string;
    status?: string;
    registrationDate?: string;
    url?: string;
  };

  // Employment / labor / unemployment
  employmentDept?: {
    employerAccountNumber?: string; // consider masking + private override if needed
    suiAccountNumber?: string;
    withholdingAccountNumber?: string;
  };

  // Local tax / city registrations (optional)
  local?: Array<{
    jurisdictionName: string;
    accountNumber?: string;
    notes?: string;
  }>;

  // Linked documents (PDFs, letters, forms)
  documentIds?: string[]; // compliance_documents refs

  notes?: string;
  updatedAt: Timestamp;
  createdAt: Timestamp;
};
```

**Sensitive note:** Some account numbers should be masked for most users. If needed:
- store masked numbers here
- store full numbers in `entities/{entityId}/private/state_accounts/{state}` (Phase 2)

---

## 6) Compliance Documents (State filings repository)

Path:
`tenants/{tenantId}/compliance_documents/{docId}`

```ts
type ComplianceDocument = {
  title: string;                 // "NV SOS Certificate", "CA EDD Account Letter"
  docType: "sos" | "employment_dept" | "wc" | "tax" | "other";

  entityId: string;
  state?: string | null;

  effectiveDate?: string;
  expiresDate?: string | null;

  file: {
    storagePath: string;
    fileName: string;
    contentType: string;
    size: number;
  };

  visibility: "admin_only" | "tenant_admin" | "all_internal";

  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

**Storage path convention**
- `tenants/{tenantId}/compliance_docs/{entityId}/{state}/{docType}/{fileName}`

---

## 7) Workers’ Comp (Base info now, class codes later)

### 7.1 Workers comp policies
Path:
`tenants/{tenantId}/workers_comp/{wcId}`

Recommended ID:
`{entityId}__{state}` (if policies vary by state) or `{entityId}__primary`.

```ts
type WorkersCompPolicy = {
  entityId: string;
  state?: string | null; // null means multi-state/primary policy

  carrierName: string;
  policyNumberMasked?: string;
  policyNumber?: string; // optional; consider private storage
  effectiveDate?: string;
  expirationDate?: string;

  claimsPhone?: string;
  brokerName?: string;
  brokerPhone?: string;

  documentIds?: string[]; // compliance_documents references

  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

**Recommendation:** keep `policyNumber` masked publicly; full number in private doc if truly needed.

### 7.2 WC class codes and rates (Phase 2)
You want:
- central WC code + rate repository
- job order dropdown selection

Proposed model:

**Class codes**
`tenants/{tenantId}/workers_comp_class_codes/{classCodeId}`
```ts
{
  code: string;        // "9015"
  title: string;       // "Building Operation"
  description?: string;
  active: boolean;
}
```

**Rate sets** (by entity + state + effective date)
`tenants/{tenantId}/workers_comp_rate_sets/{rateSetId}`
```ts
{
  entityId: string;
  state: string;
  effectiveDate: string; // ISO
  expiresDate?: string;

  rates: Array<{
    classCode: string;    // "9015"
    rate: number;         // 2.34 (per $100 payroll)
  }>;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Job order fields**
- `workersCompClassCode?: string`
- `workersCompRate?: number` (denorm for audit)
- `workersCompRateSetId?: string`

This makes job orders auditable even if rates change later.

---

## 8) UI Changes (Entities Page)

Add new sections/tabs to `EntitiesPage` detail panel:

### Tab: Overview (already implemented)
Add fields:
- DBA Name
- Entity Type
- Formation State
- Mailing Address (structured)
- Support Phone
- Default Cost Center selector (from `entity_cost_centers`)
- Workers Comp Summary selector (links to `workers_comp`)

### New Tab: Compliance / States
- Table of states (entity_jurisdictions where entityId==this)
- Add/Edit state registration
- Upload/link documents (compliance_documents filtered by entityId + state)

### New Tab: Cost Centers
- List cost centers filtered by entityId (or tenant-wide)
- Create/edit cost center records
- Set defaultCostCenterId on entity

### New Tab: Workers Comp
- List WC policies (workers_comp filtered by entityId)
- Upload policy docs
- (Later) manage class code/rate sets

---

## 9) Permissions / Rules Notes

1) `entities/*` read for internal tenant users
2) `entities/{entityId}/private/*` read/write ONLY for HRX/Admin security levels
3) `compliance_documents`:
   - allow read based on `visibility`
4) `entity_jurisdictions` and `entity_cost_centers`:
   - read for internal users
   - write for admin/manager roles only

---

## 10) Implementation Order (Cursor Checklist)

Phase 1B Extension (fastest path):
1) Extend entity schema + UI fields (DBA, addresses, contacts, defaultCostCenterId)
2) Implement `entity_cost_centers` CRUD (simple table + editor)
3) Implement `entity_jurisdictions` CRUD (state registrations)
4) Implement `compliance_documents` upload + link to jurisdictions
5) Implement `workers_comp` policies CRUD + link docs
6) (Later) WC class codes + rate sets + job order dropdown

---

## 11) Outputs / Reports (Future)

With this model you can easily generate:
- “Active entities by state” compliance report
- “Which entities are registered in CA but missing EDD account docs”
- “Payroll export mappings” (entityCode + cost center codes)
- WC policy coverage report by state

---

## 12) Key Decisions (Confirm)

- Do we store full FEIN / policy numbers in Firestore private docs, or keep them only in Everee?
- For state account numbers: masked public + full private per state, or private only?
- Rate set granularity: per entity+state vs global by state? (recommended per entity+state)

