/**
 * Legacy Unified Inbox Types
 *
 * This project has two parallel "unified inbox" type models:
 * - `src/types/unifiedInbox.ts`: the newer, normalized cross-channel model
 * - This file: the older UI-facing "UnifiedMessage" shape used by helper
 *   utilities like `src/utils/unifiedInboxNormalizers.ts`.
 *
 * Keeping this separate prevents type conflicts while we migrate callers.
 */

import { Timestamp } from 'firebase/firestore';

export type UnifiedMessageSource = 'email' | 'sms' | 'slack' | 'internal';

export type UnifiedMessageStatus = 'unreplied' | 'replied' | 'failed' | 'queued' | string;

export interface UnifiedSlackMeta {
  teamId: string;
  channelId: string;
  ts: string;
  channelName?: string;
  channelType?: string;
}

export interface UnifiedMessage {
  id: string;
  source: UnifiedMessageSource;
  conversationId: string;
  tenantId: string;
  from: string;
  to?: string;
  subject?: string;
  preview: string;
  timestamp: Date | Timestamp;
  unread: boolean;
  status: UnifiedMessageStatus;
  originalDocId?: string;
  slackMeta?: UnifiedSlackMeta;
}

/**
 * Legacy filter shape used by older unified inbox utilities/hooks.
 * (Kept separate from the newer `src/types/unifiedInbox.ts` model.)
 */
export interface UnifiedInboxFilters {
  channel?: 'all' | UnifiedMessageSource;
  unreadOnly?: boolean;
  status?: 'any' | UnifiedMessageStatus;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  searchQuery?: string;

  // Advanced fields (used for backend search / future filtering)
  from?: string;
  to?: string;
  subject?: string;
  isUnread?: boolean;
  isStarred?: boolean;
}


