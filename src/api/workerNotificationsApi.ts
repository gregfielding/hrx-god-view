/**
 * Client API for unified worker notifications + inbox (callables).
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export async function markNotificationReadCallable(uid: string, notificationId: string): Promise<void> {
  const fn = httpsCallable<{ uid: string; notificationId: string }, void>(functions, 'markWorkerNotificationRead');
  await fn({ uid, notificationId });
}

export async function markThreadReadCallable(uid: string, threadId: string): Promise<void> {
  const fn = httpsCallable<{ uid: string; threadId: string }, void>(functions, 'markWorkerThreadRead');
  await fn({ uid, threadId });
}

export async function sendWorkerThreadMessageCallable(payload: {
  threadId: string;
  senderUid: string;
  body: string;
  tenantId: string;
}): Promise<{ messageId: string }> {
  const fn = httpsCallable<
    { threadId: string; senderUid: string; body: string; tenantId: string },
    { messageId: string }
  >(functions, 'sendWorkerThreadMessage');
  const res = await fn(payload);
  return res.data;
}
