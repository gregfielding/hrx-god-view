# Activity System Unification

## Overview

This document explains the unified activity system that ensures consistency across all CRM components when displaying contact activities.

## Problem Solved

Previously, different components were loading activity data from different sources and in different ways:

1. **Last Activity Column (TenantCRM.tsx)**: Only queried `ai_logs` collection
2. **Contact Activity Tab**: Queried `tasks` and `email_logs` collections separately
3. **Contact Details Dashboard**: Queried `tasks`, `email_logs`, and `contact_notes` collections separately

This led to inconsistencies where:
- Some activities appeared in one place but not another
- Different components showed different "last activity" for the same contact
- Activity data structure was inconsistent across components

## Solution: Unified Activity Service

### Core Functions

The `src/utils/activityService.ts` provides unified functions:

#### `loadContactActivities(tenantId, contactId, options)`
Loads activities from all sources with consistent structure:
- **Tasks**: From `tasks` collection (completed tasks associated with contact)
- **Emails**: From `email_logs` collection (filtered by contactId)
- **Notes**: From `contact_notes` collection (filtered by contactId)
- **AI Activities**: From `ai_logs` collection (optional, due to permissions)

#### `getLastContactActivity(tenantId, contactId)`
Gets the single most recent activity for a contact (used in Last Activity column)

### Data Sources

The unified system queries these Firestore collections:

1. **`tenants/{tenantId}/tasks`**
   - Query: `where('associations.contacts', 'array-contains', contactId)`
   - Filter: `where('status', '==', 'completed')` (optional)
   - Order: `orderBy('updatedAt', 'desc')`

2. **`tenants/{tenantId}/email_logs`**
   - Query: `where('contactId', '==', contactId)`
   - Order: `orderBy('timestamp', 'desc')`

3. **`tenants/{tenantId}/contact_notes`**
   - Query: `where('contactId', '==', contactId)`
   - Order: `orderBy('createdAt', 'desc')`

4. **`tenants/{tenantId}/ai_logs`** (optional)
   - Query: `where('entityId', '==', contactId) AND where('entityType', '==', 'contact')`
   - Order: `orderBy('timestamp', 'desc')`

### Unified Activity Structure

All activities are normalized to this structure:

```typescript
interface UnifiedActivityItem {
  id: string;
  type: 'email' | 'task' | 'note' | 'call' | 'meeting' | 'ai_activity';
  title: string;
  description: string;
  timestamp: Date;
  salespersonId?: string;
  salespersonName?: string;
  metadata?: {
    priority?: string;
    taskType?: string;
    from?: string;
    to?: string;
    direction?: string;
    subject?: string;
    status?: string;
    [key: string]: any;
  };
  source: 'tasks' | 'email_logs' | 'contact_notes' | 'ai_logs' | 'activities';
}
```

## Implementation

### 1. Last Activity Column (TenantCRM.tsx)

**Before**: Only queried `ai_logs` collection
```typescript
const logsRef = collection(db, 'tenants', tenantId, 'ai_logs');
const q = query(logsRef, where('entityId', '==', contactId), ...);
```

**After**: Uses unified service
```typescript
const { getLastContactActivity } = await import('../../utils/activityService');
const lastActivity = await getLastContactActivity(tenantId, contactId);
```

### 2. Contact Activity Tab (ContactActivityTab.tsx)

**Before**: Separate queries for tasks and emails
```typescript
// Tasks query
const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
const tq = query(tasksRef, where('associations.contacts', 'array-contains', contactId), ...);

// Emails query  
const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
const cq = query(emailsRef, where('contactId', '==', contactId), ...);
```

**After**: Single unified call
```typescript
const { loadContactActivities } = await import('../utils/activityService');
const activities = await loadContactActivities(tenantId, contact.id, {
  limit: 200,
  includeTasks: true,
  includeEmails: true,
  includeNotes: true,
  includeAIActivities: false,
  onlyCompletedTasks: true
});
```

### 3. Contact Details Dashboard (ContactDetails.tsx)

**Before**: Separate queries for tasks, emails, and notes
```typescript
// Multiple separate queries...
const tasksQuery = query(collection(db, 'tenants', tenantId, 'tasks'), ...);
const emailsQuery = query(collection(db, 'tenants', tenantId, 'email_logs'), ...);
const notesQuery = query(collection(db, 'tenants', tenantId, 'contact_notes'), ...);
```

**After**: Single unified call
```typescript
const { loadContactActivities } = await import('../../utils/activityService');
const activities = await loadContactActivities(tenantId, contactId, {
  limit: 8,
  includeTasks: true,
  includeEmails: true,
  includeNotes: true,
  includeAIActivities: false,
  onlyCompletedTasks: true
});
```

## Benefits

1. **Consistency**: All components now show the same activities for a contact
2. **Maintainability**: Single source of truth for activity loading logic
3. **Performance**: Optimized queries with proper indexing
4. **Extensibility**: Easy to add new activity types or sources
5. **Error Handling**: Centralized error handling for all activity queries

## Activity Types Supported

- **Tasks**: Completed tasks associated with the contact
- **Emails**: Email communications with the contact
- **Notes**: Notes added about the contact
- **AI Activities**: AI-generated activities (optional, due to permissions)

## Future Enhancements

1. **Real-time Updates**: Add real-time listeners for activity changes
2. **Activity Logging**: Automatically log activities when tasks/emails/notes are created
3. **Activity Analytics**: Track activity patterns and engagement metrics
4. **Activity Templates**: Predefined activity templates for common interactions

## Data Structure Verification

To verify that all components are reading the same data:

1. **Last Activity Column**: Shows the most recent activity from any source
2. **Contact Activity Tab**: Shows all activities with filtering options
3. **Contact Details Dashboard**: Shows recent activities in the dashboard widget

All three should now display consistent activity information for the same contact.
