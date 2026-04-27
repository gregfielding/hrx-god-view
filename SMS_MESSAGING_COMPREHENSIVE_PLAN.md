# Comprehensive SMS Messaging System Plan

## Overview

This plan covers all SMS messaging scenarios, notification settings, admin interfaces, and integration with in-app/push notifications.

## Current State

### ✅ Already Implemented
- **Scenario 1**: Phone Verification (OTP via Twilio Verify) - Working
- Basic SMS infrastructure (`sendWorkerMessage`, `sendWorkerMessageInternal`)
- Automatic triggers for assignments, applications, and shifts (recently implemented)

### ❌ Needs Implementation
- Scenario 2: Templateized application update messages
- Scenario 3: User group/bulk messaging enhancements
- Scenario 4: Direct person-to-person messaging with recruiter numbers
- Scenario 5: Semi-automated button-triggered messages
- Scenario 6: Fully-automated messages with admin interface
- Notification settings (user-level and per-type)
- In-app message/push notification integration

---

## User Notification Settings Architecture

### Firestore Structure

**User Document:** `users/{userId}`
```typescript
{
  // Global SMS settings
  smsOptIn: boolean, // Master toggle for all SMS
  smsVerified: boolean, // Phone number verified
  
  // Per-type notification settings
  notificationSettings: {
    sms: {
      enabled: boolean, // Master SMS toggle (defaults to smsOptIn if not set)
      applicationUpdates: boolean, // Scenario 2
      bulkMessages: boolean, // Scenario 3
      directMessages: boolean, // Scenario 4
      semiAutomated: boolean, // Scenario 5
      fullyAutomated: boolean, // Scenario 6
      assignmentUpdates: boolean, // Already implemented
      shiftUpdates: boolean, // Already implemented
    },
    push: {
      enabled: boolean,
      applicationUpdates: boolean,
      bulkMessages: boolean,
      directMessages: boolean,
      semiAutomated: boolean,
      fullyAutomated: boolean,
      assignmentUpdates: boolean,
      shiftUpdates: boolean,
    },
    inApp: {
      enabled: boolean, // Always enabled, but can filter types
      applicationUpdates: boolean,
      bulkMessages: boolean,
      directMessages: boolean,
      semiAutomated: boolean,
      fullyAutomated: boolean,
      assignmentUpdates: boolean,
      shiftUpdates: boolean,
    }
  },
  
  // Push notification tokens (for mobile app)
  pushTokens: string[], // Array of FCM tokens
}
```

### Default Behavior
- If `notificationSettings` doesn't exist, use defaults:
  - `sms.enabled`: Use `smsOptIn` value (if false, no SMS)
  - All type-specific settings default to `true` if `sms.enabled` is true
  - `push.enabled`: Default to `true` if user has push tokens
  - `inApp.enabled`: Always `true` (can't disable in-app notifications)

### Helper Function
```typescript
// functions/src/utils/notificationSettings.ts
export async function shouldSendNotification(
  userId: string,
  notificationType: 'applicationUpdates' | 'bulkMessages' | 'directMessages' | 
                   'semiAutomated' | 'fullyAutomated' | 'assignmentUpdates' | 'shiftUpdates',
  channels: ('sms' | 'push' | 'inApp')[]
): Promise<{
  sms: boolean;
  push: boolean;
  inApp: boolean;
}> {
  // Fetch user and check settings
  // Return boolean for each channel
}
```

---

## Scenario 1: Phone Verification

**Status:** ✅ Already Working

**Implementation:** 
- Uses Twilio Verify API
- No in-app notification needed
- No user settings needed (required for verification)

---

## Scenario 2: Application Update Messages

### Requirements
- 5-10 templateized messages for application process
- Sent when application status changes
- Examples:
  - "Hi NAME. Thank you for applying to be a JOB TITLE in WORKSITE CITY. We are currently reviewing applicants and will be in touch soon."
  - Status change notifications (already partially implemented)

### Firestore Structure

**Collection:** `tenants/{tenantId}/smsTemplates`

```typescript
interface SmsTemplate {
  id: string;
  tenantId: string;
  name: string; // "Application Received"
  category: 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';
  triggerType: 'applicationStatusChange' | 'applicationCreated' | 'manual';
  triggerStatus?: string; // 'screened', 'advanced', etc. (if triggerType is applicationStatusChange)
  messageTemplate: string; // "Hi {firstName}. Thank you for applying to be a {jobTitle} in {locationCity}. We are currently reviewing applicants and will be in touch soon."
  variables: string[]; // ['firstName', 'jobTitle', 'locationCity']
  enabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}
```

### Implementation

**File:** `functions/src/applicationSmsTriggers.ts` (enhance existing)

**Enhancement:**
1. On application status change, check for matching template
2. Fetch template from `tenants/{tenantId}/smsTemplates`
3. Replace variables with actual data
4. Send via SMS, push, and in-app
5. Respect user notification settings

**Template Variable Resolution:**
```typescript
function resolveTemplate(template: string, variables: Record<string, any>): string {
  let resolved = template;
  Object.keys(variables).forEach(key => {
    const value = variables[key] || '';
    resolved = resolved.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  });
  return resolved;
}
```

**Variables Available:**
- `{firstName}` - User's first name
- `{lastName}` - User's last name
- `{jobTitle}` - Job order title
- `{jobOrderId}` - Job order ID
- `{locationCity}` - Location city
- `{locationName}` - Location nickname/name
- `{applicationStatus}` - Current application status
- `{applicationId}` - Application ID
- `{tenantName}` - Tenant/company name
- `{applicationDate}` - Date application was submitted

### Admin Interface Requirements
- UI to create/edit/delete SMS templates
- Preview template with sample data
- Test send to admin's phone
- Enable/disable templates
- View usage statistics

---

## Scenario 3: User Group / Bulk Messages

### Requirements
- Send to entire user group
- Send to all workers on a shift
- Send to multiple selected users
- Template support with variables
- Bulk sending with rate limiting

### Current Implementation Status
- ✅ Basic `sendGroupMessage` function exists
- ❌ Needs UI for template selection
- ❌ Needs integration with shift workers
- ❌ Needs better batch processing

### Enhancement Plan

**File:** `functions/src/groupMessaging.ts` (enhance existing)

**New Function:** `sendBulkMessage`

**Parameters:**
```typescript
{
  tenantId: string;
  recipients: {
    type: 'userGroup' | 'shift' | 'selected' | 'allTenantUsers' | 'filtered';
    userGroupId?: string;
    shiftId?: string;
    userIds?: string[];
    filter?: {
      securityLevel?: number[];
      jobOrderId?: string;
      locationId?: string;
      // ... other filters
    };
  };
  templateId?: string; // Use predefined template
  message?: string; // Custom message
  variables?: Record<string, any>; // If using template
  channels: ('sms' | 'push' | 'inApp')[];
}
```

### UI Requirements
- Bulk message composer
- Recipient selector (user groups, shifts, custom selection)
- Template selector
- Preview with sample recipient
- Schedule send (future enhancement)
- Delivery status tracking

---

## Scenario 4: Direct Person-to-Person Messages

### Requirements
- Recruiter can message applicant directly
- Two-way conversation capability
- Each recruiter gets their own Twilio number
- Messages stored in conversation thread

### Twilio Number Strategy

**Option A: One Number Per Recruiter (Recommended)**
- **Pros:** 
  - Personal touch (messages from recruiter's number)
  - Easy to identify sender
  - Better for two-way conversations
  - Recruiter can receive replies on their phone
- **Cons:**
  - Cost: ~$1/month per number
  - More complex to manage
  - Need number assignment system

**Option B: Shared Pool of Numbers**
- **Pros:**
  - Lower cost
  - Easier management
- **Cons:**
  - Can't identify specific recruiter from number
  - More complex reply routing
  - Less personal

**Option C: Use Messaging Service + Short Codes**
- **Pros:**
  - Professional appearance
  - Can handle higher volume
- **Cons:**
  - Expensive setup ($500+ one-time)
  - Long approval process (weeks)
  - Less personal

**Recommendation: Option A with fallback to main number**
- Assign dedicated number to each recruiter (security level 5+)
- Store mapping: `recruiters/{recruiterId}/twilioNumber`
- If no dedicated number assigned, use main tenant number
- Support upgrading to dedicated number per recruiter

### Firestore Structure

**Collection:** `tenants/{tenantId}/conversations/{conversationId}`
```typescript
interface Conversation {
  id: string;
  tenantId: string;
  participants: string[]; // [recruiterId, applicantId]
  type: 'directMessage';
  createdBy: string; // Recruiter ID
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastMessageAt: Timestamp;
  lastMessage: string;
  unreadCount: {
    [userId: string]: number;
  };
}
```

**Subcollection:** `tenants/{tenantId}/conversations/{conversationId}/messages`
```typescript
interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  channel: 'sms' | 'inApp' | 'push'; // Channel it was sent via
  twilioMessageId?: string; // If sent via SMS
  direction: 'outbound' | 'inbound'; // outbound = recruiter to applicant
  readAt?: Timestamp;
  deliveredAt?: Timestamp;
  createdAt: Timestamp;
}
```

**Collection:** `recruiters/{recruiterId}`
```typescript
interface Recruiter {
  id: string; // Same as userId
  tenantId: string;
  twilioNumber?: string; // Dedicated Twilio number (E.164 format)
  twilioNumberSid?: string; // Twilio number SID
  useMainNumber: boolean; // Fallback to tenant's main number
}
```

### Implementation

**File:** `functions/src/directMessaging.ts` (new)

**Functions:**
1. `sendDirectMessage` - Send message from recruiter to applicant
2. `handleInboundSms` - Webhook handler for incoming SMS replies
3. `assignRecruiterNumber` - Assign Twilio number to recruiter
4. `releaseRecruiterNumber` - Release number when recruiter is removed

**Webhook Setup:**
- Configure Twilio webhook for each recruiter number
- Route to: `https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms`
- Parse incoming message, find conversation, create message document
- Send push/in-app notification to recruiter

**Two-Way Flow:**
1. Recruiter sends message via UI
2. System sends SMS to applicant from recruiter's Twilio number
3. System creates conversation/message documents
4. Applicant replies to SMS
5. Twilio webhook receives reply
6. System finds conversation by phone number
7. System creates inbound message document
8. System sends push/in-app notification to recruiter

### UI Requirements
- Conversation list view (for recruiters)
- Message thread view
- Compose message interface
- Phone number management (admin only)
- Assign/release recruiter numbers

---

## Scenario 5: Semi-Automated Messages

### Requirements
- Button-triggered messages from UI
- Admin can create button actions
- Template support
- Example: "Remind about certification upload"

### Firestore Structure

**Collection:** `tenants/{tenantId}/semiAutomatedActions`
```typescript
interface SemiAutomatedAction {
  id: string;
  tenantId: string;
  name: string; // "Remind about certification"
  triggerContext: 'userProfile' | 'applicationDetail' | 'assignmentDetail' | 'custom';
  buttonLabel: string; // "Remind about Resume"
  buttonIcon?: string;
  templateId: string; // Reference to SMS template
  enabled: boolean;
  requiredPermissions: {
    securityLevel?: number;
    roles?: string[];
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Implementation

**File:** `functions/src/semiAutomatedMessaging.ts` (new)

**Function:** `triggerSemiAutomatedMessage`

**Parameters:**
```typescript
{
  tenantId: string;
  actionId: string;
  targetUserId: string;
  contextData?: Record<string, any>; // Additional data for template variables
  triggeredBy: string; // User ID who clicked button
}
```

**Flow:**
1. Admin creates semi-automated action with template
2. Button appears in UI based on `triggerContext`
3. User with permission clicks button
4. System checks permissions
5. System fetches template and resolves variables
6. System checks user notification settings
7. System sends via SMS, push, and in-app
8. System logs action for audit

### UI Requirements
- Button action builder (admin)
- Context selector (where button appears)
- Permission requirements
- Test action button

---

## Scenario 6: Fully-Automated Messages

### Requirements
- Admin interface to create/manage automated triggers
- Conditional triggers (if/then logic)
- Schedule-based triggers
- Event-based triggers
- Template management

### Firestore Structure

**Collection:** `tenants/{tenantId}/automatedTriggers`
```typescript
interface AutomatedTrigger {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  triggerType: 'event' | 'schedule' | 'condition';
  
  // Event-based triggers
  eventType?: 'applicationCreated' | 'applicationStatusChange' | 'assignmentCreated' | 
              'documentMissing' | 'certificationExpiring' | 'shiftReminder' | 'custom';
  eventFilters?: Record<string, any>; // Additional filters
  
  // Schedule-based triggers
  schedule?: {
    type: 'interval' | 'cron';
    interval?: number; // minutes
    cron?: string; // cron expression
    timezone?: string;
  };
  
  // Condition-based triggers
  conditions?: {
    field: string;
    operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'contains' | 'exists';
    value: any;
  }[];
  
  // Action when triggered
  action: {
    templateId: string;
    channels: ('sms' | 'push' | 'inApp')[];
    delay?: number; // Delay in minutes before sending
    conditions?: {
      // Additional conditions to check before sending
      userSettings: boolean; // Respect user notification settings
      lastSent?: number; // Don't send if sent within X hours
    };
  };
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  lastTriggeredAt?: Timestamp;
  triggerCount: number;
}
```

### Implementation

**File:** `functions/src/automatedMessaging.ts` (new)

**Functions:**
1. `evaluateAutomatedTriggers` - Check triggers on events
2. `processScheduledTriggers` - Scheduled function to check schedule-based triggers
3. `evaluateConditionalTriggers` - Evaluate condition-based triggers
4. `executeAutomatedAction` - Execute trigger action (send message)

**Event-Based Trigger Integration:**
- Enhance existing Firestore triggers to check for automated triggers
- When application created/updated, check for matching triggers
- When assignment created, check for matching triggers
- When document uploaded/removed, check for triggers

**Scheduled Trigger Processing:**
```typescript
// Run every 5 minutes
export const processAutomatedTriggers = onSchedule({
  schedule: '*/5 * * * *', // Every 5 minutes
  timeZone: 'America/New_York'
}, async (event) => {
  // Fetch all enabled schedule-based triggers
  // Evaluate conditions
  // Execute actions
});
```

### Example Triggers

**Example 1: Certification Expiring**
```typescript
{
  name: "Certification Expiring Reminder",
  triggerType: 'condition',
  conditions: [
    { field: 'certifications.expirationDate', operator: 'lessThan', value: '30 days from now' },
    { field: 'certifications.reminderSent', operator: 'notEquals', value: true }
  ],
  action: {
    templateId: 'certification-expiring-template',
    channels: ['sms', 'push', 'inApp'],
    conditions: {
      userSettings: true,
      lastSent: 168 // Don't send if sent within 7 days
    }
  }
}
```

**Example 2: Application Created Welcome**
```typescript
{
  name: "Application Received Welcome",
  triggerType: 'event',
  eventType: 'applicationCreated',
  action: {
    templateId: 'application-received-template',
    channels: ['sms', 'push', 'inApp'],
    delay: 5 // Wait 5 minutes (in case application is immediately updated)
  }
}
```

### UI Requirements
- Trigger builder interface
- Condition builder (drag-and-drop or form-based)
- Template selector
- Trigger testing/preview
- Trigger execution history/logs
- Enable/disable triggers
- Duplicate trigger
- Import/export triggers (for templates)

---

## Unified Notification System

### Core Function

**File:** `functions/src/notifications/unifiedNotificationService.ts` (new)

```typescript
export async function sendNotification(
  tenantId: string,
  userId: string,
  notification: {
    type: 'applicationUpdates' | 'bulkMessages' | 'directMessages' | 
          'semiAutomated' | 'fullyAutomated' | 'assignmentUpdates' | 'shiftUpdates';
    channels: ('sms' | 'push' | 'inApp')[];
    templateId?: string;
    message?: string;
    variables?: Record<string, any>;
    priority?: 'low' | 'normal' | 'high';
    data?: Record<string, any>; // Additional data for push/in-app
  },
  context?: {
    source: string;
    sourceId?: string;
    triggeredBy?: string;
  }
): Promise<{
  sms: { success: boolean; messageId?: string; error?: string };
  push: { success: boolean; messageId?: string; error?: string };
  inApp: { success: boolean; notificationId?: string; error?: string };
}> {
  // 1. Check user notification settings
  // 2. Resolve template if templateId provided
  // 3. Send via each requested channel
  // 4. Return results
}
```

### In-App Notification System

**Collection:** `users/{userId}/notifications`
```typescript
interface InAppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  read: boolean;
  readAt?: Timestamp;
  createdAt: Timestamp;
  actionUrl?: string; // Deep link to relevant page
}
```

### Push Notification System

**File:** `functions/src/notifications/pushNotificationService.ts` (new)

```typescript
import * as admin from 'firebase-admin';

export async function sendPushNotification(
  userId: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, any>;
    priority?: 'normal' | 'high';
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // 1. Fetch user's push tokens
  // 2. Send via FCM
  // 3. Remove invalid tokens
  // 4. Return result
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. ✅ Implement notification settings structure
2. ✅ Create unified notification service
3. ✅ Enhance application triggers with templates
4. ✅ Create SMS template management system

### Phase 2: Bulk & Direct Messaging (Week 2)
1. ✅ Enhance bulk messaging with templates
2. ✅ Implement direct messaging system
3. ✅ Twilio number assignment system
4. ✅ Inbound SMS webhook handler

### Phase 3: Semi-Automated (Week 3)
1. ✅ Implement semi-automated action system
2. ✅ Create button action builder UI
3. ✅ Integrate with user profile/application views

### Phase 4: Fully-Automated (Week 4)
1. ✅ Implement automated trigger system
2. ✅ Create trigger builder UI
3. ✅ Scheduled trigger processor
4. ✅ Event-based trigger integration

### Phase 5: Push & In-App (Week 5)
1. ✅ Implement push notification service
2. ✅ Implement in-app notification system
3. ✅ Integrate with all messaging scenarios
4. ✅ Notification center UI

### Phase 6: Admin Interface (Week 6)
1. ✅ Template management UI
2. ✅ Trigger management UI
3. ✅ Message delivery tracking
4. ✅ Analytics dashboard

---

## Files to Create/Modify

### New Files
1. `functions/src/utils/notificationSettings.ts` - Settings helper
2. `functions/src/notifications/unifiedNotificationService.ts` - Core notification service
3. `functions/src/notifications/pushNotificationService.ts` - Push notifications
4. `functions/src/directMessaging.ts` - Direct messaging
5. `functions/src/semiAutomatedMessaging.ts` - Semi-automated messages
6. `functions/src/automatedMessaging.ts` - Fully-automated triggers
7. `functions/src/smsTemplates.ts` - Template management
8. `functions/src/webhooks/inboundSms.ts` - Inbound SMS webhook

### Modified Files
1. `functions/src/applicationSmsTriggers.ts` - Add template support
2. `functions/src/groupMessaging.ts` - Enhance with templates
3. `functions/src/index.ts` - Export new functions
4. Firestore security rules - Add rules for new collections
5. Client-side notification utilities - Add notification settings UI

---

## Testing Checklist

- [ ] Notification settings respect user preferences
- [ ] Templates resolve variables correctly
- [ ] Bulk messages send to correct recipients
- [ ] Direct messages route correctly
- [ ] Inbound SMS creates conversation messages
- [ ] Semi-automated buttons trigger correctly
- [ ] Automated triggers fire on events
- [ ] Scheduled triggers execute on schedule
- [ ] Push notifications deliver to mobile app
- [ ] In-app notifications appear in notification center
- [ ] Rate limiting works for bulk sends
- [ ] Error handling doesn't break primary operations

---

## Cost Considerations

### Twilio Costs
- **Phone Numbers**: ~$1/month per recruiter number (Scenario 4)
- **SMS**: ~$0.0079 per message (US)
- **Verify API**: ~$0.05 per verification (already in use)

### Estimated Monthly Costs (100 recruiters, 10,000 messages/month)
- Recruiter numbers: $100/month
- SMS: $79/month
- **Total**: ~$179/month

### Optimization Strategies
- Batch sends to reduce API calls
- Cache user settings to reduce Firestore reads
- Queue non-urgent messages for batch processing
- Use push notifications when possible (cheaper)

---

## Security & Privacy

1. **User Consent**: Always respect `smsOptIn` and notification settings
2. **Data Privacy**: Don't include sensitive data in SMS (use links)
3. **Rate Limiting**: Prevent abuse with rate limits
4. **Audit Logging**: Log all message sends for compliance
5. **Opt-Out**: Easy way for users to opt out of all SMS
6. **Number Privacy**: Don't expose recruiter numbers in UI (unless intentional)

---

## Next Steps

1. Review and approve this plan
2. Prioritize scenarios (which to implement first)
3. Design UI mockups for admin interfaces
4. Set up development environment for Twilio number testing
5. Begin Phase 1 implementation

