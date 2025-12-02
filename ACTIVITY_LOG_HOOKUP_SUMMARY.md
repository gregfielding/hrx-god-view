# Activity Log Hookup Summary

## Current Status

The Activity Log tab is already implemented and working. It reads from `users/{uid}/activityLogs` subcollection and displays activities with filtering capabilities. However, several activities are not being logged yet.

## What Needs to Be Hooked Up

### 1. ✅ Login/Logout Logging (High Priority)
**Status:** Functions exist but not being called

**Location:**
- Functions: `src/utils/activityLogger.ts` - `logLoginActivity()` and `logLogoutActivity()`
- Need to add calls in: `src/contexts/AuthContext.tsx`

**What to do:**
- Call `logLoginActivity()` after successful authentication in `onAuthStateChanged` handler
- Call `logLogoutActivity()` in the `logout()` function
- Include metadata: IP address, user agent, device type

**Example:**
```typescript
import { logLoginActivity, logLogoutActivity } from '../utils/activityLogger';

// In onAuthStateChanged handler after user is set:
if (user && !hasReportedLoginRef.current) {
  logLoginActivity(user.uid, {
    ipAddress: await getClientIP(),
    userAgent: navigator.userAgent,
    deviceType: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
  });
}

// In logout function:
await logLogoutActivity(currentUser?.uid || '', {
  userAgent: navigator.userAgent
});
```

---

### 2. ❌ Job Application Logging (High Priority)
**Status:** Not implemented

**Locations where applications are created:**
- `src/components/apply/Wizard.tsx` - Public job application wizard
- `recruiter_tmp/applications/createApplication.ts` - Firebase Function
- `recruiter_tmp/jobsBoard/applyToPost.ts` - Firebase Function
- `src/services/phase2/applicationService.ts` - ApplicationService class

**What to do:**
- Import `logJobApplicationActivity` from `src/utils/activityLogger.ts`
- Call it after successfully creating/updating an application
- Log to the **applicant's** activity log (userId from the application)

**Example:**
```typescript
import { logJobApplicationActivity } from '../../../utils/activityLogger';

// After creating application:
await logJobApplicationActivity(
  userId, // The applicant's user ID
  jobId,
  jobTitle,
  {
    applicationId: newApplicationId,
    tenantId: tenantId,
    status: 'submitted'
  }
);
```

---

### 3. ❌ Notes Logging (High Priority)
**Status:** Partially implemented - logs to AI logs but not activity logs

**Location:** `src/pages/UserProfile/components/NotesTab.tsx`

**Current implementation:**
- Notes are added at line 177: `await addDoc(notesRef, noteData)`
- Currently calls `logNoteCreation()` which logs to AI logs (line 180)
- Need to also log to user's activity log

**What to do:**
1. Check if the note author has security level 5-7
2. If yes, log to the **target user's** activity log (the `uid` prop)
3. Add new action type `'note_added'` to `ActivityLogData` interface

**New function needed:**
```typescript
export const logNoteActivity = async (
  targetUserId: string,
  noteId: string,
  authorName: string,
  authorId: string,
  category: string,
  priority: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId: targetUserId,
    action: 'Note Added',
    actionType: 'note_added', // Need to add this type
    description: `Note added by ${authorName}: ${category}`,
    severity: priority === 'urgent' ? 'high' : priority === 'high' ? 'medium' : 'low',
    source: 'web',
    metadata: {
      ...metadata,
      noteId,
      authorId,
      authorName,
      category,
      priority,
      targetType: 'note',
    },
  });
};
```

**Update ActivityLogData interface:**
```typescript
actionType: 'login' | 'logout' | 'profile_update' | 'job_application' | 'assignment_update' | 'document_upload' | 'security_change' | 'notification' | 'note_added' | 'sms_sent' | 'other';
```

---

### 4. ❌ SMS Logging (High Priority)
**Status:** Not implemented

**Location:** `functions/src/twilio.ts` - `sendWorkerMessage` function

**What to do:**
1. Check if the sender has security level 5-7
2. Get the recipient's userId from the phone number
3. Log to the **recipient's** activity log
4. Add new action type `'sms_sent'` to `ActivityLogData` interface

**New function needed:**
```typescript
export const logSMSActivity = async (
  recipientUserId: string,
  senderName: string,
  senderId: string,
  messagePreview: string,
  metadata?: ActivityLogData['metadata']
) => {
  await logUserActivity({
    userId: recipientUserId,
    action: 'SMS Sent',
    actionType: 'sms_sent', // Need to add this type
    description: `SMS sent by ${senderName}`,
    severity: 'medium',
    source: 'system',
    metadata: {
      ...metadata,
      senderId,
      senderName,
      messagePreview: messagePreview.substring(0, 100), // Truncate for privacy
      targetType: 'sms',
    },
  });
};
```

**In Firebase Function:**
- After successfully sending SMS, look up recipient userId by phone number
- Check sender's security level from their user document
- If level 5-7, call the activity logger (can use a callable function or direct Firestore write from function)

---

### 5. ⚠️ Profile Update Logging (Medium Priority)
**Status:** Partially implemented

**Current implementation:**
- `logProfileUpdateActivity()` exists and is called in `ProfileOverview.tsx` on form submit (line 746)
- **Missing:** Individual field updates don't log activities

**What to do:**
- Log activities for all profile field updates (not just full form submissions)
- Track which fields changed in the metadata
- Could add logging to `persistProfileField()` and `persistEmploymentField()` functions

---

## Action Items Summary

### High Priority (Required for Activity Log to be useful)

1. **Add login/logout logging in AuthContext**
   - File: `src/contexts/AuthContext.tsx`
   - Add calls to `logLoginActivity()` and `logLogoutActivity()`
   - Include IP address and user agent metadata

2. **Add job application logging**
   - Files to update:
     - `src/components/apply/Wizard.tsx` (public wizard)
     - `recruiter_tmp/applications/createApplication.ts` (Firebase Function)
     - `recruiter_tmp/jobsBoard/applyToPost.ts` (Firebase Function)
   - Log after successful application creation/update

3. **Add note logging for internal workers**
   - File: `src/pages/UserProfile/components/NotesTab.tsx`
   - Check if author has security level 5-7
   - Add new action type `'note_added'` to interface
   - Create `logNoteActivity()` function

4. **Add SMS logging for internal workers**
   - File: `functions/src/twilio.ts`
   - Check sender security level (5-7)
   - Look up recipient userId by phone number
   - Add new action type `'sms_sent'` to interface
   - Create `logSMSActivity()` function (can be Firebase Function helper)

### Medium Priority (Nice to have)

5. **Improve profile update logging**
   - Log individual field changes, not just full form submissions
   - Track specific fields that changed in metadata

---

## Files That Need Updates

1. `src/utils/activityLogger.ts`
   - Add `'note_added'` and `'sms_sent'` to `actionType` union type
   - Add `logNoteActivity()` function
   - Add `logSMSActivity()` function (or helper)

2. `src/contexts/AuthContext.tsx`
   - Add login/logout logging calls

3. `src/pages/UserProfile/components/NotesTab.tsx`
   - Add activity logging when notes are added by security level 5-7 users

4. `functions/src/twilio.ts`
   - Add activity logging after SMS is sent by security level 5-7 users

5. Application creation files (multiple)
   - Add activity logging after applications are created/updated

---

## Testing Checklist

After implementation, verify:
- [ ] Login creates activity log entry
- [ ] Logout creates activity log entry
- [ ] Job applications create activity log entries
- [ ] Notes added by level 5-7 users create activity log entries
- [ ] SMS sent by level 5-7 users creates activity log entries
- [ ] Activity Log tab displays all logged activities
- [ ] Filters work correctly (action type, severity, source)
- [ ] Search works correctly

