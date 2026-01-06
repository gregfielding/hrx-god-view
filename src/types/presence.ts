/**
 * Presence Types
 * 
 * Types for user presence/online status system.
 */

import { Timestamp } from 'firebase/firestore';

export type PresenceStatus = 'online' | 'idle' | 'offline';

export interface UserPresenceDoc {
  status: PresenceStatus; // derived, but stored for simplicity
  lastSeenAt: Timestamp;
  device?: 'web' | 'mobile' | 'unknown';
  source?: 'hrx' | 'slack' | 'combined';

  // Optional enrichment (future)
  slackPresence?: 'active' | 'away' | 'unknown';
  // could be expanded with zoom, teams, etc.
}

