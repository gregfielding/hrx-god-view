# HRX Messaging & Notifications — Conversations Migration (Exact Diffs)

**Date:** 2026-02-16  
**Repo:** hrx-god-view  
**Purpose:** Step-by-step, file-by-file patches to migrate from root `threads` + tenant `smsThreads` into canonical tenant-scoped `conversations`.

---

## 0) Guiding constraints (DO NOT VIOLATE)

- ✅ Canonical storage for inbox: `tenants/{tenantId}/conversations/{conversationId}/messages/{messageId}`
- ✅ Keep `users/{uid}/notifications` as alert-only (no replies).
- ✅ No temporary Firestore rules for root `/threads`.
- ✅ During bridge period: keep writing tenant `smsThreads` so existing admin SMS UI works.
- ✅ Auth hardening: never trust recruiterId/fromUserId from client body.

---

## 1) Phase 0 — Push token path naming (surgical, must-do)

### 1.1 `src/data/firestorePaths.ts`
**Change**
- Replace any `userDeviceTokens(uid)` or `deviceTokens` path with `userPushTokens(uid)` → `users/{uid}/pushTokens`.

**Patch**
- Add/ensure:
  - `workerNotificationsPaths.userPushTokens(uid)` (or top-level helper)
  - Deprecate/remove `userDeviceTokens`

**Search**
- `deviceTokens`
- `userDeviceTokens`

**Expected end state**
- Only one canonical token collection: `users/{uid}/pushTokens`

### 1.2 Any usage points
**Search & patch**
- `workerNotificationsPaths.userDeviceTokens`
- `users/${uid}/deviceTokens`
- Any mention in hooks/services

**Note:** Server-side code (unifiedWorkerNotifications.ts, routingOrchestrator.ts) already uses `PUSH_TOKENS(uid)` = `users/${uid}/pushTokens`; only the path helper in firestorePaths.ts is wrong. No client code currently imports `userDeviceTokens`; firebaseMessaging.ts hardcodes `users/{uid}/pushTokens`. So the only change needed is in firestorePaths.ts: add `userPushTokens`, deprecate or remove `userDeviceTokens`.

---

## 2) Phase 0 — Harden sendThreadMessageApi authentication (stop the bleeding)

### 2.1 `functions/src/messaging/threadsApi.ts`
**Goal**
- `sendThreadMessageApi` must:
  - Require `request.auth`
  - Derive sender UID from `request.auth.uid`
  - Validate tenant access
  - Reject body-provided `recruiterId` / `fromUserId`

**Patch instructions**
- At start of handler:
  - `if (!request.auth) return 401;`
  - `const senderUid = request.auth.uid;`
- Load the thread by `threadId` (or from query param)
- Compute `tenantId` from thread doc (NOT from request body)
- Validate:
  - `isHRX()` OR `isAssignedToTenant(tenantId)` AND `isInternal(tenantId)`
  - (or your existing internal checks)
- Call `sendOutboundMessage({ threadId, fromUid: senderUid, body })`
- Remove/ignore `recruiterId/fromUserId` from request body

**Also patch**
- `createThreadApi`, `getThreadApi`, `listThreadsApi`: ensure they require auth and enforce tenant/internal access.

---

## 3) Phase 1 — Canonical conversations paths and types (already added, verify wiring)

### 3.1 `src/types/conversations.ts`
**Verify**
- Exports:
  - `Conversation`, `ConversationMessage`
  - enums/unions for `ConversationType`, `ParticipantRole`, `ChannelEndpoints`
- Field names match spec and rules: `participantUids`, `assignedToUid`, `lastMessageAt`, etc.

**Action:** Create this file if it does not exist (see MESSAGING_CONVERSATIONS_MIGRATION_PLAN.md Part 2).

### 3.2 `src/data/firestorePaths.ts`
**Add/verify helpers**
- `conversationPaths.conversations(tenantId)`
- `conversationPaths.conversation(tenantId, conversationId)`
- `conversationPaths.messages(tenantId, conversationId)`
- `conversationPaths.message(tenantId, conversationId, messageId)`

**Action:** Add the `conversationPaths` object (see migration plan Part 3).

---

## 4) Phase 1 — New hooks (worker + admin use canonical)

> These should be new files so we can flip UI without breaking existing code.

### 4.1 Add: `src/hooks/useConversationsForUser.ts`
**Implement**
- Params: `{ tenantId: string, uid: string }`
- Query: `tenants/{tenantId}/conversations`
  - `where('participantUids', 'array-contains', uid)`
  - `orderBy('lastMessageAt', 'desc')`
  - `limit(50)` (or 100)

**Return**
- `{ conversations, loading, error }`

### 4.2 Add: `src/hooks/useConversationMessages.ts`
**Implement**
- Params: `{ tenantId: string, conversationId: string }`
- Query: `tenants/{tenantId}/conversations/{conversationId}/messages`
  - `orderBy('createdAt', 'asc')`
  - `limit(200)` (and later paginate)

**Return**
- `{ messages, loading, error }`

### 4.3 Add: `src/api/conversationsApi.ts`
**Implement callable wrappers**
- `listConversationsCallable` (optional if Firestore query is enough)
- `sendConversationMessageCallable` (recommended for rollups + unread consistency)
- `markConversationReadCallable` (recommended so workers don't write rollups)

---

## 5) Phase 1 — Worker Inbox UI switch (remove root threads)

### 5.1 `src/pages/c1/workers/inbox.tsx`
**Replace data sources**
- REMOVE:
  - `useWorkerThreads`
  - `useWorkerThreadMessages`
  - any Firestore reads from root `threads`
- ADD:
  - `useConversationsForUser({ tenantId: activeTenantId, uid })`
  - `useConversationMessages({ tenantId: activeTenantId, conversationId })`

**Routing**
- Change route param from `threadId` → `conversationId`
  - `/c1/workers/inbox/:conversationId`

**Send message**
- Use callable: `sendConversationMessageCallable({ tenantId, conversationId, text })`
  - Do NOT allow direct client write to messages if you want tighter control (rules currently allow participant create; callable is still better for rollups).

**Mark read**
- Use callable: `markConversationReadCallable({ tenantId, conversationId })`

### 5.2 App.tsx route
**Patch**
- Change route from `path="inbox/:threadId"` to `path="inbox/:conversationId"` (or keep param name as `conversationId` in useParams).

### 5.3 Remove/retire old worker inbox hooks
- `src/hooks/useWorkerThreads.ts`
- `src/hooks/useWorkerThreadMessages.ts`

**Note**
- Don't delete immediately; mark deprecated and stop importing first.

---

## 6) Phase 1 — Worker Notifications CTA update

### 6.1 `src/hooks/useWorkerNotifications.ts`
**If notifications contain a thread reference**
- Replace any logic that navigates to `/c1/workers/inbox/:threadId` with `/c1/workers/inbox/:conversationId`

**Migration note**
- During bridge, you may temporarily support both fields:
  - If `notification.conversationId` exists → use it
  - Else if `notification.threadId` exists → (legacy) either:
    - map threadId → conversationId via callable, OR
    - open legacy view (but prefer mapping)

---

## 7) Phase 2 — Cloud Functions: Conversations module (already added, wire it)

### 7.1 Ensure exports in `functions/src/index.ts`
**Export**
- conversations APIs (HTTP/callable):
  - `listConversationsForUser`
  - `getConversation`
  - `sendConversationMessage`
  - (optional) `markConversationRead`

### 7.2 `functions/src/messaging/conversations/conversationsModel.ts`
**Verify these functions exist and are used**
- `findOrCreateConversationForSms(...)`
- `appendConversationMessage(...)`
- `updateConversationRollups(...)`

**Action:** Create this module if it does not exist (see migration plan Part 5).

### 7.3 `functions/src/messaging/conversations/conversationsApi.ts`
**Verify**
- Callables/HTTP for list, get, send, markRead.

---

## 8) Phase 2 — Inbound SMS bridge (write both smsThreads + conversations)

### 8.1 `functions/src/messaging/inboundSmsWebhook.ts`
**In `handleRegularInboundMessage`**
Keep current behavior:
- find/create `smsThreads` thread
- create inbound smsThreads message

ADD canonical conversation write:
1) Determine tenantId + worker identity
   - Use the same resolution you already do for smsThreads
2) `const convo = await findOrCreateConversationForSms({ tenantId, workerUid, workerPhoneE164: From, twilioNumberE164: To, topic })`
3) `await appendConversationMessage({ tenantId, conversationId: convo.id, sender: { role: "worker", uid: workerUid }, channel: "sms", visibility: "participants", bodyText: Body, provider: { name: "twilio", messageId: MessageSid } })`
4) `await updateConversationRollups(...)` (if not inside append)

Optional but recommended:
- create an internal notification to assigned recruiter when inbound arrives:
  - `sendNotificationAndPush` for recruiter uid(s) OR create tenant-level badge counters.

---

## 9) Phase 3 — Outbound bridge (canonical-first, then route to SMS)

### 9.1 Recruiter/admin sending from UI
Where it currently sends:
- Admin TextMessagesPage → `sendThreadMessageApi` → `sendOutboundMessage` → queue → smsThreads message written

New behavior (bridge period):
1) When recruiter clicks send:
   - First call `sendConversationMessage` callable:
     - creates canonical message (channel `in_app`, sender recruiter uid)
     - updates rollups/unread counts
2) Then call orchestrator / outbound queue:
   - If worker opted in, send SMS
   - On success, write provider metadata back:
     - update canonical message `provider.messageId/status`

### 9.2 Where to implement provider metadata update
- In `processSmsOutbound` once Twilio returns SID:
  - Write the SID into canonical message doc if outbound request links to conversation message id
- Therefore: add fields to outbound request:
  - `conversationId`
  - `conversationMessageId`

**Patch**
- `functions/src/messaging/smsOutboundQueue.ts`
  - When creating outbound request from conversation send, include:
    - `conversationId`, `conversationMessageId`
  - On send success:
    - update canonical message provider fields

---

## 10) Phase 4 — Admin UI: converge TextMessagesPage into conversations

### 10.1 Quick win approach
- Keep TextMessagesPage but swap its data source:
  - Instead of listening to `smsThreads`, listen to:
    - `conversations` where `channelEndpoints.sms` exists
  - Show same UI with:
    - conversation list
    - message view from canonical messages
  - Sending:
    - `sendConversationMessage` + outbound SMS route

### 10.2 Old smsThreads remain as compatibility layer
- Do not delete smsThreads yet.
- Mark as deprecated and stop writing once admin UI is fully swapped.

---

## 11) Firestore rules verification checklist (must pass)

### Worker can:
- Read `tenants/{tenantId}/conversations/{id}` only if participant
- Read messages under that conversation
- Create participant-visible messages where `sender.uid == auth.uid`

### Worker cannot:
- Update conversation metadata
- Create `internal_only` messages
- Read conversations they're not in

### Internal can:
- Read/write all for tenant (security>=5)

---

## 12) Smoke tests (run after each phase)

### Phase 0 tests
- Token registration still writes to `users/{uid}/pushTokens/{token}`
- `sendThreadMessageApi` refuses unauthenticated access and ignores spoofed recruiterId

### Phase 1 tests
- Worker Inbox loads without "Missing or insufficient permissions"
- Worker can send/receive conversation messages

### Phase 2 tests
- Inbound SMS creates:
  - smsThreads message (old UI still works)
  - canonical conversation message (new inbox sees it)

### Phase 3 tests
- Recruiter send writes canonical message, then sends SMS
- Twilio status updates map back to canonical message (if linked)

### Phase 4 tests
- Admin inbox reads canonical conversations with sms endpoints
- smsThreads page can be removed without loss of functionality

---

## 13) Exact search list (results and classification)

Search terms and results. For each: **file path**, **what it does**, **action (delete / migrate / bridge)**.

### `collection(db, "threads")` or equivalent
| File | What it does | Action |
|------|--------------|--------|
| `src/hooks/useWorkerThreads.ts` | `collection(db, workerNotificationsPaths.threads())` — queries root `threads` for worker inbox list | **Migrate** — switch to useConversationsForUser → tenant conversations |

### `threads/` or `workerNotificationsPaths.threads`
| File | What it does | Action |
|------|--------------|--------|
| `src/data/firestorePaths.ts` | Defines `threads()`, `thread(threadId)`, `threadMessages`, `threadMessage` for root threads | **Migrate** — add conversationPaths; deprecate thread paths (keep for legacy during bridge or remove once inbox switched) |
| `src/hooks/useWorkerThreads.ts` | Uses `threads()` and `threadMessages(threadId)` for queries | **Migrate** — replace with useConversationsForUser + useConversationMessages |

### `useWorkerThreads` / `useWorkerThreadMessages`
| File | What it does | Action |
|------|--------------|--------|
| `src/pages/c1/workers/inbox.tsx` | Imports and uses both hooks for list + messages | **Migrate** — use useConversationsForUser, useConversationMessages |
| `src/hooks/useWorkerThreads.ts` | Defines both hooks (root threads) | **Retire** — mark deprecated, stop importing; delete after Phase 1 |

### `markWorkerThreadRead` / `sendWorkerThreadMessage`
| File | What it does | Action |
|------|--------------|--------|
| `functions/src/messaging/unifiedWorkerNotifications.ts` | Defines callables; read/write root `threads` and `threads/{id}/messages` | **Bridge** — keep during migration; add markConversationRead + sendConversationMessage callables; eventually deprecate thread callables |
| `functions/src/index.ts` | Exports markWorkerThreadRead, sendWorkerThreadMessage | **Bridge** — keep exports; add new conversation callable exports |
| `src/api/workerNotificationsApi.ts` | markThreadReadCallable, sendWorkerThreadMessageCallable wrap the callables | **Migrate** — add markConversationReadCallable, sendConversationMessageCallable in conversationsApi.ts; inbox uses new ones |
| `src/pages/c1/workers/inbox.tsx` | Calls markThreadReadCallable, sendWorkerThreadMessageCallable | **Migrate** — use markConversationReadCallable, sendConversationMessageCallable |

### `smsThreads`
| File | What it does | Action |
|------|--------------|--------|
| `src/pages/TextMessagesPage.tsx` | List: collection(tenants, tid, 'smsThreads'); state smsThreads | **Bridge then migrate** — Phase 4 swap to conversations where channelEndpoints.sms |
| `src/hooks/useSmsThreadMessages.ts` | Listens to tenants/{tid}/smsThreads/{threadId}/messages | **Bridge** — Phase 4 replace with useConversationMessages when admin uses conversations |
| `src/pages/UserInboxPage.tsx` | State smsThreads; combined inbox | **Bridge** — migrate to conversations when that page is updated |
| `src/pages/UserProfile/components/MessagesTab.tsx` | List: collection(tenants, tid, 'smsThreads') | **Bridge** — same as TextMessagesPage |
| `functions/src/messaging/*` (twoWayMessaging, inboundSmsWebhook, threadsApi, webhooksApi, smsOutboundQueue, aiAssistApi, etc.) | Read/write tenant smsThreads for SMS flow | **Bridge** — keep writing smsThreads until Phase 4; add conversation writes in Phase 2 (inbound) and Phase 3 (outbound) |

### `sendThreadMessageApi` / `recruiterId` in messaging endpoints
| File | What it does | Action |
|------|--------------|--------|
| `functions/src/messaging/threadsApi.ts` | sendThreadMessageApi: uses `request.body.recruiterId`, `request.body.fromUserId` (no auth); createThreadApi, listThreadsApi same | **Must fix (Phase 0)** — require request.auth; senderUid = request.auth.uid; validate tenant/internal; ignore body recruiterId/fromUserId |

### `deviceTokens` / `userDeviceTokens`
| File | What it does | Action |
|------|--------------|--------|
| `src/data/firestorePaths.ts` | `userDeviceTokens(uid)` → `users/{uid}/deviceTokens` (wrong path; actual is pushTokens) | **Fix (Phase 0)** — add userPushTokens → users/{uid}/pushTokens; deprecate/remove userDeviceTokens |
| `functions/src/messaging/unifiedWorkerNotifications.ts` | Variable `deviceTokens` (array of token strings); reads from PUSH_TOKENS = pushTokens path | **No change** — variable name is fine; path is already correct |
| `functions/src/messaging/routingOrchestrator.ts` | getDeviceTokensForUser, variable deviceTokens | **No change** — server reads pushTokens; variable name OK |
| `functions/src/messaging/FcmPushProvider.ts` | target.deviceTokens (API shape) | **No change** |
| `functions/src/messaging/PushProvider.ts` | deviceTokens in interface | **No change** |

**Summary**
- **Delete (later):** useWorkerThreads.ts, useWorkerThreadMessages.ts (after Phase 1).
- **Migrate:** inbox.tsx (data + callables), workerNotificationsApi (add conversation callables), firestorePaths (conversationPaths + userPushTokens).
- **Bridge:** smsThreads everywhere (keep writes until Phase 4); markWorkerThreadRead/sendWorkerThreadMessage (keep, add conversation equivalents).
- **Must fix:** threadsApi.ts auth (Phase 0); firestorePaths userDeviceTokens → userPushTokens (Phase 0).

---

## 14) Implementation order (do not reorder)

1) Phase 0 token + auth hardening  
2) Worker Inbox UI swap to tenant conversations  
3) Inbound bridge: smsThreads + conversations  
4) Outbound bridge: conversations-first + SMS routing + status metadata  
5) Admin UI swap to conversations  
6) Deprecate smsThreads writes, then remove old code  
