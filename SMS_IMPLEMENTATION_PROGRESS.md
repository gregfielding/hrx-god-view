# SMS Implementation Progress
**Date:** 2025-01-27  
**Status:** Phase 1 & 2 Complete, Phase 3 In Progress

---

## ✅ Completed: Phase 1 - Security Rules

### Firestore Security Rules Added
**File:** `firestore.rules`

Added comprehensive security rules for all SMS collections:

1. **SMS Threads** (`/tenants/{tenantId}/smsThreads/{threadId}`)
   - Read: Internal users (security level >= 5) assigned to tenant
   - Create: Internal users can create threads for outbound messages
   - Update: Internal users can update, but denied client writes to inbound-specific fields
   - Delete: Only admins

2. **SMS Messages** (subcollection)
   - Read: Internal users assigned to tenant
   - Create: Only outbound messages from client (inbound handled by webhook)
   - Update: Only outbound messages can be updated by client
   - Delete: Only admins

3. **SMS Templates** (`/tenants/{tenantId}/smsTemplates/{templateId}`)
   - Read: Internal users
   - Write: Only admins/managers (security level >= 6)

4. **SMS Consents** (`/tenants/{tenantId}/smsConsents/{userId}`)
   - Read: Internal users + users can read their own
   - Write: Only backend (webhook) or admins

5. **Message Logs** (`/tenants/{tenantId}/messageLogs/{logId}`)
   - Read: Internal users
   - Write: Only backend (Cloud Functions)

6. **Recruiter Numbers** (`/tenants/{tenantId}/recruiterNumbers/{recruiterId}`)
   - Read: Internal users + users can read their own
   - Write: Only admins/managers (security level >= 6)

### Helper Functions Added
- `isInternal(tenantId)` - Checks if user is internal (security level >= 5)
- `hasSecurityLevel(tenantId, minLevel)` - Checks if user has at least specified security level

---

## ✅ Completed: Phase 2 - Data Model Normalization

### Updated Interfaces
**File:** `functions/src/messaging/twoWayMessaging.ts`

1. **SmsThread Interface**
   - ✅ Added `participant?: Participant` - Normalized participant (candidate/contact)
   - ✅ Added `counterparty?: Participant` - Normalized counterparty (recruiter/system)
   - ✅ Added `threadStatus?: ThreadStatus` - Explicit status (open/closed/spam)
   - ✅ Added `assignedToUserId?: string` - Assigned recruiter
   - ✅ Added `lastInboundAt`, `lastOutboundAt` - Separate timestamps
   - ✅ Added `lastReadAtByUser?: { [uid]: Timestamp }` - Per-user read tracking
   - ✅ Added `unreadCountByUser?: { [uid]: number }` - Per-user unread counts
   - ✅ Added `companyId`, `dealId`, `locationId` - Linked entities
   - ✅ Kept legacy fields (`candidateUserId`, `candidatePhone`, `primaryRecruiterUserId`) for backward compatibility

2. **SmsMessage Interface**
   - ✅ Added `source?: 'automation' | 'manual' | 'ai_suggested' | 'ai_sent'` - Message source tracking
   - ✅ Added `ai?: { suggestedByRunId?, approvedByUid?, model?, promptRef? }` - AI metadata

3. **New Types**
   - ✅ `ParticipantType = 'user' | 'contact' | 'unknown'`
   - ✅ `Participant` interface with `type`, `id`, `phoneE164`, `displayName`
   - ✅ `ThreadStatus` extended to include `'spam'`

### Updated Functions
1. **`findOrCreateThread()`**
   - ✅ Populates normalized `participant` and `counterparty` fields
   - ✅ Sets `threadStatus` explicitly
   - ✅ Sets `assignedToUserId` if primary recruiter provided
   - ✅ Maintains backward compatibility with legacy fields

2. **`createInboundMessage()`**
   - ✅ Sets `source: 'automation'` on inbound messages
   - ✅ Updates `lastInboundAt` timestamp
   - ✅ Increments unread counts

3. **`sendOutboundMessage()`**
   - ✅ Sets `source: 'manual'` on outbound messages
   - ✅ Updates `lastOutboundAt` timestamp

4. **`updateThreadStatus()`**
   - ✅ Updates both `status` and `threadStatus` fields

### New Functions Added
1. **`assignThread(threadId, recruiterId, tenantId?)`**
   - Assigns thread to recruiter
   - Updates `assignedToUserId` and `counterparty` fields
   - Maintains legacy `primaryRecruiterUserId` field

2. **`markThreadRead(threadId, userId, tenantId?)`**
   - Marks thread as read for a specific user
   - Updates `lastReadAtByUser[userId]` timestamp

---

## 🚧 In Progress: Phase 3 - Queueing & Retries

### Next Steps
1. Create `smsSendQueue` Cloud Tasks queue handler
2. Implement retry logic with exponential backoff
3. Add consent checks, quiet hours, footer injection, STOP-list enforcement
4. Update outbound send functions to use queue instead of direct Twilio calls

---

## 📋 Pending: Phase 4 - Inbox UI Enhancements

1. Read/unread indicators (using `lastReadAtByUser`)
2. Assignment UI (using `assignedToUserId`)
3. Search/filter functionality
4. Full message pane (replace drawer)
5. Context panel (linked contact/worker/deal)

---

## 🔒 Security Improvements

- ✅ All SMS collections now protected by Firestore rules
- ✅ Cross-tenant reads denied
- ✅ Inbound message fields protected from client writes
- ✅ Template/settings changes require admin/manager level
- ✅ Consent updates only via backend (webhook) or admins

---

## 📊 Data Model Improvements

- ✅ Normalized participant structure (supports users, contacts, unknown)
- ✅ Per-user read tracking (enables unread indicators)
- ✅ Message source tracking (automation/manual/AI)
- ✅ AI metadata structure (ready for AI features)
- ✅ Backward compatibility maintained (legacy fields still populated)

---

**Next Commit:** Implement Cloud Tasks queueing system
