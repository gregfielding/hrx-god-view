# HRX Messaging & Notifications — Current-State Inventory

**Generated:** 2025-02-16  
**Repo:** hrx-god-view  
**Purpose:** Complete, accurate inventory for designing next architecture.

---

## 1) High-level summary

### What works today (user POV)

- **Worker**
  - **Notifications table** (`/c1/workers/notifications`): Lists in-app notifications from `users/{uid}/notifications`; filter by type (assignment, application, document, general), mark read, open CTA (applications, job board, or inbox thread).
  - **Worker inbox** (`/c1/workers/inbox`, `/c1/workers/inbox/:threadId`): Thread list from global `threads` collection (participantUids array-contains uid), thread messages from `threads/{threadId}/messages`; send reply via callable `sendWorkerThreadMessage`. **Caveat:** Firestore rules do not define `threads` or `threads/{id}/messages` at root — client reads may get "Missing or insufficient permissions" unless rules were added elsewhere or access is via callables only.
  - **Push (FCM web):** Tokens registered to `users/{uid}/pushTokens` when worker is in C1 worker layout; application-created and assignment-updated triggers call `sendNotificationAndPush` and send FCM to those tokens; deep links (e.g. `/c1/workers/applications`, `/c1/workers/assignments`) in payload.
  - **SMS opt-in toggle:** Worker dashboard can show SMS toggle (WorkerDashboardSmsToggle) when SMS is off; actual opt-in/out is enforced server-side via STOP/HELP and tenant consent.
- **Admin/recruiter**
  - **Text Messages page** (`TextMessagesPage`): Lists SMS threads from `tenants/{tenantId}/smsThreads`, real-time messages via `useSmsThreadMessages` from `tenants/{tenantId}/smsThreads/{threadId}/messages`; send reply via HTTP `sendThreadMessageApi` (which calls `sendOutboundMessage` → `createOutboundRequest` → Cloud Tasks → `processSmsOutbound` → Twilio). Inbound replies land in same thread and are visible here.
  - **Messaging tab** (tenant settings): Templates (SMS/email), message types, automation rules, recruiter phone numbers; uses `templateApi` (listTemplates, createTemplate, sendTestMessage, etc.) and recruiter number assignment.
  - **Unified routing:** Application/assignment triggers and other flows can send via `sendMessage()` in `routingOrchestrator` (SMS + email + push) with message types, templates, consent, and rate limiting.

### Partially built / broken

- **Worker inbox Firestore access:** Global collection `threads` and `threads/{threadId}/messages` are used by client hooks (`useWorkerThreads`, `useWorkerThreadMessages`) but **have no rules** in `firestore.rules`. Root-level `match /{document=**}` denies by default, so direct client reads to `threads` will fail unless rules are deployed elsewhere or all access is through callables (currently only send/mark-read are callables; list threads and list messages are direct Firestore).
- **Path naming mismatch:** `firestorePaths.ts` exposes `workerNotificationsPaths.userDeviceTokens` (path `users/{uid}/deviceTokens`), while actual storage and rules use **`pushTokens`** (`users/{uid}/pushTokens`). Client writes in `firebaseMessaging.ts` use hardcoded `users/{uid}/pushTokens`.
- **sendThreadMessageApi auth:** `threadsApi.ts` has `// TODO: Add authentication`; recruiterId is taken from body/query, not `request.auth`.
- **userConsents:** STOP/HELP handler writes to `userConsents/{userId}/events` for compliance; there is **no rule** for `userConsents` in `firestore.rules` (Cloud Functions use Admin SDK so writes still succeed).
- **Twilio status callback:** Status updates (delivered/failed) are handled by `twilioStatusCallback` but finding the message log requires scanning tenants/messageLogs by `providerMessageId` (no tenantId in webhook payload).
- **Inbound SMS “notify recruiter”:** Comment in `inboundSmsWebhook.ts`: `// TODO: Notify recruiter(s) with access to thread` — no real-time alert to recruiter when worker replies.

### Missing entirely

- **Worker-facing SMS inbox:** Workers do not have a dedicated “SMS inbox” in the app; they receive SMS on their phone and replies are stored in tenant `smsThreads` and visible only to admin/Text Messages page.
- **Email provider for workers:** Orchestrator and templates support email (SendGrid/Gmail) for recruiter/candidate flows; no dedicated “worker email inbox” in the worker app.
- **Native mobile push:** FCM is used; implementation is web-focused (VAPID, `getToken`). No explicit APNS or other mobile SDK integration in this inventory.
- **Message status callbacks to client:** Beyond Firestore listener on thread messages, there is no dedicated “delivery receipt” UI for the sender (e.g. “delivered” badge); status is updated in messageLogs and thread messages by Twilio status webhook.

---

## 2) File structure map

### Worker app (web)

| Path | What it does |
|------|----------------|
| `src/pages/c1/workers/notifications.tsx` | Notifications list: reads `users/{uid}/notifications`, filter by type/unread, mark read via `markNotificationReadCallable`, navigate to CTA or inbox thread. Uses `useWorkerNotifications`, `getNotificationUrlAsync`. |
| `src/pages/c1/workers/inbox.tsx` | Inbox: thread list from `threads` (useWorkerThreads), messages from `threads/{threadId}/messages` (useWorkerThreadMessages); mark thread read (`markThreadReadCallable`), send message (`sendWorkerThreadMessageCallable`). |
| `src/hooks/useWorkerNotifications.ts` | Real-time listener on `users/{uid}/notifications` (orderBy createdAt desc), maps to WorkerNotification; getNotificationUrl / getNotificationUrlAsync for CTA. |
| `src/hooks/useWorkerThreads.ts` | Listener on `threads` where participantUids array-contains uid, orderBy lastMessageAt desc; useWorkerThreadMessages on `threads/{threadId}/messages` orderBy createdAt asc. |
| `src/hooks/usePushNotifications.ts` | Calls `registerPushToken(uid)` and `listenForegroundNotifications`; used in C1WorkerLayout. |
| `src/firebaseMessaging.ts` | FCM: getToken with VAPID, writes to `users/{uid}/pushTokens/{token}` (token, platform: 'web', enabled: true, createdAt/updatedAt). Foreground listener stub. |
| `src/api/workerNotificationsApi.ts` | Callables: markNotificationReadCallable, markThreadReadCallable, sendWorkerThreadMessageCallable (all via httpsCallable). |
| `src/types/unifiedWorkerNotifications.ts` | Types: WorkerNotification, WorkerThread, WorkerThreadMessage, NotificationType, etc. |
| `src/components/worker/dashboard/WorkerDashboardSmsToggle.tsx` | UI toggle for “SMS Notifications” when smsEnabled is false; onToggle(enabled) callback (parent must persist). |

### Admin app (web)

| Path | What it does |
|------|----------------|
| `src/pages/TextMessagesPage.tsx` | SMS inbox: real-time `tenants/{tenantId}/smsThreads`, `useSmsThreadMessages` for selected thread; send reply via POST `sendThreadMessageApi` (body, recruiterId, fromUserId). Assign Twilio number via `assignRecruiterNumber` callable. |
| `src/pages/TenantViews/MessagingTab.tsx` | Messaging settings: Templates (SMS/email), automation rules, recruiter numbers; uses templateApi (listTemplates, createTemplate, sendTestMessage, listAutomationRules, etc.), EmailTemplateEditor. |
| `src/pages/TenantViews/SenderManagementPage.tsx` | Sender/identity management (referenced in routing). |
| `src/hooks/useSmsThreadMessages.ts` | Real-time listener on `tenants/{tenantId}/smsThreads/{threadId}/messages` orderBy createdAt asc. |
| `src/utils/templateApi.ts` | Client wrappers for template/message-type/automation HTTP/callable APIs. |

### Shared / data

| Path | What it does |
|------|----------------|
| `src/data/firestorePaths.ts` | Canonical paths: `p.*` for tenant-scoped (applications, assignments, etc.); `workerNotificationsPaths`: userNotifications(uid), userDeviceTokens(uid) — **note:** code uses pushTokens, not deviceTokens; threads(), thread(id), threadMessages(id). |
| `src/contexts/AuthContext.tsx` | Auth / user / activeTenant used by worker and admin pages. |
| `src/firebase.ts` | Firebase app, db, functions. |

### Cloud Functions (messaging)

| Path | What it does |
|------|----------------|
| `functions/src/messaging/inboundSmsWebhook.ts` | HTTP handler `handleInboundSms`: Twilio POST, processInboundSms (STOP/HELP/START), else handleRegularInboundMessage (find thread by candidatePhone+twilioNumber, createInboundMessage, logMessage, AI draft). |
| `functions/src/messaging/webhooksApi.ts` | `twilioInboundSmsWebhook` wraps handleInboundSms; `twilioStatusCallback` updates messageLogs and thread message status by providerMessageId. |
| `functions/src/messaging/stopHelpHandler.ts` | processInboundSms, handleStopKeyword, handleHelpKeyword, handleStartKeyword; updates tenant smsConsents, user doc, userConsents/{uid}/events, sends confirmation SMS via sendWorkerMessageInternal. |
| `functions/src/messaging/smsOutboundQueue.ts` | createOutboundRequest (idempotency/dedupe), enqueueSmsOutbound (Firestore onCreate → Cloud Task), processSmsOutbound (HTTP worker: compliance, footer, Twilio send, write thread message + request status + messageLog). |
| `functions/src/messaging/twoWayMessaging.ts` | findOrCreateThread (tenant smsThreads), createInboundMessage, getOrCreateThreadForUser, sendOutboundMessage (createOutboundRequest). |
| `functions/src/messaging/twoWayMessagingFunctions.ts` | sendRecruiterMessage callable → sendOutboundMessage. |
| `functions/src/messaging/threadsApi.ts` | listThreadsApi, getThreadApi, sendThreadMessageApi (POST, calls sendOutboundMessage), createThreadApi. |
| `functions/src/messaging/routingOrchestrator.ts` | sendMessage(context): message type config, user/tenant settings, channel decisions, template render, SMS (createOutboundRequest/thread), email, push (sendNotificationAndPush). |
| `functions/src/messaging/routingFunctions.ts` | sendUnifiedMessage callable → sendMessage. |
| `functions/src/messaging/unifiedWorkerNotifications.ts` | sendNotificationAndPush (write users/{uid}/notifications, read pushTokens, FCM send); markWorkerNotificationRead, markWorkerThreadRead, sendWorkerThreadMessage callables. |
| `functions/src/messaging/messageLogging.ts` | logMessage → tenants/{tenantId}/messageLogs; updateMessageLogStatus; logPreferenceChange. |
| `functions/src/messaging/tenantConsent.ts` | getTenantSmsConsent, updateTenantSmsConsent (tenants/{tid}/smsConsents/{userId}, mirror to user doc). |
| `functions/src/messaging/templateEngine.ts` | getTemplate, renderTemplate, renderTemplateHtmlBody, renderStringWithVariables. |
| `functions/src/messaging/messageTypesRegistry.ts` | getMessageTypeConfig, DEFAULT_MESSAGE_TYPES (channels, template). |
| `functions/src/messaging/rateLimiter.ts` | checkRateLimits. |
| `functions/src/messaging/quietHours.ts` | isQuietHours. |
| `functions/src/messaging/templatesApi.ts` | listTemplatesApi, createTemplateApi, updateTemplateApi, deleteTemplateApi, listMessageTypesApi (HTTP). |
| `functions/src/messaging/messageAutomationRulesApi.ts` | list/create/update/delete automation rules, listTriggerCatalogApi, testAutomationTemplateApi. |
| `functions/src/messaging/emailThreadsApi.ts` | listEmailThreadsApi, getEmailThreadApi, sendEmailReplyApi, etc. (tenant email threads). |
| `functions/src/messaging/bulkSendApi.ts` | bulkSendEmailApi, bulkSendSmsApi. |
| `functions/src/messaging/adminApi.ts` | listMessageLogsApi, getConsentHistoryApi. |
| `functions/src/messaging/analyticsApi.ts` | getMessagingSummary, getUserMessageHistory, getOptOuts. |
| `functions/src/triggers/onApplicationCreatedPush.ts` | Firestore onCreate tenants/.../applications → sendNotificationAndPush, set applicationPushSentAt. |
| `functions/src/triggers/onAssignmentUpdatedPush.ts` | Firestore onUpdate tenants/.../assignments → sendNotificationAndPush on status change, set lastPushSentForStatus. |
| `functions/src/applicationSmsTriggers.ts` | onApplicationCreated, onApplicationStatusChanged → sendLegacyApplicationStatusMessage (orchestrator path). |
| `functions/src/messaging/systemSms.ts` | System SMS (e.g. welcome): getOrCreateThreadForUser, createOutboundRequest with dedupe. |
| `functions/src/messaging/systemSmsTriggers.ts` | enqueueWelcomeSmsOnUserCreated (Auth onCreate). |
| `functions/src/messaging/pushProviderFactory.ts` | getPushProvider() → FcmPushProvider. |
| `functions/src/messaging/FcmPushProvider.ts` | sendPush: admin.messaging().send per token (notification + data). |
| `functions/src/messaging/smsProviderFactory.ts` | getSmsProvider() → TwilioSmsProvider (or Mock). |
| `functions/src/messaging/TwilioSmsProvider.ts` | Twilio client send. |
| `functions/src/messaging/twilioSecrets.ts` | defineSecret for TWILIO_ACCOUNT_SID, AUTH_TOKEN, MESSAGING_PHONE_NUMBER, A2P_CAMPAIGN. |
| `functions/src/twilio.ts` | sendWorkerMessageInternal (direct Twilio send for STOP/HELP/START confirmations). |
| `functions/src/recruiterNumbers.ts` | assignRecruiterNumber, Twilio number list; references handleInboundSms URL. |

---

## 3) Firestore model inventory

### Notifications (worker)

| Collection | Path | Doc ID | Fields | Indexes / queries | Rules |
|------------|------|--------|--------|-------------------|-------|
| User notifications | `users/{uid}/notifications` | Auto | uid, tenantId, type, title, body, severity, createdAt, readAt, source, channel, ctaLabel, ctaUrl, threadId, entity | orderBy('createdAt','desc'), limit(100); where readAt==null for unread count | Read/update: auth.uid==userId; create: false (server) |

### Worker inbox (global threads)

| Collection | Path | Doc ID | Fields | Indexes / queries | Rules |
|------------|------|--------|--------|-------------------|-------|
| Threads | `threads` | Auto | tenantId, participantUids[], participantTypes, topic, subject, createdAt, lastMessageAt, lastMessagePreview, unreadCountByUid{} | where participantUids array-contains uid, orderBy lastMessageAt desc | **None in firestore.rules** — default deny |
| Thread messages | `threads/{threadId}/messages` | Auto | tenantId, threadId, senderUid, senderType, body, createdAt, deliveryChannels[], status | orderBy createdAt asc | **None** |

### Push tokens

| Collection | Path | Doc ID | Fields | Indexes / queries | Rules |
|------------|------|--------|--------|-------------------|-------|
| Push tokens | `users/{uid}/pushTokens` | FCM token string | token, platform, deviceId, enabled, createdAt, updatedAt | where enabled==true (server) | Read/write: auth.uid==userId |

Note: `firestorePaths.ts` exposes `userDeviceTokens` → `users/{uid}/deviceTokens` but actual usage is `pushTokens`.

### SMS (tenant-scoped)

| Collection | Path | Doc ID | Fields | Indexes / queries | Rules |
|------------|------|--------|--------|-------------------|-------|
| SMS outbound requests | `tenants/{tid}/smsOutboundRequests` | Auto | tenantId, threadId, recipientUserId, toPhoneE164, fromPhoneE164, body, source, status, attemptCount, idempotencyKey, createdAt, scheduledFor, dedupeKey, messageLogId, twilioMessageSid, sentAt, lastError | where status=='queued' (trigger); where idempotencyKey/dedupeKey (dedupe) | Read/create: tenant internal; update: false (Cloud Tasks) |
| SMS threads | `tenants/{tid}/smsThreads` | Auto | tenantId, participant{}, counterparty{}, candidateUserId, candidatePhone, twilioNumber, status, lastMessageAt, lastInboundAt, lastOutboundAt, lastMessageSnippet, createdAt, updatedAt, jobOrderId, applicationId | collectionGroup smsThreads where candidatePhone, twilioNumber, status; orderBy lastOutboundAt desc | Read/create/update: tenant internal; messages subcollection: internal, client create only outbound |
| SMS thread messages | `tenants/{tid}/smsThreads/{threadId}/messages` | Auto | tenantId, threadId, direction, fromType, fromUserId, body, providerMessageId, status, createdAt | orderBy createdAt asc | Same as parent |
| Message logs | `tenants/{tid}/messageLogs` | Auto | tenantId, userId, threadId, messageTypeId, channel, direction, fromIdentity, contentSent, language, status, providerMessageId, createdAt | where providerMessageId (status callback) | Read: tenant internal; write: false (server) |
| SMS consents | `tenants/{tid}/smsConsents/{userId}` | userId | userId, tenantId, phoneNumber, smsOptIn, smsBlockedSystem, lastUpdatedAt, source | — | Read: tenant internal or own userId; write: HRX/admin |
| Consent events | `tenants/{tid}/smsConsents/{userId}/events` | Auto | type, createdAt, source, rawMessageSid, previousValue, newValue | — | Read: tenant internal; write: false (server) |
| Message templates | `tenants/{tid}/messageTemplates` | templateId | (unified template schema) | — | Read: tenant internal; write: security level >= 6 |
| Recruiter numbers | `tenants/{tid}/recruiterNumbers/{recruiterId}` | recruiterId | (Twilio number assignment) | — | Read: tenant internal or own; write: admin/manager |

### Email (tenant-scoped)

| Collection | Path | Doc ID | Fields | Indexes / queries | Rules |
|------------|------|--------|--------|-------------------|-------|
| Email threads | `tenants/{tid}/emailThreads` | threadId | participantUserIds[], etc. | where participantUserIds array-contains uid | Read: tenant + participant; create/update: tenant participant |
| Email logs | `tenants/{tid}/email_logs` | emailId | (email log schema) | — | Read/write: tenant assigned |

### Compliance / legacy

| Collection | Path | Doc ID | Fields | Notes |
|------------|------|--------|--------|-------|
| userConsents | `userConsents/{userId}/events` | Auto | type (STOP/HELP/START), timestamp, source, twilioSid | Written by stopHelpHandler; **no rule** in firestore.rules (Admin SDK only). |

---

## 4) Cloud Functions inventory

### SMS outbound send

| Function | File | Trigger | Inputs | Outputs | Firestore | External | Errors / retries |
|----------|------|---------|--------|---------|-----------|----------|------------------|
| createOutboundRequest | smsOutboundQueue.ts | N/A (exported) | tenantId, threadId?, toPhoneE164, body, source, requestedByUid?, dedupeKey?, scheduledFor?, etc. | requestId | Write tenants/.../smsOutboundRequests | — | Throws on error |
| enqueueSmsOutbound | smsOutboundQueue.ts | Firestore onCreate `tenants/{tenantId}/smsOutboundRequests/{requestId}` | event.params | — | Read request doc | Cloud Tasks create (queue sms-outbound) | On failure: update request status failed |
| processSmsOutbound | smsOutboundQueue.ts | HTTP POST (invoker: private, Cloud Tasks) | body: { tenantId, requestId } | 200 JSON | Read request, user (phone), consent; write request status, thread message, messageLog | Twilio send (getSmsProvider) | 21610 → blocked, update consent; retryable → status queued, throw for Tasks retry; idempotent if status != queued |

### SMS inbound webhook

| Function | File | Trigger | Inputs | Outputs | Firestore | External | Errors / retries |
|----------|------|---------|--------|---------|-----------|----------|------------------|
| handleInboundSms | inboundSmsWebhook.ts | HTTP POST (public) | Twilio body: From, To, Body, MessageSid | 200 OK | processInboundSms; then findOrCreateThread, createInboundMessage, logMessage, createAIDraft | — | Always 200; errors logged |
| twilioInboundSmsWebhook | webhooksApi.ts | HTTP POST (public) | Same | Delegates to handleInboundSms | Same | — | Same |

### STOP / HELP / START

| Function | File | Trigger | Inputs | Outputs | Firestore | External | Errors / retries |
|----------|------|---------|--------|---------|-----------|----------|------------------|
| processInboundSms | stopHelpHandler.ts | Called from handleInboundSms | phoneE164, messageBody, messageSid | { handled, keyword?, result? } | get user by phone; updateTenantSmsConsent; user doc smsConsent; userConsents/{uid}/events; logMessage; logPreferenceChange | sendWorkerMessageInternal (Twilio) for STOP/HELP/START confirmations | Returns handled: false on error |
| handleStopKeyword, handleHelpKeyword, handleStartKeyword | stopHelpHandler.ts | Called from processInboundSms | phoneE164, messageBody, twilioMessageSid | { success, messageSent, error? } | tenant smsConsents, user doc, userConsents/events, logMessage | Twilio confirmation SMS | Log and return |

### Push token registration

- **Client-only:** `registerPushToken(uid)` in `firebaseMessaging.ts` writes to `users/{uid}/pushTokens/{token}` via Firestore SDK. No Cloud Function for token registration.

### Push notification send

| Function | File | Trigger | Inputs | Outputs | Firestore | External | Errors / retries |
|----------|------|---------|--------|---------|-----------|----------|------------------|
| sendNotificationAndPush | unifiedWorkerNotifications.ts | N/A (exported) | uid, tenantId, title, body, type?, ctaUrl?, threadId?, entity? | notificationId | Write users/{uid}/notifications; read users/{uid}/pushTokens | getPushProvider().sendPush (FCM) | Log only |
| onApplicationCreatedPush | triggers/onApplicationCreatedPush.ts | Firestore onCreate `tenants/{tid}/applications/{appId}` | event | — | Read pushTokens; update applicationPushSentAt | sendNotificationAndPush | Catch, no throw |
| onAssignmentUpdatedPush | triggers/onAssignmentUpdatedPush.ts | Firestore onUpdate `tenants/{tid}/assignments/{assignId}` | event | — | Read pushTokens; update lastPushSentForStatus, lastPushSentAt | sendNotificationAndPush | Catch, no throw |

### Notification creation (in-app)

- Same as push: `sendNotificationAndPush` writes to `users/{uid}/notifications` then sends FCM. Other flows (e.g. routingOrchestrator) may call it for push channel.

### Message routing / queue

| Function | File | Trigger | Inputs | Outputs | Firestore | External | Errors / retries |
|----------|------|---------|--------|---------|-----------|----------|------------------|
| sendMessage | routingOrchestrator.ts | N/A (exported) | MessageContext (userId, tenantId, messageTypeId, variables, metadata, …) | SendMessageResult | User, tenant settings, templates, messageLogs; createOutboundRequest for SMS; email provider; sendNotificationAndPush for push | Twilio (via queue), SendGrid/Gmail, FCM | Per-channel; SMS uses queue retries |
| sendUnifiedMessage | routingFunctions.ts | Callable | data: userId, tenantId, messageTypeId, variables, metadata, … | result of sendMessage | Same | Same | Throws HttpsError |
| sendOutboundMessage | twoWayMessaging.ts | N/A (exported) | threadId, recruiterId, body, options? | { requestId, success } | collectionGroup smsThreads; createOutboundRequest | — | Throws |
| sendThreadMessageApi | threadsApi.ts | HTTP POST | query threadId; body body, recruiterId, fromUserId | 200 JSON { success, requestId?, status } | — | sendOutboundMessage | 200 with warning on block |

### Scheduled / queue / PubSub

- **Cloud Tasks queue:** `sms-outbound` (name from env SMS_QUEUE_NAME); task created by enqueueSmsOutbound; worker URL points to processSmsOutbound. Retry config: maxAttempts 10, min/max backoff 30s/3600s.
- **System welcome SMS:** enqueueWelcomeSmsOnUserCreated (Auth user onCreate) in systemSmsTriggers.ts; calls systemSms to getOrCreateThreadForUser + createOutboundRequest with dedupeKey.

### Worker inbox callables

| Function | File | Trigger | Inputs | Outputs | Firestore | External |
|----------|------|---------|--------|---------|-----------|----------|
| markWorkerNotificationRead | unifiedWorkerNotifications.ts | onCall | notificationId (data) | {} | Update users/{uid}/notifications/{id} readAt | — |
| markWorkerThreadRead | unifiedWorkerNotifications.ts | onCall | threadId (data) | {} | Update threads/{threadId} unreadCountByUid[uid]=0 | — |
| sendWorkerThreadMessage | unifiedWorkerNotifications.ts | onCall | threadId, body, tenantId (data) | — | Read threads/{id}; write threads/{id}/messages, update thread unreadCountByUid, lastMessageAt, lastMessagePreview | — (no push/SMS from this stub) |

### Twilio status callback

| Function | File | Trigger | Inputs | Outputs | Firestore | External |
|----------|------|---------|--------|---------|-----------|----------|
| twilioStatusCallback | webhooksApi.ts | HTTP POST (public) | MessageSid, MessageStatus, ErrorCode?, ErrorMessage? | 200 OK | Find messageLog by providerMessageId (scan tenants); updateMessageLogStatus; find thread message by providerMessageId, update status/deliveredAt | — |

---

## 5) Provider integrations

### Twilio

- **Credentials:** Firebase Functions params secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_PHONE_NUMBER`, `TWILIO_A2P_CAMPAIGN` (twilioSecrets.ts). Loaded in handleInboundSms, processSmsOutbound, stopHelpHandler (via sendWorkerMessageInternal in twilio.ts).
- **Numbers:** Recruiter-specific numbers stored in `tenants/{tid}/recruiterNumbers/{recruiterId}`; assignment via assignRecruiterNumber callable (recruiterNumbers.ts). Inbound webhook URL in comments: `https://us-central1-hrx1-d3beb.cloudfunctions.net/twilioInboundSmsWebhook` (or handleInboundSms in some references).
- **Inbound webhook:** `twilioInboundSmsWebhook` (webhooksApi.ts) → handleInboundSms (inboundSmsWebhook.ts). POST, form body: From, To, Body, MessageSid.
- **Status callbacks:** `twilioStatusCallback` (webhooksApi.ts) handles MessageStatus (queued/sent/delivered/failed); updates messageLogs and thread message doc. No custom status callback URL set in outbound send in this inventory (would need to be set when calling Twilio API to point to twilioStatusCallback).

### Push (FCM)

- **Token registration:** Client only. Worker app: `firebaseMessaging.ts` getToken(messaging, { vapidKey }), then setDoc `users/{uid}/pushTokens/{token}` with token, platform: 'web', enabled: true. Requires REACT_APP_FIREBASE_VAPID_KEY.
- **Token storage:** `users/{uid}/pushTokens` (doc ID = token string).
- **Sending:** FcmPushProvider (FcmPushProvider.ts): admin.messaging().send({ token, notification: { title, body }, data: { ...params.data, tenantId, messageTypeId, userId } }). Used by sendNotificationAndPush and routingOrchestrator for push channel.
- **Web vs mobile:** Implementation is web (VAPID, web token). No APNS or Android-specific SDK in this inventory.

### Email

- **Providers:** emailProviderFactory returns SendGrid or Gmail (sendGridEmailProvider, gmailEmailProvider). Used by routingOrchestrator for email channel.
- **Templates:** Tenant messageTemplates; templateEngine getTemplate, renderTemplate, renderTemplateHtmlBody. SendGrid/Gmail send from orchestrator.
- **Webhooks:** sendGridWebhook (functions) for bounces/complaints (referenced in codebase).

---

## 6) End-to-end flow diagrams (text-based)

### A) Worker receives outbound SMS

1. **Trigger:** Admin sends from Text Messages page → POST sendThreadMessageApi (body, recruiterId, threadId).
2. **API:** sendThreadMessageApi → sendOutboundMessage(threadId, recruiterId, body).
3. **Two-way:** sendOutboundMessage loads thread (collectionGroup smsThreads), gets candidatePhone, twilioNumber, tenantId → createOutboundRequest({ tenantId, threadId, toPhoneE164, body, source: 'manual', requestedByUid }).
4. **Firestore:** Document created in tenants/{tid}/smsOutboundRequests with status 'queued'.
5. **Trigger:** enqueueSmsOutbound (onCreate) → Cloud Tasks create task for queue sms-outbound, payload { tenantId, requestId }.
6. **Worker:** processSmsOutbound HTTP invoked by Tasks → load request, check compliance (consent, STOP), apply footer, getSmsProvider().sendSms() → Twilio.
7. **Firestore:** On success: write message to tenants/{tid}/smsThreads/{threadId}/messages (outbound), update thread lastMessageAt/lastOutboundAt/lastMessageSnippet, update request status 'sent', twilioMessageSid; create/update messageLog.
8. **Status:** If Twilio status callback URL is set, twilioStatusCallback updates messageLog and thread message status (sent/delivered/failed).

### B) Worker replies to SMS (inbound)

1. **Twilio:** User replies → Twilio POST to twilioInboundSmsWebhook (or handleInboundSms).
2. **Handler:** handleInboundSms → processInboundSms (STOP/HELP/START) or handleRegularInboundMessage.
3. **Regular message:** Query collectionGroup('smsThreads') where candidatePhone==From, twilioNumber==To, status=='open', orderBy lastOutboundAt desc, limit 1; or find user by phoneE164 → tenantId/candidateId; findOrCreateThread then createInboundMessage(threadId, body, messageSid, { tenantId, language }).
4. **Firestore:** New doc in tenants/{tid}/smsThreads/{threadId}/messages (direction: inbound, fromType: candidate); thread updated lastMessageAt, lastInboundAt, lastMessageSnippet, unreadCountForRecruiter increment; logMessage to tenants/{tid}/messageLogs; createAIDraft (optional).
5. **Admin visibility:** TextMessagesPage listens to tenants/{tid}/smsThreads and tenants/{tid}/smsThreads/{threadId}/messages → new message appears in real time. No separate “notify recruiter” push/email yet (TODO).

### C) Worker receives push notification

1. **Trigger:** e.g. application created → onApplicationCreatedPush (Firestore onCreate tenants/.../applications).
2. **Function:** Load userId from application; if !applicationPushSentAt → sendNotificationAndPush({ uid, tenantId, title, body, type: 'application', ctaUrl, entity }).
3. **Firestore:** Write users/{uid}/notifications/{id} (title, body, createdAt, readAt: null, ctaUrl, entity, …).
4. **Push:** Read users/{uid}/pushTokens where enabled==true; getPushProvider().sendPush({ targets: [{ userId, deviceTokens }], title, body, data: { deepLink, notificationId, threadId, ctaUrl } }).
5. **FCM:** admin.messaging().send per token.
6. **Client:** Worker device receives notification; foreground listener in usePushNotifications can show in-app toast; deep link opens app to ctaUrl (e.g. /c1/workers/applications).
7. **Idempotency:** Application doc updated applicationPushSentAt so duplicate trigger does not resend.

### D) Worker views notifications table

1. **Page:** /c1/workers/notifications loads; useWorkerNotifications(uid) subscribes to users/{uid}/notifications orderBy createdAt desc limit 100.
2. **Firestore:** Client reads users/{uid}/notifications (allowed: auth.uid==userId).
3. **UI:** List with filter (all/unread/type), mark read via markNotificationReadCallable → Cloud Function updates readAt.
4. **Click:** getNotificationUrlAsync → navigate to ctaUrl or /c1/workers/inbox/{threadId}.

### E) Worker inbox (threads)

1. **Page:** /c1/workers/inbox; useWorkerThreads(uid) queries collection `threads` where participantUids array-contains uid, orderBy lastMessageAt desc.
2. **Firestore:** **No rule for `threads`** — request may fail with permission denied unless rules added or access via callables only.
3. **Select thread:** useWorkerThreadMessages(threadId) queries threads/{threadId}/messages orderBy createdAt asc — same rule gap.
4. **Mark read:** markThreadReadCallable(uid, threadId) → server updates threads/{threadId} unreadCountByUid[uid]=0.
5. **Send:** sendWorkerThreadMessageCallable({ threadId, senderUid, body, tenantId }) → server adds message to threads/{threadId}/messages, updates thread unreadCountByUid and lastMessageAt. No SMS/push from this callable (in-app only).

### F) Admin views / responds to SMS

1. **Page:** TextMessagesPage; tenantId from activeTenant; real-time listener on tenants/{tenantId}/smsThreads (orderBy lastMessageAt desc).
2. **Firestore:** Client reads smsThreads and smsThreads/{id}/messages (rules: isInternal(tenantId)).
3. **Select thread:** useSmsThreadMessages({ tenantId, threadId }) → listener on messages subcollection; inbound and outbound messages appear.
4. **Send reply:** User types, clicks Send → POST sendThreadMessageApi?threadId=… with body, recruiterId, fromUserId → sendOutboundMessage → createOutboundRequest → queue → processSmsOutbound → Twilio; new outbound message doc written to thread, so UI updates via listener.

---

## 7) Known issues / TODOs (from code)

- **inboundSmsWebhook.ts:** “TODO: Determine primaryRecruiterId based on routing rules”; “TODO: Notify recruiter(s) with access to thread.”
- **smsOutboundQueue.ts:** “TODO: Check template settings for autoAppendOptOutFooter.”
- **threadsApi.ts:** “TODO: Add authentication” (sendThreadMessageApi, createThreadApi, getThreadApi, listThreadsApi).
- **templatesApi.ts, emailThreadsApi.ts, messagingApi.ts, automationsApi.ts, aiAssistApi.ts, adminApi.ts:** Multiple “TODO: Add authentication” or “TODO: Add authentication and permission checks.”
- **stopHelpHandler.ts:** notifyRecruitersOfOptOut is a stub (logs only).
- **Firestore rules:** No rules for root-level `threads` or `threads/{id}/messages`; no rules for `userConsents`.
- **Path mismatch:** firestorePaths `userDeviceTokens` vs actual `pushTokens` usage.
- **Twilio status:** Status callback finds message log by scanning tenants; no tenantId in webhook payload.

---

## What to tackle first

1. **Add Firestore rules for worker inbox**  
   Define read (and minimal write) for `threads` and `threads/{threadId}/messages` so worker client can list threads and messages (e.g. allow read where request.auth.uid in resource.data.participantUids for threads; for messages, allow read if parent thread allows user). Alternatively, move worker inbox to callable-backed list (no direct client read).

2. **Fix push token path consistency**  
   Either rename firestorePaths to `userPushTokens` and path `users/{uid}/pushTokens`, or migrate storage to `deviceTokens` and update client + server to one name.

3. **Harden sendThreadMessageApi auth**  
   Validate request.auth and set recruiterId from auth.uid (or tenant role), and ensure tenantId is derived from thread.

4. **Recruiter notification on inbound reply**  
   Implement “notify recruiter(s) with access to thread” (e.g. create in-app notification or push for assigned/participating recruiters when createInboundMessage runs).

5. **Twilio status callback scope**  
   Include tenantId (or threadId) in outbound request metadata and pass to Twilio as custom parameter so status callback can update message log and thread message without scanning tenants.

6. **Optional: userConsents rules**  
   If any client ever needs to read compliance events, add read rule for userConsents for the owning user or admins; writes can remain server-only.

This inventory is exhaustive from the codebase searched; any production-only or environment-specific wiring (e.g. Twilio status URL set on outbound send) should be confirmed in deployment config.
