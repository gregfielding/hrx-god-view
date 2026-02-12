/**
 * Worker inbox threads from global threads collection.
 * Spec: HRX-Unified-Notifications-and-Inbox-Spec.md
 */

import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { workerNotificationsPaths } from '../data/firestorePaths';
import type { WorkerThread, WorkerThreadMessage } from '../types/unifiedWorkerNotifications';
import type { Timestamp } from 'firebase/firestore';

function mapThreadDoc(docSnap: import('firebase/firestore').DocumentSnapshot): (WorkerThread & { id: string }) | null {
  const d = docSnap.data();
  if (!d) return null;
  return {
    id: docSnap.id,
    tenantId: d.tenantId ?? '',
    participantUids: Array.isArray(d.participantUids) ? d.participantUids : [],
    participantTypes: d.participantTypes,
    topic: d.topic ?? 'general',
    subject: d.subject,
    createdAt: d.createdAt as Timestamp,
    lastMessageAt: d.lastMessageAt as Timestamp,
    lastMessagePreview: d.lastMessagePreview ?? '',
    unreadCountByUid: typeof d.unreadCountByUid === 'object' ? d.unreadCountByUid : {},
    closedAt: d.closedAt ?? null,
    relatedEntity: d.relatedEntity,
  };
}

export function useWorkerThreads(uid: string | undefined, options?: { max?: number }) {
  const [threads, setThreads] = useState<(WorkerThread & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalUnread, setTotalUnread] = useState(0);

  useEffect(() => {
    if (!uid) {
      setThreads([]);
      setTotalUnread(0);
      setLoading(false);
      return;
    }
    // Composite index required: threads collection, participantUids (array-contains), lastMessageAt (desc)
    const threadsRef = collection(db, workerNotificationsPaths.threads());
    const q = query(
      threadsRef,
      where('participantUids', 'array-contains', uid),
      orderBy('lastMessageAt', 'desc'),
      limit(options?.max ?? 50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => mapThreadDoc(d)).filter(Boolean) as (WorkerThread & { id: string })[];
        setThreads(list);
        const unread = list.reduce((acc, t) => acc + (t.unreadCountByUid?.[uid] ?? 0), 0);
        setTotalUnread(unread);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid, options?.max]);

  return { threads, totalUnread, loading };
}

function mapMessageDoc(docSnap: import('firebase/firestore').DocumentSnapshot): (WorkerThreadMessage & { id: string }) | null {
  const d = docSnap.data();
  if (!d) return null;
  return {
    id: docSnap.id,
    tenantId: d.tenantId ?? '',
    threadId: d.threadId ?? '',
    senderUid: d.senderUid ?? '',
    senderType: d.senderType,
    senderDisplayName: d.senderDisplayName,
    body: d.body ?? '',
    createdAt: d.createdAt as Timestamp,
    deliveryChannels: Array.isArray(d.deliveryChannels) ? d.deliveryChannels : [],
    status: d.status,
    attachments: d.attachments,
    metadata: d.metadata,
  };
}

export function useWorkerThreadMessages(threadId: string | undefined) {
  const [messages, setMessages] = useState<(WorkerThreadMessage & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    const col = collection(db, workerNotificationsPaths.threadMessages(threadId));
    const q = query(col, orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => mapMessageDoc(d)).filter(Boolean) as (WorkerThreadMessage & { id: string })[]);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [threadId]);

  return { messages, loading };
}
