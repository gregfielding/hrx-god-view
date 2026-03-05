#!/usr/bin/env node
/**
 * Run the dev server ONLY from the correct branch (recovery/last-night)
 * so you always see Placements tab with Assign All, Export, and Preview Email.
 *
 * Usage: from repo root, run:  node scripts/run-local-with-placements-ui.js
 * Or:    npm run start:placements
 */

const { execSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const expectedBranch = 'recovery/last-night';

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: repoRoot, ...opts });
}

let currentBranch;
try {
  currentBranch = run('git rev-parse --abbrev-ref HEAD').trim();
} catch (e) {
  console.error('Not a git repo or git failed.');
  process.exit(1);
}

if (currentBranch !== expectedBranch) {
  console.error('');
  console.error('Wrong branch. Placements UI (Preview Email, etc.) is only on recovery/last-night.');
  console.error('  Current branch: ' + currentBranch);
  console.error('  Required:       ' + expectedBranch);
  console.error('');
  console.error('Run:');
  console.error('  cd ' + repoRoot);
  console.error('  git checkout recovery/last-night');
  console.error('  npm start');
  console.error('');
  process.exit(1);
}

console.log('Branch OK: ' + currentBranch + ' — starting dev server from ' + repoRoot);
console.log('When Placements tab loads, you should see: Assign All, Export, Preview Email');
console.log('');
require('child_process').spawn('npm', ['start'], { cwd: repoRoot, stdio: 'inherit', shell: true });
