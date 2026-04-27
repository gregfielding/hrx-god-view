# Template Variable Standardization - Implementation Summary

## ✅ What We Built

### 1. **Centralized Variable Resolver** (`functions/src/utils/templateVariableResolver.ts`)

A comprehensive system that:
- ✅ **Standardizes variable names** - All templates use the same variable names
- ✅ **Handles inconsistent data** - Tries multiple field names and sources
- ✅ **Automatic lookups** - Fetches documents when IDs provided but data missing
- ✅ **Fallback chains** - Each variable has a prioritized list of sources
- ✅ **Type-safe** - Full TypeScript interfaces

### 2. **Updated Application Triggers**

Both triggers now use the standardized resolver:
- ✅ `onApplicationCreated` - Uses new resolver
- ✅ `onApplicationStatusChanged` - Uses new resolver

### 3. **Enhanced Preview Function**

Preview now uses all standardized variables with realistic sample data.

---

## Key Features

### Fallback Chains

Each variable tries multiple sources automatically:

**Example: `locationCity`**
```
1. locationData.city
2. locationData.locationCity  
3. jobOrderData.locationCity
4. jobOrderData.worksiteCity
5. jobPostData.locationCity
6. applicationData.locationCity
7. userData.address.city
8. Default: ''
```

### Automatic Document Lookups

If you provide IDs but not data, it automatically fetches:
- Job Order → extracts locationId/companyId → fetches Location/Company
- Location → can be at company subcollection or tenant level
- Company → fetches company name
- Tenant → fetches tenant name

### Handles Field Name Variations

Knows about all the different ways data might be stored:
- `locationCity` vs `worksiteCity` vs `city`
- `jobTitle` vs `jobOrderName` vs `postTitle`
- `firstName` from user vs `applicantData.firstName`

---

## Standard Variables Available

### User: `{firstName}`, `{lastName}`, `{fullName}`, `{email}`, `{phone}`
### Job: `{jobTitle}`, `{jobOrderId}`, `{jobOrderName}`, `{jobPostId}`, `{jobPostTitle}`
### Location: `{locationCity}`, `{locationState}`, `{locationName}`, `{locationAddress}`, `{locationZipCode}`
### Company: `{companyName}`
### Application: `{applicationId}`, `{applicationStatus}`, `{applicationDate}`
### Assignment: `{assignmentId}`, `{assignmentStatus}`, `{assignmentDate}`, `{assignmentTimeRange}`
### Shift: `{shiftId}`, `{shiftDate}`, `{shiftTimeRange}`, `{shiftStartTime}`, `{shiftEndTime}`
### Tenant: `{tenantName}`

**Total: 28 standardized variables**

---

## Best Practices Implemented

✅ **Single Source of Truth** - All variable resolution in one file  
✅ **Extensible** - Easy to add new variables  
✅ **Maintainable** - Fix variable resolution in one place  
✅ **Robust** - Handles missing/inconsistent data gracefully  
✅ **Type-Safe** - Full TypeScript support  
✅ **Documented** - Clear function docs and examples  

---

## Usage Example

### In Your Triggers:
```typescript
// Build context (just IDs and available data)
const context: TemplateVariableContext = {
  userId: userId,
  userData: userData,  // Optional - will fetch if missing
  applicationId: applicationId,
  applicationData: applicationData,
  jobOrderId: applicationData.jobOrderId,  // Resolver will fetch if needed
  tenantId: tenantId,
};

// Resolve all variables
const variables = await resolveTemplateVariables(context);

// Use in template
message = resolveTemplate(template.messageTemplate, variables);
```

**That's it!** All the complex lookups and fallbacks happen automatically.

---

## Next Steps

1. ✅ **Application triggers** - Done!
2. 🚧 **Assignment triggers** - Update to use resolver
3. 🚧 **Shift triggers** - Update to use resolver  
4. 🚧 **Group messaging** - Update to use resolver

**Migration pattern:** Replace manual variable building with `resolveTemplateVariables()` call.

---

## Benefits

1. **No more hardcoded field names** - Handles variations automatically
2. **No more manual lookups** - Resolver fetches documents
3. **Consistent behavior** - Same variables work everywhere
4. **Future-proof** - Add new variables in one place
5. **Error-resistant** - Fallback chains prevent crashes

---

## Testing Recommendations

When testing:
1. **Test with missing data** - Should still resolve variables
2. **Test with different structures** - Should handle variations
3. **Check logs** - Warnings are okay (shows fallback working)
4. **Verify lookups** - Should fetch documents when needed

---

## Summary

**Problem:** Inconsistent variable resolution, hardcoded field names, manual lookups  
**Solution:** Centralized resolver with fallback chains and automatic lookups  
**Result:** Standardized, maintainable, extensible variable system

**You can now safely use any variable in templates - the resolver handles all the complexity!** 🎉

