# Entities & Onboarding Workflows Admin UI (Phase 1B)
## Cursor Upload — Layout + Data Model + Component Plan

Owner: Greg Fielding / HRX One  
Date: 2026-02-17  
Goal: Build an admin layout to manage **Entities** and **Onboarding Workflows** (Requirement Packages) with:
- A **master library** of onboarding items (steps/docs/checks)
- Per-entity selection (checked/unchecked)
- Doc uploads for signature (handbooks, IC agreements, etc.)
- Provider-agnostic signature support (Phase 2), while keeping payroll onboarding in Everee

---

## 0) Design Principles

1) **One master library** of onboarding items (avoids duplicated definitions across entities).  
2) **Entities choose what applies** (checkbox matrix) + can set defaults (e.g., default package).  
3) **Job Orders choose entity**; assignments inherit; onboarding_instances snapshot.  
4) **Docs are versioned** and can be required/ack/e-sign/upload.  
5) Keep PII-heavy payroll onboarding **out of Firestore** (Everee later).

---

## 1) Firestore Collections (Tenant-Scoped)

Existing (already in spec):
- `tenants/{tenantId}/entities/{entityId}`
- `tenants/{tenantId}/requirement_packages/{packageId}`
- `tenants/{tenantId}/onboarding_instances/{assignmentId}`

New for Phase 1B (admin configuration + assets):
- `tenants/{tenantId}/onboarding_item_library/{itemId}`  ✅ master list
- `tenants/{tenantId}/onboarding_documents/{docId}`      ✅ uploaded docs/versions
- `tenants/{tenantId}/entity_onboarding/{entityId}`      ✅ entity-specific config (or store inside entity doc)

You can choose to embed `entity_onboarding` into the entity doc to reduce collections; a separate doc keeps entity lean and avoids doc size limits as you add many items.

---

## 2) Data Model

### 2.1 Onboarding Item Library (master list)
Path:
`tenants/{tenantId}/onboarding_item_library/{itemId}`

```ts
type OnboardingItemType = "step" | "document" | "check";

type OnboardingItemLibraryDoc = {
  itemId: string;                 // doc id
  type: OnboardingItemType;

  key: string;                    // stable key like "w4", "i9", "handbook_ack", "ic_agreement"
  title: string;
  description?: string;

  audience: "worker" | "internal" | "both";
  assigneeRole?: "recruiter" | "hr" | "payroll";

  // gating
  requiredDefault: boolean;
  blockingDefault: boolean;

  // step-specific
  workerAction?: "fill_form" | "upload" | "esign" | "acknowledge" | "none";
  duePolicyDefault?: { offsetHours: number; from: "assignmentCreated" | "startDate" };

  // document-specific
  documentMode?: "esign" | "upload" | "acknowledge";
  documentKey?: string;           // references onboarding_documents.docKey (below)
  allowVersionSelect?: boolean;   // if true, entity can pick which doc version is active

  // check-specific
  checkProvider?: "none" | "backgroundVendor" | "drugVendor" | "everify";
  providerConfigTemplate?: any;

  tags?: string[];                // e.g., ["W2", "1099", "events", "everify"]
  isActive: boolean;

  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

**Notes**
- `key` is the canonical identifier used downstream in onboarding_instances snapshots.
- This library is the “catalog” admins select from.

---

### 2.2 Onboarding Documents (uploaded assets + versions)
Path:
`tenants/{tenantId}/onboarding_documents/{docId}`

```ts
type OnboardingDocument = {
  docId: string;                 // doc id
  docKey: string;                // stable key: "handbook_employee", "handbook_contractor", "ic_agreement"
  title: string;

  // versioning
  version: string;               // "2026.02" or "v3"
  status: "draft" | "active" | "archived";
  effectiveDate?: string;        // ISO date

  mode: "esign" | "upload" | "acknowledge";  // preferred interaction
  file: {
    storagePath: string;         // gs://... or storage path
    fileName: string;
    contentType: string;
    size: number;
  };

  // signature provider placeholders (Phase 2)
  signatureTemplate?: {
    provider: "docusign" | "dropboxsign" | "adobe" | "other";
    templateId?: string;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

**Storage Path Convention**
- `tenants/{tenantId}/onboarding_docs/{docKey}/{version}/{fileName}`

---

### 2.3 Entity Onboarding Config (checkbox selections)
Path:
`tenants/{tenantId}/entity_onboarding/{entityId}`
(or embed inside `entities/{entityId}`)

```ts
type EntityOnboardingConfig = {
  entityId: string;

  // global defaults
  defaultRequirementPackageId?: string | null; // optional shortcut; job orders can override

  // the "checked" items + per-entity overrides
  enabledItemKeys: string[];          // list of OnboardingItemLibraryDoc.key

  overrides?: {
    [itemKey: string]: {
      required?: boolean;
      blocking?: boolean;
      assigneeRole?: "recruiter" | "hr" | "payroll";
      workerAction?: "fill_form" | "upload" | "esign" | "acknowledge" | "none";

      // document-specific override
      documentVersion?: string;       // pick version for docKey if allowVersionSelect
      documentKeyOverride?: string;   // switch to a different docKey entirely (rare)

      // check-specific override
      providerConfig?: any;
    };
  };

  updatedAt: Timestamp;
};
```

**Why store `enabledItemKeys` not itemIds?**
- `key` is stable and is what your onboarding_instances snapshots should carry.
- Item doc IDs can change; keys shouldn’t.

---

## 3) Admin Layout (Pages + Navigation)

Add to **Settings** (or Admin) navigation:

### A) Settings → Entities
Route: `/settings/entities`

**Left column:** Entities list (C1 Events, C1 Workforce, C1 Select)  
**Right panel:** Entity detail tabs

Entity Detail Tabs:
1) **Overview**
   - name, entityCode, workerType, everifyRequired
   - defaultRequirementPackageId
2) **Onboarding Workflow**
   - checkbox matrix: master item list vs entity enabled
   - per-item overrides (required/blocking/audience/assignee)
3) **Documents**
   - shows docs relevant to enabled items (handbooks, agreements)
   - upload new version
   - set active version
4) **Export / Integrations** (stub)
   - shows Everee integration placeholder and entityCode usage (read-only for now)

---

### B) Settings → Onboarding Library
Route: `/settings/onboarding-library`

Tabs:
1) **Items**
   - master list of steps/docs/checks
   - create/edit item
   - tags, defaults, active toggle
2) **Documents**
   - docKey list with versions
   - upload doc version
   - mark active/archived
3) **Packages** (optional convenience)
   - ability to assemble requirement_packages quickly from the library

---

## 4) Key UI: “Master Items + Entity Checkboxes”

### 4.1 Recommended UI Pattern
A table with:
- Column 1: Item (title + type chip)
- Column 2: Tags (W2/1099/E-Verify)
- Column 3: Enabled (checkbox for current entity)
- Column 4: Required (toggle; defaults from library; override per entity)
- Column 5: Blocking (toggle)
- Column 6: Assignee (dropdown recruiter/hr/payroll) when audience includes internal
- Column 7: Doc Version (dropdown) if item is a document + allowVersionSelect

**Filters**
- Type: step / document / check
- Tags: W2 / 1099 / E-Verify / Events
- Search by title/key

### 4.2 UX Detail
- When checkbox is OFF → disable the override controls (greyed)
- When checkbox ON → show a chevron to expand “Advanced overrides” drawer
- Save is explicit (button) OR auto-save per change (your call; explicit is safer initially)

---

## 5) How this maps to Requirement Packages (Important)

You have two workable approaches:

### Option 1 (recommended now): Entity config generates packages
- Entities define enabled items and defaults.
- A background action generates/updates a `requirement_packages/{packageId}` for that entity.
- Job Orders set `requirementPackageId` to the entity’s generated package.

**Pros:** simple “Entity → Package” mapping; minimal complexity for recruiters  
**Cons:** need a generator function

### Option 2: Keep packages independent, entity selects default package
- Requirement packages are manually assembled.
- Entity just selects default package; job orders can override package.
- Entity-level checkbox UI becomes a **package editor** rather than entity config.

**Pros:** fewer moving parts  
**Cons:** less clean for “entity owns compliance” mental model

**Recommendation:** Start with **Option 2** for Phase 1B UI speed:
- Build Library + Document upload + Package editor UI
- Entities only choose `defaultRequirementPackageId`
Then evolve to Option 1 later (auto-generate packages from entity checkbox config).

---

## 6) Minimal Package Builder UI (Phase 1B)

Route: `/settings/onboarding-library?tab=packages` or `/settings/requirement-packages`

Package form:
- name, workerType, everifyRequired
- “Add items from library” picker (multi-select)
- For each added item:
  - required/blocking overrides
  - doc version selector (if doc)
  - provider config (if check)

Persist to:
`tenants/{tenantId}/requirement_packages/{packageId}`
with arrays `steps/documents/checks` that match your Phase 1A snapshot writing.

---

## 7) Document Upload UX (Handbooks, IC agreements)

### Document List View
Group by `docKey`:
- Handbook (Employee) → versions list
- Handbook (Contractor) → versions list
- IC Agreement → versions list

Actions:
- Upload new version (PDF)
- Mark version ACTIVE
- Archive version
- Copy “docKey/version” reference

### Storage + Firestore flow
1) Upload to Storage path:
   `tenants/{tenantId}/onboarding_docs/{docKey}/{version}/{fileName}`
2) Create Firestore doc in `onboarding_documents`
3) If marked active:
   - set this doc status=active
   - set previous active version to archived

---

## 8) How the Worker Actually Signs (Phase 2 stub)

For now (Phase 1B):
- documents can be **acknowledge** or **upload**
- show placeholder “E-sign coming soon” for esign mode

Later (Phase 2):
- create `signature_envelopes/{envelopeId}`
- store provider signingUrl
- update onboarding_instances document status when webhook returns

---

## 9) Components (React / MUI)

Suggested component breakdown:

- `EntitiesPage`
  - `EntitiesListPanel`
  - `EntityDetailPanel`
    - `EntityOverviewTab`
    - `EntityWorkflowTab` (checkbox matrix)
    - `EntityDocumentsTab`
- `OnboardingLibraryPage`
  - `OnboardingItemsTab`
  - `OnboardingDocumentsTab`
  - `RequirementPackagesTab`

Reusable:
- `OnboardingItemTable`
- `DocVersionPicker`
- `DocUploadDialog`
- `ItemOverrideDrawer`
- `TagChips`

---

## 10) Phase 1B Build Order (Recommended)

1) **Onboarding Library: Items CRUD**
2) **Documents CRUD + Storage upload**
3) **Requirement Packages builder using Library**
4) **Entities CRUD + select defaultRequirementPackageId**
5) (Optional) **Entity Workflow checkbox matrix**
6) Tie job order UI to entityId + packageId
7) Validate onboarding_instances snapshots reflect selected package items

---

## 11) Acceptance Criteria

- Admin can create onboarding items (step/doc/check) in library ✅
- Admin can upload and version documents ✅
- Admin can build a requirement package by selecting library items ✅
- Admin can set entity default package ✅
- Assignments created through placementsCreateAssignments produce onboarding_instances snapshots matching selected package ✅

---

## 12) Notes (Sensitive Payroll / Everee)

- Do not store SSN/bank info in Firestore.
- Payroll onboarding will be handled in Everee later.
- In this system, represent payroll readiness only as **boolean completion** signals (e.g., “Direct deposit completed”)
without storing sensitive details.

---

## 13) Next Extensions

- Entity-level checkbox matrix auto-generates packages (Option 1)
- E-Verify provider adapter and everify case table
- Background checks provider adapter tables
- E-sign provider integration + webhooks

