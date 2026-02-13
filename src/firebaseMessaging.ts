/**
 * FCM Web Push — canonical token registration and foreground listener.
 * Tokens stored at users/{uid}/pushTokens/{token} per HRX-FCM-Messaging-Complete.
 */

import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './firebase';

let messagingInstance: Messaging | null = null;

async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  if (!messagingInstance) messagingInstance = getMessaging(app);
  return messagingInstance;
}

/**
 * Register FCM token for the current device and write to users/{uid}/pushTokens/{token}.
 * Call when user is signed in (e.g. from usePushNotifications).
 */
export async function registerPushToken(uid: string): Promise<void> {
  const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn('[FCM] REACT_APP_FIREBASE_VAPID_KEY not set; push registration skipped.');
    return;
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return;

  const token = await getToken(messaging, { vapidKey });
  if (!token) return;

  await setDoc(
    doc(db, 'users', uid, 'pushTokens', token),
    {
      token,
      platform: 'web',
      deviceId: 'web-' + (navigator.userAgent?.slice(0, 80) ?? 'unknown'),
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Subscribe to foreground messages (when app is open). Use for toasts or in-app updates.
 */
export function listenForegroundNotifications(callback: (payload: unknown) => void): () => void {
  let unsub: (() => void) | undefined;
  getMessagingInstance().then((messaging) => {
    if (!messaging) return;
    unsub = onMessage(messaging, callback);
  });
  return () => unsub?.();
}
