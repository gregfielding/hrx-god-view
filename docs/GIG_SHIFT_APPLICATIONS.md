# Gig Shift Applications - How They're Saved to Firestore

## Overview

When a user applies to work a **gig shift**, the application is saved similarly to a career position application, but with additional shift-specific information. However, there's currently an **issue** where `shiftId` is not being stored directly in the application document.

## Current Implementation

### 1. Application Document Location
**Path**: `tenants/{tenantId}/applications/{userId}_{jobId}`

**Example**: For user `5hqNE0ngmGOEa2jA0QSTdJMfBln1` applying to job `vq4exK1xgoS0wxgAtJlW`:
- Document ID: `5hqNE0ngmGOEa2jA0QSTdJMfBln1_vq4exK1xgoS0wxgAtJlW`
- Full Path: `tenants/BCiP2bQ9CgVOCTfV6MhD/applications/5hqNE0ngmGOEa2jA0QSTdJMfBln1_vq4exK1xgoS0wxgAtJlW`

### 2. Application Document Structure

```typescript
{
  userId: string,              // User's UID
  tenantId: string,            // Tenant ID
  jobId: string,               // Job posting ID (e.g., "vq4exK1xgoS0wxgAtJlW")
  jobOrderId: string | null,   // Job order ID if posting is linked (e.g., "a4tHdgPcW5UYMYwe34gk")
  status: 'submitted',         // Application status
  submittedAt: Timestamp,      // When submitted
  updatedAt: Timestamp,        // Last update
  data: {                      // Full form data from wizard
    // All wizard form fields...
  },
  applicant: {
    firstName: string,
    lastName: string,
    email: string,
    phone: string
  }
  // ⚠️ ISSUE: shiftId and shiftIds are NOT stored here!
}
```

### 3. User Document - applicationData Map

The shift information is stored in the **user document** under `applicationData`:

**Path**: `users/{userId}/applicationData/{tenantId}_{jobId}`

**Example**:
```typescript
{
  applicationIds: [
    "BCiP2bQ9CgVOCTfV6MhD_vq4exK1xgoS0wxgAtJlW"
  ],
  applicationData: {
    "BCiP2bQ9CgVOCTfV6MhD_vq4exK1xgoS0wxgAtJlW": {
      applicationId: "BCiP2bQ9CgVOCTfV6MhD_vq4exK1xgoS0wxgAtJlW",
      jobId: "vq4exK1xgoS0wxgAtJlW",
      jobOrderId: "a4tHdgPcW5UYMYwe34gk",
      status: "submitted",
      appliedAt: Timestamp,
      updatedAt: Timestamp,
      jobTitle: "Janitors and Cleaners",
      postTitle: "Cleaners - Florida State Fair",
      payRate: 16,
      // ✅ Shift information IS stored here:
      selectedShifts: ["shiftId1", "shiftId2"],  // Array of shift IDs
      shiftAssignments: {                         // Map of shift ID to status
        "shiftId1": "pending",
        "shiftId2": "pending"
      }
    }
  }
}
```

## How Shift Applications Work

### When User Clicks "Apply" on a Shift:

1. **URL Parameter**: The shift ID is passed via URL parameter
   - Example: `/apply/{tenantId}/{jobId}?shifts=shiftId1,shiftId2`
   - Or single shift: `/apply/{tenantId}/{jobId}?shiftId=shiftId1`

2. **Wizard Reads Shifts**: The Wizard component extracts shifts from URL:
   ```typescript
   const selectedShifts = useMemo(() => {
     const shiftsParam = searchParams.get('shifts');
     return shiftsParam ? shiftsParam.split(',').filter(Boolean) : [];
   }, [searchParams]);
   ```

3. **Application Submission**: When the wizard is submitted:
   - Application document is created at `tenants/{tenantId}/applications/{userId}_{jobId}`
   - **Shift information is stored in user's `applicationData` map**, NOT in the application document itself

## Comparison: Gig vs Career Applications

### Career Position Application:
```typescript
// Application Document
{
  userId: "xxx",
  tenantId: "xxx",
  jobId: "xxx",
  jobOrderId: null,  // Usually null for standalone career posts
  status: "submitted",
  // No shiftId or shiftIds fields
}

// User's applicationData
{
  "tenantId_jobId": {
    jobId: "xxx",
    status: "submitted",
    // No selectedShifts or shiftAssignments
  }
}
```

### Gig Shift Application (✅ Now Fixed):
```typescript
// Application Document
{
  userId: "xxx",
  tenantId: "xxx",
  jobId: "xxx",  // This could be "job-order-{id}" format
  jobOrderId: "a4tHdgPcW5UYMYwe34gk",  // ✅ Present for gig jobs
  status: "submitted",
  // ✅ NOW INCLUDED:
  shiftId: "shiftId1",  // Single shift (if only one)
  // OR
  shiftIds: ["shiftId1", "shiftId2"],  // Multiple shifts (if more than one)
}

// User's applicationData
{
  "tenantId_jobId": {
    jobId: "xxx",
    jobOrderId: "a4tHdgPcW5UYMYwe34gk",
    status: "submitted",
    // ✅ Shift info IS here:
    selectedShifts: ["shiftId1"],
    shiftAssignments: { "shiftId1": "pending" }
  }
}
```

## ✅ FIXED: The Problem (Now Resolved)

**Previous Issue**: `shiftId` and `shiftIds` were **NOT stored in the application document**, only in the user's `applicationData` map.

This made it difficult to:
1. Query applications by shift ID
2. Find all applications for a specific shift
3. Check if a user has applied to a specific shift without loading their entire user document

## ✅ Solution Implemented

The application document now includes shift information:

```typescript
// In src/components/apply/Wizard.tsx (updated)
await setDoc(tRef, {
  userId: uid,
  tenantId,
  jobId,
  jobOrderId: posting?.jobOrderId || null,
  status: 'submitted',
  submittedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  data: formData,
  applicant: { ... },
  // ✅ NOW INCLUDED:
  ...(selectedShifts.length === 1 ? { shiftId: selectedShifts[0] } : {}),
  ...(selectedShifts.length > 1 ? { shiftIds: selectedShifts } : {}),
}, { merge: true });
```

### Backfill Script

A backfill script has been created to update existing applications:
- **Script**: `scripts/migrations/backfillShiftIdsInApplications.js`
- **Documentation**: `scripts/migrations/README-backfillShiftIds.md`
- **Usage**: `node scripts/migrations/backfillShiftIdsInApplications.js`

## How to Query Applications

### ✅ Now You Can Query by Shift ID:
```typescript
// Query by single shiftId
const apps = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'applications'),
    where('shiftId', '==', shiftId)
  )
);

// Query by shiftIds array (for applications with multiple shifts)
const apps = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'applications'),
    where('shiftIds', 'array-contains', shiftId)
  )
);

// Query by jobId (still works)
const apps = await getDocs(
  query(
    collection(db, 'tenants', tenantId, 'applications'),
    where('jobId', '==', jobId)
  )
);
```

## Summary

- **Same Location**: Gig shift applications are saved to the same location as career applications: `tenants/{tenantId}/applications/{userId}_{jobId}`
- **Same Structure**: Same basic fields (userId, tenantId, jobId, status, etc.)
- **Key Differences**:
  - Gig jobs have `jobOrderId` populated
  - ✅ Shift information is now stored in **both** the application document AND user's `applicationData`
  - Multiple shifts can be applied to in one application (via `selectedShifts` array → `shiftIds` array in document)

- **✅ Fixed**: Can now query applications directly by `shiftId` or using `array-contains` for `shiftIds`
- **Backfill Required**: Run the backfill script to update existing applications: `node scripts/migrations/backfillShiftIdsInApplications.js`

