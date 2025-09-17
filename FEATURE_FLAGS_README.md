# Feature Flag System

This document describes the feature flag system implemented for Phase 0.1 of the data model redesign project.

## Overview

The feature flag system allows you to safely ship new features incrementally by toggling them on/off without code deployments. This is essential for the data model redesign where we need to test new single-document structures for Companies, Workers, and Job Orders.

## Architecture

### Multi-Tenant Firestore Principle

**Key Principle**: Only two top-level collections should exist in a multi-tenant app: `tenants` and `users`. Everything else lives under `tenants/{tenantId}` (or as subcollections under child docs). This keeps rules simple and avoids cross-tenant leakage.

### Firestore Structure

Feature flags are stored in Firestore at:
```
tenants/{tenantId}/settings/config
```

The document structure is:
```json
{
  "flags": {
    "NEW_DATA_MODEL": false,
    "OTHER_FEATURE": true
  },
  "createdAt": "2025-01-27T...",
  "updatedAt": "2025-01-27T..."
}
```

This follows the principle by keeping all tenant-specific configuration under the tenant document, not in a separate top-level collection.

### Key Components

1. **`useFlag` Hook** (`src/hooks/useFlag.ts`)
   - React hook for accessing individual feature flags
   - Real-time updates via Firestore listeners
   - Handles loading and error states

2. **`useFlags` Hook** (`src/hooks/useFlag.ts`)
   - React hook for accessing multiple feature flags at once
   - Optimized for components that need multiple flags

3. **Utility Functions** (`src/utils/featureFlags.ts`)
   - Server-side functions for managing feature flags
   - CRUD operations for flags
   - Initialization helpers

4. **Test Components**
   - `FeatureFlagTest.tsx` - UI for testing flag toggles
   - `ExampleNewDataModelComponent.tsx` - Example of flag usage

## Usage

### Basic Usage

```typescript
import { useFlag } from '../hooks/useFlag';

const MyComponent = () => {
  const { value: newDataModelEnabled, loading, error } = useFlag('NEW_DATA_MODEL', false);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {newDataModelEnabled ? (
        <NewDataModelUI />
      ) : (
        <LegacyDataModelUI />
      )}
    </div>
  );
};
```

### Multiple Flags

```typescript
import { useFlags } from '../hooks/useFlag';

const MyComponent = () => {
  const { flags, loading } = useFlags(
    ['NEW_DATA_MODEL', 'ENHANCED_UI', 'BETA_FEATURES'],
    { NEW_DATA_MODEL: false, ENHANCED_UI: true, BETA_FEATURES: false }
  );

  return (
    <div>
      {flags.NEW_DATA_MODEL && <NewDataModelUI />}
      {flags.ENHANCED_UI && <EnhancedUI />}
      {flags.BETA_FEATURES && <BetaFeatures />}
    </div>
  );
};
```

### Server-Side Usage

```typescript
import { getFeatureFlag, setFeatureFlag } from '../utils/featureFlags';

// Get a flag value
const isEnabled = await getFeatureFlag(tenantId, 'NEW_DATA_MODEL', false);

// Set a flag value
await setFeatureFlag(tenantId, 'NEW_DATA_MODEL', true);
```

## Initialization

### Using the Script

```bash
node scripts/initializeFeatureFlags.js <tenantId>
```

### Using the UI

1. Import and use the `FeatureFlagTest` component
2. Click "Initialize Flags" to set up the config document
3. Toggle flags using the switch controls

### Manual Firestore Setup

1. Navigate to Firestore Console
2. Go to `tenants/{tenantId}/settings/config`
3. Create document with:
```json
{
  "flags": {
    "NEW_DATA_MODEL": false
  }
}
```

## Testing

### Verification Steps

1. **Initialize Flags**: Run the initialization script or use the UI
2. **Toggle Flag**: Use the `FeatureFlagTest` component to toggle `NEW_DATA_MODEL`
3. **Verify Behavior**: Check that new UI components show/hide instantly
4. **Check Firestore**: Verify the flag value updates in Firestore
5. **Test Real-time**: Open multiple browser tabs and verify updates sync

### Expected Behavior

- ✅ Flag toggles instantly in UI
- ✅ Changes persist in Firestore
- ✅ Real-time updates across browser tabs
- ✅ Graceful fallback to default values
- ✅ Loading and error states handled properly

## Safety Guidelines

### DO:
- ✅ Gate UI components behind flags
- ✅ Use default values (usually `false`)
- ✅ Test flag toggles thoroughly
- ✅ Monitor for errors in console
- ✅ Keep flags simple (boolean values)

### DON'T:
- ❌ Gate background jobs behind flags
- ❌ Use flags for business logic
- ❌ Make flags dependent on each other
- ❌ Forget to handle loading/error states
- ❌ Use flags for security controls

## Current Flags

| Flag Name | Default | Purpose |
|-----------|---------|---------|
| `NEW_DATA_MODEL` | `false` | Enables new single-document data model for Companies, Workers, and Job Orders |

## Troubleshooting

### Common Issues

1. **Flag not updating**: Check Firestore permissions and network connection
2. **Component not showing**: Verify flag name spelling and default value
3. **Loading forever**: Check if tenant ID is available in auth context
4. **Permission errors**: Ensure user has read access to tenant settings

### Debug Commands

```javascript
// Check current flags in browser console
const { getFeatureFlags } = await import('./src/utils/featureFlags');
const flags = await getFeatureFlags('your-tenant-id');
console.log(flags);
```

## Data Model Design Principles

### Single-Document Architecture

When implementing the new data model (Companies, Workers, Job Orders), follow this structure:

```
tenants/{tenantId}/
├── companies/{companyId}          # Single document per company
├── workers/{workerId}             # Single document per worker  
├── jobOrders/{jobOrderId}         # Single document per job order
├── settings/
│   ├── config                     # Feature flags
│   ├── main                       # General settings
│   └── flex                       # Flex-specific settings
└── customers/{customerId}/        # Customer subcollections
    ├── locations/{locationId}
    └── departments/{deptId}
```

### Benefits of This Structure

1. **Security**: Firestore rules are simpler with only two top-level collections
2. **Performance**: No cross-tenant queries or data leakage possible
3. **Scalability**: Each tenant's data is isolated and can scale independently
4. **Maintenance**: Easier to backup, migrate, or delete tenant data
5. **Cost**: More predictable Firestore usage and billing

## Next Steps

1. **Phase 0.2**: Add backup system before data model changes
2. **Phase 1**: Implement new single-document structures following the tenant principle
3. **Phase 2**: Migrate existing data to new structure
4. **Phase 3**: Remove legacy code and feature flags

## Files Created

- `src/hooks/useFlag.ts` - React hooks for feature flags
- `src/utils/featureFlags.ts` - Utility functions for flag management
- `src/components/FeatureFlagTest.tsx` - Test component for flag toggles
- `src/components/ExampleNewDataModelComponent.tsx` - Example usage
- `scripts/initializeFeatureFlags.js` - Initialization script
- `FEATURE_FLAGS_README.md` - This documentation
