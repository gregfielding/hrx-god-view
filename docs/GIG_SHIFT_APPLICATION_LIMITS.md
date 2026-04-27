# Gig Shift Application Limits - One Shift Per Day Policy

## Overview

This document describes the implementation of a **one-shift-per-day application limit** system for gig shift jobs. This prevents users from applying to multiple shifts on the same day simultaneously, reducing the risk of double-booking and ensuring users can only commit to one shift per day.

## Strategy

Based on research of how other gig work platforms handle this challenge, we've implemented a **hybrid approach** that balances user flexibility with operational efficiency:

### Key Principles

1. **One Active Application Per Day**: Users can only have ONE active application per calendar day
2. **Flexibility on Rejection**: If a user's application is rejected or withdrawn, they can immediately apply to another shift on the same day
3. **Automatic Withdrawal on Hire**: When a user is hired for a shift, all other active applications for that same date are automatically withdrawn
4. **Priority-Based**: Users can still express interest in multiple shifts, but only one can be active at a time

### How It Works

#### Application Flow

1. **User Selects Shift(s)**: User chooses one or more shifts to apply for
2. **Validation Check**: Before submission, the system checks if the user has any active applications for the same shift date(s)
3. **Block if Conflict**: If a conflict exists, the application is blocked with a clear error message
4. **Allow if No Conflict**: If no conflict, the application proceeds normally
5. **Store Shift Date**: The shift date(s) are stored in the application document for quick lookups

#### Hire Flow

1. **Application Status Changes to "Hired"**: When a recruiter marks an application as "hired"
2. **Firebase Trigger**: The `autoWithdrawApplicationsOnHire` function triggers
3. **Find Conflicting Applications**: System finds all other active applications for the same shift date(s)
4. **Auto-Withdraw**: All conflicting applications are automatically withdrawn with status "withdrawn" and reason "auto_withdrawn_on_hire"

## Implementation Details

### 1. Utility Functions (`src/utils/gigShiftApplicationLimits.ts`)

Core utility functions for checking conflicts:

- `checkShiftDateConflict()`: Checks if a user has an active application for a specific shift date
- `checkMultipleShiftDateConflicts()`: Checks conflicts for multiple shifts in one application
- `getActiveApplicationsForDate()`: Gets all active applications for a user on a specific date
- `extractDateFromShiftDate()`: Helper to extract date string from ISO date

### 2. Application Validation (`src/components/apply/Wizard.tsx`)

Before submitting an application:

1. **Check if Gig Job**: Only applies to gig jobs with shifts
2. **Fetch Shift Dates**: Gets the shift date(s) for the selected shift(s)
3. **Check Conflicts**: Calls `checkShiftDateConflict()` or `checkMultipleShiftDateConflicts()`
4. **Block if Conflict**: Shows error message and prevents submission
5. **Store Shift Date**: Stores `shiftDate` (single) or `shiftDates` (array) in application document

### 3. Auto-Withdraw Function (`functions/src/autoWithdrawApplicationsOnHire.ts`)

Firebase Firestore trigger that watches for application status changes:

- **Trigger**: `onDocumentUpdated` on `tenants/{tenantId}/applications/{applicationId}`
- **Condition**: Only runs when status changes TO "hired"
- **Action**: 
  - Gets shift date(s) from the hired application
  - Finds all other active applications for the same user on the same date(s)
  - Withdraws those applications automatically

### 4. Data Storage

Applications now store shift date information:

```typescript
{
  // ... existing fields ...
  shiftId?: string;           // Single shift ID
  shiftIds?: string[];        // Multiple shift IDs
  shiftDate?: string;         // Single shift date (YYYY-MM-DD) for quick lookup
  shiftDates?: string[];      // Multiple shift dates (for applications with multiple shifts)
}
```

## Active Statuses

The following application statuses are considered "active" and will block new applications:

- `submitted`
- `screened`
- `advanced`
- `interview`
- `offer_pending`
- `hired`

The following statuses allow new applications:

- `rejected`
- `withdrawn`

## User Experience

### When Applying

If a user tries to apply to a shift on a date they already have an active application:

```
⚠️ You already have an active application for a shift on [Date]. 
You can only apply to one shift per day. 
Please withdraw your existing application or wait for it to be processed.
```

### When Hired

When a user is hired for a shift:

1. Their application status changes to "hired"
2. All other active applications for that same date are automatically withdrawn
3. User receives notification (if notifications are enabled)
4. User can now apply to other shifts on different dates

## Benefits

1. **Prevents Double-Booking**: Users can't commit to multiple shifts on the same day
2. **Flexibility**: Users can still apply to other shifts if their first choice is rejected
3. **Automated**: No manual intervention needed - system handles withdrawals automatically
4. **Clear Communication**: Users understand why they can't apply and what to do
5. **Scalable**: Works efficiently even with large numbers of applications

## Edge Cases Handled

1. **Multiple Shifts in One Application**: If user applies to multiple shifts in one application, all dates are checked
2. **Shift Date Format**: Handles various date formats (ISO strings, timestamps)
3. **Missing Shift Data**: Gracefully handles cases where shift date isn't stored directly
4. **Network Errors**: Fails open - if conflict check fails, allows application (logs error)
5. **Concurrent Applications**: Handles race conditions by checking at submission time

## Future Enhancements

Potential improvements for future iterations:

1. **Waitlist System**: Allow users to join a waitlist if their preferred shift is full
2. **Priority Ranking**: Allow users to rank shifts by preference
3. **Smart Suggestions**: Suggest alternative shifts on different dates
4. **Notification Improvements**: Better notifications when applications are auto-withdrawn
5. **Admin Override**: Allow admins to override the limit in special cases

## Testing

To test the system:

1. **Apply to Shift**: User applies to a shift on a specific date
2. **Try Duplicate**: User tries to apply to another shift on the same date - should be blocked
3. **Apply Different Date**: User applies to a shift on a different date - should succeed
4. **Get Hired**: Mark first application as "hired" - other applications for that date should auto-withdraw
5. **Re-apply After Rejection**: Reject an application - user should be able to apply to another shift that day

## Related Files

- `src/utils/gigShiftApplicationLimits.ts` - Core utility functions
- `src/components/apply/Wizard.tsx` - Application form validation
- `functions/src/autoWithdrawApplicationsOnHire.ts` - Auto-withdraw trigger
- `docs/GIG_SHIFT_APPLICATIONS.md` - Overall gig shift application system

