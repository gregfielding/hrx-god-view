/**
 * Server-side: detect bad `users.firstName` (digits / phone) and validate prescreen confirmation.
 * Logic aligned with `src/utils/profileDisplayName.ts` (functions bundle cannot import app src).
 */

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function valueLooksLikePhoneStoredAsName(value: string, phoneOnProfile?: string | null): boolean {
  const t = String(value || '').trim();
  if (!t) return false;

  const d = digitsOnly(t);
  if (d.length < 10 || d.length > 15) return false;

  const looksPhoneShaped = /^[\d\s\-().+]+$/.test(t);
  if (looksPhoneShaped && d.length >= 10) return true;

  if (phoneOnProfile) {
    const pd = digitsOnly(phoneOnProfile);
    if (pd.length >= 10 && (d === pd || pd.slice(-10) === d.slice(-10))) {
      return true;
    }
  }

  return false;
}

export function userDocNeedsLegalFirstNameConfirm(ud: Record<string, unknown> | null | undefined): boolean {
  if (!ud || typeof ud !== 'object') return false;
  const fn = String(ud.firstName ?? '').trim();
  if (!fn) return false;
  const phone = String(ud.phone ?? ud.phoneE164 ?? '');
  if (valueLooksLikePhoneStoredAsName(fn, phone || null)) return true;
  if (!/[a-zA-Z\u00C0-\u024F]/.test(fn)) {
    const digits = fn.replace(/\D/g, '');
    if (digits.length >= 3) return true;
  }
  return false;
}

export function isValidConfirmedLegalFirstName(s: string): boolean {
  const t = String(s ?? '').trim();
  if (t.length < 2 || t.length > 80) return false;
  if (!/[a-zA-Z\u00C0-\u024F]/.test(t)) return false;
  if (valueLooksLikePhoneStoredAsName(t, null)) return false;
  return true;
}

export function capitalizeFirstLetterName(input: string): string {
  const t = String(input ?? '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
