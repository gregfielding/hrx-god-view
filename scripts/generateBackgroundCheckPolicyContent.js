#!/usr/bin/env node
/**
 * Regenerates src/pages/compliance/backgroundCheckPolicyContent.ts from the
 * canonical policy markdown. Run after every policy version bump:
 *   node scripts/generateBackgroundCheckPolicyContent.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'docs/compliance/background-check-review-process.md');
const OUT = path.join(ROOT, 'src/pages/compliance/backgroundCheckPolicyContent.ts');

const md = fs.readFileSync(SRC, 'utf8');
const escaped = md.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
fs.writeFileSync(
  OUT,
  `/**
 * GENERATED from docs/compliance/background-check-review-process.md — the
 * canonical policy source. Do not hand-edit; regenerate on every policy
 * version bump:  node scripts/generateBackgroundCheckPolicyContent.js
 */
export const BACKGROUND_CHECK_POLICY_MD = \`${escaped}\`;
`,
);
console.log('wrote', OUT, `(${escaped.length} chars)`);
