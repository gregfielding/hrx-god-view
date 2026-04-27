# Data Connections - Quick Reference Guide
**For Developers: What IDs to Store Where**

> Launch staffing source of truth: `docs/STAFFING_LAUNCH_CANONICAL_CONTRACT.md`

---

## Quick Lookup Table

| Entity | Path | Key IDs Stored | Denormalized Names |
|--------|------|----------------|-------------------|
| **Deal** | `tenants/{t}/crm_deals/{id}` | `companyId`, `locationId`, `owner`, `associations.contacts[]`, `associations.salespeople[]` | `companyName`, `locationName` |
| **JobOrder** | `tenants/{t}/job_orders/{id}` | `dealId`, `companyId`, `worksiteId`, `hrContactId`, `decisionMaker`, `assignedRecruiters[]` | `companyName`, `worksiteName` |
| **JobPost** | `tenants/{t}/job_postings/{id}` | `jobOrderId`, `companyId`, `worksiteId`, `autoAddToUserGroup` | `companyName`, `worksiteName` |
| **Application** | `tenants/{t}/applications/{id}` | `userId`, `jobId`, `jobOrderId`, `companyId` | `companyName`, `jobTitle`, `location` |
| **Company** | `tenants/{t}/crm_companies/{id}` | `salesOwnerId` | - |
| **Contact** | `tenants/{t}/crm_contacts/{id}` | `companyId`, `locationId`, `associations.locations[]` | `companyName`, `locationName` |
| **Location** | `tenants/{t}/crm_companies/{c}/locations/{id}` | (companyId in path) | - |

---

## When Creating Each Entity

### Creating a Deal
```typescript
{
  tenantId: string,              // ✅ Required
  companyId: string,             // ✅ Required - primary company
  companyName: string,           // ✅ Denormalized
  locationId?: string,           // ⚠️ Optional - primary location
  locationName?: string,         // ⚠️ Denormalized if locationId present
  owner: string,                 // ✅ Required - user ID
  associations: {
    contacts: [...],             // ⚠️ Optional - with snapshots
    locations: [...],            // ⚠️ Optional - with snapshots
    salespeople: [...]           // ⚠️ Optional - with snapshots
  }
}
```

### Creating a JobOrder (from Deal)
```typescript
{
  tenantId: string,              // ✅ Copy from deal
  dealId: string,                // ✅ Required - source deal
  companyId: string,             // ✅ Copy from deal (becomes definitive)
  companyName: string,           // ✅ Copy from deal (snapshot)
  worksiteId: string,            // ✅ Copy from deal.locationId (becomes definitive)
  worksiteName: string,          // ✅ Copy from deal.locationName (snapshot)
  createdBy: string,             // ✅ Required - user ID
  assignedRecruiters: [],        // ✅ Initialize empty array
  deal: { ...dealData },         // ✅ Full deal snapshot
  // Extract contact IDs from deal.associations for role assignments
}
```

### Creating a JobOrder (manual)
```typescript
{
  tenantId: string,              // ✅ Required
  dealId: null,                  // ✅ Explicitly null (not from deal)
  companyId: string,             // ✅ Required - user selected
  companyName: string,           // ✅ Denormalized from company
  worksiteId: string,            // ✅ Required - user selected
  worksiteName: string,          // ✅ Denormalized from location
  createdBy: string,             // ✅ Required - current user ID
  assignedRecruiters: [userId],  // ✅ Start with creator
  hrContactId?: string,          // ⚠️ Optional - user selected
  // ... other contact roles
}
```

### Creating a JobPost (from JobOrder)
```typescript
{
  tenantId: string,              // ✅ Copy from job order
  jobOrderId: string,            // ✅ Required - source job order
  companyId: string,             // ✅ Copy from job order
  companyName: string,           // ✅ Copy from job order (snapshot)
  worksiteId: string,            // ✅ Copy from job order
  worksiteName: string,          // ✅ Copy from job order (snapshot)
  worksiteAddress: {...},        // ✅ Copy from job order
  jobType: 'gig' | 'career',     // ✅ Required - user selected or copied
  createdBy: string,             // ✅ Required - user ID
}
```

### Creating a JobPost (standalone)
```typescript
{
  tenantId: string,              // ✅ Required
  jobOrderId: null,              // ✅ Explicitly null (not linked)
  companyId?: string,            // ⚠️ Optional - user selected
  companyName: string,           // ✅ Required - user entered or copied
  worksiteId?: string,           // ⚠️ Optional - user selected
  worksiteName: string,          // ✅ Required - user entered or copied
  worksiteAddress: {...},        // ✅ Required - user entered
  jobType: 'gig' | 'career',     // ✅ Required - user selected
  createdBy: string,             // ✅ Required - user ID
}
```

### Creating an Application
```typescript
{
  userId: string,                           // ✅ Required - applicant
  tenantId: string,                         // ✅ Required
  jobId: string,                            // ✅ Required - posting ID
  jobOrderId: posting.jobOrderId || null,   // ✅✅✅ CRITICAL - copy from posting!
  companyId: posting.companyId || null,     // ✅ Denormalized
  companyName: posting.companyName,         // ✅ Denormalized
  jobTitle: posting.jobTitle,               // ✅ Denormalized
  jobPostId: posting.jobPostId,             // ✅ Sequential number
  location: posting.worksiteName,           // ✅ Denormalized
  status: 'submitted',                      // ✅ Required
  applicant: {                              // ✅ Required - for display
    firstName: string,
    lastName: string,
    email: string,
    phone: string
  },
  data: formData                            // ✅ Full wizard data
}
```

---

## Common Queries

### Find All Contacts for a Company
```typescript
const contacts = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'crm_contacts'),
    where('companyId', '==', companyId)
  )
);
```

### Find All JobOrders for a Deal
```typescript
const jobOrders = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'job_orders'),
    where('dealId', '==', dealId)
  )
);
```

### Find All JobPosts for a JobOrder
```typescript
const jobPosts = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'job_postings'),
    where('jobOrderId', '==', jobOrderId)
  )
);
```

### Find All Applications for a JobOrder (FIXED)
```typescript
const applications = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'applications'),
    where('jobOrderId', '==', jobOrderId)  // ✅ Now works with fix!
  )
);
```

### Find All Applications for a JobPost
```typescript
const applications = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'applications'),
    where('jobId', '==', postId)
  )
);
```

### Load Location for a JobOrder
```typescript
const location = await getDoc(
  doc(db, 'tenants', tenantId, 'crm_companies', jobOrder.companyId, 'locations', jobOrder.worksiteId)
);
```

---

## Checklist: Before Deploying New Features

- [ ] All entities have `tenantId`
- [ ] Foreign key IDs are valid (reference existing entities)
- [ ] Denormalized names are set alongside IDs
- [ ] Applications include `jobOrderId` if posting is linked
- [ ] JobOrders include `dealId` if created from deal
- [ ] Contacts include `companyId` (required)
- [ ] Appropriate indexes exist for query fields

---

## Red Flags to Watch For

🚩 **Orphaned Reference**: ID points to non-existent entity  
🚩 **Missing Denormalized Name**: Have ID but no corresponding name field  
🚩 **Missing Critical Connection**: Application without `jobOrderId` when posting was linked  
🚩 **Inconsistent Patterns**: Some entities use one pattern, others use different pattern  
🚩 **Performance Issue**: Querying multiple documents to display a list  

---

## Recently Fixed Issues

✅ **Contact Loading in JobOrder Form** (Oct 24, 2025)
- Added `useEffect` to load company contacts when form opens
- File: `src/components/JobOrderForm.tsx`

✅ **Date Field Persistence** (Oct 24, 2025)
- Simplified to string format (YYYY-MM-DD)
- File: `src/components/JobOrderForm.tsx`

✅ **Application jobOrderId Missing** (Oct 24, 2025)
- Added explicit copy of `posting.jobOrderId` to application
- File: `src/components/apply/Wizard.tsx` lines 629, 665

✅ **Job Type Field Added** (Oct 24, 2025)
- Added to JobOrder form and save logic
- File: `src/components/JobOrderForm.tsx`

✅ **JobPost Not Fully Populating from JobOrder** (Oct 24, 2025)
- Added copy of all requirements fields when job order is connected
- Fields now copied: jobType, licensesCerts, skills, languages, experienceLevels, educationLevels, physicalRequirements, uniformRequirements, requiredPpe
- Files: `src/pages/TenantViews/JobsBoard.tsx`, `src/components/JobPostForm.tsx`

---

**For detailed analysis, see**: `docs/DATA_CONNECTIONS.md`

