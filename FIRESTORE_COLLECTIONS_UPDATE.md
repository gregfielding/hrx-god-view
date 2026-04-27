# Firestore Collections Update Summary

**Date:** 2025-01-27  
**Status:** ✅ Complete  
**Spec:** HRX One Firestore Messaging Collections v1.0

---

## ✅ Updated Collection Paths

All messaging collections have been updated to match the Firestore Collections spec:

### 1. SMS Threads
**Before:** `/smsThreads/{threadId}`  
**After:** `/tenants/{tenantId}/smsThreads/{threadId}`

**Changes:**
- Updated `findOrCreateThread()` to use tenant-scoped path
- Updated all thread queries to use tenant path
- Updated message creation to use tenant path
- Updated field names: `candidateId` → `candidateUserId`, `primaryRecruiterId` → `primaryRecruiterUserId`

### 2. Message Logs
**Before:** `/messageLogs/{logId}`  
**After:** `/tenants/{tenantId}/messageLogs/{logId}`

**Changes:**
- Updated `logMessage()` to use tenant-scoped path
- Updated `updateMessageLogStatus()` to find tenant from log
- Updated `getUserMessageLogs()` and `getTenantMessageLogs()` to use tenant path
- Updated field names: `body` → `contentSent`, `bodyOriginal` → `contentOriginal`

### 3. Templates
**Current:** `/tenants/{tenantId}/messageTemplates/{templateId}` ✅  
**Note:** Spec also supports `/system/messageTemplates/{templateId}` for global defaults (to be implemented)

### 4. Message Types
**Current:** `/tenants/{tenantId}/messageTypes/{messageTypeId}`  
**Note:** Spec recommends `/system/messageTypes/{messageTypeId}` for global defaults (to be implemented)

---

## 📋 Field Name Updates

### SmsThread Interface
- ✅ `candidateId` → `candidateUserId`
- ✅ `primaryRecruiterId` → `primaryRecruiterUserId`
- ✅ Added `lastMessageSnippet` (from spec)
- ✅ `unreadCount` → `unreadCountForRecruiter` (simplified from object)

### SmsMessage Interface
- ✅ Added `tenantId` field (required even though path encodes it)
- ✅ Added `failureReason` (from spec)
- ✅ Removed `deliveredAt`, `readAt` (not in spec)

### MessageLog Interface
- ✅ `body` → `contentSent`
- ✅ `bodyOriginal` → `contentOriginal`
- ✅ Added `fromUserId` (from spec)
- ✅ Removed `routingDecision`, `deliveryResults`, `context` (simplified per spec)

---

## 🔧 Implementation Details

### Collection Path Helpers

All functions now use tenant-scoped paths:
```typescript
// Threads
db.collection('tenants').doc(tenantId).collection('smsThreads')

// Messages (nested under threads)
db.collection('tenants').doc(tenantId)
  .collection('smsThreads').doc(threadId)
  .collection('messages')

// Message Logs
db.collection('tenants').doc(tenantId).collection('messageLogs')

// Templates
db.collection('tenants').doc(tenantId).collection('messageTemplates')
```

### Finding Tenant from Document

When only document ID is known, use `collectionGroup`:
```typescript
const threadQuery = await db
  .collectionGroup('smsThreads')
  .where(admin.firestore.FieldPath.documentId(), '==', threadId)
  .limit(1)
  .get();

const tenantId = threadData.tenantId || threadDoc.ref.parent.parent?.id;
```

---

## ✅ Files Updated

1. `functions/src/messaging/twoWayMessaging.ts` - Thread and message paths
2. `functions/src/messaging/messageLogging.ts` - Message log paths
3. `functions/src/messaging/routingOrchestrator.ts` - Log message field names
4. `functions/src/messaging/stopHelpHandler.ts` - Log message field names
5. `functions/src/messaging/inboundSmsWebhook.ts` - Log message field names
6. `functions/src/messaging/threadsApi.ts` - Field name updates
7. `functions/src/messaging/aiAssistApi.ts` - Field name updates
8. `functions/src/messaging/adminApi.ts` - Field name mapping

---

## 🚀 Next Steps

1. **Global Templates** - Implement `/system/messageTemplates` for global defaults
2. **Global Message Types** - Move to `/system/messageTypes` for global defaults
3. **Consent Collections** - Implement `/tenants/{tenantId}/smsConsents/{userId}` structure
4. **Notification Settings** - Update to `/tenants/{tenantId}/notificationSettings/{userId}`
5. **Automation Runs** - Implement `/tenants/{tenantId}/automationRuns/{runId}`

---

## 📝 Notes

- All documents include `tenantId` field even though path encodes it (per spec requirement)
- Collection paths are now tenant-scoped for better isolation and security
- Field names match the spec exactly
- Backward compatibility: Old paths will need migration scripts if data exists

