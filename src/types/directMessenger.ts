/**
 * Direct Messenger Types
 * 
 * TypeScript interfaces for DM threads and messages.
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Participant metadata stored in thread document
 */
export interface DMParticipantMeta {
  displayName: string;
  email: string;
  avatarUrl?: string;
}

/**
 * UI-facing participant meta (includes uid)
 */
export interface ParticipantMeta extends DMParticipantMeta {
  uid: string;
}

/**
 * DM Thread document structure
 */
export interface DMThread {
  participantIds: string[];
  participantMeta: { [uid: string]: DMParticipantMeta };
  lastMessageText: string;
  lastMessageAt: Timestamp | null;
  lastMessageSenderId: string;
  unreadCounts: { [uid: string]: number };
  isMuted: { [uid: string]: boolean };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: 'active' | 'archived';
  pinnedBy?: { [uid: string]: boolean };
}

/**
 * DM Message document structure
 */
export interface DMMessage {
  senderId: string;
  text: string;
  attachments?: DMAttachment[];
  createdAt: Timestamp;
  editedAt?: Timestamp;
  deletedAt?: Timestamp;
  type: 'message' | 'system' | 'gif';
  meta?: {
    replyToMessageId?: string;
  };
  // GIF-specific fields
  gifUrl?: string;
  stillPreviewUrl?: string;
  gifWidth?: number;
  gifHeight?: number;
  gifProvider?: 'giphy' | 'tenor';
}

/**
 * Attachment structure (future)
 */
export interface DMAttachment {
  id: string;
  type: 'image' | 'file' | 'link';
  url: string;
  name?: string;
  size?: number;
}

/**
 * Frontend view model for DM Thread
 */
export interface DMThreadView {
  id: string;
  otherUser: {
    uid: string;
    displayName: string;
    email: string;
    avatarUrl?: string;
  };
  lastMessageText: string;
  lastMessageAt: Date | null;
  lastMessageTimeLabel: string;
  unreadCount: number;
  isMuted: boolean;
  isPinned: boolean;
  status: 'active' | 'archived';
}

/**
 * Frontend view model for DM Message
 */
export interface DMMessageView {
  id: string;
  senderId: string;
  text: string;
  createdAt: Date;
  editedAt?: Date;
  deletedAt?: Date;
  type: 'message' | 'system' | 'gif';
  isOwn: boolean;
  timeLabel: string;
  dateLabel?: string; // For date separators
  isPending?: boolean; // True for optimistic messages that haven't been confirmed by server
  // GIF-specific fields
  gifUrl?: string;
  stillPreviewUrl?: string;
  gifWidth?: number;
  gifHeight?: number;
  gifProvider?: 'giphy' | 'tenor';
  // Reactions (populated by hook)
  reactions?: DMReactionView[];
}

/**
 * User presence status
 */
export type PresenceStatus = 'online' | 'away' | 'offline';

/**
 * User presence document
 */
export interface UserPresence {
  status: PresenceStatus;
  lastActiveAt: Timestamp;
}

/**
 * Typing indicator document
 */
export interface DMTypingDoc {
  threadId: string;
  userId: string;
  updatedAt: Timestamp;
}

/**
 * Emoji reaction document
 */
export interface DMReaction {
  emoji: string; // "❤️" "👍" "🔥"
  userId: string; // HRX user ID
  createdAt: Timestamp;
}

/**
 * Reaction view model (aggregated)
 */
export interface DMReactionView {
  emoji: string;
  count: number;
  userReacted: boolean; // Whether current user has reacted with this emoji
  userIds: string[]; // List of user IDs who reacted (for hover tooltip)
}

/**
 * Quick reaction emojis (default set)
 */
export const QUICK_REACTION_EMOJIS = ['❤️', '👍', '🎉', '🙏', '😂'];

