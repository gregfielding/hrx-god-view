# SMS Queueing Implementation
**Date:** 2025-01-27  
**Status:** ✅ Complete

---

## Overview

Implemented Cloud Tasks queueing system for all outbound SMS sends, replacing direct Twilio calls. This provides:
- ✅ Reliable delivery with automatic retries
- ✅ Compliance enforcement at send time
- ✅ Idempotency to prevent duplicate sends
- ✅ Observability and audit trail

---

## Implementation Details

### 1. New Collection: `smsOutboundRequests`

**Path:** `/tenants/{tenantId}/smsOutboundRequests/{requestId}`

**Schema:**
```typescript
interface SmsOutboundRequest {
  id?: string;
  tenantId: string;
  threadId?: string;
  toPhoneE164: string;
  fromPhoneE164?: string;
  fromMessagingServiceSid?: string;
  body: string;
  bodyRaw?: string;
  templateId?: string;
  source: 'manual' | 'automation' | 'ai_sent';
  requestedByUid?: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'canceled';
  attemptCount: number;
  lastError?: { code?: string; message: string; timestamp?: Timestamp };
  createdAt: Timestamp;
  scheduledFor?: Timestamp;
  idempotencyKey: string;
  metadata?: { dealId?, companyId?, contactId?, campaignId?, applicationId?, assignmentId?, locationId? };
  twilioMessageSid?: string;
  sentAt?: Timestamp;
}
```

### 2. Idempotency Key Generation

**Function:** `generateIdempotencyKey()`
- Uses SHA-256 hash of: `tenantId|threadId|toPhoneE164|body|scheduledForRounded|requestedByUid`
- Prevents duplicate sends from retries or double-clicks
- Checks existing requests before creating new ones

### 3. Firestore Trigger: `enqueueSmsOutbound`

**File:** `functions/src/messaging/smsOutboundQueue.ts`

**Trigger:** `onDocumentCreated('tenants/{tenantId}/smsOutboundRequests/{requestId}')`

**Behavior:**
- Enqueues Cloud Task when request status is 'queued'
- Calculates delay if `scheduledFor` is in the future
- Configures retry policy:
  - `maxAttempts: 10`
  - `minBackoff: 30s`
  - `maxBackoff: 1h`
  - `maxDoublings: 5`

### 4. Cloud Task Worker: `processSmsOutbound`

**Endpoint:** `POST /processSmsOutbound`

**Process Flow:**
1. Load request doc
2. Hard stop if status not 'queued' (idempotent)
3. Mark status='sending' (transaction to prevent double-processing)
4. **Enforce compliance:**
   - Check STOP list / suppression
   - Check tenant-scoped consent
   - Check quiet hours (stub for future)
5. **Apply footer injection:**
   - Appends "Reply STOP to opt out." if not already present
   - Handles message length limits
6. Send via Twilio provider
7. **Write side effects (transaction):**
   - Create message in thread (if threadId exists)
   - Update thread rollups (lastMessageAt, lastOutboundAt, lastMessageSnippet)
   - Update request status='sent', store twilioSid
   - Write to messageLogs
8. **Error handling:**
   - Retryable errors: Reset to 'queued', throw to trigger Cloud Tasks retry
   - Non-retryable errors: Mark as 'failed', don't retry

### 5. Updated Functions

**`sendOutboundMessage()` in `twoWayMessaging.ts`:**
- Now creates outbound request instead of direct Twilio call
- Returns `{ requestId, success }` instead of `{ messageId, twilioMessageId, success }`
- Uses normalized participant fields when available

**`sendThreadMessageApi()` in `threadsApi.ts`:**
- Updated to handle async queue response
- Returns `requestId` so client can track status
- Message appears in thread when queue worker processes it

### 6. Security Rules

**Added to `firestore.rules`:**
- `smsOutboundRequests` collection:
  - Read: Internal users (security level >= 5)
  - Create: Internal users (status must be 'queued')
  - Update: Only backend (Cloud Tasks worker uses Admin SDK)
  - Delete: Only admins

---

## Compliance Enforcement

All compliance checks happen in the queue worker (single enforcement point):

1. **STOP List Check:**
   - Checks `user.smsBlockedSystem === true`
   - Checks `tenantConsent.smsBlockedSystem === true`
   - Blocks send if user has opted out

2. **Consent Check:**
   - Checks `tenantConsent.smsOptIn === false`
   - Blocks send if user has not consented

3. **Footer Injection:**
   - Appends "Reply STOP to opt out." to all transactional messages
   - Checks if footer already exists to avoid duplication
   - Handles message length limits (160 chars per segment)

4. **Quiet Hours:**
   - Stub implemented (can be enabled later)
   - Would check local time and block sends outside allowed hours

---

## Retry Logic

**Retryable Errors:**
- Network failures
- Twilio rate limits (429)
- Temporary service unavailability (5xx)

**Non-Retryable Errors:**
- `SMS_BLOCKED` - User has opted out
- `SMS_NOT_CONSENTED` - User has not consented
- `INVALID_PHONE_NUMBER` - Bad phone format
- `TWILIO_CONFIG_MISSING` - Configuration error

**Retry Configuration:**
- Max 10 attempts
- Exponential backoff: 30s → 1h
- Max doublings: 5

---

## Observability

**Structured Logging:**
- Request creation: `Created outbound SMS request {requestId}`
- Task enqueue: `Enqueued Cloud Task for SMS outbound request {requestId}`
- Worker processing: `Processing SMS outbound request {requestId}`
- Success: `Successfully processed SMS outbound request {requestId} in {durationMs}ms`
- Errors: Full error context with tenantId, requestId, duration

**Message Logs:**
- All sends logged to `/tenants/{tenantId}/messageLogs/{logId}`
- Includes providerMessageId, status, failureReason

---

## Migration Notes

**Breaking Changes:**
- `sendOutboundMessage()` return type changed from `{ messageId, twilioMessageId, success }` to `{ requestId, success }`
- Messages are created asynchronously (appear when queue worker processes)

**Backward Compatibility:**
- Legacy fields still populated in threads (`candidateUserId`, `candidatePhone`)
- Existing code using `sendOutboundMessage()` will need to handle async response

**Client Updates Needed:**
- UI should show "Sending..." status while request is queued
- Use Firestore real-time listeners to see when message appears in thread
- Can track request status via `smsOutboundRequests` collection

---

## Next Steps

1. **Create Cloud Tasks Queue:**
   ```bash
   gcloud tasks queues create sms-outbound --location=us-central1
   ```

2. **Deploy Functions:**
   - `enqueueSmsOutbound` (Firestore trigger)
   - `processSmsOutbound` (HTTP endpoint)

3. **Update UI:**
   - Show "Sending..." status
   - Use real-time listeners for message updates
   - Handle requestId in response

4. **Future Enhancements:**
   - Quiet hours enforcement
   - Per-tenant rate limiting
   - Queue monitoring dashboard
   - Bulk send optimization

---

## Files Modified

1. `functions/src/messaging/smsOutboundQueue.ts` - **NEW** - Queue system
2. `functions/src/messaging/twoWayMessaging.ts` - Updated to use queue
3. `functions/src/messaging/threadsApi.ts` - Updated to handle async response
4. `functions/src/index.ts` - Added exports
5. `firestore.rules` - Added security rules for `smsOutboundRequests`
6. `functions/src/utils/taskQueue.ts` - Fixed missing PROJECT check

---

**Implementation Complete** ✅
