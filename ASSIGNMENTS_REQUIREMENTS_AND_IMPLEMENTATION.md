# Assignments System - Requirements & Implementation Guide

## 📋 Executive Summary

Assignments represent the act of **assigning a worker to a shift within a job order**. This system must be **absolutely bulletproof** as it directly impacts:
- Worker scheduling and payroll
- Job order fulfillment tracking
- Timesheet and billing systems
- Worker experience and notifications

**Target Structure:** Assignments must be stored as a **subcollection of the Tenant**:
```
tenants/{tenantId}/assignments/{assignmentId}
```

---

## 🎯 Core Requirements (from phase2-assignments.md)

### Business Goals
1. Convert Applications → Assignments
2. Track assignments per Job Order and per Candidate
3. Support status lifecycle: `proposed` → `confirmed` → `active` → `completed` → `ended` → `canceled`
4. Link assignments to shifts (when assigning workers to specific shifts)
5. Support timesheet mode configuration
6. Auto-update Job Order status when assignments change

### Status Lifecycle
```
proposed → confirmed → active → completed
                               ↓
                         ended | canceled
```

---

## 📂 Required Firestore Structure

### Primary Structure (Target)
```
tenants/{tenantId}/
  assignments/{assignmentId}
    ├── tenantId: string (required)
    ├── jobOrderId: string (required)
    ├── shiftId?: string (optional - links to specific shift)
    ├── candidateId: string (required - references user/worker)
    ├── userId: string (required - same as candidateId or denormalized)
    ├── applicationId?: string (optional - links back to application)
    ├── status: 'proposed' | 'confirmed' | 'active' | 'completed' | 'ended' | 'canceled'
    ├── startDate: string (ISO date)
    ├── endDate?: string (ISO date, optional)
    ├── payRate: number (decimal, tenant currency)
    ├── billRate?: number (decimal, tenant currency)
    ├── timesheetMode: 'mobile' | 'kiosk' | 'paper'
    ├── createdBy: string (userId - required)
    ├── createdAt: Timestamp (required - Firestore serverTimestamp())
    ├── updatedAt: Timestamp (required - Firestore serverTimestamp())
    ├── updatedBy?: string (userId - optional, set on updates)
    ├── assignedAt?: Timestamp (optional - when assignment was made, can differ from createdAt)
    ├── notes?: string
    └── [denormalized fields for performance - REQUIRED]
        ├── Worker Information:
        │   ├── firstName: string (required)
        │   ├── lastName: string (required)
        │   ├── email?: string
        │   └── phone?: string
        ├── Company Information:
        │   ├── companyId: string (required)
        │   ├── companyName: string (required)
        │   └── companyTitle?: string (optional - full display name)
        ├── Location/Worksite Information:
        │   ├── locationId: string (required)
        │   ├── locationIds?: string[] (array of location IDs if multiple)
        │   ├── locationNickname?: string (display name)
        │   ├── worksiteName?: string (fallback name)
        │   ├── latitude?: number (for distance calculations)
        │   └── longitude?: number (for distance calculations)
        ├── Job Information:
        │   ├── jobOrderType: 'career' | 'gig' (required - determines scheduling/timesheet behavior)
        │   ├── jobTitle?: string
        │   └── shiftTitle?: string
```

### Alternative Structure (Nested under Job Orders)
```
tenants/{tenantId}/
  job_orders/{jobOrderId}/
    assignments/{assignmentId}
```
**Note:** While the spec mentions this, the user has specified assignments should be a direct subcollection of Tenant for better query flexibility and tenant isolation.

---

## 🔑 Critical Data Requirements

### Required Fields (Must Always Exist)

**Core References:**
- `tenantId` - For tenant isolation
- `jobOrderId` - Links to the job order
- `candidateId` / `userId` - The worker being assigned
- `status` - Current assignment status
- `startDate` - When assignment begins
- `payRate` - Compensation rate
- `createdBy` - Audit trail (who created the assignment)
- `createdAt` - Timestamp (Firestore serverTimestamp() - when record created)
- `updatedAt` - Timestamp (Firestore serverTimestamp() - when record last updated)

**Required Denormalized Fields (Must populate at creation):**
- `firstName`, `lastName` - Worker name snapshot
- `companyId`, `companyName` - Company reference and name
- `locationId`, `locationNickname` (or `worksiteName`) - Primary worksite reference and name
- `latitude`, `longitude` - Location coordinates (for distance calculations, maps, check-ins)
- `jobOrderType` - 'career' or 'gig' (determines scheduling behavior, timesheet rules, shift handling)

**Optional Denormalized Fields:**
- `email`, `phone` - Worker contact info
- `companyTitle` - Full company display name (if different from companyName)
- `locationIds[]` - Array if assignment spans multiple locations
- `jobTitle` - Job position title
- `shiftTitle` - Shift title if assigned to specific shift
- `shiftId` - Link to specific shift (when applicable)

**Critical Rule:** Denormalized fields are **snapshots** - they reflect data at time of creation and do NOT auto-update when source data changes. This is by design for historical accuracy and performance.

---

## 🔐 Security Rules Requirements

### Firestore Rules Pattern
```javascript
match /tenants/{tenantId}/assignments/{assignmentId} {
  // READ Rules
  allow read: if request.auth != null && (
    // Worker can read their own assignments
    resource.data.userId == request.auth.uid ||
    resource.data.candidateId == request.auth.uid ||
    // Users assigned to same tenant can read
    isAssignedToTenant(tenantId) ||
    // HRX can read all
    isHRX()
  );
  
  // CREATE Rules
  allow create: if request.auth != null && (
    // Recruiters/Admins in tenant can create
    (isAssignedToTenant(tenantId) && hasRecruiterAccess()) ||
    isHRX()
  ) && 
  // Ensure tenantId matches path
  request.resource.data.tenantId == tenantId;
  
  // UPDATE Rules
  allow update: if request.auth != null && (
    // Worker can only update their own status after active
    (resource.data.userId == request.auth.uid && 
     resource.data.status == 'active' &&
     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'updatedAt'])) ||
    // Recruiters/Admins can update anything
    (isAssignedToTenant(tenantId) && hasRecruiterAccess()) ||
    isHRX()
  );
  
  // DELETE Rules
  allow delete: if request.auth != null && (
    // Only admins/HRX can delete
    isTenantAdmin(tenantId) ||
    isHRX()
  );
}
```

### Key Security Principles
1. **Tenant Isolation:** All reads/writes must verify tenant membership
2. **Worker Self-Service:** Workers can read their assignments and update status once active
3. **Recruiter Control:** Recruiters/Admins can create and update assignments
4. **Audit Trail:** Track who created/updated each assignment

---

## 🔄 Current Implementation Status

### ⚠️ INCONSISTENT STRUCTURE (CRITICAL ISSUE)

**Problem:** Assignments are currently stored in **three different locations**:

1. **Root-level collection (WRONG - Being phased out)**
   ```javascript
   collection(db, 'assignments')  // ❌ Legacy, needs migration
   ```

2. **Nested under job orders (Per spec, but not user requirement)**
   ```javascript
   collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'assignments')
   // ✅ Matches spec, but user wants tenant-level
   ```

3. **Tenant subcollection (TARGET STRUCTURE)**
   ```javascript
   collection(db, 'tenants', tenantId, 'assignments')  // ✅ Target structure
   ```

### Files Currently Using Wrong Structure

**Root-level `assignments` collection (NEEDS MIGRATION):**
- `src/pages/UserProfile/index.tsx` (line 482)
- `src/pages/UserProfile/components/AssignmentRequirementsCard.tsx` (line 74)
- `src/pages/UserProfile/components/UserAssignmentsTab.tsx` (line 224)
- `src/pages/AssignmentDetails.tsx` (line 138)
- `src/pages/MyAssignments.tsx` (line 59)

**Nested under job orders (NEEDS DECISION):**
- `src/services/phase2/assignmentService.ts` - Uses nested structure per spec

**Correct structure (ALREADY DEFINED):**
- `src/data/firestorePaths.ts` (lines 67-68) - Defines `tenants/{tenantId}/assignments`

---

## 🎯 Implementation Plan

### Phase 1: Standardize Data Structure ✅ URGENT

**Goal:** Migrate all assignments to `tenants/{tenantId}/assignments/{assignmentId}`

**Steps:**
1. ✅ Create migration script to move existing assignments
2. ✅ Update all code to use tenant subcollection
3. ✅ Update Firestore security rules
4. ✅ Update all queries to include tenantId

### Phase 2: Enhance Assignment Creation

**Requirements:**
1. **Link to Shift:** When assigning worker to shift, store `shiftId`
2. **Auto-create Candidate:** Ensure candidate record exists (if converting from application)
3. **Denormalize Data:** Populate worker and location names at creation time
4. **Auto-trigger Onboarding:** If user not onboarded, start onboarding process
5. **Validate Duplicates:** Prevent assigning same worker to same shift twice
6. **Status Validation:** Enforce valid status transitions

### Phase 3: Status Management

**Status Transition Rules:**
- `proposed` → Can transition to: `confirmed`, `canceled`
- `confirmed` → Can transition to: `active`, `canceled`
- `active` → Can transition to: `completed`, `ended`, `canceled`
- `completed` → Terminal state
- `ended` → Terminal state
- `canceled` → Terminal state

**Auto-Actions:**
- When first assignment becomes `active` → Update Job Order status to "Filled" (if headcount met)
- When all assignments `ended`/`canceled` → Update Job Order status to "Completed" (if endDate passed)

### Phase 4: Query Optimization

**Required Indexes:**
```json
{
  "collectionGroup": "assignments",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenantId", "order": "ASCENDING" },
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "assignments",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenantId", "order": "ASCENDING" },
    { "fieldPath": "jobOrderId", "order": "ASCENDING" },
    { "fieldPath": "startDate", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "assignments",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenantId", "order": "ASCENDING" },
    { "fieldPath": "shiftId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

---

## 🔗 Relationship to Other Systems

### 1. Applications
- Assignments can be created from applications
- Store `applicationId` to maintain link
- Converting application → assignment should auto-create candidate if missing

### 2. Shifts
- Assignments link to shifts via `shiftId`
- When assigning to shift, assignment inherits shift details
- Multiple assignments can link to same shift (one per worker)

### 3. Job Orders
- Assignments belong to job orders via `jobOrderId`
- Assignment status changes trigger job order status updates
- Job order headcount calculated from active assignments

### 4. Onboarding
- When worker assigned to shift and not onboarded → **auto-start onboarding**
- Store onboarding job order requirements in assignment
- This is mentioned in user's previous requirements

### 5. Timesheets
- Assignments have `timesheetMode` field
- Timesheets reference assignment via `assignmentId`
- Future: Auto-create timesheet stubs for active assignments

---

## 🛡️ Bulletproof Requirements

### Data Integrity
1. **Always require tenantId** - Never allow assignments without tenant
2. **Validate status transitions** - Enforce valid state machine
3. **Prevent duplicates** - Same worker cannot be assigned to same shift twice
4. **Cascade deletes** - When job order deleted, handle assignments appropriately
5. **Audit trail** - Track all changes with `updatedBy` and `updatedAt`

### Performance
1. **Denormalize critical fields** - Worker names, location names, job titles
2. **Index all query patterns** - Ensure sub-200ms query times
3. **Batch operations** - When loading many assignments, use batching
4. **Cache frequently accessed** - Consider caching active assignments

### Error Handling
1. **Graceful degradation** - If assignment data missing, show clear error
2. **Validation errors** - Client-side validation before Firestore write
3. **Permission errors** - Clear messaging when user can't access assignment
4. **Retry logic** - For failed writes, implement exponential backoff

### Security
1. **Tenant isolation** - Never allow cross-tenant access
2. **Role-based access** - Recruiters can manage, workers can view/update own
3. **Input validation** - Sanitize all user inputs
4. **Rate limiting** - Prevent assignment creation abuse

---

## 🧪 Testing Requirements

### Unit Tests
- Status transition validation
- Duplicate assignment prevention
- Tenant isolation enforcement
- Data denormalization logic

### Integration Tests
- Assignment creation from application
- Assignment creation from shift assignment UI
- Status update triggers job order status change
- Query performance under load (10k+ assignments)

### User Acceptance Tests
- Recruiter creates assignment → Shows in job order
- Worker views assignments → Can see own assignments
- Status changes → Job order status updates correctly
- Assignment deletion → Proper cleanup

---

## 📊 Migration Checklist

### Pre-Migration
- [ ] Audit all existing assignment documents
- [ ] Document current data locations
- [ ] Create backup of all assignments
- [ ] Identify all code references

### Migration Steps
- [ ] Write migration script to move root-level assignments
- [ ] Write migration script to move nested assignments (if keeping tenant-level)
- [ ] Update all code references
- [ ] Update Firestore rules
- [ ] Create indexes
- [ ] Test migration on staging
- [ ] Run migration on production
- [ ] Verify data integrity

### Post-Migration
- [ ] Remove old assignment collections
- [ ] Update documentation
- [ ] Monitor error logs
- [ ] Verify query performance

---

## 🚀 Next Steps (Priority Order)

1. **URGENT:** Standardize to `tenants/{tenantId}/assignments` structure
2. **HIGH:** Update security rules for new structure
3. **HIGH:** Create migration script for existing data
4. **MEDIUM:** Implement assignment creation from shift assignment
5. **MEDIUM:** Auto-trigger onboarding when assignment created
6. **LOW:** Implement status transition validation
7. **LOW:** Add denormalization helpers

---

## 📝 Key Decisions Needed

1. **Structure Choice:** 
   - ✅ DECIDED: `tenants/{tenantId}/assignments/{assignmentId}` (user specified)
   
2. **Migration Strategy:**
   - Need decision on how to handle existing root-level assignments
   - Need decision on nested assignments (keep or migrate)

3. **Shift Relationship:**
   - Assignments should have `shiftId` when assigned to specific shift
   - But assignment can exist without shift (general job order assignment)

4. **Onboarding Trigger:**
   - User mentioned auto-starting onboarding when assigning to shift
   - Need to implement this logic

---

## 🔗 Related Documentation

- `phase2-assignments.md` - Original specification
- `docs/SHIFT_SELECTION_MODEL.md` - Shift assignment details
- `src/data/firestorePaths.ts` - Path definitions
- `src/types/phase2.ts` - Type definitions

---

**Last Updated:** December 2, 2025  
**Status:** Requirements compiled, awaiting implementation decisions

