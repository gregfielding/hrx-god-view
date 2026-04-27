/**
 * Slack Channel Utilities
 * 
 * Helper functions for Slack channel UI features.
 */

/**
 * Generate a deterministic color for a channel based on its name
 * Returns a color that's consistent for the same channel name
 */
export function getChannelColor(channelName: string): string {
  // Remove # if present
  const name = channelName.replace(/^#/, '');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate HSL color with good saturation and lightness
  const hue = Math.abs(hash) % 360;
  const saturation = 60 + (Math.abs(hash) % 20); // 60-80%
  const lightness = 45 + (Math.abs(hash) % 15); // 45-60%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Check if channel has recent activity (< 3 minutes)
 */
export function isRecentlyActive(lastMessageAt: Date | null | undefined): boolean {
  if (!lastMessageAt) return false;
  const now = new Date();
  const diffMs = now.getTime() - lastMessageAt.getTime();
  const diffMins = diffMs / (1000 * 60);
  return diffMins < 3;
}


