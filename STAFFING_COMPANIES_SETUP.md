# Staffing Companies - Hired Staff Feature

## Overview

The system now supports a specialized "Hired Staff" feature for staffing companies. This allows staffing companies to distinguish between:

- **Company Directory (Workers)**: In-house employees (security level '5')
- **Hired Staff**: Employees working at customer locations (security level '4')
- **Flex Workers**: Temporary/flexible workers (security level '3')

## How It Works

### For Staffing Companies
When a tenant is identified as a staffing company, the Workforce Management page shows an additional "Hired Staff" tab between "Company Directory" and "Flex Workers".

**Tab Order for Staffing Companies:**
1. Company Directory (Workers)
2. **Hired Staff** ← New tab
3. Flex Workers
4. User Groups
5. Add Workers
6. Integrations
7. Pending Invites

**Tab Order for Regular Companies:**
1. Company Directory (Workers)
2. Flex Workers
3. User Groups
4. Add Workers
5. Integrations
6. Pending Invites

### Security Level Hierarchy
- **'7'** = Admin (highest access)
- **'6'** = Manager
- **'5'** = Worker (in-house employees)
- **'4'** = Hired Staff (employees at customer locations)
- **'3'** = Flex
- **'2'** = Applicant
- **'1'** = Dismissed
- **'0'** = Suspended

## Configuration

### Adding New Staffing Companies

To add a new staffing company, edit the file `src/utils/staffingCompanies.ts`:

```typescript
export const STAFFING_COMPANY_IDS = [
  'BCiP2bQ9CgVOCTfV6MhD', // C1 Staffing
  'NEW_TENANT_ID_1',      // Your New Company Name
  'NEW_TENANT_ID_2',      // Another Company Name
];
```

### Current Staffing Companies
- **C1 Staffing**: `BCiP2bQ9CgVOCTfV6MhD`

## Usage

### For Staffing Companies

1. **Adding Workers**: When adding new workers, you can now select:
   - **Worker** (security level '5') - for in-house employees
   - **Hired Staff** (security level '4') - for employees working at customer locations
   - **Flex** (security level '3') - for temporary workers

2. **Managing Workforce**: 
   - Use "Company Directory" tab to manage in-house workers
   - Use "Hired Staff" tab to manage employees at customer locations
   - Use "Flex Workers" tab to manage temporary workers

### For Regular Companies

The interface remains unchanged - no "Hired Staff" tab is shown, and the security level options in the Add Worker form don't include "Hired Staff".

## Technical Implementation

### Files Modified
- `src/pages/TenantViews/TenantWorkforce.tsx` - Added Hired Staff tab and logic
- `src/componentBlocks/AddWorkerForm.tsx` - Added Hired Staff option for staffing companies
- `src/utils/staffingCompanies.ts` - New utility for managing staffing company IDs
- `src/utils/AccessRoles.ts` - Updated security level hierarchy

### Key Features
- **Automatic Detection**: System automatically detects staffing companies based on tenant ID
- **Conditional UI**: Hired Staff tab only appears for staffing companies
- **Flexible Security Levels**: Add Worker form adapts to show appropriate options
- **Easy Configuration**: Simple array-based configuration for adding new staffing companies

## Future Enhancements

Consider these potential improvements:
1. **Customer Assignment Tracking**: Track which customer location each Hired Staff member is assigned to
2. **Billing Integration**: Different billing rates for Hired Staff vs in-house Workers
3. **Reporting**: Separate reports for Hired Staff vs in-house Workers
4. **Permissions**: Different permission sets for Hired Staff vs in-house Workers 