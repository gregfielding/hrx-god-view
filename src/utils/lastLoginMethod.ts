/**
 * Remembers how this browser last signed in ('phone' | 'email').
 *
 * Phone-first /login (Greg 2026-08-25): workers get the phone screen by
 * default, but anyone who last signed in with email/password (staff, admins)
 * is bounced straight to /login/email so the flip costs them nothing.
 * Stamped only on SUCCESSFUL sign-in, never on merely visiting a form.
 */
export type LastLoginMethod = 'phone' | 'email';

const KEY = 'c1LastLoginMethod';

export function getLastLoginMethod(): LastLoginMethod | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'phone' || v === 'email' ? v : null;
  } catch {
    return null;
  }
}

export function setLastLoginMethod(method: LastLoginMethod): void {
  try {
    localStorage.setItem(KEY, method);
  } catch {
    /* private mode etc. — memory is best-effort */
  }
}
