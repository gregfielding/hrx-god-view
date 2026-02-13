/**
 * Worker notifications from users/{uid}/notifications.
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md
 */

import { collection, query, where, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
import { p } from '../data/firestorePaths';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { workerNotificationsPaths } from '../data/firestorePaths';
import type { WorkerNotification } from '../types/unifiedWorkerNotifications';
import type { Timestamp } from 'firebase/firestore';

function mapDoc(doc: import('firebase/firestore').DocumentSnapshot): WorkerNotification & { id: string } {
  const d = doc.data();
  return {
    id: doc.id,
    uid: d?.uid ?? '',
    tenantId: d?.tenantId ?? '',
    type: d?.type ?? 'general',
    title: d?.title ?? '',
    body: d?.body ?? '',
    severity: d?.severity ?? 'info',
    createdAt: d?.createdAt as Timestamp,
    readAt: (d?.readAt ?? null) as Timestamp | null,
    source: d?.source ?? 'system',
    channel: d?.channel ?? 'web',
    ctaLabel: d?.ctaLabel,
    ctaUrl: d?.ctaUrl,
    threadId: d?.threadId,
    entity: d?.entity,
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

/** Resolve notification link: prefer job board post when entity is job_post, else ctaUrl. */
export function getNotificationUrl(n: WorkerNotification & { id: string }): string {
  if (n.entity?.kind === 'job_post' && n.entity?.id) {
    return `/c1/jobs-board/${n.entity.id}`;
  }
  return n.ctaUrl ?? (n.threadId ? `/c1/workers/inbox/${n.threadId}` : '') ?? '';
}

/**
 * Resolve notification link with fallback for old "application" notifications that still
 * have ctaUrl /c1/workers/applications: fetch user's latest application and use its jobId.
 */
export async function getNotificationUrlAsync(
  n: WorkerNotification & { id: string },
  uid: string | undefined
): Promise<string> {
  let url = getNotificationUrl(n);
  const applicationsPath = '/c1/workers/applications';
  const isOldApplicationLink =
    n.type === 'application' &&
    (url === applicationsPath || url?.endsWith(applicationsPath)) &&
    n.tenantId &&
    uid;

  if (isOldApplicationLink) {
    try {
      const applicationsRef = collection(db, p.applications(n.tenantId));
      const q = query(applicationsRef, where('userId', '==', uid), limit(15));
      const snap = await getDocs(q);
      type AppRow = { id: string; jobId?: string; postId?: string; createdAt?: unknown };
      const byCreated = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as AppRow))
        .filter((a) => a.jobId || a.postId)
        .sort((a, b) => {
          const at = (a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? (a.createdAt as number) ?? 0;
          const bt = (b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? (b.createdAt as number) ?? 0;
          return bt - at;
        });
      const jobId = byCreated[0]?.jobId ?? byCreated[0]?.postId;
      if (jobId) url = `/c1/jobs-board/${jobId}`;
    } catch {
      // keep original url
    }
  }
  return url;
}

export async function getWorkerUnreadNotificationCount(uid: string): Promise<number> {
  const col = collection(db, workerNotificationsPaths.userNotifications(uid));
  const q = query(col, where('readAt', '==', null));
  const snap = await getDocs(q);
  return snap.size;
}
