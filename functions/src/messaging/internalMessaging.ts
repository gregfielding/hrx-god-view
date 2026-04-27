/**
 * Internal Messaging System
 * 
 * Provides Slack-style internal messaging for HRX teams.
 * Supports Direct Messages (DMs) and Channels.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

// ============================================================================
// Type Definitions
// ============================================================================

export interface SlackMessageMeta {
  teamId: string;
  channelId: string;
  ts: string;
  threadTs?: string;
}

export interface InternalMessage {
  id?: string;
  tenantId: string;
  
  // Conversation context
  conversationType: 'dm' | 'channel';
  conversationId: string; // DM: dmId, Channel: channelId
  threadId?: string; // For future thread replies
  
  // Message content
  content: string;
  contentType?: 'text' | 'file' | 'link';
  attachments?: Array<{
    type: string;
    url: string;
    name: string;
    size: number;
  }>;
  
  // Sender
  fromUserId: string;
  fromUserName: string;
  fromUserAvatar?: string;
  
  // Source tracking (Phase 4/5)
  source?: 'hrx' | 'slack' | 'email' | 'sms';
  mirroredToSlack?: boolean;
  mirroredFromSlack?: boolean;
  slackMessageMeta?: SlackMessageMeta | null;
  inSlackThread?: boolean; // Derived: true if threadTs exists and != ts
  
  // Optional: UI / control metadata (Phase 5)
  meta?: {
    sendToSlackRequested?: boolean; // Set by UI when user explicitly clicks "Send to Slack"
  };
  
  // Metadata
  editedAt?: admin.firestore.Timestamp;
  deletedAt?: admin.firestore.Timestamp;
  reactions?: Array<{
    emoji: string;
    userId: string;
  }>;
  
  // Timestamps
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface SlackConversationLink {
  teamId: string;          // Slack workspace ID (e.g. T07H4CTCBHD)
  channelId: string;       // Slack channel/DM/MPIM ID (e.g. C07HJRX1K5Z)
  rootThreadTs?: string | null; // Root Slack thread ts for this conversation (optional)
}

export type SlackConversationMode =
  | 'off'              // Slack integration disabled for this conversation
  | 'manual'           // HRX messages *only* go to Slack when explicitly requested
  | 'auto_all'         // All HRX messages in this conversation mirror to Slack
  | 'auto_admin_only'; // Only HRX messages from high-security users mirror to Slack

export interface SlackConversationSettings {
  mode: SlackConversationMode;
  autoThreadReplies?: boolean; // If true: try to mirror replies into same Slack thread
  defaultThreadTs?: string | null; // If set, always use this thread in Slack
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

export interface DirectMessage {
  id?: string;
  tenantId: string;
  
  // Participants
  participants: string[]; // Array of userIds (sorted)
  participantNames: string[]; // For display
  participantAvatars?: string[];
  
  // Last message info
  lastMessage?: string;
  lastMessageAt?: admin.firestore.Timestamp;
  lastMessageFrom?: string;
  lastMessageFromUserId?: string;
  
  // Unread counts per user
  unreadCounts: {
    [userId: string]: number;
  };
  
  // Metadata
  isGroup: boolean; // true if > 2 participants
  groupName?: string;
  groupAvatar?: string;
  
  // Slack link (Phase 4/5)
  slackLink?: SlackConversationLink | null;
  slackSettings?: SlackConversationSettings | null;
  
  // Timestamps
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface InternalChannel {
  id?: string;
  tenantId: string;
  
  // Channel info
  name: string; // e.g., "sales", "recruiting"
  description?: string;
  isPrivate: boolean;
  
  // Members
  memberIds: string[];
  memberCount: number;
  createdBy: string;
  createdByName?: string;
  
  // Last message info
  lastMessage?: string;
  lastMessageAt?: admin.firestore.Timestamp;
  lastMessageFrom?: string;
  lastMessageFromUserId?: string;
  
  // Unread counts per user
  unreadCounts: {
    [userId: string]: number;
  };
  
  // Settings
  mutedBy: string[]; // User IDs who muted this channel
  
  // Slack link (Phase 4/5)
  slackLink?: SlackConversationLink | null;
  slackSettings?: SlackConversationSettings | null;
  
  // Timestamps
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get or create a DM conversation between users
 */
export async function getOrCreateDM(
  tenantId: string,
  userId1: string,
  userId2: string
): Promise<string> {
  // Sort user IDs to ensure consistent DM ID
  const participants = [userId1, userId2].sort();
  const dmId = participants.join('_');
  
  const dmRef = db.collection('tenants').doc(tenantId)
    .collection('internalDMs').doc(dmId);
  
  const dmDoc = await dmRef.get();
  
  if (!dmDoc.exists) {
    // Get user names for display
    const [user1Doc, user2Doc] = await Promise.all([
      db.collection('users').doc(userId1).get(),
      db.collection('users').doc(userId2).get(),
    ]);
    
    const user1Data = user1Doc.data();
    const user2Data = user2Doc.data();
    
    const user1Name = user1Data?.displayName || user1Data?.firstName || user1Data?.email || 'User';
    const user2Name = user2Data?.displayName || user2Data?.firstName || user2Data?.email || 'User';
    
    await dmRef.set({
      tenantId,
      participants,
      participantNames: [user1Name, user2Name],
      participantAvatars: [user1Data?.avatarUrl, user2Data?.avatarUrl].filter(Boolean),
      unreadCounts: {
        [userId1]: 0,
        [userId2]: 0,
      },
      isGroup: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  
  return dmId;
}

/**
 * Get or create a group DM
 */
export async function getOrCreateGroupDM(
  tenantId: string,
  participantIds: string[]
): Promise<string> {
  // Sort user IDs to ensure consistent group DM ID
  const participants = [...participantIds].sort();
  const dmId = `group_${participants.join('_')}`;
  
  const dmRef = db.collection('tenants').doc(tenantId)
    .collection('internalDMs').doc(dmId);
  
  const dmDoc = await dmRef.get();
  
  if (!dmDoc.exists) {
    // Get user names for display
    const userDocs = await Promise.all(
      participants.map(id => db.collection('users').doc(id).get())
    );
    
    const participantNames = userDocs.map(doc => {
      const data = doc.data();
      return data?.displayName || data?.firstName || data?.email || 'User';
    });
    
    const participantAvatars = userDocs.map(doc => {
      const data = doc.data();
      return data?.avatarUrl;
    }).filter(Boolean);
    
    await dmRef.set({
      tenantId,
      participants,
      participantNames,
      participantAvatars,
      unreadCounts: participants.reduce((acc, id) => {
        acc[id] = 0;
        return acc;
      }, {} as { [userId: string]: number }),
      isGroup: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  
  return dmId;
}

/**
 * Calculate unread message counts for a user
 */
export async function calculateUnreadCounts(
  tenantId: string,
  userId: string
): Promise<{
  messages: number;
  dms: number;
  channels: number;
}> {
  let dmsUnread = 0;
  let channelsUnread = 0;
  
  // Get all DMs where user is participant
  const dmsQuery = await db.collection('tenants').doc(tenantId)
    .collection('internalDMs')
    .where('participants', 'array-contains', userId)
    .get();
  
  dmsQuery.docs.forEach(doc => {
    const data = doc.data() as DirectMessage;
    dmsUnread += data.unreadCounts[userId] || 0;
  });
  
  // Get all channels where user is member (and not muted)
  const channelsQuery = await db.collection('tenants').doc(tenantId)
    .collection('internalChannels')
    .where('memberIds', 'array-contains', userId)
    .get();
  
  channelsQuery.docs.forEach(doc => {
    const data = doc.data() as InternalChannel;
    // Don't count if user muted this channel
    if (!data.mutedBy?.includes(userId)) {
      channelsUnread += data.unreadCounts[userId] || 0;
    }
  });
  
  return {
    messages: dmsUnread + channelsUnread,
    dms: dmsUnread,
    channels: channelsUnread,
  };
}


