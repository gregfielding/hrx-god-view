# SMS Queue System - Ready for Testing ✅
**Date:** 2025-01-27  
**Status:** Infrastructure Complete, Ready for Smoke Tests

---

## ✅ What's Been Completed

### 1. Queue Infrastructure
- ✅ Cloud Tasks queue created: `sms-outbound` in `us-central1`
- ✅ Queue state: `RUNNING`
- ✅ Full path: `projects/hrx1-d3beb/locations/us-central1/queues/sms-outbound`

### 2. Core Functions
- ✅ `enqueueSmsOutbound` - Firestore trigger (auto-enqueues on request creation)
- ✅ `processSmsOutbound` - HTTP worker endpoint (processes sends)
- ✅ `createOutboundRequest()` - Helper function (creates requests with idempotency)

### 3. Test Functions
- ✅ `testCreateOutboundRequest` - Callable (creates test requests)
- ✅ `testCheckRequestStatus` - Callable (checks request status)
- ✅ `testIdempotency` - Callable (tests duplicate prevention)

### 4. Security
- ✅ Firestore rules for `smsOutboundRequests` collection
- ✅ Only internal users can create, only backend can update

### 5. Compliance Enforcement
- ✅ STOP list checking
- ✅ Consent checking
- ✅ Footer injection
- ✅ Quiet hours stub (ready for implementation)

### 6. Retry Logic
- ✅ Exponential backoff (30s → 1h)
- ✅ Max 10 attempts
- ✅ Retryable vs non-retryable error handling

---

## 🚀 Next Step: Deploy Functions

```bash
cd functions
npm run deploy
```

This will deploy:
- `enqueueSmsOutbound` (Firestore trigger)
- `processSmsOutbound` (HTTP worker)
- `testCreateOutboundRequest` (Callable)
- `testCheckRequestStatus` (Callable)
- `testIdempotency` (Callable)

---

## 🧪 Test Execution Plan

### Quick Start: Test B (End-to-End)

**Option 1: Via Callable Function (Easiest)**

```javascript
// In your frontend or Firebase CLI
import { httpsCallable } from 'firebase/functions';

const testCreate = httpsCallable(functions, 'testCreateOutboundRequest');
const result = await testCreate({
  tenantId: 'your-tenant-id',
  toPhoneE164: '+1234567890',
  body: 'Test message',
  threadId: 'optional-thread-id', // if you have one
});

console.log('Request ID:', result.data.requestId);

// Check status
const testCheck = httpsCallable(functions, 'testCheckRequestStatus');
const status = await testCheck({
  tenantId: 'your-tenant-id',
  requestId: result.data.requestId,
});

console.log('Status:', status.data.request.status);
```

**Option 2: Via Firestore Console**

1. Go to: https://console.firebase.google.com/project/hrx1-d3beb/firestore
2. Navigate to: `tenants/{tenantId}/smsOutboundRequests`
3. Click "Add document"
4. Add fields:
   ```json
   {
     "tenantId": "your-tenant-id",
     "toPhoneE164": "+1234567890",
     "body": "Test message",
     "source": "manual",
     "status": "queued",
     "attemptCount": 0,
     "createdAt": [server timestamp]
   }
   ```
5. Watch for Cloud Task to appear (2-5 seconds)
6. Monitor request status changes

---

## 📊 Test Checklist

### Test A: Queue Infrastructure ✅
- [x] Queue created
- [x] Queue verified
- [ ] Functions deployed (run `npm run deploy`)
- [ ] Verify Cloud Tasks can invoke worker

### Test B: End-to-End Send
- [ ] Create test request
- [ ] Verify Cloud Task appears
- [ ] Verify request processes: `queued` → `sending` → `sent`
- [ ] Verify message appears in thread
- [ ] Verify thread rollups updated
- [ ] Verify SMS received

### Test C: Idempotency
- [ ] Create duplicate request
- [ ] Verify same idempotency key
- [ ] Verify only one send occurs

### Test D: STOP Enforcement
- [ ] Set up blocked user
- [ ] Create request for blocked user
- [ ] Verify request fails with `SMS_BLOCKED`
- [ ] Verify no send occurs

### Test E: Retry Logic
- [ ] Simulate error
- [ ] Verify retries occur
- [ ] Verify exponential backoff

### Test F: Scheduled Send
- [ ] Create scheduled request
- [ ] Verify sends at correct time

---

## 🔍 Monitoring

### Cloud Tasks Console
https://console.cloud.google.com/cloudtasks/queue/us-central1/sms-outbound

### Firestore Console
https://console.firebase.google.com/project/hrx1-d3beb/firestore

### Cloud Functions Logs
```bash
# Worker logs
gcloud functions logs read processSmsOutbound --limit=50

# Trigger logs
gcloud functions logs read enqueueSmsOutbound --limit=50
```

---

## 📝 Key URLs & Endpoints

- **Queue:** `projects/hrx1-d3beb/locations/us-central1/queues/sms-outbound`
- **Worker URL:** `https://us-central1-hrx1-d3beb.cloudfunctions.net/processSmsOutbound`
- **Cloud Tasks Console:** https://console.cloud.google.com/cloudtasks/queue/us-central1/sms-outbound
- **Firestore Console:** https://console.firebase.google.com/project/hrx1-d3beb/firestore

---

## ⚠️ Important Notes

1. **Worker URL Format:** The worker URL uses the format `https://{LOCATION}-{PROJECT}.cloudfunctions.net/{FUNCTION_NAME}` which is correct for v2 functions.

2. **Idempotency:** The `createOutboundRequest()` function automatically generates idempotency keys. If you manually create requests in Firestore, you'll need to calculate the key yourself (or use the callable function).

3. **Permissions:** Ensure the Cloud Functions service account has `cloudtasks.tasks.create` permission. This is usually granted automatically, but verify if tasks aren't being created.

4. **Testing STOP:** You'll need a user with `smsBlockedSystem: true` or `smsOptIn: false` to test STOP enforcement.

---

## 🎯 Success Criteria

All tests pass when:
- ✅ Requests are created and enqueued automatically
- ✅ Messages are sent via Twilio
- ✅ Messages appear in threads
- ✅ Duplicate requests are prevented
- ✅ STOP enforcement blocks sends
- ✅ Retries work correctly
- ✅ Scheduled sends work

---

**Ready to test!** Deploy functions and start with Test B (End-to-End Send).
