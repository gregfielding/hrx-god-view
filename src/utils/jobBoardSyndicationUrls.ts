/** Normalize user-entered URL for external links (add https if missing). */
export function normalizeJobBoardSyndicationUrl(raw: string | undefined | null): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function hasJobBoardSyndicationUrl(indeedUrl?: string | null, craigslistUrl?: string | null): boolean {
  return Boolean(normalizeJobBoardSyndicationUrl(indeedUrl) || normalizeJobBoardSyndicationUrl(craigslistUrl));
}
