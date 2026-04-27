# Shift Selection Model for Gig Jobs

## Overview

This document describes the implementation of the **Shift Selection Model** for Gig-type job postings, allowing workers to select from multiple available shifts when applying to a single job.

---

## 🎯 Business Logic

### Job Type Behavior

| Job Type | Shift Handling | Application Flow |
|----------|---------------|------------------|
| **Gig** | Multi-shift selection | Workers select from available shifts, one application tracks preferences for all selected shifts |
| **Career** | Traditional | Single application, no shift selection (standard behavior) |

### Key Principle
> **One Job Order = One Job Posting**, but for **Gig jobs**, the posting displays multiple selectable shifts.

---

## 📊 Data Architecture

### 1. JobBoardShift Interface

```typescript
export interface JobBoardShift {
  shiftId: string;              // Reference to shifts/{shiftId}
  shiftTitle: string;           // "Wednesday Cleaners"
  shiftDate: string;            // ISO date: "2025-10-28"
  startTime: string;            // HH:mm format: "08:00"
  endTime: string;              // HH:mm format: "17:30"
  staffNeeded: number;          // Total positions: 2
  staffFilled: number;          // Currently filled: 0 (calculated)
  spotsRemaining: number;       // Available spots: 2 (calculated)
  poNumber?: string;            // Optional PO number
  shiftDescription?: string;    // Optional shift-specific details
}
```

### 2. JobsBoardPost (Updated)

```typescript
export interface JobsBoardPost {
  // ... existing fields ...
  
  jobType: 'gig' | 'career';
  
  // NEW: Shift Selection Model (for Gig jobs only)
  availableShifts?: JobBoardShift[];      // Array of selectable shifts
  includeShiftsInPosting?: boolean;       // Auto-true for Gig jobs with shifts
}
```

### 3. Application Data Structure (Future)

```typescript
// User document: users/{userId}/applicationData/{applicationId}
{
  jobPostId: "2002",
  jobOrderId: "KWzNbwXzKsL8wXthN9QS",
  status: "submitted",
  
  // NEW: Shift preferences for Gig jobs
  selectedShifts?: string[];           // Array of shift IDs: ["shift_001", "shift_002"]
  shiftAssignments?: {
    [shiftId: string]: 'pending' | 'approved' | 'rejected' | 'waitlisted';
  };
  // Example:
  // shiftAssignments: {
  //   "shift_wed_001": "approved",
  //   "shift_thu_002": "pending"
  // }
}
```

---

## 🔧 Implementation Status

### ✅ Phase 1: Foundation (COMPLETE)

1. **Shift Setup Tab**
   - ✅ Create/Edit shifts for job orders
   - ✅ Shift table with date, time, staff needed
   - ✅ Full CRUD operations on shifts
   - **File:** `src/components/recruiter/ShiftSetupTab.tsx`

2. **Data Model Updates**
   - ✅ Added `JobBoardShift` interface
   - ✅ Updated `JobsBoardPost` with `availableShifts` field
   - ✅ Added `includeShiftsInPosting` flag
   - **File:** `src/services/recruiter/jobsBoardService.ts`

3. **Auto-Fetch Shifts for Gig Jobs**
   - ✅ `fetchShiftsForJobOrder()` helper method
   - ✅ Auto-populates `availableShifts` when creating Gig job posting
   - ✅ Skips shift fetching for Career jobs
   - **File:** `src/services/recruiter/jobsBoardService.ts` (lines 249-285)

---

### 🔄 Phase 2: UI Integration (NEXT SPRINT)

**TODO #3: Build Multi-Shift Selection UI**

#### Public Jobs Board - Shift Selector

Location: `src/pages/PublicJobsBoard.tsx` or new component `src/components/ShiftSelector.tsx`

**UI Mockup:**
```tsx
{jobPost.jobType === 'gig' && jobPost.includeShiftsInPosting && jobPost.availableShifts ? (
  <Box sx={{ mb: 3 }}>
    <Typography variant="h6" gutterBottom>
      Available Shifts
    </Typography>
    <Typography variant="body2" color="text.secondary" gutterBottom>
      Select all shifts you're available for
    </Typography>
    
    <Stack spacing={1} sx={{ mt: 2 }}>
      {jobPost.availableShifts.map(shift => (
        <Card 
          key={shift.shiftId}
          variant="outlined"
          sx={{ 
            cursor: 'pointer',
            border: selectedShifts.includes(shift.shiftId) 
              ? '2px solid' 
              : '1px solid',
            borderColor: selectedShifts.includes(shift.shiftId) 
              ? 'primary.main' 
              : 'divider'
          }}
          onClick={() => toggleShift(shift.shiftId)}
        >
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>
                  {shift.shiftTitle}
                </Typography>
                <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    📅 {format(new Date(shift.shiftDate), 'EEE, MMM dd')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    🕐 {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                  </Typography>
                  <Chip 
                    label={`${shift.spotsRemaining} spots left`}
                    size="small"
                    color={shift.spotsRemaining <= 2 ? 'error' : 'success'}
                  />
                </Stack>
              </Box>
              <Checkbox 
                checked={selectedShifts.includes(shift.shiftId)}
                onChange={() => toggleShift(shift.shiftId)}
              />
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
    
    <Alert severity="info" sx={{ mt: 2 }}>
      You can select multiple shifts. Recruiters will review your application for each shift.
    </Alert>
  </Box>
) : (
  // Traditional single-shift or Career job display
  <Box>...</Box>
)}
```

**State Management:**
```typescript
const [selectedShifts, setSelectedShifts] = useState<string[]>([]);

const toggleShift = (shiftId: string) => {
  setSelectedShifts(prev => 
    prev.includes(shiftId)
      ? prev.filter(id => id !== shiftId)
      : [...prev, shiftId]
  );
};
```

---

### 🔄 Phase 3: Application Flow (SPRINT 3)

**TODO #4: Update Application Flow**

#### Wizard.tsx Updates

When submitting application for a Gig job with shifts:

```typescript
const submitApplication = async () => {
  const applicationData = {
    // ... existing fields ...
    
    // NEW: For Gig jobs with shift selection
    ...(jobPost.includeShiftsInPosting && selectedShifts.length > 0 ? {
      selectedShifts: selectedShifts,
      shiftAssignments: selectedShifts.reduce((acc, shiftId) => {
        acc[shiftId] = 'pending';
        return acc;
      }, {} as Record<string, string>)
    } : {})
  };
  
  // Save to Firestore
  await updateDoc(doc(db, 'users', userId), {
    [`applicationData.${applicationId}`]: applicationData
  });
};
```

---

### 🔄 Phase 4: Recruiter Tools (SPRINT 4)

**TODO #5: Shift-Specific Application Management**

#### RecruiterJobOrderDetail.tsx - Applications Tab

**Applicant Row Enhancement:**
```tsx
<TableRow>
  <TableCell>
    <Typography variant="body2" fontWeight={600}>
      {applicant.displayName}
    </Typography>
    
    {/* NEW: Show shift preferences for Gig jobs */}
    {applicant.selectedShifts && applicant.selectedShifts.length > 0 && (
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Applied for {applicant.selectedShifts.length} shifts:
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
          {applicant.selectedShifts.map(shiftId => {
            const shift = shifts.find(s => s.id === shiftId);
            const status = applicant.shiftAssignments?.[shiftId] || 'pending';
            
            return (
              <Chip
                key={shiftId}
                label={`${shift?.shiftTitle} - ${status}`}
                size="small"
                color={
                  status === 'approved' ? 'success' :
                  status === 'rejected' ? 'error' :
                  status === 'waitlisted' ? 'warning' :
                  'default'
                }
                onClick={() => handleShiftStatusChange(applicant.uid, shiftId)}
              />
            );
          })}
        </Stack>
      </Box>
    )}
  </TableCell>
  {/* ... other cells ... */}
</TableRow>
```

**Bulk Actions Menu:**
- "Approve All Shifts" - Approve applicant for all selected shifts
- "Approve Selected Shift" - Dropdown to choose specific shift
- "Reject All Shifts" - Reject all shift applications
- "Waitlist for Shift" - Put on waitlist for specific shift

---

## 🚀 Future Enhancements

### Phase 5: Advanced Features
1. **Real-time Capacity Tracking**
   - Auto-calculate `staffFilled` from assignments
   - Update `spotsRemaining` dynamically
   - Show "FULL" badge when shift is at capacity
   - Auto-waitlist applicants when full

2. **Auto-sync Shifts**
   - When shifts are added/removed in Shift Setup tab
   - Automatically update live job posting `availableShifts[]`
   - Use Firestore triggers or manual "Sync Shifts" button

3. **Shift Notifications**
   - Email workers when approved for specific shifts
   - Send calendar invites (.ics files)
   - Remind workers 24 hours before shift

4. **Analytics Dashboard**
   - Shifts with most applications
   - Average time-to-fill per shift
   - Popular shift times
   - Fill rate by day of week

---

## 📝 Database Schema

### Collections

#### `shifts/`
```typescript
{
  id: string;                    // Auto-generated
  tenantId: string;
  jobOrderId: string;
  shiftTitle: string;
  defaultJobTitle: string;
  totalStaffRequested: number;
  poNumber: string;
  shiftDate: string;             // ISO date
  defaultStartTime: string;      // HH:mm
  defaultEndTime: string;        // HH:mm
  shiftDescription: string;
  emailIntro: string;
  sendNotification: boolean;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
}
```

#### `tenants/{tenantId}/job_postings/`
```typescript
{
  id: string;
  jobType: 'gig' | 'career';
  availableShifts: JobBoardShift[];  // Only for Gig jobs
  includeShiftsInPosting: boolean;   // Only for Gig jobs
  // ... other fields ...
}
```

#### `users/{userId}/applicationData/{applicationId}`
```typescript
{
  jobPostId: string;
  jobOrderId: string;
  status: string;
  selectedShifts: string[];          // Only for Gig jobs
  shiftAssignments: {                // Only for Gig jobs
    [shiftId]: 'pending' | 'approved' | 'rejected' | 'waitlisted'
  };
  // ... other fields ...
}
```

---

## 🎨 Design Principles

1. **Conditional Display**
   - Shift selector only shows for `jobType === 'gig'` AND `includeShiftsInPosting === true`
   - Career jobs display traditional UI

2. **Flexibility**
   - Workers can select 1 or all shifts
   - Recruiters can approve some shifts, reject others

3. **Clarity**
   - Clear visual distinction between shift statuses
   - Real-time feedback on available spots
   - Intuitive checkbox selection

4. **Performance**
   - Shifts cached in job posting document
   - Minimal real-time queries
   - Lazy-load shift assignments

---

## 📊 Competitive Analysis

| Platform | Approach | UX Rating |
|----------|----------|-----------|
| **Instawork** | Multi-shift selection with capacity tracking | ⭐⭐⭐⭐⭐ |
| **Wonolo** | Multi-shift selection with instant confirmation | ⭐⭐⭐⭐⭐ |
| **Indeed Flex** | Separate listing per shift | ⭐⭐⭐ |
| **Our Implementation** | Multi-shift selection (Gig only) | ⭐⭐⭐⭐⭐ |

---

## 🧪 Testing Checklist

### Gig Jobs with Shifts
- [ ] Create shifts in Shift Setup tab
- [ ] Create job posting from job order
- [ ] Verify `availableShifts` populated in posting
- [ ] View job on public jobs board
- [ ] Verify shift selector displays
- [ ] Select multiple shifts
- [ ] Submit application
- [ ] Verify `selectedShifts` saved to user document
- [ ] View application in recruiter Applications tab
- [ ] Approve/reject specific shifts
- [ ] Verify shift status updates

### Career Jobs (No Shifts)
- [ ] Create career job posting
- [ ] Verify NO shift selector displays
- [ ] Apply to career job
- [ ] Verify NO `selectedShifts` field in application
- [ ] Traditional application flow works

---

## 🔗 Related Files

- `src/services/recruiter/jobsBoardService.ts` - Core service with shift integration
- `src/components/recruiter/ShiftSetupTab.tsx` - Shift CRUD interface
- `src/pages/PublicJobsBoard.tsx` - Public job board (needs shift selector UI)
- `src/components/apply/Wizard.tsx` - Application wizard (needs shift selection logic)
- `src/pages/RecruiterJobOrderDetail.tsx` - Recruiter view (needs shift management UI)

---

## 🎯 Next Steps

1. **Immediate (This Week):**
   - ✅ Create this documentation
   - ✅ Complete Phase 1 implementation
   - 🔄 Test shift auto-population in job postings

2. **Next Sprint:**
   - Build shift selector UI component
   - Integrate into PublicJobsBoard
   - Update application wizard to capture shift selections

3. **Future Sprints:**
   - Recruiter shift-specific approval tools
   - Real-time capacity tracking
   - Notification system for shift assignments

---

**Last Updated:** October 28, 2025  
**Status:** Phase 1 Complete, Phase 2-5 Planned

