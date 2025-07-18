# Tenant Structure Migration Guide

## Overview

This document outlines the migration from the separate `agencies` and `customers` collections to a unified `tenants` collection structure. This change provides a cleaner, more flexible architecture that treats all organizations as tenants with optional customer relationships.

## New Tenant Structure

### Tenant Document Structure
```javascript
{
  id: "tenant_123",
  name: "Acme Staffing Agency",
  type: "Agency", // "Agency", "Customer", or "Employer"
  customers: ["customer_456", "customer_789"], // Array of customer IDs
  workforce: {
    "user_123": {
      uid: "user_123",
      role: "Worker",
      status: "active",
      addedAt: timestamp,
      customerId: "customer_456" // Optional, if user works for specific customer
    }
  },
  modules: ["companion", "intelligence", "scheduler"],
  features: {
    gigEnabled: true,
    aiChatEnabled: true,
    // ... other feature flags
  },
  // ... other tenant fields
}
```

### Customer Subcollection Structure
For tenants that have customers, customer data is stored in a subcollection:

```
/tenants/{tenantId}/customers/{customerId}
```

```javascript
{
  id: "customer_456",
  name: "Tech Corp",
  type: "Customer",
  tenantId: "tenant_123", // Parent tenant ID
  locations: [...],
  departments: [...],
  aiSettings: {...},
  // ... other customer-specific data
}
```

## User Structure Changes

### Before
```javascript
{
  uid: "user_123",
  agencyId: "agency_456", // or
  customerId: "customer_789",
  orgType: "Agency" // or "Customer"
}
```

### After
```javascript
{
  uid: "user_123",
  tenantId: "tenant_456", // Primary tenant
  tenantIds: ["tenant_456", "tenant_789"], // Array of all tenant access
  orgType: "Tenant"
}
```

## Migration Process

### 1. Run Migration Script
```bash
node migrateToTenants.js
```

The migration script will:
- Convert all agencies to tenants with `type: "Agency"`
- Move customers to tenant subcollections
- Update user documents to use `tenantId` and `tenantIds`
- Update all references in assignments, job orders, shifts, etc.

### 2. Update Frontend Components
Components need to be updated to use the new structure:
- Replace `agencyId` with `tenantId`
- Update collection references from `agencies` to `tenants`
- Handle customer data from tenant subcollections

### 3. Update Cloud Functions
Functions need to be updated to:
- Use `tenantId` instead of `agencyId`/`customerId`
- Handle customer data from tenant subcollections
- Use new tenant-based security rules

## Security Rules

### Tenant Access
```javascript
function isAssignedToTenant(tenantId) {
  return isAuthenticated() && (
    getUser().tenantIds != null && tenantId in getUser().tenantIds ||
    getUser().tenantId == tenantId
  );
}
```

### Tenant Admin Access
```javascript
function isTenantAdmin(tenantId) {
  return isAssignedToTenant(tenantId) && getUser().securityLevel == "Admin";
}
```

## Key Benefits

1. **Unified Structure**: All organizations are treated as tenants
2. **Flexible Relationships**: Tenants can have customers, or be standalone
3. **Multi-Tenant Users**: Users can belong to multiple tenants
4. **Feature Flags**: Easy to enable/disable features per tenant
5. **Cleaner Code**: No more "if agency, do X; if customer, do Y" logic

## Backward Compatibility

The migration maintains backward compatibility by:
- Keeping original collections as backup
- Providing migration logic in AuthContext
- Supporting both old and new field names during transition

## Post-Migration Cleanup

After verifying the migration:
1. Delete old `agencies` collection
2. Delete old `customers` collection
3. Remove migration logic from AuthContext
4. Update any remaining hardcoded references

## Testing Checklist

- [ ] Users can log in and access their tenant data
- [ ] Agency users can see their customers
- [ ] Customer users can access their data
- [ ] Admin functions work with new structure
- [ ] All existing features continue to work
- [ ] Security rules are properly enforced

## Rollback Plan

If issues arise:
1. Keep original collections as backup
2. Revert AuthContext changes
3. Update frontend to use original structure
4. Run rollback migration if needed

## Support

For questions or issues during migration:
1. Check the migration logs
2. Verify data integrity in Firestore console
3. Test with a small subset of data first
4. Contact the development team 