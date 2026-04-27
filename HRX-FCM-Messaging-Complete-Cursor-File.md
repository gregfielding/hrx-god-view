# HRX FCM Web Push + Messaging Unification — FINAL Implementation File
_Last generated: 2026-02-13T20:28:35.277146 UTC_

This file contains COMPLETE instructions to:

1. Implement FCM Web Push in CRA correctly
2. Standardize token storage (single canonical model)
3. Add required Firestore rules
4. Align backend functions to unified token path
5. Ensure notifications + threads are future-proof for Flutter
6. Enable real-time worker + admin messaging architecture

This replaces any partial implementations.

---

# 🚀 GOAL

By the end of this implementation:

- Web push works in browser (CRA)
- Tokens stored in ONE canonical place
- Notifications written to Firestore
- Worker sees real-time updates
- Push fires when:
  - System notification is created
  - Thread message is sent
- Architecture is 100% compatible with future Flutter apps
- Admin can later build Inbox + User Message panel on same model

---

# 🧱 CANONICAL DATA MODEL (DO NOT DEVIATE)

## 1️⃣ Push Tokens (Unified Path)

users/{uid}/pushTokens/{token}

Fields:

{
  token: string,
  platform: "web" | "ios" | "android",
  deviceId: string,
  enabled: boolean,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}

STOP USING:
- deviceTokens
- devices

Everything must use pushTokens going forward.

---

## 2️⃣ Notifications

users/{uid}/notifications/{notificationId}

{
  title: string,
  body: string,
  type: "system" | "application" | "assignment" | "thread",
  read: boolean,
  deepLink: string | null,
  threadId: string | null,
  createdAt: serverTimestamp()
}

---

## 3️⃣ Threads

threads/{threadId}

{
  participantIds: string[],
  lastMessageAt: serverTimestamp(),
  lastMessagePreview: string
}

threads/{threadId}/messages/{messageId}

{
  senderId: string,
  body: string,
  createdAt: serverTimestamp()
}

---

# 🧩 STEP 1 — SERVICE WORKER

Create:

public/firebase-messaging-sw.js

```js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  messagingSenderId: "...",
  appId: "..."
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'HRX Notification';
  const options = {
    body: payload.notification?.body,
    data: payload.data
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const deepLink = event.notification.data?.deepLink;
  if (deepLink) {
    event.waitUntil(clients.openWindow(deepLink));
  }
});
```

---

# 🧩 STEP 2 — CLIENT MESSAGING INIT

Create:

src/firebaseMessaging.ts

```ts
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app, db } from "./firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export const messaging = getMessaging(app);

export async function registerPushToken(uid: string) {
  const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;

  const token = await getToken(messaging, { vapidKey });
  if (!token) return;

  await setDoc(
    doc(db, "users", uid, "pushTokens", token),
    {
      token,
      platform: "web",
      deviceId: "web-" + navigator.userAgent,
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export function listenForegroundNotifications(callback: (payload: any) => void) {
  onMessage(messaging, callback);
}
```

---

# 🧩 STEP 3 — SERVICE WORKER REGISTRATION

Modify:

src/index.tsx

Add:

```ts
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/firebase-messaging-sw.js");
  });
}
```

---

# 🧩 STEP 4 — HOOK FOR WORKERS

Create:

src/hooks/usePushNotifications.ts

```ts
import { useEffect } from "react";
import { registerPushToken, listenForegroundNotifications } from "../firebaseMessaging";

export function usePushNotifications(uid?: string) {
  useEffect(() => {
    if (!uid) return;

    registerPushToken(uid);

    listenForegroundNotifications((payload) => {
      console.log("Foreground notification:", payload);
    });
  }, [uid]);
}
```

Use inside WorkerLayout or Dashboard.

---

# 🧩 STEP 5 — FIRESTORE RULES

Add:

match /users/{uid}/pushTokens/{token} {
  allow read, write: if request.auth.uid == uid;
}

match /users/{uid}/notifications/{notificationId} {
  allow read, update: if request.auth.uid == uid;
  allow create: if false;
}

Deploy rules.

---

# 🧩 STEP 6 — BACKEND PUSH ALIGNMENT

Update all Cloud Functions to:

1. Read tokens from users/{uid}/pushTokens
2. Send push via Admin SDK
3. Include deepLink in payload.data

Example:

```ts
const message = {
  token,
  notification: { title, body },
  data: { deepLink }
};
```

---

# 🧩 STEP 7 — THREAD MESSAGE PUSH

When writing a new thread message:

1. Write message
2. Write notification doc
3. Send push

Push type: "thread"
deepLink: /c1/workers/support?thread={threadId}

---

# 🧩 STEP 8 — FUTURE FLUTTER COMPATIBILITY

Flutter app should:

- Register token using same pushTokens path
- Use same deepLink model
- Subscribe to same threads + notifications collections
- Never depend on web-specific logic

---

# 🧩 STEP 9 — GO LIVE CHECKLIST

- Test browser permission flow
- Verify pushTokens document is created
- Send test notification
- Verify:
  - Push appears
  - Click opens correct deepLink
  - Notification doc appears in Firestore
  - Worker notifications page updates real-time
- Confirm no duplicate token paths exist

---

END OF FILE
