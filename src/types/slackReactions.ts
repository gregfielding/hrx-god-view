/**
 * Slack Reactions Types
 * 
 * Types for Slack message reactions feature.
 */

/**
 * Context identifying a specific Slack message
 */
export interface SlackReactionContext {
  channelId: string;
  messageTs: string; // Slack timestamp (e.g., "1234567890.123456")
}

/**
 * Summary of a reaction for a message
 */
export interface ReactionSummary {
  emoji: string; // Emoji name (e.g., "white_check_mark", "thumbsup")
  count: number;
  userHasReacted: boolean;
  userIds: string[]; // Array of user IDs who reacted
}

