/**
 * Worker notifications from users/{uid}/notifications.
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md
 */

import { collection, query, where, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
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

export async function getWorkerUnreadNotificationCount(uid: string): Promise<number> {
  const col = collection(db, workerNotificationsPaths.userNotifications(uid));
  const q = query(col, where('readAt', '==', null));
  const snap = await getDocs(q);
  return snap.size;
}
