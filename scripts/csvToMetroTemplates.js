#!/usr/bin/env node
/**
 * Convert a CSV file (cities by metro/area) into our metro templates JSON.
 * Output can be piped to a file or used with importMetroTemplates.js.
 *
 * Usage: node scripts/csvToMetroTemplates.js <path-to.csv> [> output.json]
 *
 * Expected CSV columns (header row required; names are case-insensitive):
 *   - metro_name or metro (metro display name)
 *   - area_name or area (subarea display name, e.g. "South Houston", "East Bay")
 *   - city
 *   - state (2-letter preferred, e.g. TX; or full name)
 *
 * Optional: metro_key, area_key (if not provided, derived from names).
 *
 * Example CSV:
 *   metro_name,area_name,city,state
 *   Houston,South Houston,Pearland,TX
 *   Houston,South Houston,Webster,TX
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const STATE_ABBR = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
  hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia',
  kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md',
  massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo',
  montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh',
  oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt',
  virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy',
  'district of columbia': 'dc', 'washington dc': 'dc',
};

function toCityKey(city, state) {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let s = (state || '').trim();
  if (s.length === 2) {
    s = s.toLowerCase();
  } else {
    s = STATE_ABBR[s.toLowerCase()] || s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }
  return s ? `${c}_${s}` : c || 'unknown';
}

function normalizeKey(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function normalizeHeaderKey(k) {
  return (k || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  const rows = (parsed.data || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const key = normalizeHeaderKey(k);
      if (key) out[key] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  });
  return rows;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/csvToMetroTemplates.js <path-to.csv> [> output.json]');
    process.exit(1);
  }
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error('File not found:', absPath);
    process.exit(1);
  }
  const rows = parseCsv(absPath);
  const metroMap = new Map();

  const getMetro = (metroName, metroKeyIn) => {
    const label = (metroName || '').trim() || 'Unknown';
    const key = (metroKeyIn || '').trim() || normalizeKey(label);
    let metro = metroMap.get(key);
    if (!metro) {
      metro = { metroKey: key, label, subareas: [] };
      metroMap.set(key, metro);
    }
    return metro;
  };

  const getArea = (metro, areaName, areaKeyIn) => {
    const label = (areaName || '').trim() || 'Other';
    const areaKey = (areaKeyIn || '').trim() || normalizeKey(label);
    let area = metro.subareas.find((s) => s.subareaKey === areaKey);
    if (!area) {
      area = { subareaKey: areaKey, label, cityKeys: [] };
      metro.subareas.push(area);
    }
    return area;
  };

  for (const row of rows) {
    const metroKeyIn = row.metro_key || row.metrokey || '';
    const metroName = row.metro_name || row.metro || row.metropolitan_area || row.cbsa_title || '';
    const areaKeyIn = row.area_key || row.areakey || row.subarea_key || '';
    const areaName = row.area_name || row.area || row.subarea || row.region || row.county || 'Other';
    const city = row.city || row.city_ascii || row.place || row.place_name || '';
    const state = row.state || row.state_id || row.state_abbr || row.state_name || '';
    if (!city && !state) continue;
    const metro = getMetro(metroName, metroKeyIn);
    const area = getArea(metro, areaName, areaKeyIn);
    const ck = toCityKey(city, state);
    if (ck && ck !== 'unknown' && !area.cityKeys.includes(ck)) {
      area.cityKeys.push(ck);
    }
  }

  const metros = Array.from(metroMap.values()).map((m) => ({
    metroKey: m.metroKey,
    label: m.label,
    subareas: m.subareas
      .map((s) => ({ ...s, cityKeys: s.cityKeys.sort() }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));

  process.stdout.write(JSON.stringify(metros, null, 2) + '\n');
}

main();
