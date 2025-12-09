# Simple & Extensible Trigger System - Recommendations

## Core Principles

1. **Start Simple** - Only show triggers that are actually implemented
2. **Category-Driven** - Triggers are filtered by template category
3. **Progressive Disclosure** - Show additional fields only when needed
4. **Easy to Extend** - Add new triggers by updating a simple config object
5. **Clear Labels** - Each trigger explains what it does

---

## Recommended Architecture

### 1. Centralized Trigger Registry

Create a single source of truth for all available triggers:

```typescript
// src/utils/smsTriggerRegistry.ts

export interface TriggerDefinition {
  id: string;
  label: string;
  category: SmsTemplate['category'];
  description: string;
  requiresStatus?: boolean; // Does this trigger need a status value?
  statusOptions?: string[]; // Predefined status options (optional)
  statusPlaceholder?: string; // Help text for status field
  available: boolean; // Is this trigger currently implemented?
}

export const TRIGGER_REGISTRY: TriggerDefinition[] = [
  // Application Triggers
  {
    id: 'applicationStatusChange',
    label: 'Application Status Changes',
    category: 'application',
    description: 'Sends when an application status changes (e.g., screened, hired)',
    requiresStatus: true,
    statusOptions: ['screened', 'advanced', 'interview', 'offer', 'hired', 'rejected'],
    statusPlaceholder: 'e.g., screened, advanced, hired',
    available: true, // ✅ Already implemented
  },
  {
    id: 'applicationCreated',
    label: 'New Application Received',
    category: 'application',
    description: 'Sends immediately when a new application is created',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  
  // Assignment Triggers
  {
    id: 'assignmentCreated',
    label: 'Assignment Created',
    category: 'assignment',
    description: 'Sends when a worker is assigned to a job',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'assignmentStatusChange',
    label: 'Assignment Status Changes',
    category: 'assignment',
    description: 'Sends when assignment status changes (confirmed, cancelled, etc.)',
    requiresStatus: true,
    statusPlaceholder: 'e.g., confirmed, cancelled, completed',
    available: false, // 🚧 Coming soon
  },
  
  // Shift Triggers
  {
    id: 'shiftCreated',
    label: 'New Shift Posted',
    category: 'shift',
    description: 'Sends when a new shift is created',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'shiftUpdated',
    label: 'Shift Updated',
    category: 'shift',
    description: 'Sends when shift details change (time, location, etc.)',
    requiresStatus: false,
    available: true, // ✅ Already implemented
  },
  {
    id: 'shiftReminder',
    label: 'Shift Reminder',
    category: 'shift',
    description: 'Sends X hours before shift starts',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  
  // Bulk Triggers
  {
    id: 'manual',
    label: 'Manual Send',
    category: 'bulk',
    description: 'Send manually via bulk messaging UI',
    requiresStatus: false,
    available: true, // ✅ Always available
  },
  
  // Semi-Automated Triggers (Future)
  {
    id: 'documentMissing',
    label: 'Document Missing Reminder',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Send Reminder" button',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  {
    id: 'certificationExpiring',
    label: 'Certification Expiring',
    category: 'semiAutomated',
    description: 'Triggered when admin clicks "Remind About Certification"',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
  
  // Fully-Automated Triggers (Future)
  {
    id: 'autoDocumentCheck',
    label: 'Auto: Document Missing',
    category: 'fullyAutomated',
    description: 'Automatically checks and sends if document missing for X days',
    requiresStatus: false,
    available: false, // 🚧 Coming soon
  },
];

// Helper functions
export function getTriggersForCategory(category: SmsTemplate['category']): TriggerDefinition[] {
  return TRIGGER_REGISTRY.filter(t => t.category === category);
}

export function getAvailableTriggersForCategory(category: SmsTemplate['category']): TriggerDefinition[] {
  return TRIGGER_REGISTRY.filter(t => t.category === category && t.available);
}

export function getTriggerDefinition(triggerId: string): TriggerDefinition | undefined {
  return TRIGGER_REGISTRY.find(t => t.id === triggerId);
}
```

---

### 2. Updated UI Component

Simple, category-driven dropdown:

```typescript
// In MessagingTab.tsx

import { getAvailableTriggersForCategory, getTriggerDefinition } from '../../utils/smsTriggerRegistry';

// ... in template form ...

<FormControl fullWidth>
  <InputLabel>Trigger Type</InputLabel>
  <Select
    value={templateForm.triggerType || 'manual'}
    label="Trigger Type"
    onChange={(e) => {
      const triggerType = e.target.value;
      const triggerDef = getTriggerDefinition(triggerType);
      
      setTemplateForm({ 
        ...templateForm, 
        triggerType,
        triggerStatus: triggerDef?.requiresStatus ? templateForm.triggerStatus : undefined
      });
    }}
  >
    {getAvailableTriggersForCategory(templateForm.category).map((trigger) => (
      <MenuItem key={trigger.id} value={trigger.id}>
        <Box>
          <Typography variant="body2">{trigger.label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {trigger.description}
          </Typography>
        </Box>
      </MenuItem>
    ))}
  </Select>
  <FormHelperText>
    {getTriggerDefinition(templateForm.triggerType)?.description}
  </FormHelperText>
</FormControl>

{/* Only show status field if trigger requires it */}
{templateForm.triggerType && getTriggerDefinition(templateForm.triggerType)?.requiresStatus && (
  <FormControl fullWidth>
    {getTriggerDefinition(templateForm.triggerType)?.statusOptions ? (
      <Select
        label="Trigger Status"
        value={templateForm.triggerStatus || ''}
        onChange={(e) =>
          setTemplateForm({ ...templateForm, triggerStatus: e.target.value })
        }
      >
        {getTriggerDefinition(templateForm.triggerType)!.statusOptions!.map((status) => (
          <MenuItem key={status} value={status}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </MenuItem>
        ))}
      </Select>
    ) : (
      <TextField
        label="Trigger Status"
        value={templateForm.triggerStatus || ''}
        onChange={(e) =>
          setTemplateForm({ ...templateForm, triggerStatus: e.target.value })
        }
        placeholder={getTriggerDefinition(templateForm.triggerType)?.statusPlaceholder}
        helperText="Application status that triggers this template"
      />
    )}
  </FormControl>
)}
```

---

### 3. Backend Matching Logic (Keep It Simple)

The backend just needs to match `triggerType` and `triggerStatus`:

```typescript
// functions/src/utils/templateMatcher.ts

export async function findMatchingTemplate(
  db: admin.firestore.Firestore,
  tenantId: string,
  triggerType: string,
  triggerStatus?: string
): Promise<SmsTemplate | null> {
  let query = db
    .collection(`tenants/${tenantId}/smsTemplates`)
    .where('triggerType', '==', triggerType)
    .where('enabled', '==', true);
  
  // If trigger requires a status, filter by it
  if (triggerStatus) {
    query = query.where('triggerStatus', '==', triggerStatus) as any;
  }
  
  const snapshot = await query.limit(1).get();
  
  if (snapshot.empty) {
    return null;
  }
  
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as SmsTemplate;
}
```

---

### 4. Adding New Triggers (Super Simple!)

**To add a new trigger:**

1. **Add to registry** (one object):
```typescript
{
  id: 'newTriggerType',
  label: 'Friendly Label',
  category: 'application',
  description: 'What it does',
  requiresStatus: false,
  available: true, // Set to true when implemented
}
```

2. **Update TypeScript type** (if needed):
```typescript
triggerType?: 'applicationStatusChange' | 'newTriggerType' | ... | 'manual';
```

3. **Implement backend matching** (in existing triggers):
```typescript
// In your Firestore trigger
const template = await findMatchingTemplate(db, tenantId, 'newTriggerType');
```

That's it! No UI changes needed - it automatically appears in dropdown.

---

## Benefits of This Approach

✅ **Simple to start** - Only shows what's implemented  
✅ **Easy to extend** - Add one object to registry  
✅ **Self-documenting** - Each trigger has description  
✅ **Type-safe** - TypeScript ensures consistency  
✅ **Progressive** - Unavailable triggers hidden until ready  
✅ **User-friendly** - Clear labels and help text  
✅ **Maintainable** - Single source of truth  

---

## Implementation Steps

1. **Phase 1 (Now):** Create trigger registry with current triggers
2. **Phase 2:** Update UI to use registry
3. **Phase 3:** Add new triggers as you build them (just update registry)
4. **Phase 4:** Add status dropdowns for triggers with predefined options

---

## Example: Adding "Shift Reminder" Later

When you're ready to implement shift reminders:

```typescript
// 1. Update registry
{
  id: 'shiftReminder',
  label: 'Shift Reminder',
  category: 'shift',
  description: 'Sends X hours before shift starts',
  requiresStatus: false,
  available: true, // ✅ Changed from false to true
}

// 2. Implement backend trigger (in your shift reminder function)
const template = await findMatchingTemplate(db, tenantId, 'shiftReminder');

// Done! UI automatically shows it now.
```

No UI changes, no form updates, just works! 🎉

