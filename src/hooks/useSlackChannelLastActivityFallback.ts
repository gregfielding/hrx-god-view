import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export type SlackChannelLastActivity = {
  channelId: string;
  lastMessageText: string;
  lastMessageUserName: string;
  lastMessageAt: Date;
  latestActivityLabel: string;
  latestActivityTimeLabel: string;
};

function computeActivityTimeLabel(date?: Date | null): string {
  if (!date) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function computeActivityLabel(userName?: string | null, text?: string | null): string {
  if (!text && !userName) return 'No recent activity';
  const snippet = (text ?? '').trim().replace(/\s+/g, ' ');
  const preview = snippet.length > 80 ? `${snippet.slice(0, 77)}…` : snippet;
  return userName ? `${userName}: ${preview}` : preview;
}

/**
 * Fallback helper: for channels that don't have slackChannels.lastMessage* snapshot fields,
 * fetch the newest message from root `slack_messages` and compute a UI label/time.
 *
 * This is intentionally lightweight: it only queries for channel IDs you pass in
 * and caches results in-memory.
 */
export function useSlackChannelLastActivityFallback(
  tenantId: string | null | undefined,
  channelIds: string[],
): Record<string, SlackChannelLastActivity> {
  const [byChannel, setByChannel] = useState<Record<string, SlackChannelLastActivity>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  const uniqueChannelIds = useMemo(() => {
    const s = new Set(channelIds.filter(Boolean));
    return Array.from(s);
  }, [channelIds]);

  useEffect(() => {
    if (!tenantId) return;
    if (uniqueChannelIds.length === 0) return;

    let cancelled = false;

    const run = async () => {
      const updates: Record<string, SlackChannelLastActivity> = {};

      for (const channelId of uniqueChannelIds) {
        if (!channelId) continue;
        if (fetchedRef.current.has(channelId)) continue;

        fetchedRef.current.add(channelId);

        try {
          const q = query(
            collection(db, 'slack_messages'),
            where('tenantId', '==', tenantId),
            where('channelId', '==', channelId),
            orderBy('sentAt', 'desc'),
            limit(1),
          );

          const snap = await getDocs(q);
          if (snap.empty) continue;

          const doc = snap.docs[0];
          const data: any = doc.data() || {};
          const sentAt = data.sentAt?.toDate ? data.sentAt.toDate() : data.sentAt ? new Date(data.sentAt) : null;
          if (!sentAt) continue;

          const userName = data.userName || data.slackUserName || data.username || data.botName || 'Unknown';
          const text = data.text || '';

          const latestActivityLabel = computeActivityLabel(userName, text);
          const latestActivityTimeLabel = computeActivityTimeLabel(sentAt);

          updates[channelId] = {
            channelId,
            lastMessageText: text,
            lastMessageUserName: userName,
            lastMessageAt: sentAt,
            latestActivityLabel,
            latestActivityTimeLabel,
          };
        } catch {
          // If a query fails (e.g. missing index/permissions), don't block the rest.
        }
      }

      if (cancelled) return;
      if (Object.keys(updates).length === 0) return;
      setByChannel((prev) => ({ ...prev, ...updates }));
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [tenantId, uniqueChannelIds]);

  return byChannel;
}


