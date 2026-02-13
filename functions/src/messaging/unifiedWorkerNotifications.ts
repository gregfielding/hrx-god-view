/**
 * Unified Worker Notifications + Inbox — Cloud Function stubs
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md §5
 *
 * Firestore: users/{uid}/notifications, users/{uid}/pushTokens (canonical), threads, threads/{id}/messages
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { getPushProvider } from './pushProviderFactory';
const db = admin.firestore();

const NOTIFICATIONS = (uid: string) => `users/${uid}/notifications`;
/** Canonical path per HRX-FCM-Messaging-Complete — do not use deviceTokens/devices */
const PUSH_TOKENS = (uid: string) => `users/${uid}/pushTokens`;
const THREADS = 'threads';
const THREAD_MESSAGES = (threadId: string) => `threads/${threadId}/messages`;

type NotificationType = 'assignment' | 'application' | 'document' | 'shift' | 'payroll' | 'general' | 'system';
type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * 5.1 sendNotificationAndPush — write notification doc + FCM push
 */
export async function sendNotificationAndPush(payload: {
  uid: string;
  tenantId: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  type?: NotificationType;
  ctaUrl?: string;
  ctaLabel?: string;
  threadId?: string;
  entity?: { kind: string; id: string };
  source?: 'system' | 'recruiter' | 'automation';
}): Promise<{ notificationId: string }> {
  const id = db.collection('_').doc().id;
  const ref = db.doc(`${NOTIFICATIONS(payload.uid)}/${id}`);
  const now = admin.firestore.Timestamp.now();
  await ref.set({
    uid: payload.uid,
    tenantId: payload.tenantId,
    type: payload.type ?? 'general',
    title: payload.title,
    body: payload.body,
    severity: payload.severity ?? 'info',
    createdAt: now,
    readAt: null,
    source: payload.source ?? 'system',
    channel: 'push',
    ctaLabel: payload.ctaLabel,
    ctaUrl: payload.ctaUrl,
    threadId: payload.threadId,
    entity: payload.entity,
  });

  const tokensSnap = await db.collection(PUSH_TOKENS(payload.uid)).where('enabled', '==', true).get();
  const deviceTokens = tokensSnap.docs.flatMap((d) => {
    const token = d.data().token ?? d.id;
    return token ? [token] : [];
  });
  const deepLink = payload.ctaUrl ?? (payload.threadId ? `/c1/workers/inbox/${payload.threadId}` : '') ?? '';
  if (deviceTokens.length > 0) {
    const push = getPushProvider();
    await push.sendPush({
      tenantId: payload.tenantId,
      messageTypeId: 'worker_notification',
      targets: [{ userId: payload.uid, deviceTokens }],
      title: payload.title,
      body: payload.body,
      data: { notificationId: id, threadId: payload.threadId ?? '', ctaUrl: payload.ctaUrl ?? '', deepLink },
    });
  }
  logger.info('Unified worker notification created', { notificationId: id, uid: payload.uid });
  return { notificationId: id };
}

/**
 * 5.3 markNotificationRead — callable for worker client
 */
export const markWorkerNotificationRead = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const uid = request.auth.uid;
  const { notificationId } = request.data as { uid?: string; notificationId: string };
  if (!notificationId) throw new HttpsError('invalid-argument', 'notificationId required');
  const ref = db.doc(`${NOTIFICATIONS(uid)}/${notificationId}`);
  await ref.update({ readAt: admin.firestore.Timestamp.now() });
  return {};
});

/**
 * 5.4 markThreadRead — callable for worker client
 */
export const markWorkerThreadRead = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const uid = request.auth.uid;
  const { threadId } = request.data as { uid?: string; threadId: string };
  if (!threadId) throw new HttpsError('invalid-argument', 'threadId required');
  const ref = db.doc(`${THREADS}/${threadId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Thread not found');
  const unread = (snap.data()?.unreadCountByUid as Record<string, number>) ?? {};
  unread[uid] = 0;
  await ref.update({ unreadCountByUid: unread });
  return {};
});

/**
 * 5.2 sendThreadMessageAndPush — write message, update thread, optional notification + push
 * Stub: sendWorkerThreadMessage callable lets worker post a message; server updates thread and notifies other participants.
 */
export const sendWorkerThreadMessage = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const senderUid = request.auth.uid;
  const { threadId, body, tenantId } = request.data as {
    threadId: string;
    senderUid?: string;
    body: string;
    tenantId: string;
  };
  if (!threadId || !body?.trim() || !tenantId) {
    throw new HttpsError('invalid-argument', 'threadId, body, tenantId required');
  }
  const threadRef = db.doc(`${THREADS}/${threadId}`);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) throw new HttpsError('not-found', 'Thread not found');
  const thread = threadSnap.data()!;
  const participantUids = (thread.participantUids as string[]) ?? [];
  if (!participantUids.includes(senderUid)) throw new HttpsError('permission-denied', 'Not a participant');

  const messageId = db.collection('_').doc().id;
  const now = admin.firestore.Timestamp.now();
  const messagesRef = db.collection(THREAD_MESSAGES(threadId));
  await messagesRef.doc(messageId).set({
    tenantId,
    threadId,
    senderUid,
    senderType: 'user',
    body: body.trim(),
    createdAt: now,
    deliveryChannels: ['web'],
  });

  const unreadCountByUid = (thread.unreadCountByUid as Record<string, number>) ?? {};
  participantUids.forEach((uid) => {
    if (uid !== senderUid) unreadCountByUid[uid] = (unreadCountByUid[uid] ?? 0) + 1;
  });
  await threadRef.update({
    lastMessageAt: now,
    lastMessagePreview: body.trim().slice(0, 100),
    unreadCountByUid,
  });

  logger.info('Worker thread message sent', { threadId, messageId, senderUid });
  return { messageId };
});

/**
 * 5.5 registerDeviceToken — callable for web/mobile to register FCM token
 */
export const registerWorkerDeviceToken = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  const uid = request.auth.uid;
  const { token, platform } = request.data as { token: string; platform: 'ios' | 'android' | 'web' };
  if (!token || !platform) throw new HttpsError('invalid-argument', 'token and platform required');
  const now = admin.firestore.Timestamp.now();
  // Canonical path: users/{uid}/pushTokens/{tokenId} — doc id sanitized (no "/"); token stored in field
  const tokenId = token.replace(/\//g, '_').slice(0, 1500);
  await db.doc(`${PUSH_TOKENS(uid)}/${tokenId}`).set({
    token,
    platform,
    deviceId: `web-${platform}`,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  return {};
});
