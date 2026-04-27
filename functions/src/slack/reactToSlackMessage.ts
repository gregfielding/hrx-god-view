/**
 * reactToSlackMessage Cloud Function
 * 
 * Toggles a user's reaction to a Slack message.
 * Phase 1: Firestore-only (no Slack API calls yet)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

interface ReactToSlackMessageInput {
  channelId: string;
  messageTs: string;
  emoji: string;
}

interface ReactToSlackMessageResult {
  success: boolean;
}

/**
 * React to a Slack message (toggle reaction)
 * 
 * Phase 1: Firestore-only implementation
 * - Stores reactions in slackMessageReactions collection
 * - Document ID format: {channelId}__{messageTs}
 * - Structure: { reactions: [{ emoji: string, users: string[] }] }
 */
export const reactToSlackMessage = onCall({
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const userId = request.auth.uid;
  const { channelId, messageTs, emoji } = request.data as ReactToSlackMessageInput;

  if (!channelId || !messageTs || !emoji) {
    throw new HttpsError('invalid-argument', 'channelId, messageTs, and emoji are required');
  }

  try {
    const docId = `${channelId}__${messageTs}`;
    const ref = db.collection('slackMessageReactions').doc(docId);

    // Get current document
    const docSnap = await ref.get();
    const currentData = docSnap.exists ? docSnap.data() : { reactions: [] };
    const reactions: Array<{ emoji: string; users: string[] }> = currentData.reactions || [];

    // Find or create reaction entry
    let reactionIndex = reactions.findIndex((r) => r.emoji === emoji);
    
    if (reactionIndex === -1) {
      // Create new reaction
      reactions.push({ emoji, users: [userId] });
    } else {
      // Toggle user in existing reaction
      const reaction = reactions[reactionIndex];
      const userIndex = reaction.users.indexOf(userId);
      
      if (userIndex === -1) {
        // Add user
        reaction.users.push(userId);
      } else {
        // Remove user
        reaction.users.splice(userIndex, 1);
      }

      // Remove reaction if no users left
      if (reaction.users.length === 0) {
        reactions.splice(reactionIndex, 1);
      }
    }

    // Update Firestore
    await ref.set({
      reactions,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true } as ReactToSlackMessageResult;
  } catch (error: any) {
    console.error('Error toggling Slack reaction:', error);
    throw new HttpsError('internal', `Failed to toggle reaction: ${error.message || 'Unknown error'}`);
  }
});

