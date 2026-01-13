# SMS Queue Smoke Test Guide
**Date:** 2025-01-27

---

## ✅ Test A: Queue Infrastructure - COMPLETE

**Status:** ✅ Queue created and verified

**Queue Details:**
- **Name:** `sms-outbound`
- **Location:** `us-central1`
- **URL:** https://console.cloud.google.com/cloudtasks/queue/us-central1/sms-outbound

**Verification:**
```bash
gcloud tasks queues describe sms-outbound --location=us-central1
```

---

## Test B: Manual Send → End-to-End

### Prerequisites
- Functions deployed (`enqueueSmsOutbound` trigger + `processSmsOutbound` worker)
- A test phone number you control
- A test tenant ID and user ID

### Steps

1. **Create a test thread** (if needed):
   ```javascript
   // In Firebase Console or via function
   // Use findOrCreateThread() or create manually
   ```

2. **Create outbound request** via Firestore Console:
   - Collection: `tenants/{tenantId}/smsOutboundRequests`
   - Document ID: (auto-generated)
   - Fields:
     ```json
     {
       "tenantId": "your-tenant-id",
       "threadId": "your-thread-id", // optional
       "toPhoneE164": "+1234567890",
       "body": "Test end-to-end message",
       "source": "manual",
       "requestedByUid": "your-user-id",
       "status": "queued",
       "attemptCount": 0,
       "createdAt": [server timestamp],
       "idempotencyKey": "will-be-generated-by-function"
     }
     ```

3. **Watch for Cloud Task** (within 2-5 seconds):
   - Check Cloud Tasks Console: https://console.cloud.google.com/cloudtasks
   - Queue: `sms-outbound`
   - Should see task appear

4. **Monitor request status**:
   - Check `smsOutboundRequests/{requestId}` doc
   - Status should change: `queued` → `sending` → `sent`
   - Should have `twilioMessageSid` populated

5. **Verify message created**:
   - Check `smsThreads/{threadId}/messages/{messageId}`
   - Should have message with `providerMessageId` matching `twilioMessageSid`

6. **Verify thread updated**:
   - Check `smsThreads/{threadId}`
   - `lastMessageAt` should be updated
   - `lastOutboundAt` should be set
   - `lastMessageSnippet` should contain message preview

7. **Verify message log**:
   - Check `tenants/{tenantId}/messageLogs/{logId}`
   - Should have entry with `providerMessageId` and `status: 'sent'`

### Pass Criteria
- ✅ Request doc created with status='queued'
- ✅ Cloud Task appears in queue
- ✅ Request status becomes 'sending' then 'sent'
- ✅ Message appears in thread messages subcollection
- ✅ Thread rollups updated
- ✅ Message log entry created
- ✅ Exactly one SMS delivered to phone

---

## Test C: Idempotency (Double-Click Prevention)

### Steps

1. **Create first request** (same as Test B)

2. **Immediately create second request** with identical:
   - `tenantId`
   - `threadId` (if used)
   - `toPhoneE164`
   - `body`
   - `requestedByUid` (if used)

3. **Check results**:
   - Both requests should have **same `idempotencyKey`**
   - `createOutboundRequest()` should return **same request ID** for both
   - OR second request should be prevented at create time

4. **Verify only one send**:
   - Check Cloud Tasks queue - should only see one task
   - Check Twilio logs - should only see one message sent
   - Check thread messages - should only have one message doc

### Pass Criteria
- ✅ Same idempotency key generated
- ✅ Only one Cloud Task created
- ✅ Only one Twilio send occurs
- ✅ Only one message doc created

---

## Test D: STOP / Consent Enforcement

### Prerequisites
- A user who has sent STOP (or has `smsBlockedSystem: true`)

### Steps

1. **Set up blocked user**:
   ```javascript
   // In Firestore Console
   // Collection: users/{userId}
   // Update:
   {
     "smsBlockedSystem": true,
     "smsOptIn": false
   }
   
   // OR in tenant consent:
   // Collection: tenants/{tenantId}/smsConsents/{userId}
   {
     "smsBlockedSystem": true,
     "smsOptIn": false
   }
   ```

2. **Create outbound request** for blocked user's phone:
   - Same as Test B, but use blocked user's phone

3. **Monitor request**:
   - Status should become `sending` then `failed`
   - `lastError.code` should be `SMS_BLOCKED` or `SMS_NOT_CONSENTED`
   - `lastError.message` should explain the block

4. **Verify no send**:
   - Check Cloud Tasks - task should complete (not retry)
   - Check Twilio logs - **no message should be sent**
   - Check thread - **no message should be created**

### Pass Criteria
- ✅ Request fails with clear error code (`SMS_BLOCKED` or `SMS_NOT_CONSENTED`)
- ✅ Status is `failed` (not retrying)
- ✅ No Twilio send occurs
- ✅ No message doc created
- ✅ Error message is clear and actionable

---

## Test E: Retry Logic

### Prerequisites
- Temporarily break Twilio config (wrong credentials) OR
- Simulate retryable error in provider

### Steps

1. **Break Twilio config** (temporarily):
   ```bash
   # In Firebase Console, temporarily set wrong secret
   # OR comment out credentials in code
   ```

2. **Create outbound request** (same as Test B)

3. **Monitor retries**:
   - Check Cloud Tasks Console
   - Should see multiple attempts
   - `attemptCount` in request doc should increment
   - Each retry should have exponential backoff delay

4. **Fix config and verify**:
   - Restore correct credentials
   - Request should eventually succeed
   - OR after max attempts (10), should fail permanently

### Pass Criteria
- ✅ Multiple attempts visible in Cloud Tasks
- ✅ `attemptCount` increments
- ✅ Retries have increasing delays (exponential backoff)
- ✅ Eventually succeeds when fixed, or fails after max attempts

---

## Test F: Scheduled Send

### Steps

1. **Create scheduled request**:
   ```javascript
   // In Firestore Console
   // Collection: tenants/{tenantId}/smsOutboundRequests
   {
     "tenantId": "your-tenant-id",
     "toPhoneE164": "+1234567890",
     "body": "Scheduled test message",
     "source": "automation",
     "status": "queued",
     "scheduledFor": [timestamp 2 minutes in future],
     "attemptCount": 0,
     "createdAt": [server timestamp],
     "idempotencyKey": "will-be-generated"
   }
   ```

2. **Verify immediate behavior**:
   - Cloud Task should be created
   - Task should have `scheduleTime` set to future
   - Request status should remain `queued`

3. **Wait for scheduled time**:
   - Monitor Cloud Tasks - task should execute at scheduled time
   - Request should process and send

4. **Verify timing**:
   - Message should **not** send early
   - Message should send **around** scheduled time (±30 seconds acceptable)

### Pass Criteria
- ✅ Cloud Task created with future `scheduleTime`
- ✅ Request does not send early
- ✅ Message sends at scheduled time (±30s acceptable)

---

## Quick Test Script

You can also use the test functions in `functions/src/messaging/testSmsQueue.ts`:

```typescript
import { runAllTests } from './messaging/testSmsQueue';

await runAllTests({
  tenantId: 'your-tenant-id',
  testPhone: '+1234567890',
  threadId: 'your-thread-id', // optional
  recruiterId: 'your-user-id', // optional
  blockedUserId: 'blocked-user-id', // optional
});
```

---

## Monitoring & Debugging

### Cloud Tasks Console
- URL: https://console.cloud.google.com/cloudtasks/queue/us-central1/sms-outbound
- View: Task list, execution history, retry attempts

### Firestore Console
- Monitor: `tenants/{tenantId}/smsOutboundRequests`
- Filter by: `status`, `createdAt`, `source`

### Cloud Functions Logs
```bash
gcloud functions logs read processSmsOutbound --limit=50
gcloud functions logs read enqueueSmsOutbound --limit=50
```

### Key Log Messages
- `Created outbound SMS request {requestId}`
- `Enqueued Cloud Task for SMS outbound request {requestId}`
- `Processing SMS outbound request {requestId}`
- `Successfully processed SMS outbound request {requestId} in {durationMs}ms`
- `Compliance check failed for request {requestId}: {reason}`

---

## Common Issues & Fixes

### Issue: Cloud Task not created
- **Check:** Firestore trigger deployed?
- **Check:** Queue permissions (Cloud Functions service account needs `cloudtasks.tasks.create`)
- **Fix:** Deploy functions, check IAM roles

### Issue: Worker not processing
- **Check:** `processSmsOutbound` function deployed?
- **Check:** Function URL accessible?
- **Fix:** Deploy function, check Cloud Tasks queue configuration

### Issue: Request stuck in 'queued'
- **Check:** Cloud Task created?
- **Check:** Worker function logs for errors
- **Fix:** Check function deployment, verify queue configuration

### Issue: Duplicate sends
- **Check:** Idempotency key generation
- **Check:** Request creation logic
- **Fix:** Verify `generateIdempotencyKey()` includes all relevant fields

---

## Next Steps After Tests Pass

Once all smoke tests pass:
1. ✅ Queue infrastructure verified
2. ✅ End-to-end flow working
3. ✅ Idempotency preventing duplicates
4. ✅ STOP enforcement blocking sends
5. ✅ Retry logic working
6. ✅ Scheduled sends working

Then proceed with **Inbox UI enhancements** (Phase 1-3 as outlined in spec).
