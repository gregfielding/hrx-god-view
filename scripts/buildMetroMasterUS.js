#!/usr/bin/env node
/**
 * Build metroMaster.json for the entire United States from Census/OMB data.
 *
 * Input: Three files (see scripts/data/README.md):
 *   1. CBSA-county mapping: each row = one county in a Core Based Statistical Area (MSA/Micropolitan).
 *   2. Places (cities/towns): Census 2020 Gazetteer Places (has NAME, USPS, GEOID, INTPTLAT, INTPTLONG).
 *      Note: Place GEOID is State FIPS (2) + Place FIPS (5) — it does NOT contain county.
 *   3. Counties: Census 2020 Gazetteer Counties (has GEOID = state+county, INTPTLAT, INTPTLONG).
 *      Used to assign each place to a county by nearest centroid (place → county FIPS → CBSA).
 *
 * Logic: Place (lat/lng) → nearest county FIPS → CBSA. Places in counties not in any CBSA go to "Other [State]".
 * Output: src/data/metroMaster.json (Metro → Subarea [county] → Cities). Each cityKey appears in exactly one metro.
 *
 * Usage:
 *   node scripts/buildMetroMasterUS.js [cbsa_counties.csv] [places.csv] [counties_gazetteer.txt]
 * Default paths: scripts/data/cbsa_counties.csv, scripts/data/places.csv, scripts/data/2020_Gaz_counties_national.txt
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'scripts', 'data');
const DEFAULT_CBSA_PATH = path.join(DATA_DIR, 'cbsa2fipsxw_2023.csv');
const DEFAULT_PLACES_PATH = path.join(DATA_DIR, '2020_Gaz_place_national.txt');
const DEFAULT_COUNTIES_PATH = path.join(DATA_DIR, '2020_Gaz_counties_national.txt');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'data', 'metroMaster.json');

const STATE_FIPS_TO_ABBR = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
  '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
  '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
  '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
  '55': 'WI', '56': 'WY', '72': 'PR',
};
const STATE_ABBR_TO_FIPS = {};
for (const [fips, abbr] of Object.entries(STATE_FIPS_TO_ABBR)) {
  STATE_ABBR_TO_FIPS[abbr.toUpperCase()] = fips;
}

function normalizeKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function toCityKey(city, state) {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let s = (state || '').trim();
  if (s.length === 2) {
    s = s.toLowerCase();
  } else {
    s = s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }
  return s ? `${c}_${s}` : c || 'unknown';
}

function toTitleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeHeaderKey(k) {
  return (k || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const firstLine = content.split(/\r?\n/)[0] || '';
  const delimiter =
    ext === '.tsv' || ext === '.txt'
      ? '\t'
      : firstLine.split('\t').length > firstLine.split(',').length
        ? '\t'
        : ',';
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true, delimiter });
  return (parsed.data || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      const key = normalizeHeaderKey(k);
      if (key) out[key] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  });
}

function pad3(n) {
  const s = String(n || '').trim();
  return s.length >= 3 ? s.slice(0, 3) : s.padStart(3, '0');
}

function pad2(n) {
  const s = String(n || '').trim();
  return s.length >= 2 ? s.slice(0, 2) : s.padStart(2, '0');
}

/** Parse latitude/longitude from Gazetteer (may have leading space for positive numbers). */
function parseCoord(v) {
  const s = String(v ?? '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Find county FIPS whose centroid is nearest to (lat, lng). Returns 5-digit state+county FIPS or null. */
function findNearestCounty(lat, lng, counties) {
  if (lat == null || lng == null || !counties.length) return null;
  let best = null;
  let bestD2 = Infinity;
  for (const c of counties) {
    const d2 = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c.fips;
    }
  }
  return best;
}

function main() {
  const cbsaPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_CBSA_PATH;
  const placesPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : DEFAULT_PLACES_PATH;
  const countiesPath = process.argv[4] ? path.resolve(process.cwd(), process.argv[4]) : DEFAULT_COUNTIES_PATH;

  if (!fs.existsSync(cbsaPath)) {
    console.error('CBSA-county file not found:', cbsaPath);
    console.error('Expected columns: cbsa_code, cbsa_title, state_fips, county_fips, county_name (optional).');
    console.error('See scripts/data/README.md for where to get Census/OMB data.');
    process.exit(1);
  }
  if (!fs.existsSync(placesPath)) {
    console.error('Places file not found:', placesPath);
    console.error('Expected columns: name, usps, geoid, intptlat, intptlong (Census 2020 Gazetteer Places).');
    console.error('See scripts/data/README.md for where to get Census data.');
    process.exit(1);
  }
  if (!fs.existsSync(countiesPath)) {
    console.error('Counties Gazetteer file not found:', countiesPath);
    console.error('Place GEOID does not contain county; county is derived from place coordinates and the Counties Gazetteer.');
    console.error('Download 2020_Gaz_counties_national.zip from Census 2020 Gazetteer, unzip to', path.basename(countiesPath));
    console.error('See scripts/data/README.md.');
    process.exit(1);
  }

  const cbsaRows = parseCsv(cbsaPath);
  const placeRows = parseCsv(placesPath);
  const countyRows = parseCsv(countiesPath);

  // Build list of county centroids for nearest-county lookup (place → county FIPS).
  const counties = [];
  for (const row of countyRows) {
    const geoid = String(row.geoid ?? row.gaz_id ?? '').trim();
    const lat = parseCoord(row.intptlat ?? row.lat ?? row.latitude);
    const lng = parseCoord(row.intptlong ?? row.long ?? row.longitude);
    if (geoid.length >= 5 && lat != null && lng != null) {
      const fips = geoid.length === 5 ? geoid : geoid.slice(0, 5);
      counties.push({ fips, lat, lng });
    }
  }
  console.error(`Loaded ${counties.length} counties for place→county lookup.`);

  // county FIPS (5-digit: state + county) -> { cbsaCode, cbsaTitle, countyName }
  const countyToCbsa = new Map();
  for (const row of cbsaRows) {
    const stateFips = pad2(
      row.state_fips ?? row.fips_state ?? row.fipsstatecode ?? row.state_fips_code ?? row.fips_state_code
    );
    const countyFips = pad3(
      row.county_fips ?? row.fips_county ?? row.fipscountycode ?? row.county_fips_code ?? row.fips_county_code
    );
    const fips = stateFips + countyFips;
    const cbsaCode = String(
      row.cbsa_code ?? row.cbsacode ?? row.cbsa ?? row.metropolitan_division_code ?? ''
    ).trim();
    const cbsaTitle = String(
      row.cbsa_title ?? row.cbsatitle ?? row.cbsa_title_2018 ?? row.metropolitan_division_title ?? row.title ?? ''
    ).trim();
    const countyName = String(
      row.county_name ?? row.county ?? row.countycountyequivalent ?? ''
    ).trim() || `County ${countyFips}`;
    if (!fips || fips.length < 5) continue;
    countyToCbsa.set(fips, { cbsaCode, cbsaTitle, countyName });
  }

  // Metro key from CBSA title; for "Other [State]" we use other_<state_abbr>
  function getMetroKey(cbsaTitle, stateAbbr) {
    if (!cbsaTitle || cbsaTitle.startsWith('Other')) {
      const state = (stateAbbr || '').trim().toLowerCase();
      return state ? `other_${state}` : 'other';
    }
    return normalizeKey(cbsaTitle);
  }

  // Group: metroKey -> subareaKey -> Set(cityKey) and keep city/state for output.
  // Each cityKey must appear in exactly one metro/subarea; first occurrence wins (dedupe by cityKey).
  const metroMap = new Map(); // metroKey -> { label, subareas: Map(subareaKey -> { label, cityKeys: Set }) }
  const cityKeyToInfo = new Map(); // cityKey -> { city, state } (first occurrence wins for display)
  const assignedCityKeys = new Set(); // cityKeys already assigned to a metro (one city, one metro, one subarea)

  for (const row of placeRows) {
    const placeName = (row.place_name ?? row.name ?? row.place ?? row.city ?? '').trim();
    const geoid = String(row.geoid ?? row.gaz_id ?? '').trim();
    let stateAbbr = (row.state ?? row.usps ?? row.state_abbr ?? row.state_id ?? '').trim();
    let stateFips = pad2(
      geoid.length >= 2
        ? geoid.slice(0, 2)
        : row.state_fips ?? row.state_fips_code ?? row.statefips ?? STATE_ABBR_TO_FIPS[stateAbbr.toUpperCase()]
    );
    // Place GEOID is State FIPS (2) + Place FIPS (5) — it does NOT contain county. Derive county from coordinates.
    const placeLat = parseCoord(row.intptlat ?? row.lat ?? row.latitude);
    const placeLng = parseCoord(row.intptlong ?? row.long ?? row.longitude);
    const fips = findNearestCounty(placeLat, placeLng, counties) || null;
    if (stateAbbr.length === 2 && !stateFips) {
      stateFips = pad2(STATE_ABBR_TO_FIPS[stateAbbr.toUpperCase()]);
    }
    if (stateAbbr.length !== 2 && stateFips) {
      stateAbbr = STATE_FIPS_TO_ABBR[stateFips] || stateAbbr;
    }
    if (!placeName || !stateAbbr) continue;
    const cityKey = toCityKey(placeName, stateAbbr);
    if (cityKey === 'unknown') continue;
    if (assignedCityKeys.has(cityKey)) continue; // One city, one metro, one subarea: first occurrence wins.

    const cbsa = fips ? countyToCbsa.get(fips) : null;
    const metroLabel = cbsa ? cbsa.cbsaTitle : `Other ${stateAbbr}`;
    const metroKey = getMetroKey(metroLabel, stateAbbr);
    const subareaKey = cbsa ? normalizeKey(cbsa.countyName) : 'other';
    const subareaLabel = cbsa ? cbsa.countyName : 'Other';

    if (!metroMap.has(metroKey)) {
      metroMap.set(metroKey, { label: metroLabel, subareas: new Map() });
    }
    const metro = metroMap.get(metroKey);
    if (!metro.subareas.has(subareaKey)) {
      metro.subareas.set(subareaKey, { label: subareaLabel, cityKeys: new Set() });
    }
    metro.subareas.get(subareaKey).cityKeys.add(cityKey);
    assignedCityKeys.add(cityKey);
    if (!cityKeyToInfo.has(cityKey)) {
      cityKeyToInfo.set(cityKey, {
        city: toTitleCase(placeName),
        state: stateAbbr.length === 2 ? stateAbbr.toUpperCase() : stateAbbr,
      });
    }
  }

  // Ensure each cityKey appears in only one metro/subarea (plan: one city in one metro/subarea)
  // We already assigned by place → county → CBSA, so no duplicate cityKeys across metros.

  // Build metroMaster array
  const master = [];
  const metroKeysSorted = Array.from(metroMap.keys()).sort((a, b) => {
    const labelA = metroMap.get(a).label;
    const labelB = metroMap.get(b).label;
    return labelA.localeCompare(labelB);
  });

  for (const metroKey of metroKeysSorted) {
    const metro = metroMap.get(metroKey);
    const subareaKeysSorted = Array.from(metro.subareas.keys()).sort((a, b) => {
      const labelA = metro.subareas.get(a).label;
      const labelB = metro.subareas.get(b).label;
      return labelA.localeCompare(labelB);
    });
    master.push({
      metroKey,
      label: metro.label,
      subareas: subareaKeysSorted.map((subareaKey) => {
        const sub = metro.subareas.get(subareaKey);
        const cityKeysSorted = Array.from(sub.cityKeys).sort();
        return {
          subareaKey,
          label: sub.label,
          cities: cityKeysSorted.map((ck) => {
            const info = cityKeyToInfo.get(ck) || { city: ck.replace(/_/g, ' '), state: '' };
            return {
              cityKey: ck,
              city: info.city,
              state: info.state,
              coordinates: { lat: null, lng: null },
            };
          }),
        };
      }),
    });
  }

  // Validation: every cityKey appears in exactly one metro (no duplicates).
  const cityKeyToMetro = new Map();
  for (const metro of master) {
    for (const sub of metro.subareas || []) {
      for (const c of sub.cities || []) {
        const ck = c.cityKey;
        if (cityKeyToMetro.has(ck)) {
          console.error(`Validation failed: cityKey "${ck}" appears in both "${cityKeyToMetro.get(ck)}" and "${metro.metroKey}".`);
          process.exit(1);
        }
        cityKeyToMetro.set(ck, metro.metroKey);
      }
    }
  }
  // Sanity check: Modesto, CA metro should contain Stanislaus County cities (Ceres, Modesto, Turlock, Escalon).
  const modestoMetro = master.find((m) => m.metroKey === 'modesto_ca');
  if (modestoMetro) {
    const modestoCityKeys = new Set();
    for (const sub of modestoMetro.subareas || []) {
      for (const c of sub.cities || []) modestoCityKeys.add(c.cityKey);
    }
    const required = ['modesto_city_ca', 'ceres_city_ca', 'turlock_city_ca', 'escalon_city_ca'];
    const missing = required.filter((ck) => !modestoCityKeys.has(ck));
    if (missing.length) {
      console.error(`Validation warning: Modesto, CA metro is missing expected cityKeys: ${missing.join(', ')}.`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(master, null, 2) + '\n', 'utf8');
  const totalCities = master.reduce(
    (sum, m) => sum + m.subareas.reduce((s, sub) => s + sub.cities.length, 0),
    0
  );
  console.log(
    `Wrote ${master.length} metros, ${totalCities} cities to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`
  );
}

main();
