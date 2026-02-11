# Template Variables Standardization Guide

## Problem Solved

**Before:** Variables were hardcoded in each trigger, data sources were inconsistent, field names varied, and lookups weren't handled.

**After:** Centralized variable resolver with:
- ✅ Standardized variable names
- ✅ Fallback chains for each variable
- ✅ Automatic document lookups when needed
- ✅ Handles inconsistent field names
- ✅ Single source of truth

---

## How It Works

### 1. **Template Variable Resolver** (`functions/src/utils/templateVariableResolver.ts`)

A centralized system that:
- Accepts a context object with available IDs and data
- Automatically fetches missing documents
- Resolves each variable through a fallback chain
- Returns standardized variable names

### 2. **Variable Resolution Strategy**

Each variable has a **fallback chain** that tries multiple sources:

**Example: `locationCity`**
1. Try `locationData.city`
2. Try `locationData.locationCity`
3. Try `jobOrderData.locationCity`
4. Try `jobOrderData.worksiteCity`
5. Try `jobPostData.locationCity`
6. Try `applicationData.locationCity`
7. ... etc.

**If locationData is missing but we have `locationId`:**
- Automatically fetches location document
- Tries company location path first
- Falls back to tenant-level location path

---

## Available Template Variables

### User Variables
- `{firstName}` - First name (fallback: "there")
- `{lastName}` - Last name
- `{fullName}` - Full name ("John Doe" or "John")
- `{email}` - Email address
- `{phone}` - Phone number

### Job Variables
- `{jobTitle}` - Job position title
- `{jobOrderId}` - Job order ID
- `{jobOrderName}` - Job order name
- `{jobPostId}` - Job posting ID
- `{jobPostTitle}` - Job posting title

### Location Variables
- `{locationCity}` - City (tries multiple sources)
- `{locationState}` - State
- `{locationName}` - Worksite/location name
- `{locationAddress}` - Full address
- `{locationZipCode}` - ZIP code

### Company Variables
- `{companyName}` - Company/client name

### Application Variables
- `{applicationId}` - Application ID
- `{applicationStatus}` - Current status
- `{applicationDate}` - Submission date

### Assignment Variables
- `{assignmentId}` - Assignment ID
- `{assignmentStatus}` - Assignment status
- `{assignmentDate}` - Assignment date
- `{assignmentTimeRange}` - Time range (e.g., "9:00 AM - 5:00 PM")
- `{assignmentAcceptDeclineUrl}` - URL to jobs board posting where worker can accept/decline (for Assignment Created trigger)

### Shift Variables
- `{shiftId}` - Shift ID
- `{shiftDate}` - Shift date
- `{shiftTimeRange}` - Time range
- `{shiftStartTime}` - Start time
- `{shiftEndTime}` - End time

### Tenant Variables
- `{tenantName}` - Tenant/company name

---

## Usage in Triggers

### Before (Old Way):
```typescript
// Inconsistent, hardcoded, no fallbacks
const variables = {
  firstName: userData.firstName || 'there',
  jobTitle: jobOrderData?.jobTitle || 'a position',
  locationCity: applicationData.locationCity || '', // Only one source!
};
```

### After (New Way):
```typescript
// Standardized, automatic lookups, fallback chains
const context: TemplateVariableContext = {
  userId: userId,
  userData: userData,
  applicationId: applicationId,
  applicationData: applicationData,
  jobOrderId: applicationData.jobOrderId,
  jobPostId: applicationData.jobId,
  tenantId: tenantId,
};

const variables = await resolveTemplateVariables(context);
// All variables resolved with fallbacks!
```

---

## Fallback Chain Examples

### `jobTitle` Resolution:
1. `jobOrderData.jobTitle`
2. `jobPostData.jobTitle`
3. `assignmentData.jobTitle`
4. `shiftData.jobTitle`
5. `applicationData.jobTitle`
6. `applicationData.data.jobTitle`
7. Default: `'a position'`

### `locationCity` Resolution:
1. `locationData.city`
2. `locationData.locationCity`
3. `jobOrderData.locationCity`
4. `jobOrderData.worksiteCity`
5. `jobPostData.locationCity`
6. `jobPostData.worksiteCity`
7. `assignmentData.locationCity`
8. `applicationData.locationCity`
9. `userData.address.city`
10. Default: `''`

### Automatic Lookups:
If you provide `jobOrderId` but no `jobOrderData`, it automatically:
1. Fetches job order document
2. Extracts `locationId` and `companyId` if present
3. Fetches location document if `locationId` exists
4. Fetches company document if `companyId` exists

---

## Best Practices

### ✅ DO:
- Provide as many IDs as possible in context
- Let the resolver handle lookups automatically
- Use standardized variable names in templates
- Trust the fallback chains

### ❌ DON'T:
- Manually fetch documents that the resolver can fetch
- Hardcode variable resolution logic
- Use non-standard variable names
- Access raw document data directly

---

## Adding New Variables

To add a new variable:

1. **Add to `ResolvedVariables` interface:**
```typescript
export interface ResolvedVariables {
  // ... existing variables
  newVariable: string;
}
```

2. **Add resolver function:**
```typescript
function resolveNewVariable(context: TemplateVariableContext): string {
  return (
    context.source1?.field ||
    context.source2?.field ||
    'default value'
  );
}
```

3. **Add to `resolveTemplateVariables`:**
```typescript
return {
  // ... existing variables
  newVariable: resolveNewVariable(resolvedContext),
};
```

4. **Update documentation** (this file)

That's it! The variable is now available in all templates.

---

## Migration Strategy

**Current State:**
- ✅ `onApplicationCreated` - Uses new resolver
- ✅ `onApplicationStatusChanged` - Uses new resolver
- 🚧 Other triggers - Still use old method

**Next Steps:**
1. Update assignment triggers to use resolver
2. Update shift triggers to use resolver
3. Update group messaging to use resolver
4. All triggers will have consistent variable resolution!

---

## Benefits

1. **Consistency** - Same variable names everywhere
2. **Reliability** - Fallback chains handle missing data
3. **Maintainability** - One place to fix variable resolution
4. **Extensibility** - Easy to add new variables
5. **Data Integrity** - Handles inconsistent field names
6. **Performance** - Efficient lookups (only fetches if needed)

---

## Testing

When testing templates:
1. Use variables from the standard list
2. Test with missing data (should still work)
3. Test with different data structures (should still resolve)
4. Check logs for lookup failures (warnings are okay, shouldn't crash)

---

## Example: Complex Scenario

**Scenario:** Application references a job order, which references a location via ID.

**What happens:**
1. Resolver receives: `applicationId`, `jobOrderId`, `locationId`
2. Fetches job order document
3. Extracts `worksiteId` from job order
4. Fetches location document from company subcollection
5. Resolves `locationCity` from location document
6. Falls back through other sources if needed

**Result:** `{locationCity}` works even though data is nested 3 levels deep!

---

## Questions?

- **Q: What if data is in a different format?**
  - A: Add it to the fallback chain in the resolver function

- **Q: What if I need a custom variable?**
  - A: Add it following the pattern above

- **Q: What if a lookup fails?**
  - A: Falls back to next source in chain, logs warning

- **Q: Performance concerns?**
  - A: Only fetches if ID provided but data missing. Caches fetched documents in context.

