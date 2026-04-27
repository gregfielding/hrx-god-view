/**
 * Mentions Types
 * 
 * Types for @mention functionality including Slack and HRX-native mentions.
 */

import { Timestamp } from 'firebase/firestore';

/**
 * User Slack Integration stored in Firestore
 * Collection: users/{uid}/integrations/slack
 */
export interface UserSlackIntegration {
  slackUserId: string;     // e.g. "U04ABC123"
  teamId: string;          // Slack workspace ID
  displayName: string;     // "Donna Persson"
  username: string;        // "donna" (lowercase, used for @donna)
  email: string;           // user email
  avatarUrl?: string;      // Slack avatar
  linkedAt: Timestamp;
}

/**
 * HRX-native message with mentions
 */
export interface HrxMessage {
  id: string;
  threadId: string;
  authorId: string;
  body: string;                 // original markdown / text with @tokens
  plainText: string;            // stripped text for search/snippet
  mentionedUserIds: string[];   // HRX uids
  createdAt: Timestamp;
  editedAt?: Timestamp;
}

/**
 * Mentionable user for autocomplete
 */
export interface MentionableUser {
  id: string;               // HRX uid
  fullName: string;         // "Donna Persson"
  username: string;         // "donna"
  email: string;
  avatarUrl?: string;
  slackUsername?: string;   // optional, from Slack link
  presence?: 'online' | 'away' | 'offline';
}

/**
 * Mention option for autocomplete UI
 */
export interface MentionOption {
  id: string;            // HRX uid
  username: string;      // "donna"
  label: string;         // "Donna Persson"
  email: string;
  avatarUrl?: string;
}

