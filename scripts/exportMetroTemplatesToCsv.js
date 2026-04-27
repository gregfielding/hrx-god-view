#!/usr/bin/env node
/**
 * Export src/data/metroTemplates.json to a CSV with columns:
 * metro_name, area_name, city, state
 * so it can be edited or merged with other data and re-imported via csvToMetroTemplates.js
 *
 * Usage: node scripts/exportMetroTemplatesToCsv.js [> output.csv]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_PATH = path.join(REPO_ROOT, 'src/data/metroTemplates.json');

function cityKeyToCityAndState(ck) {
  if (!ck || typeof ck !== 'string') return { city: '', state: '' };
  const i = ck.lastIndexOf('_');
  if (i <= 0) return { city: ck.replace(/_/g, ' '), state: '' };
  const cityPart = ck.slice(0, i).replace(/_/g, ' ');
  const statePart = ck.slice(i + 1);
  const city = cityPart.replace(/\b\w/g, (c) => c.toUpperCase());
  const state = statePart.length === 2 ? statePart.toUpperCase() : statePart;
  return { city, state };
}

function escapeCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function main() {
  const data = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  const rows = [['metro_key', 'metro_name', 'area_key', 'area_name', 'city', 'state'].map(escapeCsv).join(',')];
  for (const m of data) {
    const metroKey = m.metroKey || '';
    const metroName = m.label || m.metroKey || '';
    for (const sub of m.subareas || []) {
      const areaKey = sub.subareaKey || '';
      const areaName = sub.label || sub.subareaKey || '';
      for (const ck of sub.cityKeys || []) {
        const { city, state } = cityKeyToCityAndState(ck);
        rows.push([metroKey, metroName, areaKey, areaName, city, state].map(escapeCsv).join(','));
      }
    }
  }
  process.stdout.write(rows.join('\n') + '\n');
}

main();
