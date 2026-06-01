/**
 * Venue alias lookup — the explicit-mapping shortcut around the fuzzy
 * matcher (Slice 3c, 2026-06-02).
 *
 * Some venue strings from Indeed Flex emails are deliberately stuffed
 * with brand / SVC / customer codes that fuzzy matching can't reliably
 * resolve to an HRX child account — e.g.:
 *
 *   "WBI (Hanover, MD) - Maryland Warehouse - SVC07/44/00"
 *      → should route to the CORT "Maryland Warehouse" account, but
 *        no fuzzy threshold clears it without also pulling in CORT
 *        Woodbridge / Phoenix / San Francisco as false positives.
 *
 * The alias table sidesteps the fuzzy match entirely: the recruiter
 * confirms the mapping ONCE via the /shifts/log UI, and every future
 * email with the same normalized venue routes automatically.
 *
 * Key shape: we re-use the existing `normalizeVenueName` from
 * matchByVenue so aliases collapse the SVC code suffix and city-code
 * prefix. That means a single alias entry covers every variant of the
 * SVC code (which rotates per request) without the recruiter having to
 * re-confirm.
 *
 * Schema (`tenants/{tid}/venue_aliases/{aliasId}`):
 *
 *   {
 *     aliasKey: string,          // normalized venue (the doc id)
 *     venueNameRaw: string,      // original full string from the email
 *     accountId: string,         // target child account
 *     accountName: string,       // snapshot for display / log
 *     createdBy: string,         // uid of the recruiter who linked it
 *     createdAt: Timestamp,
 *     tenantId: string,
 *   }
 *
 * Doc id is the alias key with `/` → `_` (Firestore disallows slashes
 * in document ids).
 */

import { normalizeVenueName } from './matchByVenue';

/**
 * Compute the alias lookup key for a raw venue string. Uses the
 * matcher's existing normalization (strips Indeed prefix codes + SVC
 * suffix) then lowercases + collapses whitespace so equivalent strings
 * collide. Exported for callers that need to build a doc id.
 */
export function aliasKeyFor(rawVenueName: string): string {
  return normalizeVenueName(rawVenueName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Firestore doc ids can't contain `/`. The normalized key occasionally
 *  does (e.g. multi-line venues with a slash). Replace with `_`. */
export function aliasDocIdFor(rawVenueName: string): string {
  const key = aliasKeyFor(rawVenueName);
  return key.replace(/\//g, '_');
}
