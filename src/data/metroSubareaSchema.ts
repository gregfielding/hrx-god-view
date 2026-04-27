/**
 * Metro / subarea schema for Smart Groups geographic hierarchy.
 * Maps city + state to cityKey, subareaKeys[], metroKey, stateKey.
 * Source of truth is metroMaster.json (metro → subareas → cities + coordinates).
 */
import { METRO_TEMPLATES } from './metroMaster';

export interface GeoHierarchy {
  cityKey: string;
  subareaKeys: string[];
  metroKey: string;
  stateKey: string;
}

/** Normalize to URL-style key: "Plano", "TX" → "plano_tx" */
export function toCityKey(city: string, state: string): string {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const s = (state || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return s ? `${c}_${s}` : c || 'unknown';
}

/** Normalize state to key: "TX" → "texas" (full name) or "tx" */
export function toStateKey(state: string): string {
  const s = (state || '').trim().toUpperCase();
  const stateNames: Record<string, string> = {
    AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
    CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia',
    HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
    KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
    MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri',
    MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new_hampshire', NJ: 'new_jersey',
    NM: 'new_mexico', NY: 'new_york', NC: 'north_carolina', ND: 'north_dakota', OH: 'ohio',
    OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode_island', SC: 'south_carolina',
    SD: 'south_dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
    VA: 'virginia', WA: 'washington', WV: 'west_virginia', WI: 'wisconsin', WY: 'wyoming',
  };
  return stateNames[s] || s.toLowerCase().replace(/\s+/g, '_') || 'unknown';
}

const CITY_TO_SUBAREA_AND_METRO: Record<string, { subareaKey: string; metroKey: string }> = {};
for (const metro of METRO_TEMPLATES) {
  for (const subarea of metro.subareas || []) {
    for (const cityKey of subarea.cityKeys || []) {
      CITY_TO_SUBAREA_AND_METRO[cityKey] = {
        subareaKey: subarea.subareaKey,
        metroKey: metro.metroKey,
      };
    }
  }
}

/**
 * Resolve worksite city/state/zip to geographic hierarchy keys.
 * Falls back to cityKey + stateKey only if city is not in the curated list.
 */
export function getGeoHierarchy(worksite: { city?: string; state?: string; zipCode?: string }): GeoHierarchy {
  const city = worksite?.city ?? '';
  const state = worksite?.state ?? '';
  const cityKey = toCityKey(city, state);
  const stateKey = toStateKey(state);

  const entry = CITY_TO_SUBAREA_AND_METRO[cityKey];
  if (entry) {
    return {
      cityKey,
      subareaKeys: [entry.subareaKey],
      metroKey: entry.metroKey,
      stateKey,
    };
  }

  return {
    cityKey: cityKey || 'unknown',
    subareaKeys: [],
    metroKey: cityKey ? `${cityKey}_metro` : 'unknown',
    stateKey,
  };
}

/** Metro options for filter dropdowns (from curated hierarchy). */
export const METRO_OPTIONS: string[] = METRO_TEMPLATES.map((m) => m.metroKey).sort();

/** Subarea (area) options for a given metro. */
export function getSubareaOptionsForMetro(metroKey: string): string[] {
  const set = new Set<string>();
  for (const entry of Object.values(CITY_TO_SUBAREA_AND_METRO)) {
    if (entry.metroKey === metroKey) set.add(entry.subareaKey);
  }
  return Array.from(set).sort();
}

/** City options for a given metro and subarea. */
export function getCityOptionsForSubarea(metroKey: string, subareaKey: string): string[] {
  const cities: string[] = [];
  for (const [cityKey, entry] of Object.entries(CITY_TO_SUBAREA_AND_METRO)) {
    if (entry.metroKey === metroKey && entry.subareaKey === subareaKey) cities.push(cityKey);
  }
  return cities.sort();
}

/** Human-readable label for a key (metro, subarea, or city). */
export function formatGeoLabel(key: string): string {
  return (key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Shape of custom metro from tenant settings (for merged filter options). */
export interface CustomMetroInput {
  label: string;
  subareas: Array<{ subareaKey: string; label: string; cityKeys: string[] }>;
}

/** Metro options for filter dropdowns. Built-in only (custom metros no longer used). */
export function getMergedMetroOptions(_customMetros?: Record<string, CustomMetroInput> | null): string[] {
  return [...METRO_OPTIONS];
}

/** Subarea options for a metro. Built-in only. */
export function getMergedSubareaOptionsForMetro(
  metroKey: string,
  _customMetros?: Record<string, CustomMetroInput> | null
): string[] {
  return getSubareaOptionsForMetro(metroKey);
}

/** City options for a metro + subarea. Built-in only. */
export function getMergedCityOptionsForSubarea(
  metroKey: string,
  subareaKey: string,
  _customMetros?: Record<string, CustomMetroInput> | null
): string[] {
  return getCityOptionsForSubarea(metroKey, subareaKey);
}

/** All city keys that belong to a metro. Built-in only. */
export function getCityKeysForMetro(
  metroKey: string,
  _customMetros?: Record<string, CustomMetroInput> | null
): string[] {
  const set = new Set<string>();
  for (const [cityKey, entry] of Object.entries(CITY_TO_SUBAREA_AND_METRO)) {
    if (entry.metroKey === metroKey) set.add(cityKey);
  }
  return Array.from(set);
}
