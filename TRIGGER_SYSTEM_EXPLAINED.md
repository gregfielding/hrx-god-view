# Trigger System - How It Works

## Two Separate Pieces

### 1. **Trigger Registry** (Frontend Metadata)
**Location:** `src/utils/smsTriggerRegistry.ts`

This is just a **list of available trigger options** that appear in the dropdown. It's pure metadata - no functionality, just labels and descriptions.

**What you need to do:**
- ✅ Add a trigger definition object to the registry
- ✅ Set `available: true` when backend is implemented
- ✅ Set `available: false` for "coming soon" triggers (they won't show in UI)

**Example - Adding a trigger definition:**
```typescript
{
  id: 'applicationCreated',           // Must match backend
  label: 'New Application Received',  // What user sees
  category: 'application',            // Which category
  description: 'Sends when...',       // Helper text
  requiresStatus: false,              // Does it need a status field?
  available: true,                    // Show in UI? (false = hidden)
}
```

---

### 2. **Trigger Implementation** (Backend Functionality)
**Location:** `functions/src/applicationSmsTriggers.ts`, `functions/src/index.ts`, etc.

This is the **actual code** that detects events and sends SMS messages.

**What you need to do:**
- ✅ Create/update Firestore trigger or function
- ✅ Make it look for templates with matching `triggerType`
- ✅ Call `sendWorkerMessageInternal` with the template

**Example - Implementing a trigger:**
```typescript
// In functions/src/applicationSmsTriggers.ts
export const onApplicationCreated = onDocumentCreated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    // Find matching template
    const template = await findMatchingTemplate(
      db, tenantId, 'applicationCreated'
    );
    
    if (template) {
      // Send SMS using template
      await sendWorkerMessageInternal(...);
    }
  }
);
```

---

## The Flow

1. **User creates template** → Selects trigger from dropdown (registry)
2. **Template saved** → Stored with `triggerType: 'applicationCreated'`
3. **Event happens** → Application created in Firestore
4. **Backend trigger fires** → Looks for template with matching `triggerType`
5. **SMS sent** → Using template message

---

## Answer to Your Question

**Q: Do I need to build/create and label triggers for them to show?**

**A: Partially yes, but it's super simple:**

1. **To show in UI dropdown:** ✅ Yes - Add one object to registry (5 lines of code)
   - Can add with `available: false` to keep it hidden until ready

2. **To actually work:** ✅ Yes - Implement backend trigger (Firestore trigger function)
   - But you can add to registry first, implement later

**Best Practice:**
- Add trigger to registry with `available: false` when you plan it
- Implement backend trigger code
- Change to `available: true` → It appears in UI automatically!

---

## Example: Adding "Application Created" Trigger

### Step 1: Add to Registry (30 seconds)
```typescript
// src/utils/smsTriggerRegistry.ts
{
  id: 'applicationCreated',
  label: 'New Application Received',
  category: 'application',
  description: 'Sends immediately when a new application is created',
  requiresStatus: false,
  available: false, // Hidden for now
}
```

### Step 2: Implement Backend (when ready)
```typescript
// functions/src/applicationSmsTriggers.ts
export const onApplicationCreated = onDocumentCreated(...);
```

### Step 3: Make Visible
```typescript
available: true, // Now it shows in UI!
```

---

## Current State

Right now, these triggers are in the registry:

**Available (show in UI):**
- ✅ `applicationStatusChange`
- ✅ `assignmentCreated`
- ✅ `shiftCreated`
- ✅ `shiftUpdated`
- ✅ `shiftDeleted`
- ✅ `manual`

**Hidden (coming soon):**
- 🚧 `applicationCreated` (in registry, but `available: false`)
- 🚧 `shiftReminder`
- 🚧 `documentMissing`
- etc.

---

## TL;DR

- **Registry = Frontend UI dropdown options** (just labels/descriptions)
- **Implementation = Backend code** (actual functionality)
- **You can add to registry first**, implement later
- **Set `available: false`** to hide until ready
- **Set `available: true`** when implemented → Shows automatically!

The registry is just a configuration file - super easy to update! 🎉

