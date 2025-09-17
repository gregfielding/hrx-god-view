# Multi-Tenant Firestore Architecture Principles

## Core Principle

**Only two top-level collections should exist in a multi-tenant app: `tenants` and `users`. Everything else lives under `tenants/{tenantId}` (or as subcollections under child docs).**

This principle keeps Firestore rules simple and prevents cross-tenant data leakage.

## Current Architecture

### ✅ Correct Structure
```
tenants/{tenantId}/
├── companies/{companyId}          # Single document per company
├── workers/{workerId}             # Single document per worker  
├── jobOrders/{jobOrderId}         # Single document per job order
├── settings/
│   ├── config                     # Feature flags
│   ├── main                       # General settings
│   ├── flex                       # Flex-specific settings
│   └── recruiter                  # Recruiter-specific settings
├── customers/{customerId}/        # Customer subcollections
│   ├── locations/{locationId}
│   └── departments/{deptId}
├── aiSettings/
│   ├── openai
│   ├── modules
│   └── securityLevelEngagement
├── branding/
│   └── settings
└── integrations/{integrationId}
```

### ❌ Avoid This Structure
```
# DON'T create top-level collections like:
companies/{companyId}              # ❌ Cross-tenant data mixing
workers/{workerId}                 # ❌ Security nightmare
jobOrders/{jobOrderId}             # ❌ Impossible to secure properly
settings/{tenantId}                # ❌ Unnecessary complexity
```

## Benefits

### 1. Security
- **Simpler Rules**: Only need to secure two top-level collections
- **No Cross-Tenant Leakage**: Impossible to accidentally query across tenants
- **Clear Boundaries**: Each tenant's data is completely isolated

### 2. Performance
- **Faster Queries**: No need to filter by tenantId in every query
- **Better Indexing**: Firestore can optimize indexes per tenant
- **Reduced Costs**: Fewer reads/writes due to better query efficiency

### 3. Scalability
- **Independent Scaling**: Each tenant can scale independently
- **Easier Sharding**: Can move tenant data to different regions if needed
- **Predictable Growth**: Data growth is contained within tenant boundaries

### 4. Maintenance
- **Easy Backups**: Backup entire tenant with single operation
- **Simple Migration**: Move tenant data by copying tenant document tree
- **Clean Deletion**: Delete tenant by removing tenant document and subcollections

## Implementation Guidelines

### When Adding New Data Types

1. **Ask**: "Does this belong to a specific tenant?"
2. **If Yes**: Put it under `tenants/{tenantId}/`
3. **If No**: Put it in `users/` (for user-specific data) or reconsider the design

### Examples

```typescript
// ✅ Correct - Company belongs to tenant
const companyRef = doc(db, 'tenants', tenantId, 'companies', companyId);

// ✅ Correct - User settings belong to user
const userSettingsRef = doc(db, 'users', userId, 'settings', 'preferences');

// ❌ Wrong - Company in top-level collection
const companyRef = doc(db, 'companies', companyId);

// ❌ Wrong - Tenant settings in top-level collection
const settingsRef = doc(db, 'settings', tenantId);
```

### Firestore Rules

With this structure, Firestore rules become much simpler:

```javascript
// Simple rule for tenant data
match /tenants/{tenantId}/{document=**} {
  allow read, write: if isAssignedToTenant(tenantId);
}

// Simple rule for user data
match /users/{userId}/{document=**} {
  allow read, write: if request.auth.uid == userId;
}
```

## Migration Strategy

### For Existing Data

1. **Identify Top-Level Collections**: Find collections that should be under tenants
2. **Create Migration Scripts**: Move data to tenant subcollections
3. **Update Firestore Rules**: Simplify rules to use tenant-based structure
4. **Update Application Code**: Change all references to use new paths
5. **Test Thoroughly**: Ensure no data loss or access issues

### Example Migration

```javascript
// Before: companies/{companyId}
// After: tenants/{tenantId}/companies/{companyId}

async function migrateCompanies() {
  const companies = await db.collection('companies').get();
  
  for (const companyDoc of companies.docs) {
    const companyData = companyDoc.data();
    const tenantId = companyData.tenantId; // Assuming this exists
    
    // Move to new location
    await db.collection('tenants')
      .doc(tenantId)
      .collection('companies')
      .doc(companyDoc.id)
      .set(companyData);
    
    // Delete from old location
    await companyDoc.ref.delete();
  }
}
```

## Data Model Design

### Single Documents vs Subcollections

**Use Single Documents When:**
- Data is relatively small (< 1MB)
- Data is accessed as a unit
- No need for complex queries within the data

**Use Subcollections When:**
- Data is large or could grow large
- Need to query subsets of the data
- Data has a clear hierarchical relationship

### Examples

```typescript
// ✅ Single document - Company profile
tenants/{tenantId}/companies/{companyId}
{
  name: "Acme Corp",
  address: "...",
  contactInfo: {...},
  settings: {...}
}

// ✅ Subcollection - Company locations
tenants/{tenantId}/companies/{companyId}/locations/{locationId}
{
  name: "Main Office",
  address: "...",
  managerId: "..."
}

// ✅ Single document - Worker profile
tenants/{tenantId}/workers/{workerId}
{
  name: "John Doe",
  skills: [...],
  availability: {...},
  assignments: [...]
}
```

## Best Practices

### 1. Consistent Naming
- Use plural names for collections: `companies`, `workers`, `jobOrders`
- Use singular names for documents: `company`, `worker`, `jobOrder`
- Use camelCase for field names

### 2. Data Relationships
- Store references as document IDs, not full objects
- Use subcollections for one-to-many relationships
- Keep related data close together in the hierarchy

### 3. Security
- Always validate tenantId in security rules
- Use the `isAssignedToTenant()` helper function
- Never trust client-side tenantId values

### 4. Performance
- Design queries to use tenantId as the first filter
- Use composite indexes for complex queries
- Consider denormalization for frequently accessed data

## Conclusion

Following this principle will result in:
- **Simpler code** - No need to filter by tenantId everywhere
- **Better security** - Impossible to leak data between tenants
- **Easier maintenance** - Clear data boundaries and ownership
- **Better performance** - Optimized queries and indexes
- **Lower costs** - More efficient Firestore usage

This architecture scales from small startups to large enterprises while maintaining security and performance.
