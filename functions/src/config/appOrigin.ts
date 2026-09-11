/**
 * Single source of truth for the public web-app origin and for the browser
 * origins that may call HTTP / callable functions.
 *
 * Migration plan (Greg, 2026-09-05): the web app moves from hrxone.com to
 * app.c1staffing.com. Until the flip, PUBLIC_APP_ORIGIN stays hrxone.com so
 * every SMS / email link keeps working; app.c1staffing.com is already in
 * BROWSER_ORIGINS so the app can be exercised there. To flip, set
 * `PUBLIC_APP_ORIGIN=https://app.c1staffing.com` in functions/.env.hrx1-d3beb
 * and redeploy the link-building functions (see
 * docs/claude/project_app_domain_migration.md). hrxone.com stays in
 * BROWSER_ORIGINS until it is retired.
 *
 * ☠️ Firebase Auth action links (setup-password / reset) are minted only for
 * AUTHORIZED auth domains — whatever PUBLIC_APP_ORIGIN points at must be in
 * Authentication → Settings → Authorized domains, or generatePasswordResetLink
 * throws "Unable to create the email action link" (worker report 2026-07-31).
 */

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Canonical origin used to BUILD links in SMS / email / push. */
export const PUBLIC_APP_ORIGIN: string = trimTrailingSlash(
  process.env.PUBLIC_APP_ORIGIN ||
    process.env.WORKER_WEB_BASE_URL ||
    process.env.WEB_BASE_URL ||
    process.env.PUBLIC_WEB_BASE_URL ||
    'https://hrxone.com'
);

/** Hostname form of PUBLIC_APP_ORIGIN (for copy like "go to hrxone.com"). */
export const PUBLIC_APP_HOST: string = PUBLIC_APP_ORIGIN.replace(/^https?:\/\//, '');

/** Origins a browser may present when calling our functions (exact match). */
export const BROWSER_ORIGINS: readonly string[] = [
  'https://hrxone.com',
  'https://www.hrxone.com',
  'https://app.hrxone.com',
  'https://app.c1staffing.com',
  'https://hrx1-d3beb.web.app',
  'https://hrx1-d3beb.firebaseapp.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/** Pattern matches for the same purpose (subdomains, dev ports, preview channels). */
export const BROWSER_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)*hrxone\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*c1staffing\.com$/i,
  /^https:\/\/[a-z0-9-]+\.web\.app$/i,
  /^https:\/\/[a-z0-9-]+\.firebaseapp\.com$/i,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
];

export function isAllowedBrowserOrigin(origin: string | string[] | undefined | null): boolean {
  const o = (Array.isArray(origin) ? origin[0] : origin || '').trim();
  if (!o) return false;
  if (BROWSER_ORIGINS.includes(o)) return true;
  return BROWSER_ORIGIN_PATTERNS.some((re) => re.test(o));
}

/**
 * Value for `Access-Control-Allow-Origin` on hand-rolled onRequest handlers:
 * echoes the caller's origin when it is one of ours, otherwise the canonical
 * origin (which makes the browser reject the response — the same effect the
 * old hardcoded 'https://hrxone.com' had for foreign callers).
 */
export function corsOriginFor(origin: string | string[] | undefined | null): string {
  const o = (Array.isArray(origin) ? origin[0] : origin || '').trim();
  return isAllowedBrowserOrigin(o) ? o : PUBLIC_APP_ORIGIN;
}
