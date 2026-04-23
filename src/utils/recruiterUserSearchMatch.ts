/**
 * Shared recruiter user list search — same behavior as /users/all (name, email, phone, skills).
 * Used by `RecruiterUsers` and group member tables.
 */

export type RecruiterUserSearchMatchInput = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  skills?: string[] | null;
};

/** Name, email (full + local-part + ignore spaces), phone, skills */
export function userMatchesSearchTerm(user: RecruiterUserSearchMatchInput, rawSearch: string): boolean {
  const q = rawSearch.trim().toLowerCase();
  if (!q) return true;

  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim().toLowerCase();
  const displayLower = (user.displayName || '').trim().toLowerCase();

  const fieldMatchesToken = (token: string) =>
    fullName.includes(token) ||
    (displayLower && displayLower.includes(token)) ||
    (user.email || '').toLowerCase().includes(token) ||
    (user.phone || '').toLowerCase().includes(token) ||
    user.skills?.some((skill) => skill.toLowerCase().includes(token)) === true;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    if (tokens.every((t) => fieldMatchesToken(t))) return true;
  } else {
    if (fullName.includes(q)) return true;
    if (displayLower && displayLower.includes(q)) return true;
  }

  const email = (user.email || '').trim();
  const emailLower = email.toLowerCase();
  if (emailLower) {
    if (tokens.length <= 1 && emailLower.includes(q)) return true;
    const compactEmail = emailLower.replace(/\s/g, '');
    const compactQ = q.replace(/\s/g, '');
    if (compactEmail.includes(compactQ)) return true;
    const at = emailLower.indexOf('@');
    if (at > 0) {
      const local = emailLower.slice(0, at);
      if (local.includes(q)) return true;
    }
  }

  if (tokens.length <= 1 && user.phone?.toLowerCase().includes(q)) return true;
  const digits = (s: string) => s.replace(/\D/g, '');
  const qDigits = digits(q);
  if (qDigits.length >= 3 && user.phone && digits(user.phone).includes(qDigits)) return true;

  if (tokens.length <= 1 && user.skills?.some((skill) => skill.toLowerCase().includes(q))) return true;

  return false;
}
