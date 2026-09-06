/**
 * Public origin of this web app, for the few places that must build an
 * absolute URL without (or in addition to) `window.location.origin`.
 *
 * Migration (Greg, 2026-09-05): the app is moving from hrxone.com to
 * app.c1staffing.com. Both hostnames serve the same Firebase Hosting site, so
 * links built from the CURRENT origin keep working on either. The canonical
 * fallback stays hrxone.com until the flip; change REACT_APP_PUBLIC_APP_ORIGIN
 * (or the default below) and rebuild to move it. See
 * docs/claude/project_app_domain_migration.md.
 */

export const PUBLIC_APP_ORIGIN: string = (
  process.env.REACT_APP_PUBLIC_APP_ORIGIN || 'https://hrxone.com'
).replace(/\/+$/, '');

/** Every hostname the app is served from (exact origins). */
export const APP_ORIGINS: readonly string[] = [
  'https://hrxone.com',
  'https://app.hrxone.com',
  'https://app.c1staffing.com',
  'https://hrx1-d3beb.web.app',
  'https://hrx1-d3beb.firebaseapp.com',
];

/**
 * The origin to build shareable links on: the page's own origin when it is
 * one of ours (or local dev), otherwise the canonical public origin. Safe to
 * call during SSR / tests (no window) — falls back to PUBLIC_APP_ORIGIN.
 */
export function getAppOrigin(): string {
  const current = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  if (!current) return PUBLIC_APP_ORIGIN;
  if (APP_ORIGINS.includes(current)) return current;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(current)) return current;
  return PUBLIC_APP_ORIGIN;
}
