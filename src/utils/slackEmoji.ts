import data from '@emoji-mart/data';

type EmojiMartData = {
  emojis?: Record<
    string,
    {
      id: string;
      name?: string;
      skins?: Array<{
        native?: string;
      }>;
    }
  >;
};

const EMOJI_DATA = data as unknown as EmojiMartData;

const getNativeEmoji = (id: string, skinTone?: number): string | null => {
  const e = EMOJI_DATA.emojis?.[id];
  if (!e) return null;

  const skins = e.skins || [];
  if (skins.length === 0) return null;

  // Emoji-mart typically stores base emoji at index 0, with tones at 1..5.
  if (typeof skinTone === 'number' && skinTone >= 1) {
    const idxCandidates = [skinTone, skinTone - 1];
    for (const idx of idxCandidates) {
      const native = skins[idx]?.native;
      if (native) return native;
    }
  }

  return skins[0]?.native || null;
};

/**
 * Convert Slack-style emoji codes like ":pray::skin-tone-3:" or ":partying_face:" into native emoji.
 * Unknown codes are left as-is.
 */
export const replaceSlackEmojiCodes = (input: string): string => {
  if (!input || !input.includes(':')) return input;

  // First pass: emoji + skin tone modifier
  const withSkinTones = input.replace(
    /:([a-z0-9_+-]+)::skin-tone-(\d):/gi,
    (_full, rawName: string, rawTone: string) => {
      const name = String(rawName);
      const tone = Number(rawTone);
      const native = getNativeEmoji(name, tone);
      return native || `:${name}::skin-tone-${tone}:`;
    },
  );

  // Second pass: plain emoji codes (skip skin-tone tokens)
  return withSkinTones.replace(/:([a-z0-9_+-]+):/gi, (_full, rawName: string) => {
    const name = String(rawName);
    if (/^skin-tone-\d$/i.test(name)) return `:${name}:`;
    const native = getNativeEmoji(name);
    return native || `:${name}:`;
  });
};

