/**
 * Mirrors `userMatchesSearchTerm` in `src/pages/RecruiterUsers.tsx` for server-side full-collection search.
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
  const q = rawSearch.trim().toLowerCase();
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
  if (!firstName && !lastName && rawDisplay) {
    const parts = rawDisplay.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      firstName = parts[0];
    }
  }

  const fullName = `${firstName} ${lastName}`.trim().toLowerCase();
  const displayLower = rawDisplay.toLowerCase();
  const email = String(resolvedEmail).trim();
  const emailLower = email.toLowerCase();
  const phone = String(data.phone || data.phoneE164 || '').trim();
  const skills = normalizeSkills(data.skills ?? tenantData?.skills);

  const fieldMatchesToken = (token: string) =>
    fullName.includes(token) ||
    (displayLower && displayLower.includes(token)) ||
    emailLower.includes(token) ||
    phone.toLowerCase().includes(token) ||
    skills.some((skill) => skill.toLowerCase().includes(token));

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    if (tokens.every((t) => fieldMatchesToken(t))) return true;
  } else {
    if (fullName.includes(q)) return true;
    if (displayLower && displayLower.includes(q)) return true;
  }

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

  if (tokens.length <= 1 && phone.toLowerCase().includes(q)) return true;
  const digits = (s: string) => s.replace(/\D/g, '');
  const qDigits = digits(q);
  if (qDigits.length >= 3 && phone && digits(phone).includes(qDigits)) return true;

  if (tokens.length <= 1 && skills.some((skill) => skill.toLowerCase().includes(q))) return true;

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

