/**
 * prebuild guard: refuse to build the web bundle without the REACT_APP_* keys
 * that live only in the gitignored .env.
 *
 * Why (incident 2026-09-11): a hosting deploy built from a checkout with no
 * .env (Claude worktrees and fresh clones don't have one) shipped
 * REACT_APP_GOOGLE_MAPS_API_KEY = '' — every Places autocomplete on hrxone.com
 * (Smart Groups radius, apply address, add worker) showed Google's "This page
 * can't load Google Maps correctly" dialog, and web push lost its VAPID key.
 * CRA inlines these at build time, so the build must fail instead.
 *
 * Prints variable NAMES only, never values. Bypass (non-deploy builds only):
 * SKIP_BUILD_ENV_CHECK=1 npm run build
 */
const fs = require('fs');
const path = require('path');

const REQUIRED = ['REACT_APP_GOOGLE_MAPS_API_KEY', 'REACT_APP_FIREBASE_VAPID_KEY'];
// Files react-scripts reads for a production build.
const ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];

if (process.env.SKIP_BUILD_ENV_CHECK === '1') {
  console.warn('[check-build-env] SKIPPED via SKIP_BUILD_ENV_CHECK=1 — do not deploy this build.');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const fromFiles = {};
for (const file of ENV_FILES) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (value && !fromFiles[m[1]]) fromFiles[m[1]] = true;
  }
}

const missing = REQUIRED.filter((name) => !(process.env[name] || '').trim() && !fromFiles[name]);
if (missing.length) {
  console.error(
    `\n[check-build-env] Missing ${missing.join(', ')}.\n` +
      `This checkout has no usable .env (Claude worktrees and fresh clones don't get one).\n` +
      `Copy .env from your main hrx-god-view checkout (or rebuild it from the Google Cloud console\n` +
      `API keys page) before building — a deploy without these breaks Google Maps on hrxone.com.\n` +
      `See docs/claude/feedback_build_missing_env_keys.md.\n`
  );
  process.exit(1);
}
console.log('[check-build-env] OK');
