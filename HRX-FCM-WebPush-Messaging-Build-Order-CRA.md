# HRX — FCM Web Push + Messaging Threads (CRA) — Build Order + File Checklist
**Target:** Get **FCM web push** working end-to-end in the Worker web app (in-browser), and lay the **messaging foundation** so Admins can view conversation history on a user record and message back-and-forth via threads.

> Repo reality (confirmed):
> - Framework: **Create React App (CRA)** (`react-scripts` 5.x)
> - Firebase init: **`src/firebase.ts`**
> - Env vars: **CRA exposes only `REACT_APP_*`**

---

## 0) Definitions & North Star (how we do this “the right way”)
### 0.1 Channels (now + future)
- **Push (FCM):** delivery mechanism (web now; Flutter later)
- **In-app messages:** canonical conversation history and thread UX (real-time)
- **SMS/Email:** separate transports, optionally bridged into the same thread model later

### 0.2 Golden Rule
**Firestore is the system of record.**  
FCM is for delivery only; **the message/notification must exist in Firestore** so:
- the Worker sees it in-app (even if push fails)
- Admins see full history
- read/unread is consistent
- Flutter can share the same backend later

### 0.3 What “done” means (minimum viable)
Worker web app:
- Worker enables push notifications
- FCM token stored under user
- Server sends push
- Notification appears in the Worker Notifications UI (real-time)
- Opening notification marks it read and removes from unread count

Admin app:
- Recruiter/Admin can open a **Messages/Threads** area
- From a **User record page**, Admin can see thread history and send a message into that thread
- Worker can respond via **in-app support messages** (not via push replies)

---

## 1) Data Model (canonical) — do this first
### 1.1 Push tokens
**Path:**
- `users/{uid}/pushTokens/{token}`

**Fields:**
- `token: string`
- `platform: "web" | "ios" | "android"`
- `deviceId: string`
- `enabled: boolean`
- `userAgent?: string`
- `locale?: string`
- `createdAt: serverTimestamp`
- `lastSeenAt: serverTimestamp`

### 1.2 Notifications (system events)
**Path:**
- `users/{uid}/notifications/{notificationId}`

**Fields:**
- `type: "application" | "assignment" | "documents" | "general" | "system"`
- `title: string`
- `body: string`
- `deepLink?: string` (e.g. `/c1/workers/applications`)
- `data?: map` (applicationId, jobId, etc.)
- `status: "unread" | "read"`
- `createdAt: serverTimestamp`
- `readAt?: serverTimestamp`
- `sent?: { provider: "fcm"; multicastCount?: number; successCount?: number; failureCount?: number; sentAt?: timestamp }`

### 1.3 Messaging Threads (conversation history)
We need a unified structure that works for:
- Admin ↔ Worker support
- “System” messages (no reply required) (optional thread)
- Later: SMS bridging (optional)

**Recommended (simple + scalable):**
- `threads/{threadId}`
- `threads/{threadId}/messages/{messageId}`

**Thread ID pattern (support):**
- `support_{uid}` (one support thread per worker)  
or if multi-tenant later:
- `support_{tenantId}_{uid}`

**threads/{threadId} fields:**
- `threadType: "support" | "system" | "job" | "sms" | "email"`
- `participantUids: string[]` (includes worker uid; optionally admin uid(s) or tenantId)
- `workerUid: string` (for fast lookup)
- `tenantId?: string`
- `lastMessageAt: timestamp`
- `lastMessagePreview: string`
- `unreadCounts: { [uid: string]: number }`  *(optional; can compute client-side early)*

**threads/{threadId}/messages/{messageId} fields:**
- `senderUid?: string` (null/undefined for “system”)
- `senderRole: "worker" | "admin" | "system"`
- `text: string`
- `createdAt: serverTimestamp`
- `delivery?: { fcm?: boolean; sms?: boolean; email?: boolean }`
- `readBy?: { [uid: string]: timestamp }` *(optional; can start with status per user later)*

**Why this model works:**
- Worker can have a “Support” tab with real-time messages
- Admin user record can load `support_{uid}` and show all messages
- Push notifications can be sent for new messages, but history stays in Firestore
- Flutter can reuse the same collections

---

## 2) Firebase Console Setup (FCM)
### 2.1 Web Push certificate (VAPID)
Firebase Console → Project settings → Cloud Messaging → Web Push certificates:
- Generate key pair
- Copy **VAPID public key**

### 2.2 Confirm Firebase config values
Use the same values as in `src/firebase.ts` for the service worker config.

---

## 3) Environment Variables (CRA)
### 3.1 Local env
**File:** `.env` (or your local env file CRA loads)

Add:
```bash
REACT_APP_FIREBASE_VAPID_KEY=YOUR_PUBLIC_VAPID_KEY_HERE
```

**Do not commit** real secrets. Optionally create `.env.example`.

### 3.2 In code
```ts
const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;
```

---

## 4) Service Worker (required for web push)
### 4.1 Create SW file (CRA path)
**Create:** `public/firebase-messaging-sw.js`  
CRA serves `/public` at site root, so this becomes `/firebase-messaging-sw.js`.

```js
/* public/firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

// Replace with your Firebase config (same values as src/firebase.ts)
firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
});

const messaging = firebase.messaging();

// Background notifications
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Notification";
  const options = {
    body: payload?.notification?.body || "",
    data: payload?.data || {},
  };
  self.registration.showNotification(title, options);
});

// Click routing
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const deepLink = event.notification?.data?.deepLink || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(deepLink);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(deepLink);
    })
  );
});
```

---

## 5) Register the Service Worker (CRA entry)
### 5.1 Modify CRA entry
**Modify:** `src/index.tsx`

```ts
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .catch((err) => console.error("[SW] registration failed", err));
  });
}
```

---

## 6) Firebase Messaging client helpers (using src/firebase.ts)
### 6.1 Ensure src/firebase.ts exports `app` and `db`
Open `src/firebase.ts` and confirm you export:
- `export const app = initializeApp(firebaseConfig);`
- `export const db = getFirestore(app);`

*(If you use different names, keep them consistent and update imports below.)*

### 6.2 Create messaging helper
**Create:** `src/firebaseMessaging.ts`

```ts
import { getMessaging, isSupported, Messaging } from "firebase/messaging";
import { app } from "./firebase";

export async function getBrowserMessaging(): Promise<Messaging | null> {
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  return getMessaging(app);
}
```

---

## 7) Token registration hook (Enable Push flow)
### 7.1 Create hook
**Create:** `src/hooks/usePushNotifications.ts`

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";
import { db } from "../firebase";
import { getBrowserMessaging } from "../firebaseMessaging";
import { useAuth } from "../auth/useAuth"; // adjust to your auth hook

function getDeviceId() {
  const key = "hrx_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>(Notification.permission);
  const [token, setToken] = useState<string | null>(null);
  const deviceId = useMemo(() => getDeviceId(), []);

  const register = useCallback(async () => {
    if (!user?.uid) throw new Error("Not signed in");

    const messaging = await getBrowserMessaging();
    if (!messaging) throw new Error("Messaging not supported in this browser");

    const p = await Notification.requestPermission();
    setPermission(p);
    if (p !== "granted") return { ok: false as const, reason: "permission_denied" as const };

    const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;
    if (!vapidKey) throw new Error("Missing REACT_APP_FIREBASE_VAPID_KEY");

    const t = await getToken(messaging, { vapidKey });
    if (!t) return { ok: false as const, reason: "token_missing" as const };

    setToken(t);

    await setDoc(
      doc(db, "users", user.uid, "pushTokens", t),
      {
        token: t,
        platform: "web",
        deviceId,
        enabled: true,
        userAgent: navigator.userAgent,
        locale: navigator.language,
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true as const, token: t };
  }, [user?.uid, deviceId]);

  // Foreground messages (site open)
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const messaging = await getBrowserMessaging();
      if (!messaging) return;
      unsub = onMessage(messaging, (payload) => {
        console.log("[FCM foreground]", payload);
        // OPTIONAL: show toast/snackbar
        // Canonical event should come from Firestore (server write).
      });
    })();
    return () => unsub?.();
  }, []);

  return { register, permission, token };
}
```

---

## 8) Worker UI wiring
### 8.1 Add “Enable Push Notifications” control
Add a button to Worker Settings or Dashboard card:
- Calls `register()`
- Shows status based on `permission`
- Copy examples:
  - Permission default: “Enable push notifications”
  - Denied: “Notifications are blocked in your browser settings”
  - Granted: “Notifications enabled”

### 8.2 Notifications page (real-time + read-on-open)
**Modify:** `src/pages/c1/workers/notifications.tsx` (or your worker notifications path)

Checklist:
- Subscribe `users/{uid}/notifications` ordered by `createdAt desc` (limit 50)
- Maintain local unread filter (or tabs)
- On row click:
  - update doc: `{ status: "read", readAt: serverTimestamp() }`
  - navigate if `deepLink` exists

**“Notifications disappear on open”**
- If your UI defaults to Unread tab, the item will disappear immediately after marking read.

---

## 9) Firestore Rules (minimum safe)
### 9.1 pushTokens
```
// users/{uid}/pushTokens/{token}
match /users/{uid}/pushTokens/{token} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

### 9.2 notifications (server-only create; user can read + mark read)
```
// users/{uid}/notifications/{notificationId}
match /users/{uid}/notifications/{notificationId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow update: if request.auth != null && request.auth.uid == uid;
  allow create: if false;
}
```

### 9.3 threads + messages (support thread)
Workers can read/write their support thread; admins can read/write based on role/security level.

**NOTE:** You already have role-based patterns. Implement similarly:
- Worker can access threads where `workerUid == request.auth.uid` OR `participantUids has request.auth.uid`
- Admin access: allowed if `isAdmin(request.auth.uid)` or `securityLevel >= X` and tenant matches

---

## 10) Cloud Functions (canonical send)
### 10.1 Function A — sendNotificationToUser (FCM + Firestore)
**Creates Firestore notification doc + sends push.**

Steps:
1) Validate input (zod)
2) Create notification doc under `users/{uid}/notifications/{id}`
3) Fetch pushTokens subcollection
4) Send FCM multicast
5) Prune invalid tokens
6) Update notification doc with send stats

### 10.2 Function B — sendThreadMessage (in-app messaging + optional push)
**Creates message doc in `threads/{threadId}/messages/{messageId}` and updates thread summary fields.**
Optionally sends push:
- Worker receives push for new admin message
- Admin receives push for new worker message (later; optional)

**Thread update:**
- `lastMessageAt`, `lastMessagePreview`, unread counts

### 10.3 Trigger — onNewThreadMessage (optional)
Alternative pattern:
- Client writes message (per rules)
- Trigger function sends push + updates unread counters
This is clean for Flutter parity later.

---

## 11) Admin UI requirements (God View) — “conversation history on user record”
### 11.1 User record layout: Messages panel
On user detail page:
- Tab: **Messages**
- Default loads thread `support_{uid}` (or creates it if missing)
- Left: message history (real-time)
- Bottom: composer + Send button
- “Send” writes a thread message via callable (preferred) or direct Firestore write (if rules allow)

### 11.2 Admin “Inbox” page (threads list)
- Shows list of threads the admin has access to
- Sort by `lastMessageAt desc`
- Search by worker name (join using worker profile fields)
- Unread badge per thread (optional v1: compute from last read timestamp)

### 11.3 Permissions for who can reply
Implement a single guard:
- `canReplyToSupportThreads(user)` true if securityLevel >= X (e.g. 5+) and tenant match
- Read-only roles can view but not send

---

## 12) Worker replies — recommended approach
### 12.1 Don’t allow “reply to push”
- Push notifications are outbound alerts only
- Replies happen inside the app via **Support Messages** (thread UI)

### 12.2 Worker Support page
Worker has:
- Menu item: **Support**
- Displays the same support thread `support_{uid}` real-time
- Worker can send message; admins see it immediately

### 12.3 Optional: route push to support thread
When Admin sends a message:
- Push includes `deepLink: "/c1/workers/support"` (or a thread route)

---

## 13) Remove / hide Everee references (for now)
Because Everee isn’t integrated yet:
- Remove “Complete in Everee”
- Replace with neutral CTAs:
  - “Upload”
  - “Update”
  - “Complete onboarding”
- Hide provider chips that say “Everee”
- Keep internal fields (`provider`) if needed, but don’t expose in UI until live

---

## 14) Quick “Go Live” sanity checklist
### 14.1 Browser checklist
- HTTPS in prod (required for SW + notifications)
- `public/firebase-messaging-sw.js` accessible at:
  - `https://YOUR_DOMAIN/firebase-messaging-sw.js`
- Service worker registered (DevTools → Application → Service Workers)
- Permission granted (site settings)
- Token written to Firestore (`pushTokens`)
- Test callable sends push and writes notification record
- Notifications page updates in real-time
- Clicking notification marks read + unread count updates

### 14.2 Admin messaging checklist
- User record shows support thread history
- Admin can send message → worker sees it
- Worker replies → admin sees it
- Optional push sent on new message

---

## 15) File Checklist (exact paths)
### New (web)
- `public/firebase-messaging-sw.js`
- `src/firebaseMessaging.ts`
- `src/hooks/usePushNotifications.ts`
- `src/components/worker/EnablePushCard.tsx` *(optional but recommended)*

### Modify (web)
- `src/index.tsx` (SW registration)
- `src/firebase.ts` (export `app`, `db`)
- `src/pages/c1/workers/notifications.tsx` (real-time + read-on-open)

### New (functions)
- `functions/src/notifications/sendNotificationToUser.ts`
- `functions/src/messages/sendThreadMessage.ts` *(or trigger-based alternative)*

### Modify (functions)
- `functions/src/index.ts` (export new functions)

### Modify (rules)
- `firestore.rules` (pushTokens, notifications, threads/messages rules)

### New (admin UI)
- `src/pages/recruiter/messages/ThreadsInbox.tsx` *(or your route convention)*
- `src/components/recruiter/user/UserMessagesPanel.tsx` (thread UI in user record)

### New (worker UI)
- `src/pages/c1/workers/support.tsx` (support thread)

---

## 16) Implementation Order (do in this order)
1) **FCM Web Push**: service worker + token registration + store token doc
2) **Notifications Firestore + UI**: server writes notification doc + worker reads real-time + mark read
3) **Threads model**: create thread + messages collections + UI on worker + admin user record
4) **Push on message**: function/trigger sends push when message arrives
5) **Inbox list**: admin threads list + permissions

---

## 17) Notes on Work Eligibility
`workEligibility` is **application/profile form data**, not a document.
- Keep it out of Documents upload flows.
- Display it under Profile / Eligibility, not under Documents.

---

## 18) Future-proofing for Flutter (best practice)
- Reuse the same Firestore collections: `threads/*`, `messages/*`, `notifications/*`
- Use triggers/callables for delivery (FCM) to keep clients thin
- Store device tokens similarly for iOS/Android at:
  `users/{uid}/pushTokens/{token}` with platform field
- Prefer `deepLink` routes that exist in web + mobile:
  e.g. `/support`, `/applications`, `/assignments`
