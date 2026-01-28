/**
 * Slack mention formatting helpers.
 *
 * The Mentions feed is "mentions of the current user", so when we see Slack's
 * raw mention tokens in the snippet (e.g. "<@U123...>") we can render a human
 * label for the current user.
 */

/**
 * Converts Slack user mention tokens to a readable "@Label".
 *
 * Handles:
 * - "<@U123ABC>" → "@label"
 * - "<@U123ABC|greg>" → "@greg"
 * - "@U123ABC" → "@label" (fallback)
 * - "@user" → "@label" (legacy/fallback)
 */
export function formatSlackMentionsForCurrentUser(
  text: string,
  currentUserLabel: string,
): string {
  if (!text) return text;
  const label = currentUserLabel?.trim() || 'you';

  // Slack format: <@U123ABC> or <@U123ABC|name>
  const withAngleMentions = text.replace(
    /<@([A-Z0-9]+)(\|([^>]+))?>/g,
    (_m, _id: string, _pipe: string | undefined, providedName: string | undefined) => {
      const name = (providedName || '').trim();
      return `@${name || label}`;
    },
  );

  // Sometimes we already stored "raw-ish" tokens like @U123ABC.
  const withAtIdMentions = withAngleMentions.replace(/@U[A-Z0-9]+/g, `@${label}`);

  // Legacy fallback in some stored snippets.
  const withLegacy = withAtIdMentions.replace(/\B@user\b/g, `@${label}`);

  return withLegacy;
}

