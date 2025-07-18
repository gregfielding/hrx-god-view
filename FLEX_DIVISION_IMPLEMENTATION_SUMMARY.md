# Flex Division Implementation Summary

## Overview
This implementation creates an automatic system-managed "Flex" division for each tenant with the "HRX Flex" (hrxFlex) feature enabled. Workers with securityLevel "Flex" are automatically assigned to this division.

## Data Model Changes

### Tenant Model
- Added `hrxFlex: boolean` field to tenant documents
- When `true`, enables automatic Flex division management

### Division Model
- Added `isSystem: boolean` field to identify system-managed divisions
- Added `autoAssignRules: object` field for automatic assignment logic
- Flex division uses consistent ID: `auto_flex`

## Implementation Details

### 1. Tenant Creation with HRX Flex
**File**: `src/pages/AgencyProfile/AddAgencyForm.tsx`
- Added checkbox to enable HRX Flex during tenant creation
- When checked, sets `hrxFlex: true` on tenant document

### 2. Automatic Flex Division Creation
**File**: `functions/src/firestoreTriggers.ts`
- Firestore trigger `firestoreLogTenantCreated` auto-creates Flex division
- Creates division with ID `auto_flex` and system-managed properties
- Only creates if `hrxFlex: true` on tenant

### 3. Auto-Assignment of Flex Workers
**File**: `functions/src/firestoreTriggers.ts`
- `firestoreAutoAssignFlexWorker`: Auto-assigns new users with securityLevel "Flex"
- `firestoreUpdateFlexWorkerAssignment`: Handles securityLevel changes
- Updates user's `divisionId` to `"auto_flex"`

### 4. Admin UI Protection
**File**: `src/pages/AgencyProfile/components/DivisionsTab.tsx`
- Visual indicators for system-managed divisions
- Disabled editing/deletion for system-managed divisions
- Tooltips explaining auto-assignment rules

### 5. Tenant Profile Management
**File**: `src/pages/AgencyProfile/components/ProfileOverview.tsx`
- Toggle switch to enable/disable hrxFlex for existing tenants
- Creates Flex division and assigns existing Flex workers when enabled

### 6. Cloud Function for Existing Tenants
**File**: `functions/src/index.ts`
- `toggleHrxFlex` function for enabling/disabling on existing tenants
- Creates Flex division and assigns existing Flex workers

### 7. Org Chart Integration
**File**: `src/pages/TenantViews/OrgTreeView.tsx`
- Flex division appears prominently in the organizational chart
- Special visual styling with purple border and background
- System-managed icon and "Flex" chip for clear identification
- Edit button disabled for system-managed divisions
- Flex division sorted to appear first in the list
- Tooltips explain system-managed status

## Data Structures

### Flex Division Document
```javascript
{
  id: "auto_flex",
  name: "Flex",
  shortcode: "FLEX",
  type: "System",
  description: "System-managed division for workers with securityLevel: 'Flex'",
  isSystem: true,
  autoAssignRules: {
    securityLevel: "Flex"
  },
  status: "Active",
  tags: ["system", "flex", "auto-managed"],
  externalIds: {},
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### User Assignment
```javascript
{
  // ... other user fields
  securityLevel: "Flex",
  divisionId: "auto_flex", // Auto-assigned for Flex workers
  // ... other fields
}
```

## Workflows

### New Tenant Creation
1. Admin creates tenant with `hrxFlex: true`
2. Firestore trigger creates Flex division
3. Future Flex workers auto-assigned to division

### Existing Tenant Enablement
1. Admin toggles hrxFlex in tenant profile
2. Cloud function creates Flex division
3. Existing Flex workers assigned to division
4. Future Flex workers auto-assigned

### Worker Assignment
1. User created/updated with `securityLevel: "Flex"`
2. Firestore trigger checks tenant hrxFlex status
3. If enabled, user's `divisionId` updated to `"auto_flex"`

## Security & Protection

### System-Managed Division Protection
- `isSystem: true` prevents accidental deletion
- Admin UI disables edit/delete for system-managed divisions
- Visual indicators clearly show system-managed status

### Org Chart Display
- Flex division prominently displayed with special styling
- Clear visual distinction from regular divisions
- Edit controls disabled with helpful tooltips
- Sorted to appear first for visibility

## Logging & Auditing

### Firestore Triggers
- Console logs for division creation
- Console logs for worker assignments
- Error handling for failed operations

### Cloud Functions
- Detailed logging for toggle operations
- Error handling and user feedback
- Success/failure reporting

## Testing

### Test Script
**File**: `testFlexDivision.js`
- Verifies tenant hrxFlex status
- Checks Flex division existence
- Validates Flex worker assignments
- Tests toggle function

### Manual Testing
1. Create tenant with hrxFlex enabled
2. Verify Flex division appears in Org chart
3. Create worker with securityLevel "Flex"
4. Verify auto-assignment to Flex division
5. Test toggle function on existing tenant

## Deployment

### Firebase Functions
```bash
cd functions
npm run deploy
```

### Frontend
- No additional deployment steps required
- Changes are in existing components

## Future Enhancements

### Potential Improvements
1. Flex division analytics and reporting
2. Bulk operations for Flex workers
3. Advanced auto-assignment rules
4. Integration with scheduling systems
5. Flex worker performance metrics

### Monitoring
- Track Flex division usage
- Monitor auto-assignment success rates
- Alert on failed assignments
- Usage analytics dashboard

## Troubleshooting

### Common Issues
1. **Flex division not appearing**: Check tenant hrxFlex status
2. **Workers not auto-assigned**: Verify Firestore triggers deployed
3. **Edit button not disabled**: Check isSystem field on division
4. **Org chart not updating**: Refresh page or check network

### Debug Steps
1. Check tenant document for hrxFlex field
2. Verify Flex division exists in Firestore
3. Check user securityLevel and divisionId
4. Review Firestore trigger logs
5. Test toggle function manually

---

This implementation ensures consistent tracking and reporting of flexible workers across the HRX platform, with robust protections to prevent accidental modification or deletion of the system-managed Flex division. 