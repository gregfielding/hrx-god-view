# Data Flow & Entity Relationship Diagram
**Visual Guide to HRX Data Connections**

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CRM MODULE                                      │
│                                                                              │
│  Salesperson enters:                                                         │
│  - Company (VenueSmart)                                                      │
│  - Location (Florida State Fairgrounds)                                     │
│  - Contacts (HR Manager, Operations Manager)                                │
│  - Deal stages (Discovery, Qualification, Scoping)                          │
│                                                                              │
│  ┌───────┐                                                                   │
│  │ DEAL  │  Contains:                                                        │
│  └───┬───┘  - Job titles from Discovery                                     │
│      │      - Pay rate from Qualification                                    │
│      │      - Requirements from Scoping                                      │
│      │      - Contacts/Locations via associations                            │
│      │                                                                        │
└──────┼──────────────────────────────────────────────────────────────────────┘
       │
       │ [Generate Job Order Button]
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RECRUITER MODULE                                    │
│                                                                              │
│  ┌─────────────┐  JobOrder created with:                                    │
│  │  JOBORDER   │  - dealId (link back)                                       │
│  │  (#0002)    │  - companyId (definitive - VenueSmart)                     │
│  └──────┬──────┘  - worksiteId (definitive - Florida State Fairgrounds)    │
│         │         - hrContactId, decisionMaker (specific contacts)           │
│         │         - assignedRecruiters[] (recruiter team)                    │
│         │         - Full deal snapshot in 'deal' field                       │
│         │                                                                     │
│         │ [Post to Jobs Board Button]                                        │
│         │                                                                     │
└─────────┼─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          JOBS BOARD MODULE                                   │
│                                                                              │
│  ┌─────────────┐  JobPost created with:                                     │
│  │  JOBPOST    │  - jobOrderId (link back to #0002)                         │
│  │  (JP2003)   │  - companyId (copied from JobOrder)                        │
│  └──────┬──────┘  - companyName (snapshot)                                  │
│         │         - worksiteId (copied)                                      │
│         │         - worksiteName (snapshot)                                  │
│         │         - Requirements, pay rate, etc.                             │
│         │                                                                     │
│         │ [User Clicks "Apply" Button]                                       │
│         │                                                                     │
└─────────┼─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       APPLICATION WIZARD                                     │
│                                                                              │
│  ┌──────────────┐  Application created with:                                │
│  │ APPLICATION  │  - userId (applicant)                                      │
│  │ (user_post)  │  - jobId (JP2003)                                          │
│  └──────────────┘  - jobOrderId (#0002) ✅ CRITICAL CONNECTION              │
│                    - companyId (VenueSmart)                                  │
│                    - Denormalized: companyName, jobTitle, location           │
│                                                                              │
│  Result: Recruiter can now view this application under JobOrder #0002       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Entity Relationships

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        COMPANY (crm_companies)                               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │  Company Document                                            │            │
│  │  - id: "comp123"                                             │            │
│  │  - companyName: "VenueSmart"                                 │            │
│  │  - address, city, state, phone, website                      │            │
│  │  - salesOwnerId: "user456"                                   │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                                                                              │
│  Child Collections:                                                          │
│  ├─ 📁 locations/                                                            │
│  │    ├─ {locationId1}: Florida State Fairgrounds                           │
│  │    └─ {locationId2}: Tampa Convention Center                             │
│  │                                                                            │
│  └─ (No contacts subcollection - contacts are separate with companyId)      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
           ▲                                    ▲
           │                                    │
           │ companyId                          │ companyId + locationId
           │                                    │
┌──────────┴─────────────┐         ┌───────────┴────────────┐
│  CONTACT (crm_contacts)│         │  DEAL (crm_deals)      │
│  - companyId: "comp123"│         │  - companyId: "comp123"│
│  - locationId: "loc1"  │         │  - locationId: "loc1"  │
│  - fullName            │         │  - associations: {     │
│  - email, phone        │         │      contacts: [...],  │
│  - role: "hr"          │         │      locations: [...]  │
└────────────────────────┘         │    }                   │
                                   └────────┬───────────────┘
                                            │
                                            │ dealId
                                            ▼
                                   ┌────────────────────────┐
                                   │ JOBORDER (job_orders)  │
                                   │ - dealId: "deal789"    │
                                   │ - companyId: "comp123" │
                                   │ - worksiteId: "loc1"   │
                                   │ - hrContactId: "con1"  │
                                   │ - assignedRecruiters[] │
                                   │ - deal: {...snapshot}  │
                                   └────────┬───────────────┘
                                            │
                                            │ jobOrderId
                                            ▼
                                   ┌────────────────────────┐
                                   │ JOBPOST (job_postings) │
                                   │ - jobOrderId: "jo002"  │
                                   │ - companyId: "comp123" │
                                   │ - worksiteId: "loc1"   │
                                   └────────┬───────────────┘
                                            │
                                            │ jobId + jobOrderId
                                            ▼
                                   ┌────────────────────────┐
                                   │ APPLICATION            │
                                   │ - jobId: "post123"     │
                                   │ - jobOrderId: "jo002"  │
                                   │ - userId: "user789"    │
                                   │ - companyId: "comp123" │
                                   └────────────────────────┘
```

---

## Connection Types Explained

### 1. Parent-Child (Subcollection)
```
Company (crm_companies/{companyId})
  └─ Locations (locations/{locationId})
```

**Characteristics**:
- Location CANNOT exist without Company
- Location inherits tenant and company context from path
- Query all locations: `collection(db, 'tenants', t, 'crm_companies', c, 'locations')`

**When to use**: True hierarchical relationship, child cannot exist independently

---

### 2. Foreign Key Reference (Single)
```
Contact
  └─ companyId: "comp123" ────┐
                               │
JobOrder                       │
  ├─ companyId: "comp123" ────┼─→ Company (crm_companies/comp123)
  └─ worksiteId: "loc1" ──────┘
```

**Characteristics**:
- Entity stores ID of related entity
- Query by: `where('companyId', '==', companyId)`
- Can reassign (change the ID)

**When to use**: Required 1-to-1 or many-to-1 relationship

---

### 3. Array Reference (Multiple)
```
JobOrder
  └─ assignedRecruiters: ["user1", "user2", "user3"] ─→ Users

Deal
  └─ associations.contacts: [
       "contact1",
       { id: "contact2", snapshot: {...} }
     ]
```

**Characteristics**:
- Entity can have multiple related entities
- Can include snapshots for historical context
- Query reverse: `where('jobOrderId', '==', id)` to find who's assigned

**When to use**: Multiple active relationships of same type

---

### 4. Snapshot (Embedded Document)
```
JobOrder
  └─ deal: {
       id: "deal789",
       name: "VenueSmart Janitorial Services",
       companyId: "comp123",
       companyName: "VenueSmart",
       associations: {
         contacts: [{id: "con1", snapshot: {...}}],
         locations: [{id: "loc1", snapshot: {...}}]
       },
       stageData: {...}
     }
```

**Characteristics**:
- Full copy of related entity at time of creation
- Preserves historical context
- Does NOT update when source changes
- Large data size

**When to use**: Need historical record of entity state at time of relationship creation

---

## Data Synchronization Patterns

### Pattern 1: No Sync (Snapshot)
**Used for**: Company names, location names in JobOrders/JobPosts/Applications

**Behavior**:
- Names are copied at creation time
- Never updated even if source entity name changes
- Represents "what it was called when we created this"

**Example**:
```
Company "ACME Corp" → renamed to "ACME Industries"

Existing JobOrder still shows:
- companyName: "ACME Corp" (snapshot from creation time)
```

**Rationale**: Historical accuracy, simpler code, no cascade updates

---

### Pattern 2: Live Query (No Denormalization)
**Used for**: Less common - when always need fresh data

**Behavior**:
- Store only ID
- Always query to get current data
- No stale data issues

**Example**:
```typescript
// Store only ID
contact: {
  id: "contact123"
}

// Always query for current data
const contactDoc = await getDoc(doc(db, 'crm_contacts', contact.id));
const currentName = contactDoc.data().fullName;  // Always current
```

**Trade-off**: More queries, slower lists, but always fresh data

**When to use**: Rare - only when data freshness is critical

---

### Pattern 3: Reactive Updates (Future Enhancement)
**Not currently implemented**

**Behavior**:
- Cloud Function triggers on entity update
- Updates all references automatically

**Example**:
```
Company name changes → Cloud Function triggers
  → Update all JobOrders with that companyId
  → Update all JobPosts with that companyId
  → Update all Applications with that companyId
```

**Trade-off**: Complex, expensive, risk of race conditions

**Recommendation**: Not recommended - use snapshots instead

---

## Special Case: Deal Associations

Deals use a flexible association pattern that combines IDs and snapshots:

```typescript
associations: {
  contacts: [
    // Option 1: Just the ID (minimal)
    "contact123",
    
    // Option 2: ID + snapshot (rich context)
    {
      id: "contact456",
      snapshot: {
        fullName: "John Doe",
        email: "john@example.com",
        title: "VP of Operations",
        phone: "555-1234"
      }
    }
  ],
  
  locations: [
    "location789",
    {
      id: "location012",
      snapshot: {
        name: "Tampa Facility",
        address: "123 Main St",
        city: "Tampa"
      }
    }
  ],
  
  salespeople: [
    {
      id: "user345",
      snapshot: {
        displayName: "Jane Smith",
        email: "jane@c1staffing.com"
      }
    }
  ]
}
```

**Why this pattern?**:
- Flexible: Can store just ID or ID + rich snapshot
- Historical: Captures who was involved at each deal stage
- Performance: Snapshots avoid queries when displaying deal details

**When JobOrder is generated**:
- Entire `associations` object is copied to `jobOrder.deal.associations`
- Contact IDs are extracted and assigned to specific roles (hrContactId, etc.)
- This becomes the "official" record for that engagement

---

## Connection Strength Levels

### Level 1: REQUIRED (Cannot exist without)
```
Location → Company (subcollection)
  Location MUST have parent company
  Path: crm_companies/{companyId}/locations/{locationId}
```

### Level 2: DEFINITIVE (Single source of truth)
```
JobOrder → Company (foreign key)
  JobOrder MUST have companyId
  This IS the official company for this job order
```

### Level 3: OPTIONAL (May or may not exist)
```
JobPost → JobOrder (foreign key)
  JobPost MAY have jobOrderId
  Some posts are standalone, some are linked
```

### Level 4: HISTORICAL (Snapshot only)
```
JobOrder → Deal (reference + snapshot)
  JobOrder stores dealId
  JobOrder also stores full deal snapshot
  Snapshot preserves state at creation time
```

---

## Real-World Example

### Scenario: VenueSmart Florida State Fairgrounds Job

```
Step 1: CRM - Salesperson creates Deal
─────────────────────────────────────
Deal Document (crm_deals/deal789):
{
  id: "deal789",
  name: "VenueSmart Janitorial Services",
  companyId: "comp_venuesmart",
  companyName: "VenueSmart",
  locationId: "loc_fsfairgrounds",
  locationName: "Florida State Fairgrounds",
  owner: "salesperson_jane",
  associations: {
    contacts: [
      {
        id: "contact_melissa",
        snapshot: {
          fullName: "Melissa Mellett",
          email: "melissa@venuesmart.com",
          title: "HR Manager"
        }
      }
    ],
    salespeople: [
      {
        id: "salesperson_jane",
        snapshot: {
          displayName: "Jane Smith",
          email: "jane@c1staffing.com"
        }
      }
    ]
  },
  stageData: {
    discovery: {
      jobTitles: ["Janitors and Cleaners, Except Maids and Housekeeping Cleaners"]
    },
    qualification: {
      expectedAveragePayRate: 21,
      expectedAverageMarkup: 25,
      staffPlacementTimeline: {
        starting: 1
      }
    }
  }
}
```

```
Step 2: Recruiter - Generate Job Order
───────────────────────────────────────
JobOrder Document (job_orders/jo_0002):
{
  id: "jo_0002",
  jobOrderNumber: "0002",
  jobOrderName: "Janitorial Supervisor – Florida State Fairgrounds",
  jobTitle: "Janitors and Cleaners, Except Maids and Housekeeping Cleaners",
  status: "open",
  jobType: "career",
  
  // DEFINITIVE CONNECTIONS (Single Source of Truth)
  tenantId: "tenant_c1",
  companyId: "comp_venuesmart",        // THE company for this job
  companyName: "VenueSmart",           // Snapshot
  worksiteId: "loc_fsfairgrounds",     // THE location for this job
  worksiteName: "Florida State Fairgrounds",  // Snapshot
  
  // SOURCE CONNECTION
  dealId: "deal789",                   // Where this came from
  
  // PEOPLE ASSIGNMENTS
  createdBy: "salesperson_jane",
  assignedRecruiters: ["recruiter_greg"],
  hrContactId: "contact_melissa",      // Extracted from deal associations
  
  // FINANCIAL
  payRate: 21,
  markup: 25,
  billRate: 26.25,
  workersNeeded: 1,
  estimatedRevenue: 54600,             // 26.25 × 2080 × 1
  
  // FULL DEAL SNAPSHOT
  deal: {
    id: "deal789",
    name: "VenueSmart Janitorial Services",
    companyId: "comp_venuesmart",
    associations: { /* full associations object */ },
    stageData: { /* all stage data */ }
  }
}
```

```
Step 3: Recruiter - Post to Jobs Board
───────────────────────────────────────
JobPost Document (job_postings/post2003):
{
  id: "post2003",
  jobPostId: "2003",
  postTitle: "Janitorial Supervisor – Florida State Fairgrounds",
  jobTitle: "Janitors and Cleaners, Except Maids and Housekeeping Cleaners",
  jobType: "career",
  
  // CONNECTION TO JOBORDER
  jobOrderId: "jo_0002",               // Link back to job order
  
  // COPIED FROM JOBORDER
  tenantId: "tenant_c1",
  companyId: "comp_venuesmart",
  companyName: "VenueSmart",           // Snapshot from job order
  worksiteId: "loc_fsfairgrounds",
  worksiteName: "Florida State Fairgrounds",  // Snapshot from job order
  worksiteAddress: {
    street: "800 U.S. 301",
    city: "Tampa",
    state: "FL",
    zipCode: "33610"
  },
  
  // JOB DETAILS
  payRate: 21,
  showPayRate: true,
  workersNeeded: 1,
  status: "active",
  visibility: "public",
  
  createdBy: "recruiter_greg"
}
```

```
Step 4: Applicant - Submits Application
────────────────────────────────────────
Application Document (applications/user789_post2003):
{
  id: "user789_post2003",
  
  // CORE CONNECTIONS
  userId: "user789",                   // Patrick Bowie (applicant)
  tenantId: "tenant_c1",
  jobId: "post2003",                   // The job posting
  jobOrderId: "jo_0002",               // ✅ CRITICAL: Linked to job order!
  
  // DENORMALIZED FROM POSTING
  companyId: "comp_venuesmart",
  companyName: "VenueSmart",
  jobTitle: "Janitors and Cleaners, Except Maids and Housekeeping Cleaners",
  jobPostId: "2003",
  location: "Florida State Fairgrounds",
  payRate: 21,
  
  // APPLICANT DATA
  applicant: {
    firstName: "Patrick",
    lastName: "Bowie",
    email: "patrick@example.com",
    phone: "+19254480579"
  },
  
  // STATUS
  status: "submitted",
  submittedAt: Timestamp,
  
  // FULL WIZARD DATA
  data: {
    personal: {...},
    eligibility: {...},
    qualifications: {...},
    preferences: {...}
  }
}
```

```
Result: Complete Connection Chain
──────────────────────────────────
✅ Salesperson can see JobOrder was created from their Deal
✅ Recruiter can see all JobPosts for JobOrder #0002
✅ Recruiter can see all Applications for JobOrder #0002
✅ Application shows which Company/Location it's for
✅ All entities maintain referential integrity
```

---

## Connection Validation Checklist

Before saving any entity, validate:

### JobOrder Validation:
```typescript
function validateJobOrder(jobOrder) {
  if (!jobOrder.tenantId) throw new Error('Missing tenantId');
  if (!jobOrder.companyId) throw new Error('Missing companyId');
  if (!jobOrder.companyName) throw new Error('Missing companyName');
  if (!jobOrder.worksiteId) throw new Error('Missing worksiteId');
  if (!jobOrder.worksiteName) throw new Error('Missing worksiteName');
  if (!jobOrder.createdBy) throw new Error('Missing createdBy');
  if (!Array.isArray(jobOrder.assignedRecruiters)) {
    jobOrder.assignedRecruiters = [];
  }
  return true;
}
```

### Application Validation:
```typescript
function validateApplication(application, posting) {
  if (!application.userId) throw new Error('Missing userId');
  if (!application.tenantId) throw new Error('Missing tenantId');
  if (!application.jobId) throw new Error('Missing jobId');
  
  // CRITICAL: If posting is linked to job order, application MUST have jobOrderId
  if (posting.jobOrderId && !application.jobOrderId) {
    throw new Error('Missing jobOrderId - posting is linked to job order!');
  }
  
  return true;
}
```

### Contact Validation:
```typescript
function validateContact(contact) {
  if (!contact.tenantId) throw new Error('Missing tenantId');
  if (!contact.companyId) throw new Error('Missing companyId');
  if (!contact.fullName) throw new Error('Missing fullName');
  if (!contact.email) throw new Error('Missing email');
  return true;
}
```

---

## Troubleshooting Common Issues

### Issue: "Contacts not loading for company"
**Check**:
1. Does JobOrder have `companyId` set?
2. Do contacts exist with matching `companyId`?
3. Is `loadCompanyContacts()` being called?

**Fix**: Ensure `useEffect` triggers contact loading when `formData.companyId` changes

---

### Issue: "Applications not showing for JobOrder"
**Check**:
1. Does JobPost have `jobOrderId` set?
2. Does Application have `jobOrderId` set?
3. Is query using correct field name?

**Fix**: Ensure Application copies `posting.jobOrderId` at creation (FIXED in Wizard.tsx)

---

### Issue: "Location not loading"
**Check**:
1. Does JobOrder have both `companyId` AND `worksiteId`?
2. Is path correct: `crm_companies/{companyId}/locations/{worksiteId}`?
3. Does location actually exist in that path?

**Fix**: Verify location exists in company's subcollection

---

### Issue: "Denormalized name is outdated"
**Not a bug**: By design!

Denormalized names are **snapshots** - they show what the entity was called at the time of creation.

If you need current name, query the source entity:
```typescript
// Get current company name
const company = await getDoc(doc(db, 'crm_companies', jobOrder.companyId));
const currentName = company.data().companyName;  // Current

// Snapshot name
const snapshotName = jobOrder.companyName;  // Historical
```

---

## Summary: The Golden Rules

1. **JobOrder is King**: It stores definitive IDs for company, location, contacts
2. **Denormalize for Display**: Always store names alongside IDs
3. **Snapshots, Not Syncs**: Denormalized data doesn't update (by design)
4. **Applications Need JobOrderId**: Critical for recruiter workflow
5. **Use Reverse Queries**: Parent doesn't need to track child IDs (usually)
6. **Validate on Save**: Check all required IDs are present and valid
7. **Companies Stand Alone**: Companies, Contacts, Locations exist independently
8. **Path Tells the Story**: Location path includes companyId (subcollection pattern)

---

**Last Updated**: October 24, 2025  
**Next Review**: When adding new entity types or major features

