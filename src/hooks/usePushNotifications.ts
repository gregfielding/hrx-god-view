/**
 * Worker FCM push — register token when user is signed in and listen for foreground messages.
 * Use inside WorkerLayout or Dashboard so tokens are stored at users/{uid}/pushTokens/{token}.
 */

import { useEffect } from 'react';
import { registerPushToken, listenForegroundNotifications } from '../firebaseMessaging';

export function usePushNotifications(uid: string | undefined): void {
  useEffect(() => {
    if (!uid) return;

    void registerPushToken(uid);

    const unsub = listenForegroundNotifications((payload) => {
      console.log('[FCM foreground]', payload);
      // Optional: show in-app toast when notification received while tab is open
    });

    return () => unsub();
  }, [uid]);
}
