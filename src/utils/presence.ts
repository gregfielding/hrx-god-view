/**
 * Presence Utilities
 * 
 * Shared utilities for deriving presence status from Firestore documents.
 */

import { differenceInMinutes } from 'date-fns';
import type { UserPresenceDoc, PresenceStatus } from '../types/presence';

/**
 * Derives effective status from a presence document.
 * 
 * Rules:
 * - <= 2 minutes ago: 'online'
 * - 2-30 minutes ago: 'idle'
 * - > 30 minutes ago: 'offline'
 */
export function getEffectiveStatus(doc: UserPresenceDoc | null | undefined): PresenceStatus {
  if (!doc || !doc.lastSeenAt) return 'offline';

  const lastSeen = doc.lastSeenAt.toDate();
  const minutesAgo = differenceInMinutes(new Date(), lastSeen);

  if (minutesAgo <= 2) return 'online';      // active in last 2 minutes
  if (minutesAgo <= 30) return 'idle';       // 2–30 minutes
  return 'offline';                          // otherwise offline
}

