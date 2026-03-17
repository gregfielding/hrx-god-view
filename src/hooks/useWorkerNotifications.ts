/**
 * Worker notifications from users/{uid}/notifications.
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md
 */

import { collection, query, where, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';

import { p, workerNotificationsPaths } from '../data/firestorePaths';
import { db } from '../firebase';
import type { WorkerNotification, NotificationCategory, NotificationType } from '../types/unifiedWorkerNotifications';

function typeToCategory(type: NotificationType): NotificationCategory {
  switch (type) {
    case 'assignment':
    case 'shift':
      return 'assignments';
    case 'application':
      return 'applications';
    case 'opportunity':
    case 'general':
      return 'opportunities';
    case 'profile_action':
      return 'profile';
    default:
      return 'system';
  }
}

function mapDoc(doc: import('firebase/firestore').DocumentSnapshot): WorkerNotification & { id: string } {
  const d = doc.data();
  const entity = d?.entity;
  const type = (d?.type ?? 'general') as NotificationType;
  const category = (d?.category ?? typeToCategory(type)) as NotificationCategory;
  return {
    id: doc.id,
    uid: d?.uid ?? '',
    tenantId: d?.tenantId ?? '',
    type,
    category,
    title: d?.title ?? '',
    body: d?.body ?? '',
    severity: d?.severity ?? 'info',
    createdAt: d?.createdAt as Timestamp,
    readAt: (d?.readAt ?? null) as Timestamp | null,
    source: d?.source ?? 'system',
    channel: d?.channel ?? 'web',
    deepLink: d?.deepLink ?? d?.ctaUrl,
    entityId: d?.entityId ?? entity?.id,
    ctaLabel: d?.ctaLabel,
    ctaUrl: d?.ctaUrl,
    threadId: d?.threadId,
    entity: d?.entity,
    metadata: d?.metadata,
    priority: d?.priority,
  };
}

export function useWorkerNotifications(uid: string | undefined, options?: { max?: number }) {
  const [notifications, setNotifications] = useState<(WorkerNotification & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!uid) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    const col = collection(db, workerNotificationsPaths.userNotifications(uid));
    const q = query(
      col,
      orderBy('createdAt', 'desc'),
      limit(options?.max ?? 100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(mapDoc);
        setNotifications(list);
        setUnreadCount(list.filter((n) => !n.readAt).length);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid, options?.max]);

  return { notifications, unreadCount, loading };
}

/** Resolve notification link: prefer deepLink, then entity/ctaUrl/threadId. */
export function getNotificationUrl(n: WorkerNotification & { id: string }): string {
  if (n.deepLink && n.deepLink.trim()) return n.deepLink.trim();
  if (n.entity?.kind === 'job_post' && n.entity?.id) {
    return `/c1/jobs-board/${n.entity.id}`;
  }
  return n.threadId ? `/c1/workers/inbox/${n.threadId}` : '';
}

export type WorkerNotificationFilterKey =
  | 'all'
  | 'unread'
  | 'applications'
  | 'assignments'
  | 'reminders'
  | 'documents'
  | 'system';

function normalizeText(v: unknown): string {
  return String(v || '').toLowerCase();
}

function toRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function parseIdFromPath(url: string | undefined, segment: string): string | null {
  if (!url) return null;
  const m = url.match(new RegExp(`${segment}/([^/?#]+)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function extractAssignmentId(n: WorkerNotification & { id: string }): string | null {
  const meta = toRecord(n.metadata);
  if (typeof meta.assignmentId === 'string' && meta.assignmentId) return meta.assignmentId;
  if (n.entity?.kind === 'assignment' && n.entity?.id) return n.entity.id;
  if ((n.type === 'assignment' || n.type === 'shift') && n.entityId) return n.entityId;
  const fromDeepLink = parseIdFromPath(n.deepLink || n.ctaUrl, '/workers/assignments');
  return fromDeepLink;
}

function extractJobId(n: WorkerNotification & { id: string }): string | null {
  const meta = toRecord(n.metadata);
  if (typeof meta.jobId === 'string' && meta.jobId) return meta.jobId;
  if (typeof meta.postId === 'string' && meta.postId) return meta.postId;
  if (n.entity?.kind === 'job_post' && n.entity?.id) return n.entity.id;
  if ((n.type === 'application' || n.type === 'opportunity') && n.entityId) return n.entityId;
  return parseIdFromPath(n.deepLink || n.ctaUrl, '/jobs-board');
}

function extractApplicationId(n: WorkerNotification & { id: string }): string | null {
  const meta = toRecord(n.metadata);
  if (typeof meta.applicationId === 'string' && meta.applicationId) return meta.applicationId;
  if (n.entity?.kind === 'application' && n.entity?.id) return n.entity.id;
  if (n.type === 'application' && n.entityId) return n.entityId;
  return null;
}

function extractThreadId(n: WorkerNotification & { id: string }): string | null {
  if (n.threadId) return n.threadId;
  const meta = toRecord(n.metadata);
  if (typeof meta.conversationId === 'string' && meta.conversationId) return meta.conversationId;
  if (n.entity?.kind === 'conversation' && n.entity?.id) return n.entity.id;
  return parseIdFromPath(n.deepLink || n.ctaUrl, '/workers/inbox');
}

function getFallbackUrl(): string {
  return '/c1/workers/notifications';
}

/**
 * Resolve notification link with fallback for old "application" notifications that still
 * have ctaUrl /c1/workers/applications: fetch user's latest application and use its jobId.
 */
export async function getNotificationUrlAsync(
  n: WorkerNotification & { id: string },
  uid: string | undefined
): Promise<string> {
  // Priority 1: explicit deepLink
  if (n.deepLink && n.deepLink.trim()) return n.deepLink.trim();

  // Priority 2: related assignment detail
  const assignmentId = extractAssignmentId(n);
  if (assignmentId) return `/c1/workers/assignments/${assignmentId}`;

  // Priority 3: related job detail
  const directJobId = extractJobId(n);
  if (directJobId) return `/c1/jobs-board/${directJobId}`;

  // Priority 4: related application detail/list
  const applicationId = extractApplicationId(n);
  if (applicationId) return `/c1/workers/applications?applicationId=${encodeURIComponent(applicationId)}`;

  // Priority 5: related inbox thread
  const threadId = extractThreadId(n);
  if (threadId) return `/c1/workers/inbox/${threadId}`;

  // Additional compatibility lookup for old application notifications
  if (n.type === 'application' && n.tenantId && uid) {
    try {
      const applicationsRef = collection(db, p.applications(n.tenantId));
      const q = query(applicationsRef, where('userId', '==', uid), limit(15));
      const snap = await getDocs(q);
      type AppRow = { id: string; jobId?: string; postId?: string; createdAt?: unknown };
      const byCreated = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as AppRow))
        .sort((a, b) => {
          const at = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? (a.createdAt as number) ?? 0;
          const bt = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? (b.createdAt as number) ?? 0;
          return bt - at;
        });
      const app = byCreated[0];
      const jobId = app?.jobId ?? app?.postId;
      if (jobId) return `/c1/jobs-board/${jobId}`;
      if (app?.id) return `/c1/workers/applications?applicationId=${encodeURIComponent(app.id)}`;
    } catch {
      // ignore lookup failures and use fallback
    }
  }

  // Priority 6: fallback notifications page
  return getFallbackUrl();
}

export async function getWorkerUnreadNotificationCount(uid: string): Promise<number> {
  const col = collection(db, workerNotificationsPaths.userNotifications(uid));
  const q = query(col, where('readAt', '==', null));
  const snap = await getDocs(q);
  return snap.size;
}

export function getWorkerNotificationFilterKey(n: WorkerNotification & { id: string }): Exclude<WorkerNotificationFilterKey, 'all' | 'unread'> {
  const category = n.category ?? typeToCategory(n.type);
  const text = `${normalizeText(n.title)} ${normalizeText(n.body)}`;
  const isReminder = category === 'assignments' && (text.includes('reminder') || text.includes('starts in') || text.includes('tomorrow'));
  if (isReminder) return 'reminders';
  if (n.type === 'document' || category === 'profile' || text.includes('compliance') || text.includes('certification')) {
    return 'documents';
  }
  if (category === 'applications') return 'applications';
  if (category === 'assignments') return 'assignments';
  return 'system';
}
