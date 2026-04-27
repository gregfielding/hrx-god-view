# Messaging Review: SendGrid Email + FCM Push (Apply-to-Job Flow)

**Context:** When a worker applies for a job, the system should send SMS, email, and push. SMS has been working. Email and push need verification. This doc summarizes current setup and gaps before you test.

---

## 1. How “Apply to Job” Messaging Works Today

1. **Firestore trigger:** `onApplicationCreated` in `functions/src/applicationSmsTriggers.ts` runs when a doc is created under `tenants/{tenantId}/applications/{applicationId}`.
2. **First path (preferred):** It calls `sendLegacyApplicationStatusMessage`, which tries **dispatchSystemMessage** with trigger `application_received`.
   - If you have a **Message Automation Rule** for “Application Received” in the tenant (with a template and **delivery channels** set to SMS + Email + Push), that rule runs and the orchestrator sends to all selected channels.
   - So your “updated message” is likely that rule. If the rule has email and push enabled, those will be attempted.
3. **Fallback path:** If no rule matches (or rule doesn’t handle it), it falls back to **sendMessage** with **overrideChannels: ['sms']** — so **only SMS** is sent. Email and push are never attempted in the fallback.

**Takeaway:** For email and push to run on apply, you need either:
- A Message Automation Rule for “Application Received” with Email and Push channels enabled, **or**
- A code change to remove the SMS-only override and add push to the message type (see below).

---

## 2. SendGrid Email Settings

### Where it’s used
- **Orchestrator:** `routingOrchestrator.ts` → `deliverEmail()` → `getEmailProvider()` from `emailProviderFactory.ts`.
- **Factory:** Uses SendGrid when sender is system (default). Config comes from **Firebase params secrets** or **process.env**:
  - `SENDGRID_API_KEY`
  - `SENDGRID_FROM_EMAIL` (default `noreply@hrxone.com` if unset)
  - `SENDGRID_FROM_NAME` (default `HRX One`)

### What to check
- **Secrets:** `applicationSmsTriggers` only declares Twilio secrets. It does **not** declare SendGrid secrets. So when the trigger runs and the orchestrator calls `getEmailProvider()`, the factory uses **process.env** (or Firebase config if you set it there). Ensure in your Firebase project:
  - **Option A:** Set **Secret Manager** secrets `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` and add them to the **onApplicationCreated** (and any other) function that eventually calls the orchestrator, e.g.:
    - In `applicationSmsTriggers.ts`: add `sendGridApiKey`, `sendGridFromEmail`, `sendGridFromName` from `emailProviderFactory` to the trigger’s `secrets` array so they’re injected at runtime.
  - **Option B:** Set **environment config** for the Cloud Functions so `process.env.SENDGRID_API_KEY`, `process.env.SENDGRID_FROM_EMAIL`, and `process.env.SENDGRID_FROM_NAME` are set (e.g. via Firebase config or your deployment pipeline).
- **SendGrid dashboard:** Verify the API key is valid, the “from” sender is verified, and domain authentication is set if you use a custom domain.
- **Deliverability:** If emails don’t arrive, check SendGrid Activity and spam; ensure no-reply address isn’t blocked.

---

## 3. FCM Push Setup

### Backend (orchestrator)
- **Channel check:** For push, `shouldUseChannel` in `routingOrchestrator.ts` requires:
  - Tenant has push enabled.
  - User’s **notification settings** have push enabled (`notificationSettings.push.enabled`).
  - User has **push tokens:** `userData.pushTokens` must be a non-empty array on the **user** document.
- **Sending:** `deliverPush()` uses **getDeviceTokensForUser(userId)** to get tokens. That function reads:
  - `users/{userId}/devices` subcollection (docs with `active === true`, fields `fcmToken` or `pushToken` or `token`), **or**
  - Root `devices` collection (where `userId` and `active === true`).
- It does **not** read from `users/{uid}/deviceTokens`, which is where **registerWorkerDeviceToken** (unified worker notifications) writes.

So there are two separate mechanisms:
- **Orchestrator:** expects tokens from `users/{uid}/devices` (or root `devices`) and/or a `pushTokens` array on the user doc.
- **Unified worker flow:** `registerWorkerDeviceToken` writes to `users/{uid}/deviceTokens` and `sendNotificationAndPush` reads from there.

### Frontend (worker web app)
- **No FCM registration in codebase:** There is no `getToken()` or Firebase Messaging initialization in the worker view. The docs (e.g. `ADMIN_MESSAGING_MESH_UNIFIED_WORKER_NOTIFICATIONS.md`) list: “TODO (web): Add Firebase Messaging (FCM) in the worker web app, request permission, get token, call **registerWorkerDeviceToken**.”
- So **web push is not wired yet:** no token is registered when a worker uses the web app, so the backend has no token to send to for web.

### In-app Notifications and Inbox
- **Notifications list** (`/c1/workers/notifications` and the bell dropdown) reads from **Firestore** `users/{uid}/notifications` (see `useWorkerNotifications`).
- Those docs are written by **sendNotificationAndPush** (unified worker notifications). The **application-created** flow does **not** call `sendNotificationAndPush`; it only goes through the legacy path (SMS, and optionally email/push via the orchestrator). So even if we sent FCM, we are **not** writing a notification doc for “application received” into `users/{uid}/notifications`, so nothing would show in the worker Notifications UI from the apply event unless we add that.

**Takeaway:** Before push and in-app notifications work for “apply to job”:
1. **Web FCM:** Add Firebase Messaging in the worker web app, request permission, get token, call `registerWorkerDeviceToken` with `platform: 'web'`.
2. **Token usage:** Either (a) have the orchestrator also read from `users/{uid}/deviceTokens` (and/or sync tokens to `user.pushTokens` or `users/{uid}/devices` when registering), or (b) have the application-created flow call `sendNotificationAndPush` so a notification is written and FCM is sent using the unified `deviceTokens` path.
3. **In-app list:** To show “application received” in the worker Notifications UI, something must write to `users/{uid}/notifications` (e.g. call `sendNotificationAndPush` when an application is created).

---

## 4. Message Type: Application Received

In `messageTypesRegistry.ts`, `application_received` is defined with:
- **defaultChannels: ['sms', 'email']** — **push is not included.**

So even if you don’t override channels, the default for this type is only SMS + email. To support push from the message type as well, add `'push'` to `defaultChannels` for `application_received`.

---

## 5. Quick Checklist Before You Test

| Item | Status / Action |
|------|------------------|
| **Message Automation Rule** for “Application Received” | Ensure it exists and has **SMS + Email + Push** in delivery channels and a template. |
| **SendGrid env / secrets** | Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` (env or Secret Manager and declare on the trigger if using secrets). |
| **SendGrid sender** | Verify “from” address in SendGrid and domain. |
| **application_received defaultChannels** | Add `'push'` if you want the type to allow push when no rule overrides. |
| **Legacy fallback** | Optionally change `overrideChannels: ['sms']` to no override (or `['sms','email','push']`) so fallback also tries email/push. |
| **Web FCM** | Not implemented yet; add FCM in worker web app and call `registerWorkerDeviceToken`. |
| **Token storage** | Unify so orchestrator uses the same tokens as `registerWorkerDeviceToken` (e.g. read `deviceTokens` or sync to `user.pushTokens` / `users/{uid}/devices`). |
| **In-app notification** | To show “application received” in Notifications/Inbox, call `sendNotificationAndPush` (or equivalent) when an application is created. |

---

## 6. Files to Touch (for reference)

- **SendGrid / email:** `functions/src/messaging/emailProviderFactory.ts`, `sendGridEmailProvider.ts`; `applicationSmsTriggers.ts` (add SendGrid secrets to trigger if using Secret Manager).
- **Push / tokens:** `functions/src/messaging/routingOrchestrator.ts` (`getDeviceTokensForUser`, `shouldUseChannel`); `functions/src/messaging/unifiedWorkerNotifications.ts` (`sendNotificationAndPush`, `registerWorkerDeviceToken`).
- **Application flow:** `functions/src/applicationSmsTriggers.ts`; `functions/src/messaging/legacyMessageHelpers.ts` (`sendLegacyApplicationStatusMessage`); `functions/src/messaging/messageTypesRegistry.ts` (`application_received`).
- **Worker UI:** Notifications from `users/{uid}/notifications`; FCM registration to be added in worker layout or a dedicated provider.
