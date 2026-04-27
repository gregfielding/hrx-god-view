# Backfill Script: Add shiftId/shiftIds to Application Documents

## Overview

This script updates existing application documents to include `shiftId` or `shiftIds` fields by reading shift information from users' `applicationData` map and writing it to the corresponding application document.

## Why This Script?

Previously, when users applied to gig shifts, the shift information was only stored in the user's `applicationData` map, not in the application document itself. This made it difficult to query applications by shift ID.

The `Wizard.tsx` component has been updated to save `shiftId`/`shiftIds` to application documents going forward. This script backfills existing applications.

## Prerequisites

1. Firebase Admin SDK credentials (`service-account-key.json` in project root)
2. Node.js installed
3. Dependencies installed (`npm install`)

## Usage

### Run the backfill script:

```bash
node scripts/migrations/backfillShiftIdsInApplications.js
```

### What the script does:

1. **Queries all users** in the `users` collection
2. **For each user** with `applicationData`:
   - Checks each application in `applicationData`
   - Looks for `selectedShifts` array
   - If found, extracts shift IDs
3. **For each application with shifts**:
   - Finds the application document at `tenants/{tenantId}/applications/{userId}_{jobId}`
   - Checks if `shiftId`/`shiftIds` already exists (skips if present)
   - Updates the document:
     - Single shift → adds `shiftId` field
     - Multiple shifts → adds `shiftIds` array field
   - Updates `updatedAt` timestamp

### Output:

The script provides progress updates and a summary:
- Total users processed
- Total applications checked
- Total applications updated
- Any errors encountered

## Example Output

```
🚀 Starting backfill of shiftId/shiftIds in application documents...

📊 Found 150 users to process

📝 Updating 5hqNE0ngmGOEa2jA0QSTdJMfBln1_vq4exK1xgoS0wxgAtJlW with shiftIds: [shiftId1, shiftId2]
✅ Updated application 5hqNE0ngmGOEa2jA0QSTdJMfBln1_vq4exK1xgoS0wxgAtJlW

📊 Progress: 10 users processed, 5 applications updated

============================================================
✅ BACKFILL COMPLETE
============================================================
📊 Users processed: 150
📊 Applications checked: 300
✅ Applications updated: 45
❌ Errors: 0

✅ Script completed successfully
```

## Safety Features

- **Idempotent**: Script skips applications that already have `shiftId`/`shiftIds`
- **Non-destructive**: Only adds fields, doesn't modify existing data
- **Error handling**: Continues processing even if individual updates fail
- **Progress tracking**: Shows progress every 10 users

## After Running

Once the backfill is complete:

1. **New applications** will automatically include `shiftId`/`shiftIds` (via updated `Wizard.tsx`)
2. **Existing applications** will have been backfilled by this script
3. You can now query applications by shift ID:
   ```typescript
   // Query by single shift
   query(
     collection(db, 'tenants', tenantId, 'applications'),
     where('shiftId', '==', shiftId)
   )
   
   // Query by shift in array
   query(
     collection(db, 'tenants', tenantId, 'applications'),
     where('shiftIds', 'array-contains', shiftId)
   )
   ```

## Troubleshooting

### Error: "Application document not found"
- This is normal if the application was deleted or never fully created
- The script will log a warning and continue

### Error: Permission denied
- Ensure `service-account-key.json` has proper Firestore permissions
- Check that the service account has read/write access to `users` and `tenants/{tenantId}/applications` collections

### Script hangs or times out
- The script processes all users sequentially
- For large datasets, consider adding batch processing or pagination
- Monitor Firebase quota limits

## Related Files

- `src/components/apply/Wizard.tsx` - Updated to save shiftId/shiftIds on new applications
- `src/services/userApplicationsService.ts` - Service for querying user applications
- `docs/GIG_SHIFT_APPLICATIONS.md` - Documentation on how gig shift applications work

