/**
 * Shared recruiter user list search — same behavior as /users/all (name, email, phone, skills).
 * Used by `RecruiterUsers` and group member tables.
 *
 * Mirrors `firestoreUserDocMatchesRecruiterSearch` in
 * `functions/src/recruiter/recruiterUsersSearchMatch.ts` — keep behavior in sync.
 *
 * Matching strategy:
 *  - Whole query as a substring of the full name / displayName / preferredName.
 *  - Token-based: split the query on whitespace; each token must hit *some* field.
 *    A token matches a name field when it is a prefix of any individual name
 *    token (firstName / lastName / each space-separated piece of displayName,
 *    multi-word lastName "Hernandez Leon", etc.) — that's what makes
 *    "Robert Sm" match "Robert Smith".
 *  - Email / phone / skills fall back to substring on individual tokens.
 *  - Phone digits-only and email local-part shortcuts are preserved.
 */

export type RecruiterUserSearchMatchInput = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  skills?: string[] | null;
};

/** Strip diacritics so "José" matches "jose" etc. */
function fold(s: string): string {
  // U+0300–U+036F = Combining Diacritical Marks block.
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function splitTokens(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Name, email (full + local-part + ignore spaces), phone, skills */
export function userMatchesSearchTerm(user: RecruiterUserSearchMatchInput, rawSearch: string): boolean {
  const q = fold(rawSearch.trim());
  if (!q) return true;

  const firstName = String(user.firstName ?? '').trim();
  const lastName = String(user.lastName ?? '').trim();
  const displayName = String(user.displayName ?? '').trim();
  const preferredName = String(user.preferredName ?? '').trim();

  const fullNameFolded = fold(`${firstName} ${lastName}`.trim());
  const displayFolded = fold(displayName);
  const preferredFolded = fold(preferredName);
  const emailLower = String(user.email ?? '').trim().toLowerCase();
  const emailFolded = fold(emailLower);
  const phone = String(user.phone ?? '').trim();
  const phoneLower = phone.toLowerCase();
  const skills = (user.skills ?? []).map((s) => fold(String(s)));

  // Individual name tokens (each word in firstName/lastName/displayName/preferredName).
  // These power per-token prefix matching: "Robert Sm" → "Robert Smith";
  // "Hernandez", "Leon", "Hernandez Leon" all hit lastName "Hernandez Leon".
  const nameTokens = new Set<string>();
  for (const src of [fullNameFolded, displayFolded, preferredFolded]) {
    if (!src) continue;
    for (const tok of splitTokens(src)) nameTokens.add(tok);
  }

  const tokenMatchesName = (token: string): boolean => {
    if (!token) return false;
    for (const nt of nameTokens) {
      if (nt.startsWith(token)) return true;
    }
    return false;
  };

  const tokenMatchesAnyField = (token: string): boolean => {
    if (tokenMatchesName(token)) return true;
    if (emailFolded.includes(token)) return true;
    if (phoneLower.includes(token)) return true;
    if (skills.some((skill) => skill.includes(token))) return true;
    return false;
  };

  // Whole-query convenience matches first (covers " abraham hern" style).
  if (fullNameFolded.includes(q)) return true;
  if (displayFolded && displayFolded.includes(q)) return true;
  if (preferredFolded && preferredFolded.includes(q)) return true;

  // Tokenize and require every token to hit some field.
  const tokens = splitTokens(q);
  if (tokens.length > 0 && tokens.every((t) => tokenMatchesAnyField(t))) return true;

  // Email special cases — full, compact (no spaces), and local-part-only.
  if (emailLower) {
    if (emailLower.includes(q)) return true;
    const compactEmail = emailLower.replace(/\s/g, '');
    const compactQ = q.replace(/\s/g, '');
    if (compactEmail.includes(compactQ)) return true;
    const at = emailLower.indexOf('@');
    if (at > 0 && emailLower.slice(0, at).includes(q)) return true;
  }

  // Phone digits-only fallback ("(555) 123-4567" still matches "5551234567").
  const digits = (s: string) => s.replace(/\D/g, '');
  const qDigits = digits(q);
  if (qDigits.length >= 3 && phone && digits(phone).includes(qDigits)) return true;

  return false;
}
