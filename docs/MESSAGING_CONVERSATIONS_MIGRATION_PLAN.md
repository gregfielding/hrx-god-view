# HRX Messaging — Canonical Conversations Migration Plan (v1)

**Date:** 2026-02-16  
**Repo:** hrx-god-view  
**Spec:** HRX Messaging & Notifications — Cursor Build Spec (v1)

This document is the **file-by-file migration plan**, type definitions, hooks, function signatures, Firestore queries, and required indexes. It assumes the outcomes and north-star architecture from the build spec.

---

## Part 1 — Code path inventory

### 1.1 Root `threads` (read/write)

| Location | Operation | Path / query |
|----------|-----------|--------------|
| `src/hooks/useWorkerThreads.ts` | Read | `collection(db, 'threads')`; query: `where('participantUids', 'array-contains', uid).orderBy('lastMessageAt','desc').limit(50)` |
| `src/hooks/useWorkerThreads.ts` | Read | `collection(db, 'threads/{threadId}/messages')`; query: `orderBy('createdAt','asc').limit(200)` |
| `src/data/firestorePaths.ts` | Path helpers | `workerNotificationsPaths.threads()`, `.thread(threadId)`, `.threadMessages(threadId)`, `.threadMessage(threadId, messageId)` |
| `functions/src/messaging/unifiedWorkerNotifications.ts` | Read/Write | `THREADS = 'threads'`, `THREAD_MESSAGES(threadId)`; markWorkerThreadRead updates `threads/{threadId}` unreadCountByUid; sendWorkerThreadMessage writes to `threads/{threadId}/messages`, updates thread rollups |
| `src/pages/c1/workers/inbox.tsx` | Uses hooks | useWorkerThreads(uid), useWorkerThreadMessages(threadId); markThreadReadCallable, sendWorkerThreadMessageCallable |
| `src/api/workerNotificationsApi.ts` | Callables | markThreadReadCallable, sendWorkerThreadMessageCallable (no direct path; callables use server paths above) |

**Summary:** Worker inbox is the only consumer of root `threads`. All writes go through callables. No other code writes to root `threads`.

### 1.2 `tenants/{tid}/smsThreads` (read/write)

| Location | Operation | Path / query |
|----------|-----------|--------------|
| `functions/src/messaging/twoWayMessaging.ts` | Read/Write | findOrCreateThread: query smsThreads by candidateUserId, twilioNumber, status; add new thread; createInboundMessage: add to smsThreads/{threadId}/messages; sendOutboundMessage: collectionGroup('smsThreads') by documentId to load thread; getOrCreateThreadForUser |
| `functions/src/messaging/inboundSmsWebhook.ts` | Read | collectionGroup('smsThreads').where('candidatePhone','==',From).where('twilioNumber','==',To).where('status','==','open').orderBy('lastOutboundAt','desc').limit(1) |
| `functions/src/messaging/inboundSmsWebhook.ts` | Write | Via findOrCreateThread + createInboundMessage (twoWayMessaging) |
| `functions/src/messaging/smsOutboundQueue.ts` | Write | processSmsOutbound: write message to smsThreads/{threadId}/messages, update thread lastMessageAt/lastOutboundAt/lastMessageSnippet |
| `functions/src/messaging/threadsApi.ts` | Read/Write | listThreadsApi: query tenants/{tid}/smsThreads orderBy lastMessageAt desc; getThreadApi: get thread + messages; sendThreadMessageApi → sendOutboundMessage; createThreadApi → findOrCreateThread + createOutboundRequest |
| `functions/src/messaging/webhooksApi.ts` | Read/Write | twilioStatusCallback: find messageLog then scan tenants/{tid}/smsThreads/{threadId}/messages by providerMessageId, update status |
| `functions/src/messaging/aiAssistApi.ts` | Read | Get thread + messages for AI context (tenant smsThreads) |
| `src/pages/TextMessagesPage.tsx` | Read | collection(db, 'tenants', tenantId, 'smsThreads') onSnapshot orderBy lastMessageAt; useSmsThreadMessages(tenantId, threadId) → tenants/.../smsThreads/{threadId}/messages |
| `src/hooks/useSmsThreadMessages.ts` | Read | collection(db, 'tenants', tenantId, 'smsThreads', threadId, 'messages') orderBy createdAt asc |
| `src/pages/UserInboxPage.tsx` | Read | Similar SMS thread list (if used) |
| `src/pages/UserProfile/components/MessagesTab.tsx` | Read | collection(db, 'tenants', effectiveTenantId, 'smsThreads') |

### 1.3 Functions that create notifications / push

| Function | File | Where it writes |
|----------|------|-----------------|
| sendNotificationAndPush | unifiedWorkerNotifications.ts | users/{uid}/notifications, then FCM to users/{uid}/pushTokens |
| onApplicationCreatedPush | triggers/onApplicationCreatedPush.ts | Calls sendNotificationAndPush |
| onAssignmentUpdatedPush | triggers/onAssignmentUpdatedPush.ts | Calls sendNotificationAndPush |
| routingOrchestrator.sendMessage | routingOrchestrator.ts | Can call sendNotificationAndPush for push channel; creates messageLogs, smsOutboundRequests |

---

## Part 2 — New TypeScript types

**New file:** `src/types/conversations.ts`

```ts
import type { Timestamp } from 'firebase/firestore';

export type ConversationType = 'recruiter' | 'support' | 'system' | 'broadcast_response';
export type ConversationStatus = 'open' | 'closed' | 'pending_worker' | 'pending_internal';
export type ParticipantRole = 'worker' | 'recruiter' | 'admin' | 'ai' | 'system';
export type MessageChannel = 'in_app' | 'sms' | 'email' | 'push';
export type MessageVisibility = 'participants' | 'internal_only';

export interface ConversationParticipant {
  uid: string;
  role: ParticipantRole;
  displayName?: string;
}

export interface ConversationTopic {
  entityType: 'application' | 'assignment' | 'support' | 'general';
  entityId?: string;
  label?: string;
}

export interface ChannelEndpoints {
  sms?: {
    workerPhoneE164: string;
    twilioNumberE164: string;
  };
  email?: {
    workerEmail: string;
    fromAddress?: string;
  };
}

export interface Conversation {
  tenantId: string;
  type: ConversationType;
  status: ConversationStatus;
  participantUids: string[];
  participants: ConversationParticipant[];
  assignedToUid: string | null;
  topic?: ConversationTopic;
  lastMessageAt: Timestamp;
  lastMessagePreview: string;
  unreadByUid: Record<string, number>;
  createdAt: Timestamp;
  createdByUid: string | 'system';
  channelEndpoints?: ChannelEndpoints;
}

export interface MessageSender {
  uid?: string;
  role: ParticipantRole;
}

export interface MessageBody {
  text: string;
  html?: string;
}

export interface MessageProvider {
  name: 'twilio' | 'fcm' | 'sendgrid' | 'gmail';
  messageId?: string;
  status?: string;
  errorCode?: string;
  deliveredAt?: Timestamp;
}

export interface ConversationMessage {
  tenantId: string;
  conversationId: string;
  createdAt: Timestamp;
  sender: MessageSender;
  body: MessageBody;
  channel: MessageChannel;
  direction?: 'inbound' | 'outbound';
  visibility: MessageVisibility;
  provider?: MessageProvider;
}
```

---

## Part 3 — Firestore path helpers

**File:** `src/data/firestorePaths.ts`

**Add** (and keep existing `workerNotificationsPaths` for Phase 0 compatibility; later deprecate root thread paths):

```ts
/**
 * Canonical conversations (tenant-scoped).
 * Use for new inbox and unified SMS/in-app.
 */
export const conversationPaths = {
  conversations: (tid: string) => `tenants/${tid}/conversations`,
  conversation: (tid: string, cid: string) => `tenants/${tid}/conversations/${cid}`,
  messages: (tid: string, cid: string) => `tenants/${tid}/conversations/${cid}/messages`,
  message: (tid: string, cid: string, mid: string) => `tenants/${tid}/conversations/${cid}/messages/${mid}`,
};
```

**Phase 0 (stabilize):** Fix push token naming in same file:

- Add or rename to: `userPushTokens: (uid: string) => \`users/${uid}/pushTokens\``, `userPushToken: (uid: string, tokenId: string) => \`users/${uid}/pushTokens/${tokenId}\``.
- Keep `userDeviceTokens` as deprecated alias pointing to same path if any legacy code still references it, or remove and grep-replace to `userPushTokens`.

---

## Part 4 — Required Firestore indexes

Create via `firestore.indexes.json` or Firebase Console:

1. **Conversations list (worker + admin)**  
   Collection: `tenants/{tenantId}/conversations`  
   Fields: `participantUids` (Array-contains), `lastMessageAt` (Descending)  
   Query scope: Collection

2. **Admin work queue — assigned to me**  
   Collection: `tenants/{tenantId}/conversations`  
   Fields: `assignedToUid` (Ascending), `lastMessageAt` (Descending)  
   Query scope: Collection

3. **Admin work queue — unassigned**  
   Collection: `tenants/{tenantId}/conversations`  
   Fields: `assignedToUid` (Ascending), `lastMessageAt` (Descending)  
   (Same as above; null is a valid value.)

4. **SMS inbound lookup**  
   Collection: `tenants/{tenantId}/conversations`  
   Fields:  
   - `channelEndpoints.sms.workerPhoneE164` (Ascending)  
   - `channelEndpoints.sms.twilioNumberE164` (Ascending)  
   - `status` (Ascending)  
   - `lastMessageAt` (Descending)  
   Query scope: Collection

5. **Conversation messages** (if not single-field)  
   Collection: `tenants/{tenantId}/conversations/{conversationId}/messages`  
   Fields: `createdAt` (Ascending)  
   (Often auto-created; list if needed.)

---

## Part 5 — Cloud Functions: new module and APIs

### 5.1 New module layout

**New directory:** `functions/src/messaging/conversations/`

| File | Purpose |
|------|--------|
| `conversationsModel.ts` | findOrCreateConversationForSms, appendConversationMessage, updateConversationRollups; pure Firestore + types, no HTTP |
| `conversationsApi.ts` | HTTP/callable: listConversationsForUser, getConversation, sendConversationMessage (callable) |

### 5.2 conversationsModel.ts — signatures and Firestore usage

```ts
// Types imported from a shared types file or duplicated for server
interface ConversationDoc { ... }  // per spec §3.1
interface MessageDoc { ... }       // per spec §3.2

/**
 * Find existing open conversation by SMS endpoints, or create one.
 * Used by inbound webhook and (later) outbound flow.
 */
export async function findOrCreateConversationForSms(params: {
  tenantId: string;
  workerUid: string;
  workerPhoneE164: string;
  twilioNumberE164: string;
  topic?: { entityType: string; entityId?: string; label?: string };
  assignedToUid?: string | null;
}): Promise<{ conversationId: string; created: boolean }> {
  const col = db.collection('tenants').doc(params.tenantId).collection('conversations');
  const query = col
    .where('channelEndpoints.sms.workerPhoneE164', '==', params.workerPhoneE164)
    .where('channelEndpoints.sms.twilioNumberE164', '==', params.twilioNumberE164)
    .where('status', '==', 'open')
    .orderBy('lastMessageAt', 'desc')
    .limit(1);
  const snap = await query.get();
  if (!snap.empty) {
    return { conversationId: snap.docs[0].id, created: false };
  }
  const ref = await col.add({
    tenantId: params.tenantId,
    type: 'recruiter',
    status: 'open',
    participantUids: [params.workerUid],
    participants: [{ uid: params.workerUid, role: 'worker' }],
    assignedToUid: params.assignedToUid ?? null,
    topic: params.topic,
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessagePreview: '',
    unreadByUid: {},
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: 'system',
    channelEndpoints: {
      sms: {
        workerPhoneE164: params.workerPhoneE164,
        twilioNumberE164: params.twilioNumberE164,
      },
    },
  });
  return { conversationId: ref.id, created: true };
}

/**
 * Append a message to a conversation and return messageId.
 */
export async function appendConversationMessage(params: {
  tenantId: string;
  conversationId: string;
  sender: { uid?: string; role: string };
  channel: 'in_app' | 'sms' | 'email' | 'push';
  body: { text: string; html?: string };
  visibility?: 'participants' | 'internal_only';
  direction?: 'inbound' | 'outbound';
  provider?: MessageProvider;
}): Promise<string> {
  const ref = db.collection('tenants').doc(params.tenantId)
    .collection('conversations').doc(params.conversationId)
    .collection('messages').doc();
  await ref.set({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    createdAt: FieldValue.serverTimestamp(),
    sender: params.sender,
    body: params.body,
    channel: params.channel,
    direction: params.direction,
    visibility: params.visibility ?? 'participants',
    provider: params.provider ?? null,
  });
  return ref.id;
}

/**
 * Update conversation rollups after a new message.
 */
export async function updateConversationRollups(params: {
  tenantId: string;
  conversationId: string;
  lastMessageAt: FieldValue | Timestamp;
  lastMessagePreview: string;
  unreadByUid: Record<string, number>;  // delta or full map
}): Promise<void> {
  const ref = db.collection('tenants').doc(params.tenantId)
    .collection('conversations').doc(params.conversationId);
  await ref.update({
    lastMessageAt: params.lastMessageAt,
    lastMessagePreview: params.lastMessagePreview,
    unreadByUid: params.unreadByUid,
  });
}
```

### 5.3 conversationsApi.ts — list, get, send

- **listConversationsForUser** (callable or HTTP):  
  - Auth: request.auth.uid required.  
  - Query: `tenants/{tenantId}/conversations` where `participantUids` array-contains `request.auth.uid`, orderBy `lastMessageAt` desc, limit 50.  
  - Return: array of conversation docs (with id).

- **getConversation** (callable or HTTP):  
  - Auth: user must be participant or internal.  
  - Read: `tenants/{tenantId}/conversations/{conversationId}` and subcollection messages orderBy createdAt asc.  
  - Return: conversation + messages.

- **sendConversationMessage** (callable):  
  - Auth: request.auth.uid; validate participant via conversation doc.  
  - Body: { tenantId, conversationId, body: { text }, channel: 'in_app' }.  
  - Server: appendConversationMessage (sender.uid = auth.uid, role = worker/recruiter from participants), updateConversationRollups, optionally trigger SMS/push from orchestrator.

Exact Firestore queries:

- List: `db.collection('tenants').doc(tenantId).collection('conversations').where('participantUids', 'array-contains', uid).orderBy('lastMessageAt', 'desc').limit(50)`.
- Messages: `db.collection('tenants').doc(tenantId).collection('conversations').doc(conversationId).collection('messages').orderBy('createdAt', 'asc').limit(200)`.

---

## Part 6 — Inbound SMS bridge (Phase 2)

**File:** `functions/src/messaging/inboundSmsWebhook.ts`

In `handleRegularInboundMessage`:

1. Keep existing logic: find/create smsThread, createInboundMessage (twoWayMessaging), logMessage, createAIDraft (so Text Messages page keeps working).
2. Add:
   - Call `findOrCreateConversationForSms({ tenantId, workerUid: candidateId, workerPhoneE164: fromPhoneE164, twilioNumberE164: toNumber, ... })`.
   - Call `appendConversationMessage({ tenantId, conversationId, sender: { uid: candidateId, role: 'worker' }, channel: 'sms', body: { text: messageBody }, direction: 'inbound', visibility: 'participants', provider: { name: 'twilio', messageId: messageSid } })`.
   - Call `updateConversationRollups` with lastMessagePreview = snippet, unreadByUid incremented for assignedToUid (or all internal participants if you have that list).
   - Optional: create a notification for assignedToUid (users/{assignedToUid}/notifications) “New message in conversation” with ctaUrl to admin inbox/conversation.

---

## Part 7 — Outbound bridge (Phase 3)

When recruiter sends from UI (sendThreadMessageApi or new sendConversationMessage):

1. Write canonical message first: `appendConversationMessage` with channel `in_app`, sender.uid = request.auth.uid, body = recruiter text.
2. If conversation has `channelEndpoints.sms` and worker is opted in: create smsOutboundRequest (existing queue) with same body; optionally store conversationId in request metadata so status callback can update canonical message.
3. On Twilio status callback: if you store conversationId/messageId in messageLog or request metadata, update the canonical message’s `provider` (status, deliveredAt) via Admin SDK.

Minimal change to existing flow: keep sendOutboundMessage(threadId, ...) for now but have it also accept an optional conversationId; when present, after creating smsThread message, also appendConversationMessage (or link existing message by providerMessageId when status comes back). Alternatively, Phase 3 can introduce a new “conversation-first” send path that writes conversation message then enqueues SMS.

---

## Part 8 — UI migration (Phase 4)

### 8.1 Worker

| Current | New |
|--------|-----|
| useWorkerThreads(uid) → root `threads` | useConversationsForUser(tenantId, uid) → `tenants/{tenantId}/conversations` where participantUids array-contains uid |
| useWorkerThreadMessages(threadId) → root `threads/{threadId}/messages` | useConversationMessages(tenantId, conversationId) → `tenants/{tenantId}/conversations/{id}/messages` |
| markThreadReadCallable(uid, threadId) | markConversationReadCallable(uid, tenantId, conversationId) — server updates unreadByUid |
| sendWorkerThreadMessageCallable({ threadId, ... }) | sendConversationMessage callable({ tenantId, conversationId, body }) |
| src/pages/c1/workers/inbox.tsx | Same page; swap hooks and API to conversation paths and callables. Use activeTenant.id for tenantId. |

**New hooks (file: `src/hooks/useConversations.ts`):**

```ts
export function useConversationsForUser(tenantId: string | undefined, uid: string | undefined, options?: { max?: number }) {
  // query: tenants/{tenantId}/conversations where participantUids array-contains uid, orderBy lastMessageAt desc, limit(options?.max ?? 50)
  // return { conversations, totalUnread, loading }
}

export function useConversationMessages(tenantId: string | undefined, conversationId: string | undefined) {
  // query: tenants/{tenantId}/conversations/{conversationId}/messages orderBy createdAt asc limit 200
  // return { messages, loading }
}
```

**New/updated API (file: `src/api/workerNotificationsApi.ts` or `src/api/conversationsApi.ts`):**

- markConversationReadCallable(uid, tenantId, conversationId)
- sendConversationMessageCallable({ tenantId, conversationId, body })

Worker inbox page: replace useWorkerThreads/useWorkerThreadMessages with useConversationsForUser/useConversationMessages; replace threadId in URL with conversationId (e.g. `/c1/workers/inbox/:conversationId`); use conversationPaths for any direct refs.

### 8.2 Admin

- **Option A:** New InboxPage that lists `tenants/{tenantId}/conversations` with filter (e.g. has channelEndpoints.sms, or assignedToUid == me).
- **Option B:** Retrofit TextMessagesPage to use conversations: list conversations where `channelEndpoints.sms` exists (or type recruiter + has sms), same messages subcollection. Send reply via sendConversationMessage (which writes in-app message and enqueues SMS).

Admin queries:

- “My SMS conversations”: `tenants/{tid}/conversations` where `channelEndpoints.sms` != null (or use a composite index), orderBy lastMessageAt desc.  
  Or: where assignedToUid == uid, orderBy lastMessageAt desc (work queue).
- Messages: same as worker — `tenants/{tid}/conversations/{cid}/messages` orderBy createdAt asc.

---

## Part 9 — Phase 0 (stabilize) checklist

1. **Token path:** In `src/data/firestorePaths.ts`, add `userPushTokens(uid)` and `userPushToken(uid, tokenId)` pointing to `users/{uid}/pushTokens`. Update any reference from deviceTokens to pushTokens (firebaseMessaging already uses pushTokens; paths file was wrong).
2. **sendThreadMessageApi auth:** In `functions/src/messaging/threadsApi.ts`, remove trust of recruiterId/fromUserId from body; use request.auth.uid; validate tenant membership / internal role before calling sendOutboundMessage.
3. **Worker inbox:** Do not add temporary rules for root threads. Proceed to Phase 1–4 and migrate worker inbox to conversations so root threads are no longer used.

---

## Part 10 — File-by-file change list

| File | Change |
|------|--------|
| `firestore.rules` | Add `match /conversations/{conversationId}` and `match /messages/{messageId}` inside existing `match /tenants/{tenantId}` (the block that contains smsThreads). |
| `src/data/firestorePaths.ts` | Add conversationPaths; add userPushTokens (and deprecate/rename userDeviceTokens). |
| `src/types/conversations.ts` | **New file** — types per §3.1 and §3.2. |
| `functions/src/messaging/conversations/conversationsModel.ts` | **New file** — findOrCreateConversationForSms, appendConversationMessage, updateConversationRollups. |
| `functions/src/messaging/conversations/conversationsApi.ts` | **New file** — listConversationsForUser, getConversation, sendConversationMessage (callable). |
| `functions/src/index.ts` | Export conversationsApi functions. |
| `functions/src/messaging/inboundSmsWebhook.ts` | In handleRegularInboundMessage: add conversation find/create + append message + rollups (keep smsThreads write). |
| `src/hooks/useConversations.ts` | **New file** — useConversationsForUser, useConversationMessages. |
| `src/api/conversationsApi.ts` | **New file** — markConversationReadCallable, sendConversationMessageCallable (or extend workerNotificationsApi). |
| `src/pages/c1/workers/inbox.tsx` | Switch to useConversationsForUser, useConversationMessages; conversationId in route; conversationPaths; new callables. |
| `functions/src/messaging/threadsApi.ts` | Harden auth: request.auth.uid, validate tenant/role. |
| `firestore.indexes.json` (or Console) | Add indexes from Part 4. |

Optional / later:

- `src/pages/TextMessagesPage.tsx`: Switch to conversations list + useConversationMessages; send via sendConversationMessage.
- `functions/src/messaging/unifiedWorkerNotifications.ts`: markWorkerThreadRead / sendWorkerThreadMessage can remain for backward compatibility during migration, or be replaced by conversation callables only.
- `functions/src/messaging/twoWayMessaging.ts` + `smsOutboundQueue.ts`: In Phase 3, optionally accept conversationId and write canonical message; status callback updates conversation message provider.

---

## Part 11 — Notifications integration

- Keep `users/{uid}/notifications` as alert-only.
- When appending a conversation message (inbound SMS or in-app), optionally create a notification for:
  - Recipients who are not currently viewing that conversation (e.g. assignedToUid when message is from worker).
  - Use existing sendNotificationAndPush; ctaUrl can point to `/c1/workers/inbox/{conversationId}` (worker) or admin inbox route (recruiter).

No schema change to notifications; only add call sites from conversation flow.
