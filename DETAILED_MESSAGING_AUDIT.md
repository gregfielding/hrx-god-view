# Detailed Messaging Code Audit
**Date:** 2025-01-27  
**Purpose:** Map all existing messaging logic with code references for framework migration

---

## 🔍 Inventory Questions

### 1. Where are SMS sends happening now?

#### Primary SMS Sending Functions

**File:** `functions/src/twilio.ts`

1. **`sendWorkerMessageInternal()`** - Lines 262-466
   - **Purpose:** Internal helper for Firestore triggers and scheduled functions
   - **Consent Logic:** Lines 293-322
     - Checks `smsOptIn === false` → skips SMS
     - Checks `phoneVerified` status
   - **Template Logic:** None - takes raw message content
   - **Logging:** Lines 384-397
     - Logs to `sms_messages` collection
     - Logs to user activity log (lines 400-430)
   - **Called by:**
     - Application triggers (`applicationSmsTriggers.ts`)
     - Broadcast system (`index.ts`)
     - Group messaging (`groupMessaging.ts`)
     - Shift notifications (`updateNextShiftDate.ts`)

2. **`sendWorkerMessage()`** - Lines 471-715
   - **Purpose:** Callable function for authenticated users (recruiters/admins)
   - **Consent Logic:** Lines 541-547
     - Checks `smsOptIn === false` → throws error
   - **Template Logic:** Lines 552-562
     - Hardcoded templates: `shift_reminder`, `onboarding`, `status_update`, `custom`
   - **Logging:** Lines 661-670
     - Logs to `sms_messages` collection
   - **Permission Check:** Lines 509-525
     - Requires security level 5+ or recruiter role

3. **`sendOtp()` / `checkOtp()`** - Lines 105-256
   - **Purpose:** Phone verification OTP
   - **Consent Logic:** None (verification only)
   - **Template Logic:** None
   - **Logging:** Basic logging only

#### SMS Trigger Locations

**File:** `functions/src/applicationSmsTriggers.ts`

1. **`onApplicationCreated`** - Lines 29-194
   - **Send Logic:** Line 165 - calls `sendWorkerMessageInternal()`
   - **Consent Logic:** Line 157 - calls `shouldSendNotification(userId, 'applicationUpdates', 'sms')`
   - **Template Logic:** Lines 94-153
     - Fetches template from `tenants/{tenantId}/smsTemplates`
     - Uses `resolveTemplate()` and `resolveTemplateVariables()`
     - Falls back to hardcoded message if no template
   - **Logging:** Via `sendWorkerMessageInternal()` → `sms_messages` collection

2. **`onApplicationStatusChanged`** - Lines 199-382
   - **Send Logic:** Line 353 - calls `sendWorkerMessageInternal()`
   - **Consent Logic:** Line 345 - calls `shouldSendNotification(userId, 'applicationUpdates', 'sms')`
   - **Template Logic:** Lines 252-341
     - Fetches template by status (e.g., `triggerStatus == 'screened'`)
     - Falls back to hardcoded messages per status
   - **Logging:** Via `sendWorkerMessageInternal()` → `sms_messages` collection

**File:** `functions/src/index.ts`

1. **`sendBroadcastInternal()`** - Lines 3795-3955
   - **Send Logic:** Line 3884 - calls `sendWorkerMessageInternal()`
   - **Consent Logic:** Lines 3860-3870
     - Filters recipients by `phoneVerified` and `smsOptIn !== false`
   - **Template Logic:** None - uses broadcast message directly
   - **Logging:** Via `sendWorkerMessageInternal()` → `sms_messages` collection

**File:** `functions/src/groupMessaging.ts`

1. **`sendGroupMessage()`** - Lines 19-212
   - **Send Logic:** Line 155 - calls `sendWorkerMessageInternal()`
   - **Consent Logic:** Line 126
     - Checks `phoneVerified` and `smsOptIn !== false`
   - **Template Logic:** Lines 97-106
     - Hardcoded templates: `shift_reminder`, `onboarding`, `status_update`, `custom`
   - **Logging:** Via `sendWorkerMessageInternal()` → `sms_messages` collection

**File:** `functions/src/updateNextShiftDate.ts`

1. **`notifyShiftWorkers()`** - Lines 81-183
   - **Send Logic:** Calls `sendWorkerMessageInternal()` (line not shown in snippet)
   - **Consent Logic:** Checks notification settings
   - **Template Logic:** Uses templates from `smsTemplates` collection
   - **Logging:** Via `sendWorkerMessageInternal()` → `sms_messages` collection

---

### 2. Where are emails happening?

**File:** `functions/src/index.ts`

1. **`inviteUserV2()`** - Lines 7636-7888
   - **Send Logic:** Line 7852 - `sgMail.send(msg)`
   - **Consent Logic:** None (invite emails don't require opt-in)
   - **Template Logic:** Lines 7800-7842
     - Uses SendGrid dynamic templates
     - Template ID from config
   - **Logging:** Lines 7863-7880 - logs to AI event log on failure

2. **`resendInviteV2()`** - Lines 7890-8055
   - **Send Logic:** Similar to `inviteUserV2()`
   - **Consent Logic:** None
   - **Template Logic:** SendGrid templates
   - **Logging:** Basic error logging

**File:** `functions/src/gmailTasksIntegration.ts`

1. **`sendEmailTaskViaGmail()`** - Lines 446-550
   - **Send Logic:** Line 508 - Gmail API `gmail.users.messages.send()`
   - **Consent Logic:** None
   - **Template Logic:** Lines 488-503
     - Uses task content directly
   - **Logging:** Lines 523-538 - logs to AI event log

**File:** `functions/src/gmailIntegration.ts`
- Gmail integration for email sending (details not fully audited)

**Summary:**
- **Email Provider:** SendGrid (for invites) + Gmail API (for tasks)
- **No unified email service**
- **No email templates system** (except SendGrid dynamic templates)
- **No email consent checking**
- **Minimal logging**

---

### 3. Is there any push logic already?

**Answer:** ❌ **No push notification sending logic found**

**Evidence:**
- `functions/src/utils/notificationSettings.ts` has push structure (lines 32-41)
- User model has `pushTokens` field
- No FCM integration found
- No push sending functions found

**Files checked:**
- `functions/src/index.ts` - No push logic
- `functions/src/twilio.ts` - SMS only
- No `pushNotification` or `fcm` files found

---

### 4. Are any messages built inline instead of via templates?

**Yes - Multiple locations:**

1. **`functions/src/twilio.ts`** - Lines 554-559
   ```typescript
   const templates = {
     shift_reminder: 'Hi! This is a reminder...',
     onboarding: 'Welcome to the team!...',
     status_update: 'Your application status...',
     custom: 'You have a new message...'
   };
   ```

2. **`functions/src/groupMessaging.ts`** - Lines 99-105
   ```typescript
   const templates = {
     shift_reminder: 'Hi! This is a reminder...',
     onboarding: 'Welcome to the team!...',
     status_update: 'Your application status...',
     custom: 'You have a new message...'
   };
   ```

3. **`functions/src/applicationSmsTriggers.ts`** - Lines 312-340
   ```typescript
   switch (newStatus) {
     case 'screened':
       message = `Hi ${firstName}, your application...`;
     case 'advanced':
       message = `Congratulations ${firstName}!...`;
     // etc.
   }
   ```

4. **Broadcast messages** - `functions/src/index.ts` Line 3882
   - Uses broadcast message directly, no template

5. **Email invites** - `functions/src/index.ts` Lines 7800-7842
   - Uses SendGrid dynamic templates (external)

---

### 5. Where is consent checked?

#### SMS Consent Checks

1. **`functions/src/twilio.ts` - `sendWorkerMessageInternal()`**
   - **Line 308:** `if (recipientUserData?.smsOptIn === false)`
   - **Action:** Returns `{ success: false, status: 'skipped' }`

2. **`functions/src/twilio.ts` - `sendWorkerMessage()`**
   - **Line 543:** `if (recipientUserData.smsOptIn === false)`
   - **Action:** Throws `HttpsError('permission-denied', ...)`

3. **`functions/src/applicationSmsTriggers.ts`**
   - **Line 157:** `shouldSendNotification(userId, 'applicationUpdates', 'sms')`
   - **Implementation:** `functions/src/utils/notificationSettings.ts` Lines 129-154
   - **Checks:**
     - `settings.sms.enabled`
     - `settings.sms[notificationType]`

4. **`functions/src/groupMessaging.ts`**
   - **Line 126:** `smsOptIn !== false` (inline check)

5. **`functions/src/index.ts` - `sendBroadcastInternal()`**
   - **Line 3860-3870:** Filters by `smsOptIn !== false`

#### Consent Storage

**User Document Fields:**
- `smsOptIn` (boolean) - Legacy field
- `smsConsent` (object) - New structure with:
  - `agreed` (boolean)
  - `version` (string)
  - `timestamp` (Timestamp)
- `smsBlockedSystem` (boolean) - Not found in current code, but framework expects it
- `phoneVerified` (boolean) - Used as prerequisite

**Consent Sources:**
- Signup: `src/components/AuthDialog.tsx` - Lines 678-692 (SMS consent checkbox)
- Settings: Not fully audited

---

### 6. Is STOP handled anywhere right now?

**Answer:** ❌ **No STOP keyword handling found**

**Evidence:**
- No webhook handler for inbound SMS
- No STOP keyword detection
- No `smsBlockedSystem` field updates
- No STOP confirmation messages

**Files checked:**
- `functions/src/twilio.ts` - No inbound handling
- `functions/src/index.ts` - No webhook handlers
- No `handleInboundSms` or similar functions found

**Note:** Framework document mentions webhook URL in `recruiterNumbers.ts` but handler not implemented.

---

## 📦 Output: File-by-File Mapping

### `functions/src/twilio.ts`

| Aspect | Status | Location |
|--------|--------|----------|
| **Send Logic** | ✅ `sendWorkerMessageInternal()` (262-466)<br>✅ `sendWorkerMessage()` (471-715) | Lines 262-715 |
| **Consent Logic** | ⚠️ Partial - checks `smsOptIn` only | Lines 308, 543 |
| **Template Logic** | ⚠️ Hardcoded templates only | Lines 554-559 |
| **Logging Status** | ✅ Logs to `sms_messages` collection | Lines 384-397, 661-670 |

**Issues:**
- No `smsBlockedSystem` check
- No STOP handling
- Hardcoded templates (should use template system)
- Consent check is basic (doesn't use unified consent system)

---

### `functions/src/applicationSmsTriggers.ts`

| Aspect | Status | Location |
|--------|--------|----------|
| **Send Logic** | ✅ Calls `sendWorkerMessageInternal()` | Lines 165, 353 |
| **Consent Logic** | ✅ Uses `shouldSendNotification()` | Lines 157, 345 |
| **Template Logic** | ✅ Uses template system with fallbacks | Lines 94-153, 252-341 |
| **Logging Status** | ✅ Via `sendWorkerMessageInternal()` | Indirect |

**Issues:**
- Fallback messages are hardcoded (should all be templates)
- Template lookup could be improved

---

### `functions/src/index.ts` (Broadcasts)

| Aspect | Status | Location |
|--------|--------|----------|
| **Send Logic** | ✅ Calls `sendWorkerMessageInternal()` | Line 3884 |
| **Consent Logic** | ⚠️ Inline check `smsOptIn !== false` | Lines 3860-3870 |
| **Template Logic** | ❌ None - uses broadcast message directly | Line 3882 |
| **Logging Status** | ✅ Via `sendWorkerMessageInternal()` | Indirect |

**Issues:**
- No template support
- Basic consent check (should use unified system)

---

### `functions/src/groupMessaging.ts`

| Aspect | Status | Location |
|--------|--------|----------|
| **Send Logic** | ✅ Calls `sendWorkerMessageInternal()` | Line 155 |
| **Consent Logic** | ⚠️ Inline check `smsOptIn !== false` | Line 126 |
| **Template Logic** | ⚠️ Hardcoded templates | Lines 99-105 |
| **Logging Status** | ✅ Via `sendWorkerMessageInternal()` | Indirect |

**Issues:**
- Hardcoded templates
- Basic consent check

---

### `functions/src/smsTemplates.ts`

| Aspect | Status | Location |
|--------|--------|----------|
| **Template Storage** | ✅ CRUD operations | Lines 66-341 |
| **Template Resolution** | ✅ `resolveTemplate()` function | Lines 33-44 |
| **Variable Extraction** | ✅ `extractVariables()` function | Lines 49-61 |
| **Integration** | ✅ Used by application triggers | Via imports |

**Status:** ✅ **Well-structured template system exists**

---

### `functions/src/utils/notificationSettings.ts`

| Aspect | Status | Location |
|--------|--------|----------|
| **Settings Structure** | ✅ Complete interface | Lines 21-52 |
| **Get Settings** | ✅ `getUserNotificationSettings()` | Lines 57-124 |
| **Check Permission** | ✅ `shouldSendNotification()` | Lines 129-154 |
| **Update Settings** | ✅ `updateUserNotificationSettings()` | Lines 159-185 |

**Status:** ✅ **Good foundation, needs integration with unified framework**

---

### Email Files

| File | Send Logic | Consent | Templates | Logging |
|------|------------|---------|-----------|---------|
| `functions/src/index.ts` (invites) | ✅ SendGrid | ❌ None | ✅ SendGrid dynamic | ⚠️ Basic |
| `functions/src/gmailTasksIntegration.ts` | ✅ Gmail API | ❌ None | ❌ Direct content | ⚠️ AI log only |

**Status:** ⚠️ **Fragmented, needs unification**

---

## 🎯 Migration Priority

### High Priority (Compliance)
1. **STOP/HELP handling** - ❌ Not implemented
2. **Unified consent checking** - ⚠️ Partial (multiple implementations)
3. **`smsBlockedSystem` field** - ❌ Not used

### Medium Priority (Structure)
4. **Template unification** - ⚠️ Mixed (some use templates, some hardcoded)
5. **Email service unification** - ❌ Fragmented
6. **Push notification implementation** - ❌ Not started

### Low Priority (Enhancement)
7. **Analytics enhancement** - ⚠️ Basic logging exists
8. **Template UI** - ⚠️ Partial (CRUD exists, needs UI)

---

## ✅ Framework Integration Points

### Already Compatible
- ✅ Template system (`smsTemplates.ts`)
- ✅ Variable resolver (`templateVariableResolver.ts`)
- ✅ Notification settings structure (`notificationSettings.ts`)
- ✅ SMS sending infrastructure (`twilio.ts`)

### Needs Migration
- ⚠️ Consent checking (multiple implementations → unified)
- ⚠️ Template usage (hardcoded → template system)
- ❌ STOP handling (missing → needs implementation)
- ❌ Email service (fragmented → needs unification)
- ❌ Push notifications (missing → needs implementation)

---

## 📝 Next Steps

1. **Implement STOP/HELP handling** (Step 5)
2. **Migrate all SMS sends to routing orchestrator** (gradual)
3. **Unify consent checking** (use framework)
4. **Replace hardcoded templates** (use template system)
5. **Build email service** (unify SendGrid + Gmail)
6. **Implement push notifications** (FCM integration)

