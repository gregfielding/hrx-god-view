#!/usr/bin/env node
/**
 * Add a metro area to metroMaster.json when a worksite city is not already
 * in any template. Uses Census Geocoder (no API key) to resolve city+state to
 * a Core-Based Statistical Area (CSA or MSA), then appends that metro with at
 * least the worksite city so the full metro is available for Smart Groups.
 *
 * Usage (from repo root):
 *   node scripts/add-metro-for-worksite.js "City" "ST"
 *   node scripts/add-metro-for-worksite.js "Evansville" "IN"
 *   node scripts/add-metro-for-worksite.js "City" "ST" "ZIP"
 *
 * If the metro already exists in metroMaster.json, the script adds the
 * worksite city to that metro if it's missing (one subarea used for "other"
 * cities). If the metro is new, it creates one subarea "Metro" with the
 * worksite city (and optionally principal cities from scripts/data/cbsa-principal-cities.json).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_ROOT = path.resolve(__dirname, '..');
const MASTER_PATH = path.join(REPO_ROOT, 'src/data/metroMaster.json');
const PRINCIPAL_CITIES_PATH = path.join(__dirname, 'data', 'cbsa-principal-cities.json');

function toCityKey(city, state) {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const s = (state || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return s ? `${c}_${s}` : c || 'unknown';
}

function toTitleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function cityEntryFromCityKey(cityKey) {
  const parts = String(cityKey || '').split('_');
  if (parts.length < 2) {
    return {
      cityKey,
      city: toTitleCase(cityKey.replace(/_/g, ' ')),
      state: '',
      coordinates: { lat: null, lng: null },
    };
  }
  return {
    cityKey,
    city: toTitleCase(parts.slice(0, -1).join(' ')),
    state: parts[parts.length - 1].toUpperCase(),
    coordinates: { lat: null, lng: null },
  };
}

function normalizeMetroKey(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s*(?:CSA|MSA)\s*$/i, '')
    .replace(/\s*,\s*/, '_')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'unknown_metro';
}

function labelFromCsaName(name) {
  if (!name || typeof name !== 'string') return 'Unknown Metro';
  return name.replace(/\s*(?:CSA|MSA)\s*$/i, '').trim();
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + data.slice(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

async function geocodeToMetro(city, state, zip) {
  const street = zip ? '1 Main St' : '1 Main St';
  const params = new URLSearchParams({
    street,
    city: (city || '').trim(),
    state: (state || '').trim(),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
  });
  if (zip) params.set('zip', zip);
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/address?${params}`;
  const data = await httpsGet(url);

  const match = data?.result?.addressMatches?.[0];
  if (!match || !match.geographies) {
    throw new Error('No geocoding result for this city/state. Check spelling and try again.');
  }

  const geo = match.geographies;
  const csa = geo['Combined Statistical Areas']?.[0];
  const msa = geo['Metropolitan Statistical Areas']?.[0];
  const metro = csa || msa;
  if (!metro) {
    throw new Error(
      'This location is not in a Census Combined or Metropolitan Statistical Area. ' +
      'You can still add it as a single-city metro by running with --standalone.'
    );
  }

  const name = metro.NAME || metro.BASENAME || '';
  const geoid = String(metro.GEOID || metro.CSA || metro.CBSA || '');
  const metroKey = normalizeMetroKey(metro.BASENAME || name);
  const label = labelFromCsaName(metro.BASENAME || name);

  return { metroKey, label, geoid, name };
}

function loadPrincipalCities() {
  try {
    if (fs.existsSync(PRINCIPAL_CITIES_PATH)) {
      const raw = fs.readFileSync(PRINCIPAL_CITIES_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

function findMetroContainingCity(metros, cityKey) {
  for (const metro of metros) {
    for (const sub of metro.subareas || []) {
      for (const city of sub.cities || []) {
        if (city?.cityKey === cityKey) return metro;
      }
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const standalone = args.includes('--standalone');
  const rest = args.filter((a) => a !== '--standalone');
  const city = rest[0];
  const state = rest[1];
  const zip = rest[2];

  if (!city || !state) {
    console.error('Usage: node scripts/add-metro-for-worksite.js "City" "ST" [ZIP] [--standalone]');
    console.error('Example: node scripts/add-metro-for-worksite.js "Evansville" "IN"');
    process.exit(1);
  }

  const worksiteCityKey = toCityKey(city, state);
  if (worksiteCityKey === 'unknown') {
    console.error('Invalid city or state.');
    process.exit(1);
  }

  (async () => {
    let metroKey, label, geoid;

    if (standalone) {
      metroKey = worksiteCityKey + '_metro';
      label = (city + ', ' + state).replace(/\b\w/g, (c) => c.toUpperCase());
      geoid = null;
    } else {
      try {
        const metro = await geocodeToMetro(city, state, zip);
        metroKey = metro.metroKey;
        label = metro.label;
        geoid = metro.geoid;
        console.log('Census metro:', label, '(GEOID', geoid + ')');
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
    }

    let metros;
    try {
      metros = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
    } catch (e) {
      console.error('Could not read', MASTER_PATH, e.message);
      process.exit(1);
    }

    if (!Array.isArray(metros)) {
      console.error('metroMaster.json must be an array of metros.');
      process.exit(1);
    }

    const existing = metros.find((m) => m.metroKey === metroKey);
    const alreadyInMetro = findMetroContainingCity(metros, worksiteCityKey);

    if (alreadyInMetro && alreadyInMetro.metroKey !== metroKey) {
      console.log('Worksite city', worksiteCityKey, 'is already in metro', alreadyInMetro.metroKey, '- no change.');
      return;
    }

    const principalCitiesByGeoid = loadPrincipalCities();
    const extraCityKeys = geoid && principalCitiesByGeoid?.[geoid]
      ? principalCitiesByGeoid[geoid]
          .map(({ city: c, state: s }) => toCityKey(c, s))
          .filter((k) => k && k !== worksiteCityKey)
      : [];

    const allCityKeys = [...new Set([worksiteCityKey, ...extraCityKeys])];

    if (existing) {
      const allExisting = new Set();
      for (const sub of existing.subareas || []) {
        (sub.cities || []).forEach((c) => allExisting.add(c.cityKey));
      }
      if (allExisting.has(worksiteCityKey)) {
        console.log('Metro', metroKey, 'already includes', worksiteCityKey, '- no change.');
        return;
      }
      const otherSub = existing.subareas.find((s) => s.subareaKey === 'other' || s.subareaKey === 'metro');
      if (otherSub) {
        const existingCityKeys = new Set((otherSub.cities || []).map((c) => c.cityKey));
        if (!existingCityKeys.has(worksiteCityKey)) {
          otherSub.cities = [...(otherSub.cities || []), {
            cityKey: worksiteCityKey,
            city: toTitleCase(city),
            state: String(state || '').toUpperCase(),
            coordinates: { lat: null, lng: null },
          }];
        }
      } else {
        existing.subareas = existing.subareas || [];
        existing.subareas.push({
          subareaKey: 'other',
          label: 'Other',
          cities: [{
            cityKey: worksiteCityKey,
            city: toTitleCase(city),
            state: String(state || '').toUpperCase(),
            coordinates: { lat: null, lng: null },
          }],
        });
      }
      console.log('Added', worksiteCityKey, 'to existing metro', metroKey);
    } else {
      metros.push({
        metroKey,
        label,
        subareas: [
          {
            subareaKey: 'metro',
            label: 'Metro',
            cities: allCityKeys.map((k) =>
              k === worksiteCityKey
                ? {
                    cityKey: worksiteCityKey,
                    city: toTitleCase(city),
                    state: String(state || '').toUpperCase(),
                    coordinates: { lat: null, lng: null },
                  }
                : cityEntryFromCityKey(k)
            ),
          },
        ],
      });
      console.log('Added new metro:', metroKey, 'with cities:', allCityKeys.join(', '));
    }

    fs.writeFileSync(MASTER_PATH, JSON.stringify(metros, null, 2) + '\n', 'utf8');
    console.log('Updated', path.relative(process.cwd(), MASTER_PATH));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
