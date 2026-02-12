# Admin Messaging vs Unified Worker Notifications — Mesh Review

**Spec:** HRX-Unified-Notifications-and-Inbox-Spec.md  
**Purpose:** Ensure existing admin/recruiter messaging and outbound comms mesh with the new unified worker notifications/inbox model. No competing collections; document adapters/migrations where needed.

---

## 1. Existing Admin / Recruiter Messaging (What We Found)

### 1.1 SMS / Two-Way Messaging (Recruiter ↔ Candidate)

| Location | Purpose | Data model |
|----------|---------|------------|
| `functions/src/messaging/twoWayMessaging.ts` | Thread + message CRUD for recruiter↔candidate **SMS** | `tenants/{tenantId}/smsThreads`, `tenants/{tenantId}/smsThreads/{id}/messages` (or equivalent subcollection) |
| `functions/src/messaging/threadsApi.ts` | HTTP API: list threads, get thread, send message, create thread | Queries `smsThreads` by `candidateUserId` or `recruiterId` |
| `functions/src/messaging/systemSms.ts` | System SMS (e.g. welcome), queue-first | Uses `getOrCreateThreadForUser` (SMS thread), then `createOutboundRequest` (queue) |
| `functions/src/messaging/smsOutboundQueue.ts` | Outbound SMS queue / Cloud Tasks | Separate from Firestore threads; delivery only |

**Conclusion:** SMS threads are **tenant-scoped**, **SMS-specific**, and **recruiter-facing**. They are **not** the same as the new global **worker inbox threads** (`threads/{threadId}`). No conflict: different use case (SMS vs in-app + push).

### 1.2 Push (FCM)

| Location | Purpose | Data model |
|----------|---------|------------|
| `functions/src/messaging/FcmPushProvider.ts` | Send FCM payload to device tokens | No Firestore; uses `admin.messaging().send()` |
| `functions/src/messaging/pushProviderFactory.ts` | Returns FCM push provider | — |
| `functions/src/messaging/routingOrchestrator.ts` / routing | May reference push for message delivery | Depends on message type; may call push for workers |

**Conclusion:** FCM is used for delivery only; there was **no** durable worker notification store before. The new **users/{uid}/notifications** is the source of truth for worker-facing notifications; FCM remains best-effort delivery.

### 1.3 Recruiter Dashboard Notifications

| Location | Purpose | Data model |
|----------|---------|------------|
| `functions/src/recruiterDashboardNotifications.ts` | Notifications for **recruiters** (e.g. new application, task) | Writes to a **dashboard notification** store (e.g. `tenantNotifications` or similar; see `writeDashboardNotification`) |

**Conclusion:** These are **admin/recruiter** notifications, not worker notifications. They do **not** use `users/{uid}/notifications`. No conflict.

### 1.4 Unified Inbox (Admin UI)

| Location | Purpose | Data model |
|----------|---------|------------|
| `src/types/unifiedInbox.ts`, `src/hooks/useUnifiedInboxMessages.ts` | Admin unified inbox (email, SMS, Slack, internal) | Normalizes from **email**, **SMS**, **Slack** backends (not from `threads/`) |
| `functions/src/messaging/emailThreadsApi.ts` | Email threads | Email-specific collections |
| `functions/src/messaging/internalMessagingApi.ts` | Internal messaging | Likely internal DM / threads |

**Conclusion:** Admin unified inbox aggregates **existing** channels (email, SMS, Slack). The new **worker** threads (`threads/`) are for **worker-facing** conversations. Future recruiter inbox UI can **read** the same `threads/` and `threads/{id}/messages` for worker conversations (spec §8.3). No competing collection: `threads/` is the canonical worker (and future admin) thread store.

### 1.5 Message Logging / Activity

| Location | Purpose | Data model |
|----------|---------|------------|
| `functions/src/messaging/messageLogging.ts` | Log outbound/inbound messages | `messageLogs` or similar (audit) |
| Activity logs (e.g. `activityLogger`) | User activity audit | Activity collection(s) |

**Conclusion:** Logging/audit is separate. Optional: when sending a **worker** notification or thread message via the new flow, also log to existing messageLog/activity if desired (not required for Phase 1).

---

## 2. Alignment With Unified Model

- **Worker-facing notifications** must go to **users/{uid}/notifications** and optionally trigger FCM via **sendNotificationAndPush** (or equivalent).
- **Worker-facing conversational messages** must go to **threads/{threadId}/messages** and thread metadata in **threads/{threadId}**; notify via **sendThreadMessageAndPush** (or equivalent).
- **Admin/recruiter** flows (SMS, email, Slack) stay as-is. When we want an admin action to **also** create a worker-visible notification or inbox message, we call the **unified** functions instead of (or in addition to) only sending SMS/email.

---

## 3. TODOs / Adapters / Migrations

### 3.1 Use unified notification for one existing worker touchpoint (Task E)

- **TODO:** Pick one existing push-worthy worker event (e.g. “assignment accepted”, “missing documents”, or welcome) and switch it to:
  - Write **users/{uid}/notifications** (via `sendNotificationAndPush`),
  - Then send FCM (inside that function).
- **Where to look:** `placementsApi.ts`, `systemSmsTriggers.ts`, `shiftAssignmentCascades.ts`, or any code that today sends SMS/email to a worker for a lifecycle event. Add a call to `sendNotificationAndPush` so the worker sees it in the web portal and (when tokens exist) gets push.

### 3.2 SMS thread vs worker thread (optional later)

- **Current:** Recruiter↔worker SMS lives in **tenants/{tid}/smsThreads**.
- **Unified:** Worker inbox lives in **threads/**.
- **Option A (Phase 1):** Leave as-is. Worker sees **in-app threads** in `/c1/workers/inbox`; SMS remains separate. No migration.
- **Option B (Phase 2+):** Add an **adapter** that, when an SMS is sent/received for a worker, also creates/updates a **thread** and **message** in `threads/` so the worker sees one inbox (SMS + in-app). Document as future migration if desired.

### 3.3 Device tokens for FCM

- **New:** **users/{uid}/deviceTokens** stores FCM tokens (web/mobile); **registerWorkerDeviceToken** callable registers them.
- **TODO (web):** Add Firebase Messaging (FCM) in the worker web app, request permission, get token, call **registerWorkerDeviceToken**.
- **TODO (mobile):** When native app is ready, register tokens the same way.

### 3.4 Firestore security rules

- **TODO:** Add rules for:
  - **users/{uid}/notifications:** read/update(readAt) by auth.uid === uid; create only by server/admin.
  - **threads:** read if auth.uid in participantUids; create/update by server (or controlled by callable).
  - **threads/{id}/messages:** read if auth.uid in thread participantUids; create via callable (worker reply) or server.
  - **users/{uid}/deviceTokens:** read/write by auth.uid === uid.

### 3.5 Indexes

- **Done:** Added in `firestore.indexes.json`:
  - **threads:** `participantUids` (array-contains) + `lastMessageAt` (desc).
  - **notifications:** `readAt` + `createdAt` (desc) for unread filtering.

---

## 4. Acceptance (Mesh Check)

- [x] Worker can view notifications in `/c1/workers/notifications`.
- [x] Worker can view threads and reply in `/c1/workers/inbox`.
- [x] Sending a push flows through: Firestore notification record + FCM send (via `sendNotificationAndPush` and callables).
- [x] Unread counts (notifications and threads) are supported by schema and UI.
- [x] Admin routes unchanged; `/c1/applications` and `/c1/jobs-board` unchanged.
- [x] No **competing** notification or thread collections: existing SMS/dashboard/inbox are either recruiter-facing or separate channels; the new model is the single worker-facing notification + thread store.
- [ ] **Phase 1 follow-up:** Wire one existing worker event to `sendNotificationAndPush` (Task E).
- [ ] **Phase 1 follow-up:** Add Firestore security rules and web FCM token registration (Tasks D + 6).

---

## 5. Summary

Existing admin messaging (SMS threads, email, Slack, recruiter dashboard notifications) **does not** use the new `users/{uid}/notifications` or global `threads/` collections. The unified worker notifications and inbox **add** a new, dedicated path for worker-facing alerts and two-way conversations. To mesh:

- Use **sendNotificationAndPush** and **sendThreadMessageAndPush** (and callables) for any **worker**-targeted push or inbox message.
- Do **not** create alternate worker notification or thread structures in admin code.
- Optional later: adapters to mirror SMS or other channels into `threads/` for a single worker inbox; document as migration if needed.
