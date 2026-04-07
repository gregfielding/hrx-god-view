/**
 * CORS options for Gen2 `onCall` handlers invoked from the web app.
 * Browsers send a preflight (OPTIONS) for cross-origin POSTs; the runtime must allow the page origin.
 *
 * Include localhost / 127.0.0.1 (any port) for CRA/Vite dev, plus Firebase Hosting patterns.
 * Production uses the custom domain hrxone.com (not *.web.app), so it must be listed here or
 * everifyCheckEligibility and other callables fail from the browser with a CORS preflight error.
 */
export const CALLABLE_BROWSER_CORS: Array<string | RegExp> = [
  // Explicit production origins (string match avoids any RegExp edge cases in the cors middleware / bundling).
  'https://hrxone.com',
  'https://www.hrxone.com',
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https:\/\/.+\.firebaseapp\.com$/,
  /^https:\/\/.+\.web\.app$/,
  // Apex + any subdomain (app.hrxone.com, tenant paths, etc.)
  /^https:\/\/([a-z0-9-]+\.)*hrxone\.com$/,
];
