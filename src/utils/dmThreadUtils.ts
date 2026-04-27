/**
 * Direct Messenger Thread Utilities
 * 
 * Helper functions for DM thread operations.
 */

/**
 * Generate a deterministic thread ID for a 1:1 conversation
 * Uses sorted UIDs to ensure the same thread ID regardless of order
 * 
 * @param uid1 First user ID
 * @param uid2 Second user ID
 * @returns Deterministic thread ID (hex string)
 */
export function getThreadId(uid1: string, uid2: string): string {
  // Sort UIDs to ensure deterministic ID
  const sorted = [uid1, uid2].sort();
  const key = sorted.join('_');
  
  // Simple hash function (similar to getChannelColor pattern)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Convert to positive hex string
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Get the other participant's UID from a thread
 * 
 * @param participantIds Array of participant UIDs
 * @param currentUserId Current user's UID
 * @returns The other participant's UID, or null if not found
 */
export function getOtherParticipant(
  participantIds: string[],
  currentUserId: string
): string | null {
  const other = participantIds.find(id => id !== currentUserId);
  return other || null;
}


