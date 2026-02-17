/**
 * Worker recent activity — reads from the same central store as Admin Activity Log.
 * Source of truth: users/{userId}/activityLogs (see utils/activityLogger.ts and UserProfile ActivityLogTab).
 */

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export interface WorkerActivityItem {
  id: string;
  /** i18n key for primary label (e.g. dashboard.activity.applicationSubmitted) */
  primaryKey: string;
  /** i18n key for relative time (e.g. dashboard.timeAgo.daysAgo) */
  secondaryKey: string;
  /** Params for secondary (e.g. { count: 3 }) */
  secondaryParams?: Record<string, string | number>;
  /** ISO or ms for sorting */
  ts: number;
  /** Optional link (e.g. assignment or applications) */
  to?: string;
}

function toMillis(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'object' && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Returns i18n key and params for relative time (dashboard.timeAgo.*) */
function timeAgoKeyAndParams(ms: number): { key: string; params?: Record<string, number> } {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return { key: 'dashboard.timeAgo.justNow' };
  if (sec < 3600) return { key: 'dashboard.timeAgo.minutesAgo', params: { count: Math.floor(sec / 60) } };
  if (sec < 86400) return { key: 'dashboard.timeAgo.hoursAgo', params: { count: Math.floor(sec / 3600) } };
  const days = Math.floor(sec / 86400);
  if (sec < 604800) return { key: days === 1 ? 'dashboard.timeAgo.dayAgo' : 'dashboard.timeAgo.daysAgo', params: { count: days } };
  if (sec < 2592000) return { key: 'dashboard.timeAgo.weeksAgo', params: { count: Math.floor(sec / 604800) } };
  if (sec < 31536000) return { key: 'dashboard.timeAgo.monthsAgo', params: { count: Math.floor(sec / 2592000) } };
  return { key: 'dashboard.timeAgo.yearsAgo', params: { count: Math.floor(sec / 31536000) } };
}

/** Map central activity log action to i18n key (dashboard.activity.*) */
function activityPrimaryKey(action: string, actionType: string, metadata?: { assignmentAction?: string }): string {
  if (actionType === 'job_application') return 'dashboard.activity.applicationSubmitted';
  if (actionType === 'assignment_update') {
    const a = metadata?.assignmentAction?.toLowerCase();
    if (a === 'confirmed' || a === 'confirmed by worker') return 'dashboard.activity.assignmentConfirmed';
    if (a === 'placed') return 'dashboard.activity.assignmentPlaced';
    return 'dashboard.activity.assignmentUpdated';
  }
  if (actionType === 'document_upload') return 'dashboard.activity.certificateUploaded';
  if (actionType === 'profile_update') return 'dashboard.activity.profileUpdated';
  if (action === 'User Login') return 'dashboard.activity.userLogin';
  if (action === 'User Logout') return 'dashboard.activity.userLogout';
  return 'dashboard.activity.activity';
}

/** Build link for worker view from activity metadata */
function activityToLink(actionType: string, metadata?: { targetId?: string; targetType?: string }): string | undefined {
  const id = metadata?.targetId;
  const type = metadata?.targetType;
  if (!id) return undefined;
  if (type === 'assignment') return `/c1/workers/assignments/${id}`;
  if (type === 'job' || actionType === 'job_application') return `/c1/jobs-board/${id}`;
  if (type === 'profile' || actionType === 'profile_update') return '/c1/workers/profile';
  if (type === 'document' || actionType === 'document_upload') return '/c1/workers/profile';
  return undefined;
}

export function useWorkerRecentActivity(userId: string | undefined): { items: WorkerActivityItem[]; loading: boolean } {
  const [items, setItems] = useState<WorkerActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const activitiesRef = collection(db, 'users', userId, 'activityLogs');
        // Fetch extra so after filtering out logins we still have enough items
        const q = query(activitiesRef, orderBy('timestamp', 'desc'), limit(30));
        const snap = await getDocs(q);
        if (cancelled) return;

        const list: WorkerActivityItem[] = [];
        for (const d of snap.docs) {
          const data = d.data();
          const action = data.action ?? '';
          const actionType = data.actionType ?? 'other';
          if (action === 'User Login' || action === 'User Logout') continue;
          const ts = toMillis(data.timestamp ?? data.createdAt);
          const metadata = data.metadata;
          const { key: secondaryKey, params: secondaryParams } = timeAgoKeyAndParams(ts);
          list.push({
            id: d.id,
            primaryKey: activityPrimaryKey(action, actionType, metadata),
            secondaryKey,
            secondaryParams,
            ts,
            to: activityToLink(actionType, metadata),
          });
          if (list.length >= 10) break;
        }

        setItems(list);
      } catch (err) {
        console.error('Failed to load worker recent activity:', err);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { items, loading };
}
