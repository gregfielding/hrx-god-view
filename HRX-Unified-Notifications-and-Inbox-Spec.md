# HRX / C1 — Unified Notifications + Inbox (Web + Mobile via FCM)  
**Worker namespace:** `/c1/workers/*` (new)  
**Existing routes that must not change:**  
- `/c1/applications` (My Applications)  
- `/c1/jobs-board` (Find Work / Jobs Board)

## Why this exists (Context)
We will send communications to workers via multiple delivery channels:
- **SMS** (Twilio) → stays SMS  
- **Email** (SendGrid/Gmail) → stays Email  
- **Push** (FCM) → **must also appear inside the web worker portal + native app** as:
  - **Notifications** (feed of actionable alerts)
  - **Inbox Messages** (threaded conversations workers can reply to)

**Key idea:** Push is not just a delivery method; it is a durable **in-app record**.  
Every push-worthy event should be written to Firestore so both web and mobile can render it reliably.

---

## Goals (Phase 1)
1. Add **worker-facing Notifications** and **Inbox** to `/c1/workers/*`
2. Support **two-way messaging** in the web portal (workers can reply)
3. Send **FCM push** for notification/message events (best-effort), while Firestore remains source of truth
4. Ensure admin-side comms tooling (existing or future) **meshes cleanly** with this model:
   - Cursor must review existing admin messaging/code paths and align them with this spec.

---

## Non-goals (Phase 1)
- Replacing SMS/email systems (we will log them, not reroute them)
- Building a full recruiter CRM inbox UI (optional later)
- Complex sentiment / AI summarization (later)

---

# 1) Information Architecture & Routes

## Worker routes (new)
Add these under the existing worker shell (see prior `/c1/workers` spec):

- `/c1/workers/notifications`
- `/c1/workers/inbox`
- `/c1/workers/inbox/:threadId` (optional; on desktop can be same page split-view)
- `/c1/workers/support` (can route to inbox thread “Support”)

## Worker navigation updates
In `WorkerNav`, add:
- **Notifications** → `/c1/workers/notifications`
- **Inbox** → `/c1/workers/inbox`

Keep existing:
- Applications → `/c1/applications` ✅
- Find Work → `/c1/jobs-board` ✅

---

# 2) Data Model (Firestore) — Source of Truth

We need two surfaces that share the same underlying comms event log:
- **Notifications** (short, actionable items)
- **Threads/Messages** (conversations; worker can reply)

## 2.1 Notifications Collection (per-user subcollection)
**Path:**
- `users/{uid}/notifications/{notificationId}`

**Notification document fields:**
- `uid: string` (recipient uid; redundant for convenience)
- `tenantId: string` (e.g., "c1")
- `type: 'assignment' | 'application' | 'document' | 'shift' | 'payroll' | 'general' | 'system'`
- `title: string`
- `body: string`
- `severity: 'info' | 'success' | 'warning' | 'error'`
- `createdAt: Timestamp`
- `readAt: Timestamp | null`
- `source: 'system' | 'recruiter' | 'automation'`
- `channel: 'push' | 'sms' | 'email' | 'web'`  
  - For Phase 1, we primarily write `push` events here, but the model supports logging sms/email later.
- `ctaLabel?: string`
- `ctaUrl?: string`  
  - Example: assignment accept/decline URL
- `threadId?: string`  
  - If present, clicking notification deep-links into the inbox thread.
- `entity?: { kind: string; id: string }`  
  - Optional pointer to related object (assignmentId, applicationId, etc.)

**Indexes needed (likely):**
- `readAt` + `createdAt` for unread filtering
- `createdAt` descending

## 2.2 Threads + Messages (global collections)
Use a global threads collection so future admin/recruiter tools can participate easily.

**Paths:**
- `threads/{threadId}`
- `threads/{threadId}/messages/{messageId}`

### Thread doc fields
- `tenantId: string` (e.g., "c1")
- `participantUids: string[]` (includes worker uid + internal user(s) or system pseudo-user)
- `participantTypes?: Record<uid, 'worker' | 'recruiter' | 'system'>` (optional)
- `topic: 'recruiting' | 'support' | 'scheduling' | 'general' | string`
- `subject?: string` (optional)
- `createdAt: Timestamp`
- `lastMessageAt: Timestamp`
- `lastMessagePreview: string`
- `unreadCountByUid: Record<string, number>` (map uid -> count)
- `closedAt?: Timestamp | null` (optional for support)
- `relatedEntity?: { kind: string; id: string }` (assignment/application linkage)

### Message doc fields
- `tenantId: string`
- `threadId: string`
- `senderUid: string` (worker or admin user) OR `senderType: 'system' | 'user'`
- `senderDisplayName?: string` (denormalized for speed)
- `body: string`
- `createdAt: Timestamp`
- `deliveryChannels: Array<'push' | 'sms' | 'email' | 'web'>`
- `status?: { push?: 'sent'|'failed'; sms?: 'sent'|'failed'; email?: 'sent'|'failed' }` (optional)
- `attachments?: Array<{ type: 'url'|'file'; name?: string; url: string }>` (optional later)
- `metadata?: Record<string, any>` (optional)

**Important:**  
For Phase 1, worker replies should create `Message` docs. Do not overcomplicate.

---

# 3) FCM (Push) + Device Tokens

## 3.1 Device token storage (per-user subcollection)
**Path:**
- `users/{uid}/deviceTokens/{tokenId}`

Fields:
- `token: string`
- `platform: 'ios'|'android'|'web'`
- `createdAt: Timestamp`
- `lastSeenAt: Timestamp`
- `isActive: boolean`
- `appVersion?: string`

**Notes:**
- For web push, token comes from Firebase Messaging in the web app.
- Rotate/cleanup tokens when send failures occur.

---

# 4) Write Flows (How events become Notifications + Messages)

## 4.1 Notification-only event (common)
Example: “Missing Work Eligibility Document”
1) Write `users/{uid}/notifications/{id}`
2) Send FCM push (best-effort)
3) If send fails, optionally mark notification status (not required for Phase 1)

## 4.2 Message + Notification event (conversational)
Example: recruiter asks availability
1) Create or find thread (`threads/{threadId}`)
2) Write message (`threads/{threadId}/messages/{id}`)
3) Update thread summary fields + unread counts
4) Write a notification referencing `threadId`
5) Send FCM push with deep link to `/c1/workers/inbox/{threadId}`

## 4.3 Worker reply (web portal)
1) Worker posts message into thread
2) Update thread lastMessage, unreadCountByUid for other participants
3) Optionally send push to recruiter/admin participants (Phase 1 optional, but recommended)

---

# 5) Cloud Functions (Recommended Stubs)

Create these Cloud Functions (names can vary to match your repo conventions):

## 5.1 `sendNotificationAndPush(payload)`
- Inputs: uid, title, body, severity, type, ctaUrl?, threadId?
- Writes notification doc
- Sends FCM push to all active tokens

## 5.2 `sendThreadMessageAndPush(payload)`
- Inputs: threadId (or createThread), senderUid, body, recipientUids, tenantId
- Writes message doc
- Updates thread doc (lastMessageAt, preview, unreadCountByUid)
- Writes notification doc to recipient(s)
- Sends push to recipient(s)

## 5.3 `markNotificationRead(uid, notificationId)`
- Sets `readAt = now`

## 5.4 `markThreadRead(uid, threadId)`
- Sets `unreadCountByUid[uid] = 0`
- Optional: maintain lastReadAtByUid map

## 5.5 Token maintenance
- `registerDeviceToken(uid, token, platform)`
- `deactivateTokenOnFailure(token)` (optional)

---

# 6) Security Rules (High-level)

## 6.1 Notifications rules
- User can **read** their own notifications:
  - allow read: request.auth.uid == uid
- User can **update** only allowed fields:
  - allow update: request.auth.uid == uid AND only `readAt` changes
- Only server/admin can **create** notifications:
  - allow create: admin role OR via Cloud Functions using admin SDK

## 6.2 Threads/Messages rules (Phase 1)
- allow read thread if request.auth.uid is in `participantUids`
- allow create message if request.auth.uid is in `participantUids`
- allow update thread summary fields only via server (recommended)
  - Workers should not be able to arbitrarily edit thread doc fields.

**Recommendation:** Use Cloud Functions for writes that mutate unread counters + thread metadata to prevent client-side abuse.

---

# 7) Worker UI Specs (MUI)

## 7.1 Notifications Page — `/c1/workers/notifications`
MUI components:
- `PageHeader` (title + filter)
- Filter chips: All / Unread / Assignments / Documents / Applications
- List items:
  - unread dot
  - title + body (1–2 lines)
  - timestamp
  - CTA button (if `ctaUrl` or `threadId`)
- Actions:
  - Mark all read
  - Mark individual read on click

Behavior:
- Default sort: newest first
- Clicking:
  - if `threadId` → go to `/c1/workers/inbox/{threadId}`
  - else if `ctaUrl` → open in same tab
  - else open details drawer (optional later)

## 7.2 Inbox Page — `/c1/workers/inbox`
Two modes:
- Desktop: split view (threads list left, messages right)
- Mobile: threads list → tap → message screen

Thread list shows:
- subject/topic
- last message preview
- unread badge
- timestamp

Thread view shows:
- message bubbles (worker vs recruiter/system)
- composer at bottom with Send button
- optimistic UI for sending

## 7.3 Global unread badges
In `C1WorkerLayout` top bar:
- Bell icon with unread notifications count
- Inbox icon with unread threads count (or total unread messages)

Counts computed via Firestore queries:
- Notifications: `readAt == null`
- Threads: `unreadCountByUid[uid] > 0`

---

# 8) Admin-side Integration (Critical Instruction for Cursor)

**Cursor: You must review any existing admin messaging / outbound comms code paths** and ensure they “mesh” with this model.

## 8.1 What to look for
Search repo for:
- `sendSms`, `sendEmail`, `push`, `notification`, `message`, `thread`
- existing “activity logs” or “messaging logs”
- any worker communications UI in admin

## 8.2 Alignment requirements
- Any admin action that sends a push-worthy message to a worker should call the unified functions:
  - `sendNotificationAndPush` (for alerts)
  - `sendThreadMessageAndPush` (for conversation)
- Admin tools should not create alternate, competing notification/message structures.
- If there is already a “messages” collection, either:
  - migrate it to this structure, or
  - create a compatibility adapter and plan migration later (document it)

## 8.3 Acceptance criteria (mesh check)
- Worker receives push AND sees the same item in:
  - web Notifications
  - web Inbox (if conversational)
  - mobile Notifications/Inbox (future)
- Admin/recruiter can read the same thread/messages when the admin UI is built (future-ready)

---

# 9) Implementation Tasks (Cursor)

## Task A — Add Firestore schema
- Create collections + types/interfaces
- Add minimal indexes as needed

## Task B — Create worker pages (placeholders → functional)
- `src/pages/c1/workers/notifications.tsx`
- `src/pages/c1/workers/inbox.tsx`
- optional: `src/pages/c1/workers/inboxThread.tsx`

## Task C — Cloud Functions scaffolding
- Implement functions listed in Section 5 (at least stubs)
- Use Firebase Admin SDK for FCM send
- Log success/failure

## Task D — Web push token registration
- Add Firebase Messaging setup (web)
- Register token under `users/{uid}/deviceTokens/*`

## Task E — Wire to existing outbound comms
- Identify one existing push use-case (e.g., assignment accepted, missing docs)
- Switch it to the unified write flow:
  - write notification doc + send push

## Task F — Admin mesh review
- Audit admin-side comms components/logic
- Confirm no conflicts with new collections
- Add TODOs where migration/adapter is needed

---

# 10) Definition of Done (Phase 1)
- Worker can view notifications in `/c1/workers/notifications`
- Worker can view threads and reply in `/c1/workers/inbox`
- Sending a push results in:
  - Firestore notification record
  - FCM push attempt
- Unread counts work
- Admin routes unchanged
- Cursor documents admin-side compatibility review findings in a short note/comment block

---

# 11) Next Steps (Phase 2+)
- Native app consumes same Firestore notifications/threads + receives FCM
- Recruiter/admin inbox UI
- Attachments
- Message templates + AI assist
- SLA/Support escalation and tagging
  