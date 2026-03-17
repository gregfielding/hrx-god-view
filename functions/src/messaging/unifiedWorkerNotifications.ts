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

export type NotificationType = 'assignment' | 'application' | 'document' | 'shift' | 'payroll' | 'general' | 'system' | 'opportunity' | 'profile_action' | 'support';
export type NotificationCategory = 'assignments' | 'applications' | 'opportunities' | 'profile' | 'system';
type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

const ASSIGNMENTS_PATH = '/c1/workers/assignments';
const JOBS_BOARD_PATH = '/c1/jobs-board';
const JOB_READINESS_PATH = '/c1/workers/job-readiness';
const APPLICATIONS_PATH = '/c1/workers/applications';

/** Build deepLink from ctaUrl, threadId, or entity. Push and inbox use this so tap opens the correct screen. */
function resolveDeepLink(payload: {
  deepLink?: string;
  ctaUrl?: string;
  threadId?: string;
  entity?: { kind: string; id: string };
}): string {
  if (payload.deepLink && payload.deepLink.trim()) return payload.deepLink.trim();
  if (payload.ctaUrl && payload.ctaUrl.trim()) return payload.ctaUrl.trim();
  if (payload.threadId) return `/c1/workers/inbox/${payload.threadId}`;
  if (payload.entity?.kind === 'job_post' && payload.entity?.id) return `/c1/jobs-board/${payload.entity.id}`;
  return '';
}

/** Resolve entityId for inbox (e.g. assignmentId, jobId). */
function resolveEntityId(payload: { entityId?: string; entity?: { kind: string; id: string } }): string {
  if (payload.entityId && payload.entityId.trim()) return payload.entityId.trim();
  if (payload.entity?.id) return payload.entity.id;
  return '';
}

/**
 * Write a persistent inbox message to users/{uid}/notifications (no push).
 * Use when sending push via another path (e.g. orchestrator) so every push has an inbox record.
 */
function categoryForType(type: NotificationType): NotificationCategory {
  switch (type) {
    case 'assignment': case 'shift': return 'assignments';
    case 'application': return 'applications';
    case 'opportunity': case 'general': return 'opportunities';
    case 'profile_action': return 'profile';
    case 'support': return 'system';
    default: return 'system';
  }
}

// ——— High-value worker notification helpers (inbox + push + deepLink) ———

/** 1. application_received — use in onApplicationCreatedPush with title/body/companyName. */

/** 2. application_status_changed — call from applicationSmsTriggers with status-specific title/body. */
export async function sendApplicationStatusChangedNotification(payload: {
  uid: string;
  tenantId: string;
  jobPostId?: string;
  title: string;
  body: string;
}): Promise<{ notificationId: string }> {
  const deepLink = payload.jobPostId ? `${JOBS_BOARD_PATH}/${payload.jobPostId}` : APPLICATIONS_PATH;
  return sendNotificationAndPush({
    uid: payload.uid,
    tenantId: payload.tenantId,
    title: payload.title,
    body: payload.body,
    type: 'application',
    category: 'applications',
    deepLink,
    entityId: payload.jobPostId,
    source: 'automation',
  });
}

/** 3. jobs_match_profile — new shifts match experience/schedule. */
export async function sendJobsMatchProfileNotification(payload: {
  uid: string;
  tenantId: string;
  count: number;
  title?: string;
  body?: string;
}): Promise<{ notificationId: string }> {
  const title = payload.title ?? `${payload.count} jobs match your experience and schedule`;
  const body = payload.body ?? 'New shifts are available near you.';
  return sendNotificationAndPush({
    uid: payload.uid,
    tenantId: payload.tenantId,
    title,
    body,
    type: 'opportunity',
    category: 'opportunities',
    deepLink: JOBS_BOARD_PATH,
    source: 'automation',
  });
}

/** 4. assignment_reminder — e.g. shift tomorrow, shift starts in 2 hours. */
export async function sendAssignmentReminderNotification(payload: {
  uid: string;
  tenantId: string;
  assignmentId: string;
  title: string;
  body: string;
}): Promise<{ notificationId: string }> {
  const deepLink = `${ASSIGNMENTS_PATH}/${payload.assignmentId}`;
  return sendNotificationAndPush({
    uid: payload.uid,
    tenantId: payload.tenantId,
    title: payload.title,
    body: payload.body,
    type: 'assignment',
    category: 'assignments',
    deepLink,
    entityId: payload.assignmentId,
    source: 'automation',
  });
}

/** 5. assignment_changed — time/location/canceled/instructions updated. (Status changes use onAssignmentUpdatedPush.) */
export async function sendAssignmentChangedNotification(payload: {
  uid: string;
  tenantId: string;
  assignmentId: string;
  title: string;
  body: string;
}): Promise<{ notificationId: string }> {
  const deepLink = `${ASSIGNMENTS_PATH}/${payload.assignmentId}`;
  return sendNotificationAndPush({
    uid: payload.uid,
    tenantId: payload.tenantId,
    title: payload.title,
    body: payload.body,
    type: 'assignment',
    category: 'assignments',
    deepLink,
    entityId: payload.assignmentId,
    source: 'automation',
  });
}

/** 6. profile_action_needed — e.g. upload Food Handler, add availability, complete profile. */
export async function sendProfileActionNeededNotification(payload: {
  uid: string;
  tenantId: string;
  title: string;
  body: string;
  deepLink?: string;
}): Promise<{ notificationId: string }> {
  return sendNotificationAndPush({
    uid: payload.uid,
    tenantId: payload.tenantId,
    title: payload.title,
    body: payload.body,
    type: 'profile_action',
    category: 'profile',
    deepLink: payload.deepLink ?? JOB_READINESS_PATH,
    source: 'automation',
  });
}

/** 7. support_or_operational_message — parking, check-in, dress code, recruiter message. */
export async function sendSupportOrOperationalMessage(payload: {
  uid: string;
  tenantId: string;
  title: string;
  body: string;
  deepLink: string;
  entityId?: string;
  threadId?: string;
}): Promise<{ notificationId: string }> {
  return sendNotificationAndPush({
    uid: payload.uid,
    tenantId: payload.tenantId,
    title: payload.title,
    body: payload.body,
    type: 'support',
    category: 'system',
    deepLink: payload.deepLink,
    entityId: payload.entityId,
    threadId: payload.threadId,
    source: payload.threadId ? 'recruiter' : 'system',
  });
}

export async function writeWorkerInboxNotification(payload: {
  uid: string;
  tenantId: string;
  title: string;
  body: string;
  type?: NotificationType;
  category?: NotificationCategory;
  deepLink?: string;
  entityId?: string;
  ctaUrl?: string;
  entity?: { kind: string; id: string };
  source?: 'system' | 'recruiter' | 'automation';
  metadata?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}): Promise<{ notificationId: string }> {
  const id = db.collection('_').doc().id;
  const ref = db.doc(`${NOTIFICATIONS(payload.uid)}/${id}`);
  const now = admin.firestore.Timestamp.now();
  const deepLink = payload.deepLink?.trim() || resolveDeepLink(payload);
  const entityId = payload.entityId?.trim() || resolveEntityId(payload);
  const type = payload.type ?? 'general';
  const category = payload.category ?? categoryForType(type);
  await ref.set({
    id,
    uid: payload.uid,
    tenantId: payload.tenantId,
    type,
    category,
    title: payload.title,
    body: payload.body,
    createdAt: now,
    readAt: null,
    deepLink: deepLink || undefined,
    entityId: entityId || undefined,
    source: payload.source ?? 'system',
    channel: 'push',
    ctaUrl: payload.ctaUrl ?? deepLink || undefined,
    entity: payload.entity,
    ...(payload.metadata && Object.keys(payload.metadata).length > 0 ? { metadata: payload.metadata } : {}),
    ...(payload.priority ? { priority: payload.priority } : {}),
  });
  logger.info('Worker inbox notification written', { notificationId: id, uid: payload.uid });
  return { notificationId: id };
}

/**
 * 5.1 sendNotificationAndPush — write notification doc + FCM push
 * Every push creates a persistent inbox message. Push data includes deepLink so tap opens the correct screen.
 */
export async function sendNotificationAndPush(payload: {
  uid: string;
  tenantId: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  type?: NotificationType;
  category?: NotificationCategory;
  deepLink?: string;
  entityId?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  threadId?: string;
  entity?: { kind: string; id: string };
  source?: 'system' | 'recruiter' | 'automation';
  metadata?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}): Promise<{ notificationId: string }> {
  const id = db.collection('_').doc().id;
  const ref = db.doc(`${NOTIFICATIONS(payload.uid)}/${id}`);
  const now = admin.firestore.Timestamp.now();
  const deepLink = payload.deepLink?.trim() || resolveDeepLink(payload);
  const entityId = payload.entityId?.trim() || resolveEntityId(payload);
  const type = payload.type ?? 'general';
  const category = payload.category ?? categoryForType(type);
  await ref.set({
    id,
    uid: payload.uid,
    tenantId: payload.tenantId,
    type,
    category,
    title: payload.title,
    body: payload.body,
    severity: payload.severity ?? 'info',
    createdAt: now,
    readAt: null,
    deepLink: deepLink || undefined,
    entityId: entityId || undefined,
    source: payload.source ?? 'system',
    channel: 'push',
    ctaLabel: payload.ctaLabel,
    ctaUrl: payload.ctaUrl ?? deepLink || undefined,
    threadId: payload.threadId,
    entity: payload.entity,
    ...(payload.metadata && Object.keys(payload.metadata).length > 0 ? { metadata: payload.metadata } : {}),
    ...(payload.priority ? { priority: payload.priority } : {}),
  });

  const tokensSnap = await db.collection(PUSH_TOKENS(payload.uid)).where('enabled', '==', true).get();
  const deviceTokens = tokensSnap.docs.flatMap((d) => {
    const token = d.data().token ?? d.id;
    return token ? [token] : [];
  });
  if (deviceTokens.length > 0) {
    const push = getPushProvider();
    await push.sendPush({
      tenantId: payload.tenantId,
      messageTypeId: 'worker_notification',
      targets: [{ userId: payload.uid, deviceTokens }],
      title: payload.title,
      body: payload.body,
      data: {
        notificationId: id,
        threadId: payload.threadId ?? '',
        ctaUrl: payload.ctaUrl ?? '',
        deepLink,
        entityId: entityId || '',
      },
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
