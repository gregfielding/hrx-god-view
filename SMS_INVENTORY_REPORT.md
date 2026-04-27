# SMS Inventory Report
**Date:** 2025-01-27  
**Purpose:** Comprehensive audit of existing SMS infrastructure per `hrx-semi-programmatic-sms-inbox-spec.md` Section 0

---

## Executive Summary

The codebase has **substantial SMS infrastructure** already implemented, including:
- ✅ Twilio integration (production-ready)
- ✅ Inbound webhook handler with STOP/HELP/START keyword processing
- ✅ Two-way messaging thread system
- ✅ Template management (CRUD operations)
- ✅ Consent management (tenant-scoped + legacy)
- ✅ Basic inbox UI at `/text-messages`
- ⚠️ Missing: Security rules for SMS collections, queueing/retries, full inbox features
- ⚠️ Gaps: Some spec requirements not fully aligned with existing data model

---

## 0.1 Inventory Questions

### 1. Twilio Integration Status

#### ✅ Inbound SMS Webhook
- **File:** `functions/src/messaging/inboundSmsWebhook.ts`
- **Function:** `handleInboundSms` (exported as `onRequest`)
- **Webhook URL:** `https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms`
- **Status:** ✅ **IMPLEMENTED**
- **Features:**
  - Verifies Twilio signature (via `invoker: 'public'` with CORS)
  - Normalizes phone numbers to E.164
  - Routes to STOP/HELP/START handlers
  - Creates threads and messages via `twoWayMessaging.ts`
  - AI classification and draft creation (Phase 5.3)

#### ✅ Outbound SMS Sending
- **Files:**
  - `functions/src/messaging/TwilioSmsProvider.ts` - Production Twilio provider
  - `functions/src/messaging/MockSmsProvider.ts` - Development mock
  - `functions/src/messaging/smsProviderFactory.ts` - Factory pattern
- **Functions:**
  - `sendWorkerMessageInternal()` - `functions/src/twilio.ts:268-466`
  - `sendWorkerMessage()` - `functions/src/twilio.ts:471-715` (callable)
  - `deliverSMS()` - `functions/src/messaging/routingOrchestrator.ts:394-643`
- **Status:** ✅ **IMPLEMENTED**
- **Provider Selection:** Uses `SMS_PROVIDER` env var (defaults to 'mock' in dev, 'twilio' in prod)

#### ✅ Twilio Configuration
- **Using:** Direct phone number (`TWILIO_MESSAGING_PHONE_NUMBER`) OR Messaging Service SID (`TWILIO_A2P_CAMPAIGN`)
- **Secrets Storage:** ✅ Firebase Secret Manager
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_PHONE_NUMBER`
  - `TWILIO_A2P_CAMPAIGN`
  - `TWILIO_VERIFY_SERVICE_SID` (for OTP)
- **Primary Number:** **(888) 805-8650** (Twilio Toll-Free — Approved ✅)
- **Location:** `functions/src/twilio.ts:17-21` (using `defineSecret`)

---

### 2. Data Model / Storage

#### ✅ SMS Threads Collection
- **Path:** `/tenants/{tenantId}/smsThreads/{threadId}`
- **File:** `functions/src/messaging/twoWayMessaging.ts:21-37`
- **Schema:**
```typescript
interface SmsThread {
  id?: string;
  tenantId: string;
  candidateUserId: string;              // Renamed from candidateId
  candidatePhone: string;               // E.164 format
  primaryRecruiterUserId: string | null; // Renamed from primaryRecruiterId
  twilioNumber: string;
  status: 'open' | 'snoozed' | 'closed';
  lastMessageAt: Timestamp;
  lastMessageSnippet?: string;
  unreadCountForRecruiter?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  jobOrderId?: string;
  applicationId?: string;
}
```
- **Status:** ✅ **IMPLEMENTED** (matches spec structure)
- **Note:** Uses tenant-scoped path per `hrxone-firestore-messaging-collections.md`

#### ✅ SMS Messages Collection
- **Path:** `/tenants/{tenantId}/smsThreads/{threadId}/messages/{messageId}` (subcollection)
- **File:** `functions/src/messaging/twoWayMessaging.ts:39-52`
- **Schema:**
```typescript
interface SmsMessage {
  id?: string;
  tenantId: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  fromType: 'candidate' | 'recruiter' | 'system' | 'ai';
  fromUserId?: string;
  body: string;
  language: 'en' | 'es' | null;
  providerMessageId?: string; // Twilio SID
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'not_sent';
  failureReason?: string;
  createdAt: Timestamp;
}
```
- **Status:** ✅ **IMPLEMENTED**

#### ✅ Message Logs Collection (Unified)
- **Path:** `/tenants/{tenantId}/messageLogs/{logId}`
- **File:** `functions/src/messaging/messageLogging.ts`
- **Purpose:** Canonical log for all channels (SMS, email, push)
- **Schema:** Matches spec from `hrxone-firestore-messaging-collections.md`
- **Status:** ✅ **IMPLEMENTED**

#### ✅ SMS Templates Collection
- **Path:** `/tenants/{tenantId}/smsTemplates/{templateId}`
- **File:** `functions/src/smsTemplates.ts:15-28`
- **Schema:**
```typescript
interface SmsTemplate {
  id?: string;
  tenantId: string;
  name: string;
  category: 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';
  triggerType?: 'applicationStatusChange' | 'applicationCreated' | 'assignmentCreated' | 'shiftCreated' | 'manual';
  triggerStatus?: string;
  messageTemplate: string; // Uses {variable} syntax
  variables: string[];
  enabled: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy: string;
}
```
- **Status:** ✅ **IMPLEMENTED**
- **Note:** Also has unified template system at `/tenants/{tenantId}/messageTemplates/{templateId}` (see `MessagingTab.tsx`)

#### ✅ SMS Consent Collection
- **Path:** `/tenants/{tenantId}/smsConsents/{userId}`
- **File:** `functions/src/messaging/tenantConsent.ts:21-30`
- **Schema:**
```typescript
interface SmsConsent {
  userId: string;
  tenantId: string;
  phoneNumber: string;
  smsOptIn: boolean;
  smsBlockedSystem: boolean; // Set true on STOP
  consentVersion?: string;
  lastUpdatedAt: Timestamp;
  source: 'signup' | 'keyword' | 'admin' | 'import' | 'system';
}
```
- **Subcollection:** `/tenants/{tenantId}/smsConsents/{userId}/events/{eventId}` (consent event log)
- **Status:** ✅ **IMPLEMENTED** (Phase 4)
- **Legacy:** Also mirrors to `/users/{userId}` fields (`smsOptIn`, `smsBlockedSystem`, `smsConsent`)

#### ✅ Recruiter Numbers Collection
- **Path:** `/tenants/{tenantId}/recruiterNumbers/{recruiterId}`
- **Status:** ✅ **IMPLEMENTED** (referenced in `TextMessagesPage.tsx:72`)
- **Fields:** `twilioNumber`, `useMainNumber`, `twilioNumberSid`

#### ⚠️ Security Rules
- **File:** `firestore.rules`
- **Status:** ❌ **MISSING** - No rules found for `smsThreads`, `sms_messages`, `messageLogs`, or `smsConsents`
- **Risk:** Collections may be accessible to unauthorized users
- **Action Required:** Add security rules per spec Section 7

#### ⚠️ Indexes
- **File:** `firestore.indexes.json`
- **Status:** ⚠️ **PARTIAL** - Some indexes exist, but may need review for new query patterns
- **Action Required:** Verify indexes support inbox queries (by tenant, status, assignedTo, etc.)

---

### 3. UI Components

#### ✅ `/text-messages` Route
- **File:** `src/pages/TextMessagesPage.tsx`
- **Route:** `/text-messages` (defined in `src/App.tsx:347`)
- **Status:** ✅ **IMPLEMENTED** (Basic MVP)
- **Features:**
  - ✅ Thread list display
  - ✅ Twilio number assignment check
  - ✅ Reply drawer (`ReplyDrawer` component)
  - ❌ Missing: Search/filter
  - ❌ Missing: Assignment UI
  - ❌ Missing: Read/unread indicators
  - ❌ Missing: Full message pane (currently uses drawer)
  - ❌ Missing: Context panel (linked contact/worker/deal)

#### ✅ Settings → Templates Page
- **File:** `src/pages/TenantViews/MessagingTab.tsx`
- **Route:** `/settings/messaging`
- **Status:** ✅ **IMPLEMENTED** (Full CRUD)
- **Features:**
  - ✅ Template list with category/enabled toggle
  - ✅ Create/Edit dialog
  - ✅ Variable helper (autocomplete)
  - ✅ Live preview with sample values
  - ✅ Character count
  - ✅ Template deletion
  - ✅ Channel tabs (SMS/Email)
  - ✅ Message type integration
- **Note:** Uses unified template system (`UnifiedMessageTemplate`) which supports both SMS and email

#### ❌ Attachments/Media
- **Status:** ❌ **NOT IMPLEMENTED**
- **Note:** Twilio supports MMS, but no UI or backend handling found

---

### 4. Consent & Compliance

#### ✅ SMS Consent Storage
- **Primary:** `/tenants/{tenantId}/smsConsents/{userId}` (tenant-scoped)
- **Legacy:** `/users/{userId}` fields (`smsOptIn`, `smsBlockedSystem`, `smsConsent`)
- **File:** `functions/src/messaging/tenantConsent.ts`
- **Status:** ✅ **IMPLEMENTED**

#### ✅ Opt-In Logging
- **File:** `functions/src/messaging/tenantConsent.ts:35-51`
- **Subcollection:** `/tenants/{tenantId}/smsConsents/{userId}/events/{eventId}`
- **Fields:** `type`, `source`, `timestamp`, `previousValue`, `newValue`, `rawMessageSid`, `rawPayload`
- **Status:** ✅ **IMPLEMENTED**

#### ✅ STOP/HELP/START Handling
- **File:** `functions/src/messaging/stopHelpHandler.ts`
- **Status:** ✅ **FULLY IMPLEMENTED**
- **Features:**
  - ✅ STOP keywords: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPT OUT`, `OPTOUT`
  - ✅ HELP keywords: `HELP`, `INFO`, `SUPPORT`
  - ✅ START keywords: `START`, `YES`, `UNSTOP`, `SUBSCRIBE`
  - ✅ Compliant confirmation messages
  - ✅ Updates `smsBlockedSystem` flag
  - ✅ Logs to consent events subcollection
  - ✅ Logs to `userConsents/{uid}/events` (compliance requirement)

#### ⚠️ Consent Source Tracking
- **Status:** ⚠️ **PARTIAL**
- **Found:** `source` field in consent document (`signup`, `keyword`, `admin`, `import`, `system`)
- **Missing:** Explicit "text shown" / consent version tracking in some flows
- **Action Required:** Ensure all consent flows log the exact text shown to user

#### ✅ Quiet Hours
- **Status:** ❌ **NOT IMPLEMENTED**
- **Spec Requirement:** Default 8am–8pm local time
- **Action Required:** Add quiet hours check in `routingOrchestrator.ts` before sending

#### ✅ Audit Trail
- **File:** `functions/src/messaging/messageLogging.ts`
- **Status:** ✅ **IMPLEMENTED**
- **Features:**
  - Logs all outbound sends with `fromUserId`, `fromIdentity`, `contentSent`
  - Logs inbound messages with `fromIdentity: 'candidate'`
  - Tracks `providerMessageId` (Twilio SID)
  - Stores in `/tenants/{tenantId}/messageLogs/{logId}`

#### ⚠️ Footer Policy
- **Status:** ⚠️ **PARTIAL**
- **Found:** Some templates may include opt-out text
- **Missing:** Automatic footer appending per spec (`autoAppendOptOutFooter` field exists in template schema but not enforced)
- **Action Required:** Implement automatic footer appending for templates with `autoAppendOptOutFooter: true`

---

### 5. Queueing / Retries / Rate Limiting

#### ⚠️ Queueing System
- **File:** `functions/src/utils/taskQueue.ts`
- **Status:** ⚠️ **PARTIAL**
- **Found:** Cloud Tasks utility exists (`enqueueOnce`, `ensureFirstTime`)
- **Missing:** SMS sends are currently **synchronous** (no queueing)
- **Current Flow:**
  - `sendWorkerMessageInternal()` → `TwilioSmsProvider.sendSms()` → Twilio API (synchronous)
  - `deliverSMS()` → `smsProvider.sendSms()` → Twilio API (synchronous)
- **Action Required:** Implement async queueing for high-volume sends

#### ⚠️ Retry Logic
- **Status:** ❌ **NOT IMPLEMENTED**
- **Current:** Failed sends are logged but not retried
- **Action Required:** Add retry logic with exponential backoff

#### ✅ Rate Limiting
- **Status:** ✅ **PARTIAL** (manual batching)
- **Found:**
  - `functions/src/groupMessaging.ts:146-191` - Batches SMS sends (10 per second)
  - `functions/src/index.ts:3874-3912` - Broadcast batching (10 per batch, 1s delay)
- **Missing:** Automatic rate limiting per recipient/tenant/minute
- **Action Required:** Implement automatic rate limiting middleware

#### ⚠️ Idempotency
- **Status:** ⚠️ **PARTIAL**
- **Found:** `providerMessageId` (Twilio SID) stored for deduplication
- **Missing:** Explicit idempotency keys in send requests
- **Action Required:** Add idempotency key generation and checking

---

### 6. Future AI Hooks

#### ✅ AI Assist Infrastructure
- **File:** `functions/src/messaging/aiAssistApi.ts`
- **Status:** ✅ **IMPLEMENTED** (Phase 5.3)
- **Features:**
  - ✅ `classifyInboundMessage()` - Classifies inbound messages
  - ✅ `createAIDraft()` - Creates AI draft replies
  - ✅ `suggestReply()` - Suggests replies (callable)
  - ✅ `summarizeThread()` - Summarizes thread (callable)
- **Note:** AI features are stubbed/ready but may need actual AI service integration

#### ✅ Message Classification
- **File:** `functions/src/messaging/inboundSmsWebhook.ts:148-156`
- **Status:** ✅ **IMPLEMENTED**
- **Features:**
  - Classifies inbound messages on receipt
  - Creates AI drafts automatically
  - Stores in thread metadata

#### ⚠️ AI Policy Gates
- **Status:** ❌ **NOT IMPLEMENTED**
- **Spec Requirement:** "Never auto-send without explicit 'AI allowed' toggle + policy gates"
- **Action Required:** Add AI policy configuration and enforcement

---

## 0.2 Deliverable: Summary

### ✅ Existing Components Found

1. **Twilio Integration** ✅
   - `functions/src/messaging/TwilioSmsProvider.ts`
   - `functions/src/messaging/inboundSmsWebhook.ts`
   - `functions/src/twilio.ts` (legacy, still used)

2. **Data Models** ✅
   - `functions/src/messaging/twoWayMessaging.ts` (threads + messages)
   - `functions/src/messaging/messageLogging.ts` (unified logs)
   - `functions/src/messaging/tenantConsent.ts` (consent management)
   - `functions/src/smsTemplates.ts` (template CRUD)

3. **UI Components** ✅
   - `src/pages/TextMessagesPage.tsx` (basic inbox)
   - `src/pages/TenantViews/MessagingTab.tsx` (template management)
   - `src/components/ReplyDrawer.tsx` (reply UI)

4. **Compliance** ✅
   - `functions/src/messaging/stopHelpHandler.ts` (STOP/HELP/START)
   - Consent logging and event tracking

5. **AI Infrastructure** ✅
   - `functions/src/messaging/aiAssistApi.ts` (drafts, suggestions, summaries)

### ❌ Missing Components

1. **Security Rules** ❌
   - No Firestore rules for `smsThreads`, `messageLogs`, `smsConsents`
   - **Risk:** Unauthorized access possible

2. **Queueing/Retries** ❌
   - SMS sends are synchronous
   - No retry logic
   - No idempotency keys

3. **Full Inbox Features** ❌
   - Missing: Search/filter
   - Missing: Assignment UI
   - Missing: Read/unread indicators
   - Missing: Full message pane (not just drawer)
   - Missing: Context panel

4. **Quiet Hours** ❌
   - Not implemented

5. **Automatic Footer** ❌
   - `autoAppendOptOutFooter` field exists but not enforced

6. **Rate Limiting** ⚠️
   - Manual batching only, no automatic per-recipient/tenant limits

### ⚠️ Risks/Bugs Spotted

1. **Security Risk:** No Firestore rules for SMS collections
   - **Impact:** High - Unauthorized users could read/write SMS data
   - **Fix:** Add rules per spec Section 7

2. **Data Model Mismatch:** Spec uses different field names
   - **Spec:** `participantType`, `participantId`, `phoneE164`
   - **Current:** `candidateUserId`, `candidatePhone`
   - **Impact:** Medium - May need adapter layer or migration
   - **Fix:** Align with spec OR document differences

3. **Synchronous Sends:** No queueing for high-volume
   - **Impact:** Medium - Could timeout or hit rate limits
   - **Fix:** Implement Cloud Tasks queueing

4. **Missing Indexes:** May need additional indexes for inbox queries
   - **Impact:** Low - Performance degradation on large datasets
   - **Fix:** Review and add indexes

5. **Consent Source Tracking:** Not all flows log exact text shown
   - **Impact:** Low - Compliance audit trail incomplete
   - **Fix:** Ensure all consent flows log text

### Recommended Next 3 Implementation Steps

1. **Add Security Rules** (Priority: HIGH)
   - Add Firestore rules for `smsThreads`, `messageLogs`, `smsConsents`
   - Ensure only security level 5-7 users can access
   - Block access to opted-out phone numbers for outbound sends
   - **Files to modify:** `firestore.rules`

2. **Enhance Inbox UI** (Priority: MEDIUM)
   - Add search/filter functionality
   - Implement read/unread indicators
   - Add assignment UI
   - Replace drawer with full message pane + context panel
   - **Files to modify:** `src/pages/TextMessagesPage.tsx`, create new components

3. **Implement Queueing & Retries** (Priority: MEDIUM)
   - Add Cloud Tasks queueing for outbound sends
   - Implement retry logic with exponential backoff
   - Add idempotency key generation
   - **Files to modify:** `functions/src/messaging/routingOrchestrator.ts`, create new queue handler

---

## Additional Notes

- **Primary SMS Number:** (888) 805-8650 ✅ Approved
- **Webhook URL:** `https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms`
- **Template System:** Dual system (legacy `smsTemplates` + unified `messageTemplates`)
- **Consent System:** Dual system (tenant-scoped `smsConsents` + legacy user fields)
- **AI Features:** Infrastructure exists but may need actual AI service integration

---

**Report Generated:** 2025-01-27  
**Next Action:** Review with team and prioritize implementation steps
