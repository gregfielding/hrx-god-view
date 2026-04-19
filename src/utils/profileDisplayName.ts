/**
 * Guards against bad `users.firstName` values (often a phone / digits) polluting UI.
 * Does not modify Firestore — display-time + load-time sanitization only.
 */

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** True when the string is almost certainly a phone number stored in a name field. */
export function valueLooksLikePhoneStoredAsName(value: string, phoneOnProfile?: string | null): boolean {
  const t = String(value || '').trim();
  if (!t) return false;

  const d = digitsOnly(t);
  if (d.length < 10 || d.length > 15) return false;

  // Bare digits (e.g. 6824852889) or typical phone formatting
  const looksPhoneShaped = /^[\d\s\-().+]+$/.test(t);
  if (looksPhoneShaped && d.length >= 10) return true;

  // Matches profile phone (normalized)
  if (phoneOnProfile) {
    const pd = digitsOnly(phoneOnProfile);
    if (pd.length >= 10 && (d === pd || (pd.length >= 10 && d.length >= 10 && pd.slice(-10) === d.slice(-10)))) {
      return true;
    }
  }

  return false;
}

type SanitizeInput = {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
};

/**
 * Returns safer first/last for recruiter tables and profile header when `firstName` is digits/phone-like.
 */
export function sanitizeWorkerNameParts(input: SanitizeInput): { firstName: string; lastName: string } {
  const phone = input.phone ?? null;
  let first = String(input.firstName || '').trim();
  let last = String(input.lastName || '').trim();

  if (valueLooksLikePhoneStoredAsName(first, phone)) {
    first = '';
  }
  if (valueLooksLikePhoneStoredAsName(last, phone)) {
    last = '';
  }

  const preferred = String(input.preferredName || '').trim();
  if (preferred && (!first || !last)) {
    const parts = preferred.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      if (!first && !valueLooksLikePhoneStoredAsName(parts[0], phone)) first = parts[0];
      if (!last) last = parts.slice(1).join(' ');
    } else if (parts.length === 1 && !first && !valueLooksLikePhoneStoredAsName(parts[0], phone)) {
      first = parts[0];
    }
  }

  const rawDisplay = String(input.displayName || '').trim();
  if ((!first || !last) && rawDisplay) {
    const parts = rawDisplay.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const cand = parts[0];
      if (!first && !valueLooksLikePhoneStoredAsName(cand, phone)) {
        first = cand;
        if (!last) last = parts.slice(1).join(' ');
      }
    } else if (parts.length === 1 && !first) {
      const cand = parts[0];
      if (!valueLooksLikePhoneStoredAsName(cand, phone)) first = cand;
    }
  }

  if (!first && input.email) {
    const local = input.email.split('@')[0] || '';
    if (local && !/^\d+$/.test(local)) {
      const seg = local.split(/[._-]/)[0];
      if (seg && !/^\d+$/.test(seg)) first = seg;
    }
  }

  return { firstName: first, lastName: last };
}

/**
 * True when the worker should confirm their legal first name in the AI prescreen
 * (e.g. digits / phone-like value stored in `users.firstName`).
 */
export function userDocNeedsLegalFirstNameConfirm(
  ud: Record<string, unknown> | null | undefined,
): boolean {
  if (!ud || typeof ud !== 'object') return false;
  const fn = String(ud.firstName ?? '').trim();
  if (!fn) return false;
  const phone = String(ud.phone ?? ud.phoneE164 ?? '');
  if (valueLooksLikePhoneStoredAsName(fn, phone || null)) return true;
  // No letters but enough digits — numbers instead of a name
  if (!/[a-zA-Z\u00C0-\u024F]/.test(fn)) {
    const digits = fn.replace(/\D/g, '');
    if (digits.length >= 3) return true;
  }
  return false;
}

/** Uppercase first character only; preserves the rest (e.g. "jOHN" → "JOHN" — trim first). */
export function capitalizeFirstLetterName(input: string): string {
  const t = String(input ?? '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
