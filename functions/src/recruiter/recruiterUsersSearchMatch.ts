/**
 * Mirrors `userMatchesSearchTerm` in `src/utils/recruiterUserSearchMatch.ts` for server-side full-collection search.
 *
 * Matching strategy:
 *  - Whole query as a substring of the full name / displayName / preferredName
 *    (so "abraham hern" still hits even though the second token is a prefix).
 *  - Token-based: split the query on whitespace; each token must hit *some* field.
 *    A token matches a name field when it is a prefix of any individual name
 *    token (firstName / lastName / each space-separated piece of displayName,
 *    lastName "Hernandez Leon", etc.) — that's what makes "Robert Sm" match
 *    "Robert Smith".
 *  - Email / phone / skills fall back to substring on individual tokens.
 *  - Phone digits-only and email local-part shortcuts are preserved.
 */
import { normalizeUsStateCode } from './usStateNormalize';

function normalizeSkills(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((skill: unknown) => {
      if (!skill) return null;
      if (typeof skill === 'string') return skill;
      if (typeof skill === 'object' && skill !== null) {
        const o = skill as Record<string, unknown>;
        if (typeof o.label === 'string') return o.label;
        if (typeof o.name === 'string') return o.name;
        if (typeof o.value === 'string') return o.value;
      }
      return null;
    })
    .filter((s): s is string => !!s);
}

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

/**
 * Returns true if this user document should appear when `rawSearch` is applied in the recruiter table.
 * `data` is Firestore `users/{id}` document data; `tenantId` scopes tenant-specific fields.
 */
export function firestoreUserDocMatchesRecruiterSearch(
  data: Record<string, unknown> | undefined,
  tenantId: string,
  rawSearch: string,
): boolean {
  if (!data) return false;
  const q = fold(rawSearch.trim());
  if (!q) return true;

  const tenantData = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;

  const resolvedEmail =
    [data.email, data.contactEmail, data.primaryEmail, data.profileEmail].find(
      (v: unknown) => typeof v === 'string' && String(v).trim().length > 0,
    ) || '';

  const rawDisplay = String(data.displayName || '').trim();
  let firstName = String(data.firstName || '').trim();
  let lastName = String(data.lastName || '').trim();
  const preferredName = String(data.preferredName || '').trim();
  if (!firstName && !lastName && rawDisplay) {
    const parts = rawDisplay.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      firstName = parts[0];
    }
  }

  const fullNameFolded = fold(`${firstName} ${lastName}`.trim());
  const displayFolded = fold(rawDisplay);
  const preferredFolded = fold(preferredName);
  const emailLower = String(resolvedEmail).trim().toLowerCase();
  const emailFolded = fold(emailLower);
  const phone = String(data.phone || data.phoneE164 || '').trim();
  const phoneLower = phone.toLowerCase();
  const skills = normalizeSkills(data.skills ?? tenantData?.skills).map((s) => fold(s));

  // Individual name tokens (each word in firstName/lastName/displayName/preferredName).
  // These power per-token prefix matching, which is what makes "Robert Sm"
  // → "Robert Smith" work (and "Hernandez", "Leon", "Hernandez Leon" all hit
  // a worker whose lastName is "Hernandez Leon").
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

function extractStateRawFromUserDoc(data: Record<string, unknown>): string {
  const ai =
    data.addressInfo && typeof data.addressInfo === 'object'
      ? (data.addressInfo as Record<string, unknown>)
      : null;
  const ad =
    data.address && typeof data.address === 'object' ? (data.address as Record<string, unknown>) : null;
  const raw = data.state || ad?.state || ai?.state || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/** True if user belongs to the tenant user group `groupId` (Firestore user doc shape). */
export function firestoreUserDocMatchesRecruiterGroup(
  data: Record<string, unknown> | undefined,
  tenantId: string,
  groupId: string,
): boolean {
  if (!groupId || groupId === 'all') return true;
  if (!data) return false;
  const tenantData = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  const ids = new Set<string>();
  const collect = (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    raw.forEach((x) => {
      if (typeof x === 'string' && x.trim()) ids.add(x.trim());
    });
  };
  collect(tenantData?.userGroupIds);
  collect(data.userGroupIds);
  return ids.has(groupId);
}

/** True if user's state resolves to the same USPS code as `selectedStateRaw` (2-letter or full name from client). */
export function firestoreUserDocMatchesRecruiterState(
  data: Record<string, unknown> | undefined,
  selectedStateRaw: string,
): boolean {
  const selected = normalizeUsStateCode(selectedStateRaw);
  if (!selected) return false;
  if (!data) return false;
  const userCode = normalizeUsStateCode(extractStateRawFromUserDoc(data));
  return userCode === selected;
}
