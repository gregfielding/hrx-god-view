#!/usr/bin/env node
/**
 * Firebase Hosting predeploy: always build the SPA from the repo root (where firebase.json lives),
 * then fail fast if build/ is empty or incomplete — prevents 0-file Hosting releases.
 *
 * Run from firebase.json "predeploy" so cwd quirks (e.g. invoking CLI from a subfolder) cannot
 * skip the CRA build or run `functions`' tsc instead of `craco build`.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const INDEX_HTML = path.join(BUILD_DIR, 'index.html');

function countFiles(dir) {
  let n = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

function main() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('[hostingPredeploy] cwd=', ROOT);
  const r = spawnSync(npmCmd, ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (r.status !== 0 && r.status !== null) {
    process.exit(r.status);
  }
  if (r.error) {
    console.error('[hostingPredeploy]', r.error);
    process.exit(1);
  }

  if (!fs.existsSync(INDEX_HTML)) {
    console.error(
      '[hostingPredeploy] ERROR: build/index.html is missing after npm run build.\n' +
        '  Run from repo root: npm run build\n' +
        '  Ensure you are deploying the app workspace (not only functions/).'
    );
    process.exit(1);
  }

  const n = countFiles(BUILD_DIR);
  if (n < 8) {
    console.error(
      `[hostingPredeploy] ERROR: build/ has only ${n} file(s); expected a full CRA output (typically 40+ files).`
    );
    process.exit(1);
  }

  console.log('[hostingPredeploy] OK:', n, 'files under build/');
}

main();
