#!/usr/bin/env node
/**
 * Import metro templates from an external JSON file into src/data/metroTemplates.json.
 *
 * Usage: node scripts/importMetroTemplates.js <path-to.json>
 *
 * Expected JSON shape (array of metros):
 * [
 *   {
 *     "metroKey": "houston",
 *     "label": "Houston",
 *     "subareas": [
 *       { "subareaKey": "south", "label": "South Houston", "cityKeys": ["pearland_tx", "webster_tx", ...] }
 *     ]
 *   }
 * ]
 *
 * Or a single object with a "metros" array: { "metros": [ ... ] }
 *
 * Backs up the current metroTemplates.json to metroTemplates.json.bak before overwriting.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TARGET_PATH = path.join(REPO_ROOT, 'src/data/metroTemplates.json');
const BACKUP_PATH = path.join(REPO_ROOT, 'src/data/metroTemplates.json.bak');

function toCityKey(city, state) {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const s = (state || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return s ? `${c}_${s}` : c || 'unknown';
}

function normalizeMetroKey(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function validateAndNormalize(metros) {
  const out = [];
  for (const m of metros) {
    const metroKey = m.metroKey || normalizeMetroKey(m.label);
    const subareas = (m.subareas || []).map((s) => ({
      subareaKey: s.subareaKey || normalizeMetroKey(s.label),
      label: s.label || s.subareaKey || 'Other',
      cityKeys: Array.isArray(s.cityKeys) ? s.cityKeys : [],
    }));
    out.push({
      metroKey,
      label: m.label || metroKey,
      subareas,
    });
  }
  return out;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/importMetroTemplates.js <path-to.json>');
    process.exit(1);
  }
  const absPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absPath)) {
    console.error('File not found:', absPath);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }
  let metros = Array.isArray(data) ? data : data.metros || data.metroTemplates;
  if (!Array.isArray(metros)) {
    console.error('JSON must be an array of metros or an object with "metros" array');
    process.exit(1);
  }
  metros = validateAndNormalize(metros);
  if (fs.existsSync(TARGET_PATH)) {
    fs.copyFileSync(TARGET_PATH, BACKUP_PATH);
    console.log('Backed up current file to', path.relative(REPO_ROOT, BACKUP_PATH));
  }
  fs.writeFileSync(TARGET_PATH, JSON.stringify(metros, null, 2) + '\n', 'utf8');
  console.log('Wrote', metros.length, 'metros to', path.relative(REPO_ROOT, TARGET_PATH));
}

main();
