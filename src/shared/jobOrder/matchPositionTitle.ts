/**
 * Position-title matching for gig job orders (2026-09-09).
 *
 * A gig JO carries `gigPositions[]` and one public posting PER position
 * (`posting.positionJobTitle`). Each shift is tagged with
 * `defaultJobTitle`, and the jobs board shows a posting only the shifts that
 * belong to its position. The original pairing was an EXACT string compare,
 * which silently hid every shift whose title came from somewhere other than
 * the JO's own position list — Indeed Flex calls the OnTrac role "Warehouse
 * Operative" while the JO position is "Package Handler (Warehouse
 * Operative)", so the Denver posting rendered with zero shifts and no Apply
 * buttons even though two shifts were open (JO #501).
 *
 * `matchPosition` is the loose resolver Flex shift dressing has used since
 * PI-4 (exact → unique containment → unique shared token). It lives here so
 * the client filter and the functions creator agree on what "belongs"
 * means. `functions/src/shared` is a symlink to this directory;
 * `src/shared/` is a byte-identical mirror — edit both.
 */

export interface TitledPosition {
  jobTitle?: string;
}

export function normalizePositionTitle(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

/** Best position for a role: exact title → contains → the single
 *  position sharing ≥1 token. Null when nothing matches confidently. */
export function matchPosition<T extends TitledPosition>(
  roleName: string,
  positions: T[],
): T | null {
  const role = normalizePositionTitle(roleName);
  if (!role || positions.length === 0) return null;
  const titled = positions.filter((p) => normalizePositionTitle(p.jobTitle));
  const exact = titled.find((p) => normalizePositionTitle(p.jobTitle) === role);
  if (exact) return exact;
  // Containment and token overlap must both be UNIQUE — "Associate"
  // is contained in several titles and proves nothing.
  const contains = titled.filter((p) => {
    const t = normalizePositionTitle(p.jobTitle);
    return t.includes(role) || role.includes(t);
  });
  if (contains.length === 1) return contains[0];
  const roleToks = tokens(role);
  const sharing = titled.filter((p) =>
    [...tokens(String(p.jobTitle))].some((t) => roleToks.has(t)),
  );
  return sharing.length === 1 ? sharing[0] : null;
}

/**
 * Does a shift tagged `shiftJobTitle` belong on the posting for
 * `positionJobTitle`, given the JO's `gigPositions`?
 *
 * - No position on the posting → every shift (single-post JOs).
 * - Untitled shift → every position's posting (legacy / hand-made shifts
 *   predate per-position titles; hiding them from all posts helps nobody).
 * - Exact (normalized) match → yes.
 * - JO with 0–1 titled positions → yes: there is only one position a shift
 *   could be, whatever an integration happened to call it.
 * - Otherwise resolve the shift title through `matchPosition` and compare
 *   the resolved position to the posting's.
 */
export function shiftBelongsToPosition(args: {
  shiftJobTitle?: string | null;
  positionJobTitle?: string | null;
  gigPositions?: TitledPosition[] | null;
}): boolean {
  const want = normalizePositionTitle(args.positionJobTitle);
  if (!want) return true;
  const have = normalizePositionTitle(args.shiftJobTitle);
  if (!have) return true;
  if (have === want) return true;
  const positions = (args.gigPositions ?? []).filter((p) => normalizePositionTitle(p.jobTitle));
  if (positions.length <= 1) return true;
  const resolved = matchPosition(have, positions);
  return resolved != null && normalizePositionTitle(resolved.jobTitle) === want;
}
