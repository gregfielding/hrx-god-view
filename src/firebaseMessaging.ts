/**
 * FCM Web Push — canonical token registration and foreground listener.
 * Tokens stored at users/{uid}/pushTokens/{token} per HRX-FCM-Messaging-Complete.
 */

import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './firebase';

let messagingInstance: Messaging | null = null;

/** `index.tsx` unregisters SWs on localhost to avoid stale CRA bundles; FCM requires a SW — skip push here. */
function isPushSupportedEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return false;
  return true;
}

async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  if (!messagingInstance) messagingInstance = getMessaging(app);
  return messagingInstance;
}

function isBenignPushFailure(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: string }).code) : '';
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: string }).name) : '';
  const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as Error).message) : '';
  return (
    code === 'messaging/failed-service-worker-registration' ||
    name === 'QuotaExceededError' ||
    message.includes('QuotaExceeded')
  );
}

/**
 * Register FCM token for the current device and write to users/{uid}/pushTokens/{token}.
 * Call when user is signed in (e.g. from usePushNotifications).
 * Failures are non-fatal (push is optional; must not affect auth).
 */
export async function registerPushToken(uid: string): Promise<void> {
  const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;
  if (!vapidKey) return;

  if (!isPushSupportedEnvironment()) return;

  try {
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
  } catch (e) {
    if (isBenignPushFailure(e)) return;
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('[FCM] registerPushToken failed (non-fatal):', e);
    }
  }
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
