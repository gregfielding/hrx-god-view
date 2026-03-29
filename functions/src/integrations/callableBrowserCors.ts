/**
 * CORS options for Gen2 `onCall` handlers invoked from the web app.
 * Browsers send a preflight (OPTIONS) for cross-origin POSTs; the runtime must allow the page origin.
 *
 * Include localhost / 127.0.0.1 (any port) for CRA/Vite dev, plus Firebase Hosting patterns.
 * `cors: true` should allow all origins; explicit patterns help when deployed code predates that
 * or when troubleshooting preflight failures from local dev.
 */
export const CALLABLE_BROWSER_CORS: Array<string | RegExp> = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https:\/\/.+\.firebaseapp\.com$/,
  /^https:\/\/.+\.web\.app$/,
];
