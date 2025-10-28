# Data Connections Blueprint
**HRX God View - Entity Relationship & Connection Patterns**

Last Updated: October 24, 2025  
Status: Initial Audit Complete

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Core Entities & Their Connections](#core-entities--their-connections)
3. [Data Flow Patterns](#data-flow-patterns)
4. [Connection Rules & Standards](#connection-rules--standards)
5. [Current State Audit Findings](#current-state-audit-findings)
6. [Implementation Recommendations](#implementation-recommendations)

---

## Executive Summary

### The Vision
Our application has a complex data pipeline: **CRM Deals → Job Orders → Job Posts → Applications**. Additionally, independent entities (Companies, Contacts, Locations) connect to multiple parts of this pipeline.

### Key Principle: JobOrder as Single Source of Truth
**JobOrder** is the most "definite" component in the system. Once a JobOrder is created:
- It becomes the authoritative record for that engagement
- It stores definitive IDs for Company, Location, Contacts, Recruiters
- Other entities can reference it, but JobOrder data takes precedence

### Independent Entities
Companies, Contacts, and Locations exist independently and can be used across multiple Deals, JobOrders, and JobPosts.

---

## Core Entities & Their Connections

### 1. DEAL (CRM Module)
**Firestore Path**: `tenants/{tenantId}/crm_deals/{dealId}`

#### Stored IDs & References:
```typescript
{
  id: string;
  tenantId: string;
  
  // Primary Company Connection
  companyId?: string;              // Single company (primary)
  companyName?: string;            // Denormalized for display
  
  // Location Connection
  locationId?: string;             // Single location (primary)
  locationName?: string;           // Denormalized for display
  
  // Owner/Salesperson
  owner: string;                   // User ID of deal owner
  
  // Associations Object (Complex Structure)
  associations?: {
    companies?: string[];          // Array of company IDs
    locations?: Array<string | {   // Mixed: can be IDs or objects with snapshots
      id: string;
      snapshot?: {
        name?: string;
        nickname?: string;
        address?: string;
      }
    }>;
    contacts?: Array<string | {    // Mixed: can be IDs or objects with snapshots
      id: string;
      snapshot?: {
        fullName?: string;
        email?: string;
        phone?: string;
        title?: string;
      }
    }>;
    salespeople?: Array<string | { // Mixed: can be IDs or objects with snapshots
      id: string;
      snapshot?: {
        displayName?: string;
        email?: string;
      }
    }>;
    deals?: string[];              // Related deals
    tasks?: string[];              // Related tasks
  };
  
  // Stage Data (Discovery, Qualification, Scoping, etc.)
  stageData?: {
    discovery?: {...};
    qualification?: {...};
    scoping?: {...};
    verbalAgreement?: {...};
    closedWon?: {...};
  };
  
  // NO jobOrderIds array currently stored
  // Question: Should Deal track generated JobOrders?
}
```

#### Current Query Patterns:
- Load deal: `getDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId))`
- Find deals by company: `query(collection(db, 'tenants', tenantId, 'crm_deals'), where('companyId', '==', companyId))`

#### Connections:
- **→ Company**: Stores `companyId` (single) + optional `associations.companies[]` (array)
- **→ Location**: Stores `locationId` (single) + optional `associations.locations[]` (array with snapshots)
- **→ Contacts**: Stores `associations.contacts[]` (array with snapshots)
- **→ Salespeople**: Stores `owner` (single) + `associations.salespeople[]` (array with snapshots)
- **→ JobOrder**: Creates JobOrders via "Generate Job Order" button (NO bidirectional reference stored in Deal)

---

### 2. JOBORDER (Recruiter Module) - **SINGLE SOURCE OF TRUTH**
**Firestore Path**: `tenants/{tenantId}/job_orders/{jobOrderId}`

#### Stored IDs & References:
```typescript
{
  id: string;
  tenantId: string;
  jobOrderSeq: number;             // Auto-increment counter
  jobOrderNumber: string;          // Formatted (e.g., "0002")
  jobOrderName: string;
  jobTitle: string;
  status: 'draft' | 'open' | 'on_hold' | 'cancelled' | 'filled' | 'completed';
  jobType: 'gig' | 'career';       // NEW field added
  
  // Company & Location (DEFINITIVE)
  companyId: string;               // Required - THE company for this job order
  companyName: string;             // Denormalized
  worksiteId: string;              // Required - THE location for this job order
  worksiteName: string;            // Denormalized
  
  // Deal Connection (if created from Deal)
  dealId?: string;                 // Single source: which deal generated this
  deal?: {                         // Snapshot of deal data at creation time
    id: string;
    name: string;
    companyId: string;
    companyName: string;
    locationId: string;
    locationName: string;
    stage: string;
    status: string;
    estimatedRevenue: number;
    closeDate: string;
    owner: string;
    tags: string[];
    notes: string;
    stageData: any;
    associations: any;             // Full associations object copied
    createdAt: any;
    updatedAt: any;
  };
  
  // People Assignments
  createdBy: string;               // User ID of creator
  assignedRecruiters: string[];    // Array of recruiter user IDs
  
  // Contact Assignments (DEFINITIVE for this JobOrder)
  hrContactId?: string;            // Single HR contact
  decisionMaker?: string;          // Single decision maker contact
  operationsContactId?: string;    // Single operations contact
  procurementContactId?: string;   // Single procurement contact
  billingContactId?: string;       // Single billing contact
  safetyContactId?: string;        // Single safety contact
  invoiceContactId?: string;       // Single invoice contact
  
  // Financial
  payRate: number;
  markup: number;
  billRate: number;
  calculatedBillRate: number;
  estimatedRevenue: number;        // Auto-calculated: billRate × 2080 × workersNeeded
  
  // Workers
  workersNeeded: number;
  headcountFilled: number;
  
  // Dates
  startDate?: string;              // Simple string format (YYYY-MM-DD)
  endDate?: string;                // Simple string format (YYYY-MM-DD)
  
  // Registry Fields
  schemaVersion?: number;
  initialSnapshot?: any;           // Original data from deal at creation
  
  // NO jobPostIds array currently stored
  // Question: Should JobOrder track created JobPosts?
  
  createdAt: Date;
  updatedAt: Date;
}
```

#### Current Query Patterns:
- Load job order: `getDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId))`
- Find job orders by deal: `query(collection(db, 'tenants', tenantId, 'job_orders'), where('dealId', '==', dealId))`
- Find job orders by company: `query(collection(db, 'tenants', tenantId, 'job_orders'), where('companyId', '==', companyId))`

#### Connections:
- **← Deal**: Stores `dealId` (optional, if created from deal)
- **→ Company**: Stores `companyId` (required, definitive)
- **→ Location**: Stores `worksiteId` (required, definitive)
- **→ Contacts**: Stores individual contact IDs (hrContactId, decisionMaker, etc.) (definitive)
- **→ Recruiters**: Stores `assignedRecruiters[]` (array of user IDs)
- **→ JobPost**: JobPosts reference JobOrder via `jobOrderId` (unidirectional from JobPost)

---

### 3. JOBPOST (Jobs Board Module)
**Firestore Path**: `tenants/{tenantId}/job_postings/{postId}`

#### Stored IDs & References:
```typescript
{
  id: string;
  jobPostId: string;               // Sequential (e.g., "2002", "2003")
  tenantId: string;
  
  // Posting Details
  postTitle: string;               // May differ from jobTitle
  jobType: 'gig' | 'career';
  jobTitle: string;                // Actual O*NET job title
  jobDescription: string;
  
  // Company & Location
  companyId?: string;              // Optional company reference
  companyName: string;             // Denormalized (required for display)
  worksiteId?: string;             // Optional location reference
  worksiteName: string;            // Denormalized (required for display)
  worksiteAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: { lat: number; lng: number; }
  };
  
  // JobOrder Connection (if linked)
  jobOrderId?: string;             // Optional - links to specific job order
  
  // Display & Visibility
  visibility: 'public' | 'private' | 'restricted';
  restrictedGroups?: string[];     // User group IDs
  status: 'draft' | 'active' | 'paused' | 'cancelled' | 'expired';
  
  // Requirements (copied from JobOrder if linked)
  payRate?: number;
  workersNeeded: number;
  eVerifyRequired: boolean;
  backgroundCheckPackages: string[];
  drugScreeningPanels: string[];
  additionalScreenings: string[];
  skills?: string[];
  licensesCerts?: string[];
  
  // Auto-actions
  autoAddToUserGroup?: string;     // User group ID to auto-add applicants
  
  // Metrics
  applicationCount: number;
  maxApplications?: number;
  
  // Metadata
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  postedAt?: Date;
  expiresAt?: Date;
}
```

#### Current Query Patterns:
- Load post: `getDoc(doc(db, 'tenants', tenantId, 'job_postings', postId))`
- Find posts by job order: `query(collection(db, 'tenants', tenantId, 'job_postings'), where('jobOrderId', '==', jobOrderId))`
- Find active public posts: `query(collection(db, 'tenants', tenantId, 'job_postings'), where('status', '==', 'active'), where('visibility', '==', 'public'))`

#### Connections:
- **← JobOrder**: Stores `jobOrderId` (optional)
- **→ Company**: Stores `companyId` (optional) + `companyName` (required denormalized)
- **→ Location**: Stores `worksiteId` (optional) + `worksiteName` (required denormalized)
- **→ Applications**: Applications reference JobPost via `jobId`/`postId`

---

### 4. APPLICATION (Jobs Board / Recruiter)
**Firestore Paths**: 
- Main: `tenants/{tenantId}/applications/{applicationId}` (format: `{userId}_{jobId}`)
- Draft: `tenants/{tenantId}/applicationDrafts/{draftId}`

#### Stored IDs & References:
```typescript
{
  // Main application document
  id: string;                      // Format: "{userId}_{jobId}"
  userId: string;                  // Applicant user ID
  tenantId: string;
  jobId: string;                   // Job posting ID (postId)
  
  // JobOrder Connection (denormalized from posting)
  jobOrderId?: string;             // ISSUE: Not consistently stored!
                                   // Only stored if posting.jobOrderId exists
  
  // Status & Workflow
  status: 'draft' | 'in_progress' | 'submitted';
  
  // Applicant Data (denormalized for quick access)
  applicant: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  
  // Application Data
  data: any;                       // Full form data from wizard
  
  // Denormalized Display Data
  jobTitle?: string;
  jobOrderName?: string;
  postTitle?: string;
  companyName?: string;
  companyId?: string;
  jobPostId?: string;              // Sequential post number
  payRate?: number;
  location?: string;
  startDate?: any;
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  submittedAt?: Timestamp;
  appliedAt?: Timestamp;
}
```

#### Current Query Patterns:
- Load application: `getDoc(doc(db, 'tenants', tenantId, 'applications', applicationId))`
- Find applications by job: `query(collection(db, 'tenants', tenantId, 'applications'), where('jobId', '==', postId))`
- Find applications by user: User profile stores `applicationIds[]` array

#### Connections:
- **→ User**: Stores `userId` (applicant)
- **→ JobPost**: Stores `jobId` (the posting ID)
- **→ JobOrder**: Stores `jobOrderId` (denormalized from posting - INCONSISTENT)
- **→ Company**: Stores `companyId` (denormalized from posting)

#### CRITICAL ISSUE:
Applications do NOT consistently store `jobOrderId`. They only get it if the JobPost had a `jobOrderId` field. This breaks the ability to view applications for a specific JobOrder.

---

### 5. COMPANY (CRM Module)
**Firestore Path**: `tenants/{tenantId}/crm_companies/{companyId}`

#### Stored IDs & References:
```typescript
{
  id: string;
  tenantId: string;
  companyName: string;
  name: string;                    // Alias for companyName
  
  // Primary Contact Info
  address: string;
  city: string;
  state: string;
  zipcode: string;
  phone: string;
  website: string;
  
  // Associations (NOT stored in company document)
  // Locations: Queried via subcollection
  // Contacts: Queried via where('companyId', '==', companyId)
  // Deals: Queried via where('companyId', '==', companyId)
  
  // Metadata
  status: 'lead' | 'qualified' | 'active' | 'inactive' | 'lost';
  industry: string;
  tier: 'A' | 'B' | 'C';
  tags: string[];
  salesOwnerId?: string;           // User ID
  freshsalesId?: string;           // External system ID
  createdAt: Date;
  updatedAt: Date;
  
  // Optional association counts (for performance)
  associationCounts?: {
    contacts: number;
    locations: number;
    deals: number;
    jobOrders: number;
  };
}
```

#### Child Collections:
- **Locations**: `tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}`

#### Current Query Patterns:
- Load company: `getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId))`
- Load company locations: `getDocs(collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations'))`
- Find company contacts: `query(collection(db, 'tenants', tenantId, 'crm_contacts'), where('companyId', '==', companyId))`

#### Connections:
- **→ Locations**: Subcollection (parent-child relationship)
- **← Contacts**: Contacts store `companyId` (reverse query)
- **← Deals**: Deals store `companyId` (reverse query)
- **← JobOrders**: JobOrders store `companyId` (reverse query)

---

### 6. LOCATION (CRM Module)
**Firestore Path**: `tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}`

#### Stored IDs & References:
```typescript
{
  id: string;
  // NO tenantId stored (inherited from parent path)
  // NO companyId stored (inherited from parent path)
  
  name: string;
  nickname?: string;               // Display name
  
  // Address
  address: string;
  city: string;
  state: string;
  zipcode: string;
  phone?: string;
  email?: string;
  
  // Geographic
  latitude?: number;
  longitude?: number;
  
  // Business Info
  locationType: 'headquarters' | 'facility' | 'branch' | 'regional_office';
  headcount?: number;
  facilityCode?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
```

#### Current Query Patterns:
- Load location: `getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId))`
- Load all locations for company: `getDocs(collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations'))`

#### Connections:
- **Parent: Company**: Subcollection under company (companyId in path)
- **← Contacts**: Contacts store `locationId` (reverse query)
- **← Deals**: Deals store `locationId` or `associations.locations[]`
- **← JobOrders**: JobOrders store `worksiteId` (reverse query)

---

### 7. CONTACT (CRM Module)
**Firestore Path**: `tenants/{tenantId}/crm_contacts/{contactId}`

#### Stored IDs & References:
```typescript
{
  id: string;
  tenantId: string;
  
  // Personal Info
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  
  // Company Connection (REQUIRED)
  companyId: string;               // The company this contact belongs to
  companyName?: string;            // Denormalized
  
  // Location Connection (OPTIONAL)
  locationId?: string;             // Primary location
  locationName?: string;           // Denormalized
  
  // Alternative: Associations
  associations?: {
    locations?: string[];          // Array of location IDs
  };
  
  // Role & Status
  role: 'decision_maker' | 'influencer' | 'finance' | 'operations' | 'hr' | 'other';
  dealRole?: 'decision_maker' | 'recommender' | 'observer' | 'blocker' | 'champion';
  status: 'active' | 'inactive';
  
  // Metadata
  tags: string[];
  notes: string;
  salesOwnerId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### Current Query Patterns:
- Load contact: `getDoc(doc(db, 'tenants', tenantId, 'crm_contacts', contactId))`
- Find contacts by company: `query(collection(db, 'tenants', tenantId, 'crm_contacts'), where('companyId', '==', companyId))`
- Find contacts by location: `query(collection(db, 'tenants', tenantId, 'crm_contacts'), where('locationId', '==', locationId))`

#### Connections:
- **→ Company**: Stores `companyId` (required)
- **→ Location**: Stores `locationId` (optional single) OR `associations.locations[]` (optional array)
- **← Deals**: Deals reference contacts via `associations.contacts[]`
- **← JobOrders**: JobOrders reference contacts via specific role fields (hrContactId, etc.)

---

## Data Flow Patterns

### Flow 1: Deal → JobOrder (Generate Job Order)
**File**: `src/services/recruiter/jobOrderService.ts::createJobOrderFromDeal()`

#### What Happens:
1. Load Deal document from `tenants/{tenantId}/crm_deals/{dealId}`
2. Extract job titles from `deal.stageData.discovery.jobTitles[]`
3. Create ONE JobOrder per job title
4. Use mapping function `mapDealToJobOrder()` to transform deal fields to job order fields

#### IDs Copied to JobOrder:
```typescript
{
  dealId: dealId,                  // Store source deal ID
  tenantId: tenantId,
  companyId: mapped.flat.companyId,
  worksiteId: mapped.flat.worksiteId,
  
  // Full deal object snapshot
  deal: {
    id: dealData.id,
    companyId: dealData.companyId,
    companyName: dealData.companyName,
    locationId: dealData.locationId,
    locationName: dealData.locationName,
    associations: dealData.associations,  // ENTIRE associations object copied
    // ... all other deal fields
  }
}
```

#### Current Issues:
- **Deal does NOT store jobOrderIds[]**: No way to query "what JobOrders were created from this Deal?" without reverse query
- **Associations object is massive**: The entire associations structure (with snapshots) is copied to every JobOrder
- **No update sync**: If company name changes in CRM, JobOrder keeps old snapshot (by design?)

---

### Flow 2: JobOrder → JobPost (Post to Jobs Board)
**File**: `src/services/recruiter/jobsBoardService.ts::createPostFromJobOrder()`

#### What Happens:
1. Load JobOrder document
2. Create JobPost with data copied from JobOrder
3. Link back to JobOrder via `jobOrderId` field

#### IDs Copied to JobPost:
```typescript
{
  jobOrderId: jobOrderId,          // Link back to source job order
  tenantId: tenantId,
  companyId: jobOrder.companyId,   // Copy company ID
  companyName: jobOrder.companyName, // Denormalized
  worksiteId: jobOrder.worksiteId, // Copy location ID
  worksiteName: jobOrder.worksiteName, // Denormalized
  
  // Auto-actions
  autoAddToUserGroup: customData?.autoAddToUserGroup, // Optional
}
```

#### Current Issues:
- **JobOrder does NOT store jobPostIds[]**: No way to query "what JobPosts exist for this JobOrder?" without reverse query
- **Currently solved**: RecruiterJobOrderDetail loads connected posts via reverse query `where('jobOrderId', '==', jobOrderId)`

---

### Flow 3: JobPost → Application (User Applies)
**File**: `src/components/apply/Wizard.tsx::handleSubmit()`

#### What Happens:
1. User fills out application wizard
2. On submit, creates application document
3. Application ID format: `{userId}_{jobId}`

#### IDs Stored in Application:
```typescript
{
  id: `${userId}_${jobId}`,
  userId: userId,                  // Applicant
  tenantId: tenantId,
  jobId: jobId,                    // The job posting ID
  
  // DENORMALIZED from posting
  jobTitle: posting?.jobTitle,
  jobOrderName: posting?.postTitle,
  postTitle: posting?.postTitle,
  companyName: posting?.companyName,
  companyId: posting?.companyId,
  jobPostId: posting?.jobPostId,   // Sequential number
  
  // CRITICAL ISSUE: jobOrderId not always present!
  // Only exists if posting has jobOrderId
  // NO explicit copy of posting.jobOrderId
}
```

#### Current Issues:
- **CRITICAL**: Applications do NOT reliably store `jobOrderId`
  - If JobPost was created standalone, `jobOrderId` is undefined
  - If JobPost was linked to JobOrder, `jobOrderId` SHOULD be denormalized but isn't explicitly set
- **Fix Required**: When creating application, explicitly copy `posting.jobOrderId` if it exists

---

### Flow 4: Independent - Company ↔ Contacts ↔ Locations

#### Company → Locations:
- **Pattern**: Subcollection
- **Path**: `tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}`
- **Inheritance**: Location inherits `tenantId` and `companyId` from path
- **Query**: Load all locations for company via `getDocs(collection(...))`

#### Company → Contacts:
- **Pattern**: Query by `companyId`
- **Storage**: Contact stores `companyId` field
- **Path**: `tenants/{tenantId}/crm_contacts/{contactId}`
- **Query**: `where('companyId', '==', companyId)`

#### Contact → Locations:
- **Pattern**: Dual approach
  1. Single primary location: `locationId` field
  2. Multiple associated locations: `associations.locations[]` array
- **Usage**: Contact can be associated with one primary location + multiple additional locations
- **Example**: HR Contact with `locationId: 'HQ'` and `associations.locations: ['Branch1', 'Branch2']`

---

## Connection Rules & Standards

### Rule 1: JobOrder as Single Source of Truth
When a JobOrder is created or edited:
- **JobOrder stores DEFINITIVE IDs** for:
  - Company (`companyId`)
  - Location (`worksiteId`)
  - Contacts (role-specific fields: `hrContactId`, `decisionMaker`, etc.)
  - Recruiters (`assignedRecruiters[]`)
- These IDs represent the **official** assignments for this engagement
- Even if source Deal changes, JobOrder data remains stable

### Rule 2: Denormalization for Display Performance
Frequently accessed names are denormalized:
- ✅ `companyName` (in JobOrder, JobPost, Application)
- ✅ `worksiteName` / `locationName` (in JobOrder, JobPost)
- ✅ `applicant.firstName`, `applicant.lastName` (in Application)

**Why**: Avoids joining multiple documents for list/table displays

**Trade-off**: Names may become stale if source entity is renamed

**Decision Needed**: Do we update denormalized names when source changes, or keep as snapshot?

### Rule 3: Associations Object Pattern (Deals)
Deals use a complex `associations` object with:
- **Flexibility**: Can store just IDs or IDs + snapshots
- **Snapshots**: Capture entity state at time of association
- **Use Case**: Historical record of who was involved in deal

**Pattern**:
```typescript
associations: {
  contacts: [
    "contactId1",                    // Just ID
    {                                // ID + snapshot
      id: "contactId2",
      snapshot: {
        fullName: "John Doe",
        email: "john@example.com",
        title: "VP Operations"
      }
    }
  ]
}
```

### Rule 4: Subcollection vs Query Pattern
**Subcollection** (parent-child):
- ✅ Company → Locations: `crm_companies/{companyId}/locations/{locationId}`
- **When to use**: True parent-child relationship, location cannot exist without company

**Query Pattern** (reference):
- ✅ Company → Contacts: Contact stores `companyId`, query with `where()`
- ✅ JobOrder → Applications: Application stores `jobOrderId`, query with `where()`
- **When to use**: Entity can exist independently or be reassigned

### Rule 5: Array vs Single Value
**Single Value** (most common):
- ✅ Contact has ONE `companyId`
- ✅ JobOrder has ONE `companyId`, ONE `worksiteId`
- ✅ JobPost has ONE `jobOrderId` (if linked)
- ✅ Application has ONE `userId`, ONE `jobId`

**Array** (multiple associations):
- ✅ Deal has `associations.contacts[]` (multiple contacts involved)
- ✅ Deal has `associations.salespeople[]` (multiple salespeople involved)
- ✅ JobOrder has `assignedRecruiters[]` (multiple recruiters can work on it)
- ✅ Contact has `associations.locations[]` (can work at multiple locations)

**Guideline**: Use array when entity can have multiple active relationships of the same type

---

## Current State Audit Findings

### ✅ Working Well

1. **Company → Location Subcollection**
   - Clean parent-child relationship
   - Locations properly scoped under companies
   - No orphaned locations

2. **JobOrder → JobPost Linking**
   - JobPost stores `jobOrderId` correctly
   - Reverse query works: `where('jobOrderId', '==', jobOrderId)`
   - Can find all posts for a job order

3. **Contact → Company Query Pattern**
   - Contacts store `companyId`
   - Query by `where('companyId', '==', companyId)` works
   - Recently fixed: `loadCompanyContacts()` function loads contacts on form open

4. **Deal Snapshot in JobOrder**
   - Full deal object copied to `jobOrder.deal`
   - Provides historical context
   - Preserves associations at time of creation

### ⚠️ Issues Found

1. **CRITICAL: Application → JobOrder Connection Missing**
   - **Problem**: Applications don't consistently store `jobOrderId`
   - **Impact**: Cannot show applications for a specific JobOrder
   - **Location**: `src/components/apply/Wizard.tsx` line ~662-677
   - **Fix**: Add explicit `jobOrderId: posting.jobOrderId || null` to application document

2. **Missing Bidirectional References**
   - **Deal → JobOrder**: Deal doesn't track `jobOrderIds[]`
     - Can't easily query "what job orders came from this deal?"
     - Must use reverse query: `where('dealId', '==', dealId)`
   - **JobOrder → JobPost**: JobOrder doesn't track `jobPostIds[]`
     - Can't easily list posts without reverse query
     - Currently solved via reverse query (working)

3. **Contact Loading Inconsistency**
   - **Problem**: Contacts weren't loading automatically when editing JobOrder
   - **Fix Applied**: Added `useEffect` to call `loadCompanyContacts()` on form load
   - **Status**: Recently fixed

4. **Mixed Association Patterns**
   - **Deal**: Uses `associations.contacts[]` (array with optional snapshots)
   - **JobOrder**: Uses individual fields (`hrContactId`, `decisionMaker`, etc.)
   - **Trade-off**: Deal pattern is flexible but complex; JobOrder pattern is explicit but rigid
   - **Assessment**: Both valid for their use cases

5. **Date Handling Inconsistency**
   - **Problem**: Complex date parsing caused save/load issues
   - **Fix Applied**: Simplified to string format (YYYY-MM-DD)
   - **Status**: Recently fixed

6. **Denormalized Names May Become Stale**
   - **Scenario**: Company name changes in CRM
   - **Impact**: Old JobOrders, JobPosts, Applications show old name
   - **Decision Needed**: Update all references or keep as historical snapshot?

### ❓ Questions for Standardization

1. **Should Deal track jobOrderIds[]?**
   - **Pro**: Direct query from Deal to find JobOrders
   - **Con**: Requires updating Deal when JobOrder created (two-write transaction)
   - **Current**: Relies on reverse query `where('dealId', '==', dealId)`

2. **Should JobOrder track jobPostIds[]?**
   - **Pro**: Direct list of all job posts
   - **Con**: Requires updating JobOrder when JobPost created
   - **Current**: Uses reverse query (working solution)

3. **When to denormalize vs query fresh?**
   - **Currently**: Denormalize display names (company, location, contact)
   - **Trade-off**: Performance vs data freshness
   - **Decision**: Keep snapshots for historical accuracy? Or update for current data?

4. **Cascade delete or orphan references?**
   - **Scenario**: Company is deleted
   - **Current behavior**: Orphaned references in JobOrders
   - **Options**:
     - a) Prevent deletion if references exist
     - b) Cascade delete all dependent entities
     - c) Soft delete (mark as inactive)
     - d) Keep orphaned references as historical record

---

## Connection Rules & Standards (Recommendations)

### Standard 1: Explicit Connection Fields

#### For Single Relationships:
```typescript
// GOOD: Explicit, typed field
companyId: string;
worksiteId: string;
hrContactId: string;

// AVOID: Generic references
relatedEntityId: string;
parentId: string;
```

#### For Multiple Relationships:
```typescript
// GOOD: Descriptive array name
assignedRecruiters: string[];      // User IDs
associatedContacts: string[];      // Contact IDs

// AVOID: Generic arrays
entityIds: string[];
relations: string[];
```

### Standard 2: Denormalization Pattern

**Always denormalize display names alongside IDs**:
```typescript
// JobOrder example
companyId: string;                 // ID for queries/joins
companyName: string;               // Name for display (snapshot)

worksiteId: string;                // ID for queries/joins
worksiteName: string;              // Name for display (snapshot)
```

**Rationale**: Lists and tables can display without additional queries

**Update Rule**: Denormalized names are **snapshots** - they reflect the name at time of creation/assignment and do NOT update when source entity changes

### Standard 3: JobOrder Connection Template

Every JobOrder MUST have:
```typescript
{
  // Required Connections
  tenantId: string;                ✅ Required
  companyId: string;               ✅ Required
  worksiteId: string;              ✅ Required
  createdBy: string;               ✅ Required
  
  // Optional Source Connection
  dealId?: string;                 ⚠️ Optional - only if created from deal
  
  // Optional People Assignments
  assignedRecruiters: string[];    ✅ Array (default: [])
  hrContactId?: string;            ⚠️ Optional
  decisionMaker?: string;          ⚠️ Optional
  operationsContactId?: string;    ⚠️ Optional
  // ... other contact roles
  
  // Denormalized Names (snapshots)
  companyName: string;             ✅ Required
  worksiteName: string;            ✅ Required
}
```

### Standard 4: Application Connection Template

Every Application MUST have:
```typescript
{
  // Required Connections
  tenantId: string;                ✅ Required
  userId: string;                  ✅ Required (applicant)
  jobId: string;                   ✅ Required (posting ID)
  
  // Denormalized Connections (from posting)
  jobOrderId?: string;             ⚠️ MUST copy from posting.jobOrderId
  companyId?: string;              ⚠️ Copy from posting.companyId
  
  // Denormalized Display Data
  companyName: string;             ✅ Required for display
  jobTitle: string;                ✅ Required for display
  location: string;                ✅ Required for display
}
```

**CRITICAL FIX NEEDED**: Wizard.tsx must explicitly set `jobOrderId` when creating application

### Standard 5: Query Patterns

#### Finding Children (Reverse Query):
```typescript
// Find all JobOrders for a Deal
const jobOrders = await getDocs(
  query(collection(db, 'tenants', tenantId, 'job_orders'), 
    where('dealId', '==', dealId))
);

// Find all Contacts for a Company
const contacts = await getDocs(
  query(collection(db, 'tenants', tenantId, 'crm_contacts'), 
    where('companyId', '==', companyId))
);

// Find all Applications for a JobOrder
const applications = await getDocs(
  query(collection(db, 'tenants', tenantId, 'applications'), 
    where('jobOrderId', '==', jobOrderId))  // BROKEN: jobOrderId not always present
);
```

#### Loading Parent:
```typescript
// Load Company for a JobOrder
const company = await getDoc(
  doc(db, 'tenants', tenantId, 'crm_companies', jobOrder.companyId)
);

// Load Location for a JobOrder
const location = await getDoc(
  doc(db, 'tenants', tenantId, 'crm_companies', jobOrder.companyId, 'locations', jobOrder.worksiteId)
);
```

---

## Implementation Recommendations

### Priority 1: CRITICAL FIXES

#### Fix 1: Add jobOrderId to Applications
**File**: `src/components/apply/Wizard.tsx`  
**Line**: ~662-677 (in handleSubmit function)

**Current Code**:
```typescript
const applicationQuickData: any = {
  applicationId: applicationId,
  jobId: jobId,
  // ... other fields
  companyId: companyId,
  // jobOrderId is MISSING!
};
```

**Required Fix**:
```typescript
const applicationQuickData: any = {
  applicationId: applicationId,
  jobId: jobId,
  jobOrderId: posting?.jobOrderId || null,  // ADD THIS LINE
  companyId: companyId,
  // ... other fields
};
```

**Also update user document**:
```typescript
await updateDoc(userRef, {
  applicationIds: arrayUnion(applicationId),
  [`applicationData.${applicationId}`]: {
    ...applicationQuickData,
    jobOrderId: posting?.jobOrderId || null  // ADD THIS
  }
});
```

### Priority 2: IMPORTANT IMPROVEMENTS

#### Improvement 1: Add Association Counts (Performance)
Track counts to avoid expensive queries:

**Company document**:
```typescript
associationCounts: {
  contacts: 5,        // Update when contact added/removed
  locations: 3,       // Update when location added/removed
  deals: 12,          // Update when deal created with this company
  jobOrders: 8        // Update when job order created with this company
}
```

**Implementation**: Firebase Cloud Functions to maintain counts

#### Improvement 2: Standardize Contact Loading
**Pattern established**: When a form loads with `companyId`, automatically load company contacts

**Already implemented in**:
- ✅ JobOrderForm (via useEffect)

**Should also implement in**:
- Deal forms (if they select contacts by company)
- JobPost forms (if they assign contacts)

### Priority 3: NICE-TO-HAVE ENHANCEMENTS

#### Enhancement 1: Bidirectional Arrays (Optional)
Add arrays to parent entities for direct queries:

**Deal**:
```typescript
jobOrderIds: string[];    // Track generated job orders
```

**JobOrder**:
```typescript
jobPostIds: string[];     // Track created job posts
```

**Trade-off**: Requires two-write transactions, increases complexity

**Recommendation**: NOT recommended - reverse queries work fine and are more reliable

#### Enhancement 2: Soft Delete Pattern
Instead of hard deleting entities:
```typescript
{
  status: 'active' | 'inactive' | 'deleted',
  deletedAt?: Date,
  deletedBy?: string
}
```

**Benefit**: Prevents broken references, maintains historical data

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          INDEPENDENT ENTITIES                        │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │   COMPANY    │
    │ (crm_companies)│
    └──────┬───────┘
           │
           ├─── Subcollection: LOCATIONS
           │    └─ crm_companies/{companyId}/locations/{locationId}
           │
           └─── Query: CONTACTS (where companyId ==)
                └─ crm_contacts (contact.companyId)

    ┌──────────────┐
    │   CONTACT    │
    │ (crm_contacts)│
    └──────────────┘
           │
           ├─ companyId (required)
           ├─ locationId (optional single)
           └─ associations.locations[] (optional array)

┌─────────────────────────────────────────────────────────────────────┐
│                        PIPELINE ENTITIES                             │
└─────────────────────────────────────────────────────────────────────┘

┌──────────┐        Generate        ┌──────────────┐
│   DEAL   │───────JobOrder────────→│  JOBORDER    │
│(crm_deals)│                        │ (job_orders) │
└──────────┘                        └──────┬───────┘
     │                                     │
     │ associations.contacts[]             │ hrContactId, decisionMaker, etc.
     │ associations.salespeople[]          │ assignedRecruiters[]
     │ associations.locations[]            │ companyId (definitive)
     │ companyId                            │ worksiteId (definitive)
     │ locationId                           │ dealId (source reference)
     │                                      │
     │                                      │ Post to
     │                                      │ Jobs Board
     │                                      ▼
     │                               ┌──────────────┐
     │                               │   JOBPOST    │
     │                               │(job_postings)│
     │                               └──────┬───────┘
     │                                      │
     │                                      │ jobOrderId (source reference)
     │                                      │ companyId (copied)
     │                                      │ worksiteId (copied)
     │                                      │
     │                                      │ User
     │                                      │ Applies
     │                                      ▼
     │                               ┌──────────────┐
     │                               │ APPLICATION  │
     │                               │(applications)│
     │                               └──────────────┘
     │                                      │
     │                                      │ userId (applicant)
     │                                      │ jobId (posting)
     │                                      │ jobOrderId (⚠️ MISSING!)
     │                                      │ companyId (denormalized)
     │                                      │
     └──────────────────────────────────────┘
```

---

## Connection Checklist (Development Guide)

### When Creating a Deal:
- [ ] Set `tenantId`
- [ ] Set `companyId` (primary company)
- [ ] Set `companyName` (denormalized)
- [ ] Set `owner` (user ID)
- [ ] Optionally populate `associations.contacts[]` (with snapshots)
- [ ] Optionally populate `associations.locations[]` (with snapshots)
- [ ] Optionally populate `associations.salespeople[]` (with snapshots)

### When Generating JobOrder from Deal:
- [ ] Set `dealId` (source deal)
- [ ] Copy `companyId` from deal (becomes definitive)
- [ ] Copy `companyName` from deal (snapshot)
- [ ] Copy `worksiteId` from deal.locationId (becomes definitive)
- [ ] Copy `worksiteName` from deal.locationName (snapshot)
- [ ] Copy entire `deal` object (full snapshot with associations)
- [ ] Extract contact IDs from `deal.associations.contacts[]` for role assignments
- [ ] Set `createdBy` (user ID)
- [ ] Initialize `assignedRecruiters: []` (can be edited later)

### When Creating JobOrder Manually:
- [ ] Set `tenantId`
- [ ] Select `companyId` (required)
- [ ] Set `companyName` (denormalized from company)
- [ ] Select `worksiteId` (required)
- [ ] Set `worksiteName` (denormalized from location)
- [ ] Optionally assign contact IDs (`hrContactId`, etc.)
- [ ] Set `createdBy` (user ID)
- [ ] Initialize `assignedRecruiters: []`
- [ ] Leave `dealId` null (not from deal)

### When Creating JobPost from JobOrder:
- [ ] Set `jobOrderId` (source job order)
- [ ] Copy `companyId` from job order
- [ ] Copy `companyName` from job order (snapshot)
- [ ] Copy `worksiteId` from job order
- [ ] Copy `worksiteName` from job order (snapshot)
- [ ] Copy `worksiteAddress` from job order
- [ ] Set `createdBy` (user ID)
- [ ] Set `jobType` ('gig' or 'career')

### When Creating Standalone JobPost:
- [ ] Set `tenantId`
- [ ] Optionally set `companyId` (if associated with company)
- [ ] Set `companyName` (required for display)
- [ ] Optionally set `worksiteId` (if associated with location)
- [ ] Set `worksiteName` (required for display)
- [ ] Leave `jobOrderId` null (not linked)
- [ ] Set `createdBy` (user ID)
- [ ] Set `jobType` ('gig' or 'career')

### When Creating Application:
- [ ] Set `userId` (applicant user ID)
- [ ] Set `tenantId`
- [ ] Set `jobId` (posting ID)
- [ ] **⚠️ CRITICAL**: Set `jobOrderId` from `posting.jobOrderId` (if exists)
- [ ] Denormalize: `companyId`, `companyName`, `jobTitle`, `location` from posting
- [ ] Set `status: 'submitted'`
- [ ] Update user document with `applicationIds[]` and `applicationData.{id}`
- [ ] If `posting.autoAddToUserGroup`, add user to that group

---

## Data Integrity Rules

### Rule 1: Required IDs
- **JobOrder**: MUST have `companyId` and `worksiteId`
- **Contact**: MUST have `companyId`
- **Location**: MUST be in company subcollection (companyId inherited from path)
- **Application**: MUST have `userId` and `jobId`

### Rule 2: Denormalized Names
- **Purpose**: Display performance
- **Update Policy**: Snapshot (do not update when source changes)
- **Rationale**: Historical accuracy, simpler code, no cascade updates

### Rule 3: Optional Connections
- `dealId` in JobOrder: Optional (only if created from deal)
- `jobOrderId` in JobPost: Optional (only if linked to job order)
- `jobOrderId` in Application: Optional (only if posting was linked)

### Rule 4: Query Performance
- Use indexes for common queries:
  - `crm_contacts`: Index on `companyId`
  - `job_orders`: Index on `dealId`, `companyId`
  - `job_postings`: Index on `jobOrderId`, `status`
  - `applications`: Index on `jobOrderId`, `userId`, `jobId`

---

## Migration & Cleanup Tasks

### Task 1: Fix Missing jobOrderId in Applications
**Estimated Impact**: All existing applications from linked job posts

**Script needed**:
```typescript
// For each application in tenants/{tenantId}/applications
// If jobId exists and jobOrderId is missing:
//   1. Load posting from job_postings/{jobId}
//   2. If posting.jobOrderId exists, update application.jobOrderId
```

### Task 2: Add Missing Contact IDs to JobOrders
**Impact**: JobOrders created before contact assignment feature

**Validation**: Check if any JobOrders have `companyId` but no contact IDs

### Task 3: Validate Orphaned References
**Check for**:
- JobOrders with `companyId` pointing to deleted companies
- JobOrders with `worksiteId` pointing to deleted locations
- Contacts with `companyId` pointing to deleted companies
- Applications with `jobOrderId` pointing to deleted job orders

**Resolution**: Either restore entities or mark as orphaned

---

## Common Query Examples

### Example 1: Get All Applications for a JobOrder
```typescript
// Current (BROKEN if jobOrderId missing):
const applications = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'applications'),
    where('jobOrderId', '==', jobOrderId)
  )
);

// Workaround (slower):
// 1. Get all job posts for job order
const posts = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'job_postings'),
    where('jobOrderId', '==', jobOrderId)
  )
);
const postIds = posts.docs.map(doc => doc.id);

// 2. Get applications for each post
const allApplications = [];
for (const postId of postIds) {
  const apps = await getDocs(
    query(
      collection(db, 'tenants', tenantId, 'applications'),
      where('jobId', '==', postId)
    )
  );
  allApplications.push(...apps.docs);
}
```

### Example 2: Get All Contacts for a Company
```typescript
const contacts = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'crm_contacts'),
    where('companyId', '==', companyId)
  )
);
```

### Example 3: Get All JobOrders for a Deal
```typescript
const jobOrders = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'job_orders'),
    where('dealId', '==', dealId)
  )
);
```

### Example 4: Get Company and Location for a JobOrder
```typescript
// Company (direct lookup)
const company = await getDoc(
  doc(db, 'tenants', tenantId, 'crm_companies', jobOrder.companyId)
);

// Location (subcollection lookup)
const location = await getDoc(
  doc(db, 'tenants', tenantId, 'crm_companies', jobOrder.companyId, 'locations', jobOrder.worksiteId)
);
```

---

## Code Examples: Following Standards

### Creating a JobOrder (Manual)
```typescript
const jobOrderData = {
  // Required connections
  tenantId: tenantId,
  companyId: selectedCompanyId,
  companyName: selectedCompany.companyName,  // Denormalized
  worksiteId: selectedLocationId,
  worksiteName: selectedLocation.name,        // Denormalized
  
  // Creator
  createdBy: user.uid,
  assignedRecruiters: [user.uid],             // Start with creator
  
  // Optional deal connection
  dealId: null,                               // Not from deal
  
  // Optional contact assignments
  hrContactId: selectedHRContactId || null,
  decisionMaker: selectedDMContactId || null,
  
  // Job details
  jobOrderName: 'Warehouse Supervisor - ACME Corp',
  jobTitle: 'First-Line Supervisors of Helpers, Laborers, and Material Movers, Hand',
  jobType: 'career',
  status: 'draft',
  workersNeeded: 1,
  payRate: 21,
  markup: 25,
  billRate: 26.25,
  estimatedRevenue: 26.25 * 2080 * 1,  // Auto-calculated
  
  // Timestamps
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
};

await addDoc(collection(db, 'tenants', tenantId, 'job_orders'), jobOrderData);
```

### Creating an Application (Fixed)
```typescript
// Load the posting to get jobOrderId
const postRef = doc(db, 'tenants', tenantId, 'job_postings', jobId);
const postSnap = await getDoc(postRef);
const posting = postSnap.data();

const applicationData = {
  // Required connections
  userId: uid,
  tenantId: tenantId,
  jobId: jobId,                              // Posting ID
  jobOrderId: posting?.jobOrderId || null,   // ✅ CRITICAL: Copy from posting
  
  // Denormalized data
  companyId: posting?.companyId || null,
  companyName: posting?.companyName || '',
  jobTitle: posting?.jobTitle || '',
  jobPostId: posting?.jobPostId || '',
  location: posting?.worksiteName || '',
  
  // Application data
  status: 'submitted',
  applicant: {
    firstName: firstName,
    lastName: lastName,
    email: email,
    phone: phone
  },
  data: formData,                            // Full wizard data
  
  // Timestamps
  submittedAt: serverTimestamp(),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
};

const appId = `${uid}_${jobId}`;
await setDoc(doc(db, 'tenants', tenantId, 'applications', appId), applicationData);
```

---

## Questions & Decisions Log

### Question 1: Should Deal track jobOrderIds[]?
**Status**: OPEN  
**Options**:
- a) Add `jobOrderIds: string[]` to Deal document
- b) Keep current pattern (reverse query only)

**Recommendation**: Keep current pattern
- Reverse query works fine: `where('dealId', '==', dealId)`
- Avoids two-write transactions
- Deal doesn't need to know about all job orders

### Question 2: Update denormalized names or keep as snapshots?
**Status**: DECIDED - Keep as snapshots  
**Rationale**:
- Historical accuracy (know what company name was at time of engagement)
- Simpler code (no cascade updates)
- Performance (no need to update thousands of documents)

**Implementation**: Denormalized names are considered immutable snapshots

### Question 3: What happens when entities are deleted?
**Status**: OPEN  
**Current Behavior**: Orphaned references

**Options**:
- a) Prevent deletion if references exist (with warning)
- b) Cascade delete dependent entities
- c) Soft delete (mark as inactive)
- d) Allow orphans (keep as historical record)

**Recommendation**: Implement soft delete for critical entities (Company, Contact, Location)

### Question 4: Should Applications always have jobOrderId?
**Status**: DECIDED - Yes, when available  
**Fix Required**: Update Wizard.tsx to copy `posting.jobOrderId`

---

## File Locations Reference

### Entity Type Definitions:
- Deal: `src/pages/TenantViews/DealDetails.tsx` (DealData interface, line 94)
- JobOrder: `src/types/recruiter/jobOrder.ts` (JobOrder interface, line 3)
- JobPost: `src/services/recruiter/jobsBoardService.ts` (JobsBoardPost interface, line 31)
- Application: `packages/contracts/firestore/schemas/applications.schema.json`
- Company: `src/types/CRM.ts` (CRMCompany interface, line 121)
- Contact: `src/types/CRM.ts` (CRMContact interface, line 57)
- Location: `src/types/NewDataModel.ts` (Location interface, line 170)

### Key Services:
- Deal → JobOrder: `src/services/recruiter/jobOrderService.ts::createJobOrderFromDeal()` (line 221)
- JobOrder → JobPost: `src/services/recruiter/jobsBoardService.ts::createPostFromJobOrder()` (line 232)
- JobPost → Application: `src/components/apply/Wizard.tsx::handleSubmit()` (line ~615)

### Key Forms:
- JobOrder Form: `src/components/JobOrderForm.tsx`
- Deal Stage Forms: `src/components/DealStageForms.tsx`
- Job Post Form: `src/components/JobPostForm.tsx`
- Application Wizard: `src/components/apply/Wizard.tsx`

---

## Next Steps

### Immediate Actions (Critical):
1. Fix `jobOrderId` in Application creation (Wizard.tsx)
2. Test that applications can be queried by JobOrder
3. Verify contact loading works in all forms

### Short-term Actions (Important):
1. Add association count tracking (Cloud Functions)
2. Implement soft delete for Company, Contact, Location
3. Add validation to prevent orphaned references

### Long-term Actions (Nice-to-have):
1. Create migration script for existing applications missing jobOrderId
2. Add data integrity checks (Cloud Functions)
3. Create admin UI to view/fix orphaned references

---

## Appendix: Current vs Ideal State

### Application Entity - Current vs Fixed

**CURRENT (Broken)**:
```typescript
{
  userId: "user123",
  jobId: "post456",
  // jobOrderId: MISSING!
  companyName: "ACME Corp",
  status: "submitted"
}
```

**FIXED**:
```typescript
{
  userId: "user123",
  jobId: "post456",
  jobOrderId: "joborder789",       // ✅ Added
  companyId: "company012",         // ✅ Added for completeness
  companyName: "ACME Corp",
  status: "submitted"
}
```

### Benefits of Fix:
- ✅ Can query: "Show all applications for JobOrder #0002"
- ✅ JobOrder detail page can display application count
- ✅ Recruiter can see which applications came from which job order
- ✅ Reporting: Applications per job order analytics

---

**End of Document**

