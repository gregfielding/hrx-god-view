# How to Add New Triggers to Registry (Option A Approach)

## Quick Guide

When you want to plan a new trigger, just add it to the registry with `available: false`. It will be hidden until you implement the backend, then you flip it to `true`.

---

## Step-by-Step: Adding a New Trigger

### 1. Open the Registry File
**File:** `src/utils/smsTriggerRegistry.ts`

### 2. Find the Right Category Section
Triggers are organized by category:
- `application` - Application-related triggers
- `assignment` - Assignment-related triggers  
- `shift` - Shift-related triggers
- `bulk` - Bulk/manual messaging
- `semiAutomated` - Button-triggered reminders
- `fullyAutomated` - Automatic background checks

### 3. Add Your Trigger Object
Copy this template and fill it in:

```typescript
{
  id: 'uniqueTriggerId',           // No spaces, camelCase
  label: 'User-Friendly Label',    // What shows in dropdown
  category: 'application',          // Which category
  description: 'What it does...',   // Helper text for users
  requiresStatus: false,            // Does it need a status dropdown?
  statusOptions: undefined,         // Optional: ['option1', 'option2']
  statusPlaceholder: undefined,     // Optional: 'e.g., status value'
  available: false,                 // false = hidden, true = shows in UI
}
```

### 4. Example: Adding "Interview Scheduled" Trigger

```typescript
{
  id: 'interviewScheduled',
  label: 'Interview Scheduled',
  category: 'semiAutomated',
  description: 'Triggered when admin schedules an interview',
  requiresStatus: false,
  available: false, // 🚧 Coming soon
}
```

### 5. When Ready to Implement
1. Build the backend trigger function
2. Change `available: false` → `available: true`
3. Done! It automatically appears in the UI dropdown

---

## Common Trigger Patterns

### Pattern 1: Status-Based Trigger
```typescript
{
  id: 'applicationStatusChange',
  label: 'Application Status Changes',
  category: 'application',
  description: 'Sends when an application status changes',
  requiresStatus: true,                    // Needs status field
  statusOptions: ['screened', 'hired'],    // Dropdown options
  available: true,
}
```

### Pattern 2: Event-Based Trigger
```typescript
{
  id: 'shiftCreated',
  label: 'New Shift Posted',
  category: 'shift',
  description: 'Sends when a new shift is created',
  requiresStatus: false,  // No status needed
  available: true,
}
```

### Pattern 3: Button-Triggered (Semi-Automated)
```typescript
{
  id: 'resumeUploadReminder',
  label: 'Resume Upload Reminder',
  category: 'semiAutomated',
  description: 'Triggered when admin clicks "Remind to Upload Resume"',
  requiresStatus: false,
  available: false,
}
```

### Pattern 4: Fully Automated
```typescript
{
  id: 'autoDocumentCheck',
  label: 'Auto: Document Missing',
  category: 'fullyAutomated',
  description: 'Automatically checks and sends if document missing for X days',
  requiresStatus: false,
  available: false,
}
```

---

## Current Registry Status

**Available Triggers (Show in UI):**
- ✅ `applicationStatusChange`
- ✅ `assignmentCreated`
- ✅ `shiftCreated`
- ✅ `shiftUpdated`
- ✅ `shiftDeleted`
- ✅ `manual`

**Planned Triggers (Hidden):**
- 🚧 `applicationCreated`
- 🚧 `assignmentStatusChange`
- 🚧 `shiftReminder`
- 🚧 `documentMissing`
- 🚧 `certificationExpiring`
- 🚧 `backgroundCheckReminder`
- 🚧 `resumeUploadReminder`
- 🚧 `workEligibilityReminder`
- 🚧 `interviewScheduled`
- 🚧 `autoDocumentCheck`
- 🚧 `autoCertificationExpiring`
- 🚧 `autoResumeMissing`
- 🚧 `autoWorkEligibilityCheck`

---

## Tips

1. **Use descriptive IDs** - They'll be used in backend code
   - ✅ Good: `interviewScheduled`, `resumeUploadReminder`
   - ❌ Bad: `trigger1`, `msg2`

2. **Clear descriptions** - Users see these in the dropdown
   - Explain when the trigger fires
   - Mention what action triggers it (if semi-automated)

3. **Group by category** - Keep related triggers together
   - Makes it easier to find and maintain

4. **Plan ahead** - Add triggers you're thinking about
   - Set `available: false`
   - Implement when ready
   - Flip to `true` when done

---

## Next Steps

1. ✅ **Registry is set up** - You can add triggers anytime
2. 🚧 **Plan your triggers** - Add to registry as you think of them
3. 🚧 **Implement backend** - When ready, build the trigger function
4. ✅ **Enable in UI** - Change `available: true`

**The beauty of this approach:** You can plan all your triggers now, then implement them gradually without touching the UI code!

