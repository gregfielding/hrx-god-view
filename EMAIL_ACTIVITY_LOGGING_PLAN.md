# Email Activity Logging Review & Standardization Plan

## Executive Summary

This document outlines a plan to review, standardize, and ensure proper email activity logging for both CRM contacts and Firestore users. The goal is to ensure all email activity is properly recorded and displayed on respective profile/account pages using a unified inbox design.

## Current State Analysis

### 1. CRM Contacts Email Logging

**Current Implementation:**
- **Primary Collection**: `tenants/{tenantId}/email_logs`
  - Created by: `syncGmailEmails`, `monitorGmailForContactEmailsInternal`, `bulkImportGmailEmails`
  - Fields: `contactId`, `companyId`, `dealId`, `userId`, `direction`, `subject`, `from`, `to`, `timestamp`
  - Used by: `activityService.ts` (`loadContactActivities`), `ContactDetails.tsx`, `DealActivityTab.tsx`

- **Activity Logs**: `tenants/{tenantId}/activity_logs`
  - Created by: `monitorGmailForContactEmailsInternal`, `bulkImportGmailEmails`
  - Fields: `entityType: 'contact'`, `entityId`, `activityType: 'email'`, `metadata`
  - Used for: Activity timeline on contact profiles

**Display:**
- Contact profile pages use `activityService.ts` to load emails from `email_logs`
- Deal activity tabs query `email_logs` by `contactId` and `dealId`
- Activity timeline shows email entries from `activity_logs`

### 2. User Email Logging

**Current Implementation:**
- **Primary Collection**: `tenants/{tenantId}/messageLogs`
  - Created by: `logMessage()` function (unified messaging system)
  - Fields: `userId`, `threadId`, `channel: 'email'`, `direction`, `contentSent`, `status`
  - Used by: `MessagesTab.tsx` (user profile)

**Display:**
- User profile `MessagesTab` queries `messageLogs` by `userId` and `channel: 'email'`
- Shows basic message log entries (not threaded)

### 3. New Email Threading System

**Current Implementation:**
- **Collections**: 
  - `tenants/{tenantId}/emailThreads` - Thread metadata
  - `tenants/{tenantId}/emailThreads/{threadId}/messages` - Individual messages
- **APIs**: `sendEmailReplyApi`, `sendNewEmailApi`, `listEmailThreadsApi`, `getEmailThreadApi`
- **Logging**: 
  - ✅ Logs to `messageLogs` for recipients (users)
  - ❌ Does NOT log to `email_logs` for contacts
  - ❌ Does NOT create `activity_logs` entries for contacts
  - ❌ Does NOT link threads to contacts

**Gap Identified:**
The new email threading system (used by the inbox) only logs to `messageLogs` for users, but does not:
1. Create entries in `email_logs` for CRM contacts
2. Create `activity_logs` entries for contacts
3. Link email threads to contacts via participant email matching

## Standardization Plan

### Phase 1: Review & Document Current State ✅

**Tasks:**
- [x] Review existing CRM contact email logging (`email_logs`, `activity_logs`)
- [x] Review existing user email logging (`messageLogs`)
- [x] Review new email threading system (`emailThreads`, `messages`)
- [x] Identify gaps and inconsistencies

**Deliverable:** This document

### Phase 2: Enhance Email Threading System Logging

**Goal:** Ensure all emails sent/received via the new threading system are properly logged for both users and contacts.

**Tasks:**

#### 2.1 Update `sendEmailReplyApi` and `sendNewEmailApi`
- [ ] After sending email, identify all recipients who are CRM contacts
- [ ] For each contact recipient:
  - Create entry in `email_logs` with `contactId`, `companyId`, `dealId`
  - Create entry in `activity_logs` with `entityType: 'contact'`, `entityId: contactId`
- [ ] Link email thread to contacts via participant email matching
- [ ] Update thread document with `contactIds` array for quick lookup

**Files to Modify:**
- `functions/src/messaging/emailThreadsApi.ts`
- `functions/src/messaging/emailThreading.ts` (add contact linking helper)

#### 2.2 Update `syncGmailEmails` 
- [ ] Ensure synced emails create both `email_logs` AND `emailThreads` entries
- [ ] Link threads to contacts during sync
- [ ] Create `activity_logs` entries for contacts

**Files to Modify:**
- `functions/src/gmailIntegration.ts`

### Phase 3: Create Unified Email Display Component

**Goal:** Reuse the inbox email design on contact and user profile pages.

**Tasks:**

#### 3.1 Extract Inbox Components
- [ ] Create reusable `EmailThreadList` component (based on `UserInboxPage.tsx`)
- [ ] Create reusable `EmailThreadView` wrapper for profile pages
- [ ] Support filtering by contact/user ID

**New Files:**
- `src/components/EmailThreadList.tsx` (extracted from inbox)
- `src/components/EmailThreadViewProfile.tsx` (wrapper for profiles)

#### 3.2 Update Contact Profile Page
- [ ] Add "Emails" tab to contact profile (similar to Activity tab)
- [ ] Use `EmailThreadList` filtered by contact email
- [ ] Query `emailThreads` where participants include contact email
- [ ] Display using inbox design (threaded view)

**Files to Modify:**
- `src/pages/TenantViews/ContactDetails.tsx`

#### 3.3 Update User Profile Page
- [ ] Enhance existing `MessagesTab` to use inbox design
- [ ] Query `emailThreads` where user is participant
- [ ] Display threaded conversations instead of flat message logs
- [ ] Keep backward compatibility with `messageLogs` for SMS/Push

**Files to Modify:**
- `src/pages/UserProfile/components/MessagesTab.tsx`

### Phase 4: Backward Compatibility & Migration

**Goal:** Ensure existing systems continue to work while new system is integrated.

**Tasks:**

#### 4.1 Dual Logging Strategy
- [ ] Continue logging to `email_logs` for CRM compatibility
- [ ] Continue logging to `messageLogs` for user messaging
- [ ] Add logging to `emailThreads` for new inbox system
- [ ] Ensure all three systems stay in sync

#### 4.2 Data Migration (if needed)
- [ ] Review existing `email_logs` entries
- [ ] Create corresponding `emailThreads` entries for historical emails
- [ ] Link existing threads to contacts/users

### Phase 5: Testing & Validation

**Tasks:**
- [ ] Test email sending from inbox → verify logging to all systems
- [ ] Test email receiving → verify logging to all systems
- [ ] Test contact profile email display
- [ ] Test user profile email display
- [ ] Verify activity logs are created correctly
- [ ] Verify backward compatibility with existing CRM views

## Implementation Priority

### High Priority (Do First)
1. **Phase 2.1**: Update `sendEmailReplyApi` and `sendNewEmailApi` to log to `email_logs` and `activity_logs` for contacts
2. **Phase 3.2**: Add email display to contact profile pages

### Medium Priority
3. **Phase 3.3**: Enhance user profile email display with inbox design
4. **Phase 2.2**: Ensure `syncGmailEmails` creates proper links

### Low Priority (Future)
5. **Phase 4.2**: Data migration for historical emails
6. **Phase 3.1**: Extract reusable components (can be done incrementally)

## Technical Details

### Contact Linking Logic

When an email is sent/received:
1. Extract all email addresses from `to`, `cc`, `bcc` fields
2. Query `crm_contacts` where `email` matches any address
3. For each matching contact:
   - Create `email_logs` entry with `contactId`
   - Create `activity_logs` entry with `entityType: 'contact'`
   - Add `contactId` to thread's `participantContactIds` array

### User Linking Logic

When an email is sent/received:
1. Extract all email addresses from `to`, `cc`, `bcc` fields
2. Query `users` where `email` matches any address
3. For each matching user:
   - Log to `messageLogs` (already done)
   - Add `userId` to thread's `participantUserIds` array

### Query Strategy for Profile Pages

**Contact Profile:**
```typescript
// Query threads where contact email is a participant
const threadsQuery = query(
  collection(db, 'tenants', tenantId, 'emailThreads'),
  where('participants', 'array-contains', contactEmail),
  orderBy('lastMessageAt', 'desc')
);
```

**User Profile:**
```typescript
// Query threads where user email is a participant
const threadsQuery = query(
  collection(db, 'tenants', tenantId, 'emailThreads'),
  where('participants', 'array-contains', userEmail),
  orderBy('lastMessageAt', 'desc')
);
```

## Success Criteria

✅ All emails sent via inbox are logged to:
- `messageLogs` (for users)
- `email_logs` (for contacts)
- `activity_logs` (for contacts)
- `emailThreads` (for inbox)

✅ Contact profile pages show email threads using inbox design

✅ User profile pages show email threads using inbox design

✅ Activity timelines on contact profiles include all email activity

✅ Backward compatibility maintained with existing CRM views

## Next Steps

1. **Review this plan** with stakeholders
2. **Start with Phase 2.1** - Update email sending APIs to log to contacts
3. **Implement Phase 3.2** - Add email display to contact profiles
4. **Test thoroughly** before moving to next phases




