# PR-style patch plan: Auth hardening + Worker inbox → conversations

**Date:** 2026-02-16  
**Scope:** Two deliverables, then pause for testing before SMS inbound bridging.

- **Commit 1:** sendThreadMessageApi (and related threadsApi) auth hardening  
- **Commit 2:** Worker inbox UI swap to `tenants/{tid}/conversations`  

**Out of scope in this PR:** SMS inbound bridging, outbound bridge, admin UI swap. Those come after testing.

---

## Branch and PR

- **Branch:** `feat/conversations-auth-and-worker-inbox` (or similar)
- **PR title:** `feat(messaging): Harden threadsApi auth + Worker inbox to tenant conversations`
- **Base:** current main / recovery branch

---

## Commit 1 — Harden sendThreadMessageApi and threadsApi auth

**Title:** `fix(messaging): Require auth for threadsApi; reject body recruiterId/fromUserId`

**Summary:** All four HTTP handlers in `threadsApi.ts` currently take `recruiterId`/`fromUserId` from query or body. Require Firebase ID token, derive UID from token, and enforce tenant/internal access. Client (TextMessagesPage) must send `Authorization: Bearer <idToken>`.

### Files to change

| File | Change |
|------|--------|
| `functions/src/messaging/threadsApi.ts` | Add shared auth helper; use it in listThreadsApi, getThreadApi, sendThreadMessageApi, createThreadApi. |

### 1.1 Add auth helper (top of file, after imports)

Add a small helper that:

- Reads `request.headers.authorization` (or `request.headers.Authorization`).
- If missing or not `Bearer <token>`, returns `response.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid Authorization header' } })` and returns `null` so the handler exits.
- Otherwise `admin.auth().verifyIdToken(token)` and returns `decoded.uid` (or throws; catch and 401).
- Signature idea: `async function requireAuth(request, response): Promise<string | null>` — returns `uid` or `null` (and already sent 401).

### 1.2 sendThreadMessageApi

- At start of handler: `const senderUid = await requireAuth(request, response); if (senderUid === null) return;`
- Remove use of `request.body.recruiterId`, `request.query.recruiterId`, and `request.body.fromUserId`.
- Load thread: you already have `threadId` from query; use `getThreadWithMessages(threadId)` or a lighter get (e.g. load just the thread doc to read `tenantId`). Get `tenantId` from the thread doc.
- **Tenant/role check:** Load user doc `users/{senderUid}` and confirm they are internal for this tenant (e.g. `isAssignedToTenant(tenantId)` and security level >= 5, or use existing internal check). If not, `response.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Not authorized for this tenant' } }); return;`
- Call: `sendOutboundMessage(threadId, senderUid, body)` (no `actualFromUserId` from body).

### 1.3 listThreadsApi

- Start: `const uid = await requireAuth(request, response); if (uid === null) return;`
- Use `uid` instead of `recruiterId` from query for “assigned to me” and filtering. If `candidateId` is used for a different flow, keep it but ensure tenantId is required and user has access to that tenant (e.g. internal or is the candidate).

### 1.4 getThreadApi

- Start: `const uid = await requireAuth(request, response); if (uid === null) return;`
- After loading thread, enforce access: thread belongs to `tenantId` and user is internal for that tenant (or is the candidate). If not, 403.

### 1.5 createThreadApi

- Start: `const recruiterUid = await requireAuth(request, response); if (recruiterUid === null) return;`
- Remove `request.body.recruiterId`. Use `recruiterUid` when calling `findOrCreateThread` / creating thread (e.g. `primaryRecruiterId: recruiterUid`). Validate tenant access before creating.

### 1.6 Client: TextMessagesPage

- When calling `sendThreadMessageApi`, send the Firebase ID token so the request is authenticated:
  - Get token: `import { getAuth } from 'firebase/auth'; ... const token = await getAuth().currentUser?.getIdToken();`
  - In `fetch` options: `headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }`
  - If no token, show a short message (“Please sign in again”) and do not send.

**Files to touch (Commit 1):**

- `functions/src/messaging/threadsApi.ts` (auth helper + all four handlers)
- `src/pages/TextMessagesPage.tsx` (add Authorization header with id token for sendThreadMessageApi)

---

## Commit 2 — Worker inbox UI swap to tenant conversations

**Title:** `feat(worker-inbox): Switch to tenant-scoped conversations; add hooks and callables`

**Summary:** Worker inbox stops using root `threads` and uses `tenants/{tenantId}/conversations` plus new hooks and Cloud Function callables. Route param becomes `conversationId`. Existing root-thread callables are left in place for now (can deprecate later).

### 2.1 Types and paths (no new Firestore rules in this PR; rules already added)

| File | Action |
|------|--------|
| `src/types/conversations.ts` | **Create.** Export Conversation, ConversationMessage, ConversationType, ConversationStatus, ParticipantRole, ChannelEndpoints, MessageChannel, MessageVisibility, etc. (see MESSAGING_CONVERSATIONS_MIGRATION_PLAN.md Part 2). |
| `src/data/firestorePaths.ts` | **Edit.** Add `conversationPaths`: `conversations(tid)`, `conversation(tid, cid)`, `messages(tid, cid)`, `message(tid, cid, mid)`. |

### 2.2 Cloud Functions: conversations module

| File | Action |
|------|--------|
| `functions/src/messaging/conversations/conversationsModel.ts` | **Create.** Implement `findOrCreateConversationForSms`, `appendConversationMessage`, `updateConversationRollups` (see migration plan Part 5.2). Use tenant-scoped paths and spec field names. |
| `functions/src/messaging/conversations/conversationsApi.ts` | **Create.** Implement: (1) `listConversationsForUser` — callable, auth required, query `tenants/{tenantId}/conversations` where participantUids array-contains uid, orderBy lastMessageAt desc, limit 50; (2) `getConversation` — callable, auth + participant check, return conversation + messages; (3) `sendConversationMessage` — callable, auth, validate participant, append message, update rollups; (4) `markConversationRead` — callable, auth, set unreadByUid[uid]=0. |
| `functions/src/index.ts` | **Edit.** Export the new callables from `./messaging/conversations/conversationsApi`. |

### 2.3 Client hooks and API

| File | Action |
|------|--------|
| `src/hooks/useConversationsForUser.ts` | **Create.** Params: `tenantId`, `uid`. Query `conversationPaths.conversations(tenantId)` with where participantUids array-contains uid, orderBy lastMessageAt desc, limit 50. Return `{ conversations, loading, error }`. Use onSnapshot for real-time. |
| `src/hooks/useConversationMessages.ts` | **Create.** Params: `tenantId`, `conversationId`. Query `conversationPaths.messages(tenantId, conversationId)` orderBy createdAt asc limit 200. Return `{ messages, loading, error }`. |
| `src/api/conversationsApi.ts` | **Create.** Wrappers: `markConversationReadCallable(tenantId, conversationId)`, `sendConversationMessageCallable({ tenantId, conversationId, body })` (body = { text } or single text field as per callable contract). Use httpsCallable. |

### 2.4 Worker inbox page and route

| File | Action |
|------|--------|
| `src/pages/c1/workers/inbox.tsx` | **Edit.** Replace `useWorkerThreads(uid)` with `useConversationsForUser(tenantId, uid)`. Replace `useWorkerThreadMessages(threadId)` with `useConversationMessages(tenantId, conversationId)`. Use `conversationId` from route param. Replace `markThreadReadCallable` with `markConversationReadCallable`; replace `sendWorkerThreadMessageCallable` with `sendConversationMessageCallable`. Update list key and selection to use conversation id; keep same layout (list + message view). Derive `tenantId` from `activeTenant?.id` (or fallback per existing pattern). |
| `src/App.tsx` | **Edit.** Change route from `path="inbox/:threadId"` to `path="inbox/:conversationId"` for the worker inbox route under c1/workers. |

### 2.5 Worker notifications CTA (optional in this PR)

| File | Action |
|------|--------|
| `src/hooks/useWorkerNotifications.ts` or `getNotificationUrl` | **Edit.** If notification has `threadId` and links to inbox, either: (a) keep linking to `/c1/workers/inbox/${threadId}` for now (no conversationId yet for old notifications), or (b) add support for `conversationId` and prefer `/c1/workers/inbox/${conversationId}` when present. Minimal change: support both so old notifications still open inbox (by threadId as conversationId is not yet set on old data). |

### 2.6 Deprecate old hooks (do not delete yet)

| File | Action |
|------|--------|
| `src/hooks/useWorkerThreads.ts` | **Edit.** Add a short JSDoc deprecation notice: “@deprecated Use useConversationsForUser and useConversationMessages with tenant conversations.” No other call sites should remain in inbox (only this file defines them). |

**Files to touch (Commit 2):**

- `src/types/conversations.ts` (new)
- `src/data/firestorePaths.ts` (add conversationPaths)
- `functions/src/messaging/conversations/conversationsModel.ts` (new)
- `functions/src/messaging/conversations/conversationsApi.ts` (new)
- `functions/src/index.ts` (export new callables)
- `src/hooks/useConversationsForUser.ts` (new)
- `src/hooks/useConversationMessages.ts` (new)
- `src/api/conversationsApi.ts` (new)
- `src/pages/c1/workers/inbox.tsx` (swap data source and callables)
- `src/App.tsx` (inbox/:conversationId)
- `src/hooks/useWorkerThreads.ts` (deprecation comment only)

---

## Order of operations

1. Create branch from current base.
2. **Commit 1:** Implement threadsApi auth + TextMessagesPage Authorization header. Run tests; deploy functions and test send from Text Messages page with a logged-in user (token in header).
3. **Commit 2:** Add types, paths, conversations module, hooks, conversationsApi, then swap worker inbox and route. Run app; open worker inbox and confirm no permission errors (conversations list may be empty until inbound bridge writes data).
4. Open PR; request review.
5. After merge: test SMS inbound bridging in a follow-up (inbound webhook writing both smsThreads and conversations).

---

## Smoke checks before marking done

- **After Commit 1:** Unauthenticated POST to sendThreadMessageApi returns 401. Authenticated POST with valid token (and valid threadId/body) returns 200 and message is queued. Body `recruiterId`/`fromUserId` are ignored; sender is token UID.
- **After Commit 2:** Worker can open `/c1/workers/notifications` and `/c1/workers/inbox` without “Missing or insufficient permissions”. Inbox shows empty list or existing conversations (if any). Sending a message from worker inbox uses new callable and does not touch root `threads`. Route is `/c1/workers/inbox/:conversationId`.

---

## What’s explicitly not in this PR

- Push token path rename (Phase 0) — can be a separate small commit/PR.
- Inbound SMS bridge (writing to conversations in addition to smsThreads).
- Outbound bridge (canonical-first + conversationId/conversationMessageId in queue).
- Admin Text Messages page switching to conversations.
- Removal of root `threads` or smsThreads code.

Those can be planned as the next PR(s) after validating this one.
