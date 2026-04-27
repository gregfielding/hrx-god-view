/**
 * Message Base Types
 * 
 * Base interfaces for message-like content that supports mentions.
 */

import type { Mention } from './crossSystemMentions';

export interface MessageBase {
  id: string;
  tenantId: string;
  authorId: string;
  body: string;          // raw text with @/#/&/% tokens
  mentions: Mention[];   // structured mentions
  createdAt: Date | any; // Firestore Timestamp or Date
  updatedAt?: Date | any;
}

