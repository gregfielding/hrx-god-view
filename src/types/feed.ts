/**
 * Feed Post Types
 * 
 * Types for dashboard feed posts with mentions.
 */

import type { MessageBase } from './messageBase';

export type FeedPostVisibility = 'tenant' | 'team' | 'private';

export interface FeedPost extends MessageBase {
  // For routing / filtering
  targetChannelId?: string;     // Slack channel or internal channel id
  visibility: FeedPostVisibility;
  // For referencing a Slack message if posted
  slackChannelId?: string;
  slackTs?: string;
}

