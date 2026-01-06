/**
 * useSlackReactions Hook
 * 
 * Subscribes to Firestore reactions for a Slack message and provides toggle functionality.
 */

import { useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ReactionSummary, SlackReactionContext } from '../types/slackReactions';
import { callReactToSlackMessage } from '../api/slackReactionsApi';

export function useSlackReactions(
  ctx: SlackReactionContext,
  currentUserId: string
) {
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'slackMessageReactions', `${ctx.channelId}__${ctx.messageTs}`);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setReactions([]);
        setLoading(false);
        return;
      }
      const data = snap.data() as any;
      const summaries: ReactionSummary[] =
        (data.reactions ?? []).map((r: any) => ({
          emoji: r.emoji,
          count: r.users.length,
          userHasReacted: r.users.includes(currentUserId),
          userIds: r.users,
        }));

      setReactions(summaries);
      setLoading(false);
    });

    return () => unsub();
  }, [ctx.channelId, ctx.messageTs, currentUserId]);

  const toggleReaction = useCallback(async (emoji: string) => {
    await callReactToSlackMessage({
      channelId: ctx.channelId,
      messageTs: ctx.messageTs,
      emoji,
    });
  }, [ctx.channelId, ctx.messageTs]);

  return { reactions, loading, toggleReaction };
}

