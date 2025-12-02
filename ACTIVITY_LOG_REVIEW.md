# Activity Log Review & Implementation Status

## Overview
This document reviews the current Activity Log implementation and identifies what needs to be logged based on requirements.

## Required Activities to Log

Based on requirements, the following activities should be logged to `users/{userId}/activityLogs`:

1. ✅ **Profile Updates** - Any time a user updates their profile
2. ❓ **Login/Logout** - User login and logout sessions
3. ❓ **Job Applications** - When user applies for job or updates application
4. ❌ **Notes Added** - When internal workers (security levels 5-7) add notes
5. ❌ **SMS Sent** - When internal workers (security levels 5-7) send SMS through system

## Current Implementation Status

### 1. Profile Updates
**Status:** ⚠️ Partially Implemented

**Current Implementation:**
- `logProfileUpdateActivity()` function exists in `src/utils/activityLogger.ts`
- Only called in `ProfileOverview.tsx` when form is submitted (line 708)
- **Missing:** Individual field updates via `persistProfileField()` and `persistEmploymentField()` don't log activities

**Recommendation:**
- Log activities for all profile field updates (not just full form submissions)
- Track which fields changed in the metadata

### 2. Login/Logout
**Status:** ❌ Not Implemented in Activity Logs

**Current Implementation:**
- `logLoginActivity()` and `logLogoutActivity()` functions exist in `src/utils/activityLogger.ts`
- **NOT being called** in `AuthContext.tsx` or `Login.tsx`
- Login tracking exists in Firebase Function `updateUserLoginInfo` but only updates `lastLoginAt` and `loginCount` - doesn't create activity logs

**Recommendation:**
- Call `logLoginActivity()` in `AuthContext.tsx` when user successfully authenticates
- Call `logLogoutActivity()` when user logs out
- Include metadata: IP address, user agent, device type

### 3. Job Applications
**Status:** ❌ Not Implemented

**Current Implementation:**
- `logJobApplicationActivity()` function exists in `src/utils/activityLogger.ts`
- **NOT being called** when applications are created/updated
- Applications are created in:
  - `src/components/apply/Wizard.tsx` (public job application wizard)
  - `recruiter_tmp/jobsBoard/applyToPost.ts` (Firebase Function)
  - `src/services/phase2/applicationService.ts`
  - `recruiter_tmp/applications/createApplication.ts` (Firebase Function)

**Recommendation:**
- Add activity logging when applications are created
- Add activity logging when application status is updated
- Log to the **applicant's** activity log (userId from application)

### 4. Notes Added by Internal Workers
**Status:** ❌ Not Implemented

**Current Implementation:**
- Notes are added in `src/pages/UserProfile/components/NotesTab.tsx`
- Currently logs to AI logs (`logger.aiEvent()`) but NOT to user activity logs
- No check for security level (5-7) requirement
- Notes are stored in `users/{uid}/notes` subcollection

**Recommendation:**
- When a note is added, check if the author's security level is 5-7
- If yes, log to the target user's activity log (`users/{targetUserId}/activityLogs`)
- Include metadata: note ID, category, priority, author info

### 5. SMS Sent by Internal Workers
**Status:** ❌ Not Implemented

**Current Implementation:**
- SMS can be sent via:
  - `functions/src/twilio.ts` - `sendWorkerMessage` Firebase Function
  - Direct `sms:` links in UI (opens device SMS app - doesn't go through system)
- No activity logging when SMS is sent through the system

**Recommendation:**
- When `sendWorkerMessage` is called by a user with security level 5-7:
  - Log to the **recipient's** activity log (`users/{recipientUserId}/activityLogs`)
  - Include metadata: message content (truncated), sender info, timestamp
- Add new action type: `'sms_sent'` to ActivityLogData interface

## Action Items

### High Priority
1. ✅ **Add login/logout logging** - Call `logLoginActivity()` and `logLogoutActivity()` in AuthContext
2. ✅ **Add job application logging** - Log when applications are created/updated
3. ✅ **Add note logging** - Log when internal workers (5-7) add notes
4. ✅ **Add SMS logging** - Log when internal workers (5-7) send SMS

### Medium Priority
5. ⚠️ **Improve profile update logging** - Log individual field changes, not just full form submissions

## Implementation Notes

### Activity Log Structure
Current structure in `users/{userId}/activityLogs`:
```typescript
{
  action: string;
  actionType: 'login' | 'logout' | 'profile_update' | 'job_application' | 'assignment_update' | 'document_upload' | 'security_change' | 'notification' | 'other';
  description: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high';
  source: 'web' | 'mobile' | 'api' | 'system';
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    changes?: any;
    targetId?: string;
    targetType?: string;
    [key: string]: any;
  };
}
```

### New Action Types Needed
Add to `ActivityLogData` interface:
- `'note_added'` - When internal worker adds note
- `'sms_sent'` - When internal worker sends SMS
- `'application_updated'` - When application status changes

### Security Level Check
For notes and SMS, need to check if the actor (person performing the action) has security level 5-7:
```typescript
const actorSecurityLevel = parseInt(user.securityLevel || '0');
if (actorSecurityLevel >= 5 && actorSecurityLevel <= 7) {
  // Log activity to target user's activity log
}
```

