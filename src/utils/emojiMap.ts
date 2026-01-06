/**
 * Emoji Map Utility
 * 
 * Maps Slack emoji names to Unicode glyphs.
 */

const EMOJI_MAP: Record<string, string> = {
  white_check_mark: '✅',
  eyes: '👀',
  raised_hands: '🙌',
  heart: '❤️',
  thumbsup: '👍',
  fire: '🔥',
  '+1': '👍',
  '-1': '👎',
  smile: '😄',
  laughing: '😆',
  clap: '👏',
  tada: '🎉',
  party: '🎊',
  rocket: '🚀',
  star: '⭐',
  sparkles: '✨',
  thinking_face: '🤔',
  thumbsdown: '👎',
};

/**
 * Maps Slack emoji name to Unicode glyph
 */
export function mapEmojiNameToGlyph(name: string): string {
  return EMOJI_MAP[name] ?? name; // Return name if not found (some may be Unicode already)
}

