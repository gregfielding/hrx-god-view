import metroMasterData from './metroMaster.json';

export interface MetroCity {
  cityKey: string;
  city: string;
  state: string;
  coordinates: {
    lat: number | null;
    lng: number | null;
  };
}

export interface MetroSubarea {
  subareaKey: string;
  label: string;
  cities: MetroCity[];
}

export interface MetroMasterEntry {
  metroKey: string;
  label: string;
  subareas: MetroSubarea[];
}

export interface MetroTemplateCompat {
  metroKey: string;
  label: string;
  subareas: Array<{ subareaKey: string; label: string; cityKeys: string[] }>;
}

export const METRO_MASTER: MetroMasterEntry[] = metroMasterData as MetroMasterEntry[];

export const METRO_TEMPLATES: MetroTemplateCompat[] = METRO_MASTER.map((metro) => ({
  metroKey: metro.metroKey,
  label: metro.label,
  subareas: (metro.subareas || []).map((sub) => ({
    subareaKey: sub.subareaKey,
    label: sub.label,
    cityKeys: (sub.cities || []).map((c) => c.cityKey),
  })),
}));

const templateByKey = new Map(METRO_TEMPLATES.map((m) => [m.metroKey, m]));
const cityMetadataByKey = new Map<string, MetroCity>();
for (const metro of METRO_MASTER) {
  for (const subarea of metro.subareas || []) {
    for (const city of subarea.cities || []) {
      cityMetadataByKey.set(city.cityKey, city);
    }
  }
}

export function getMetroTemplateByKey(metroKey: string): MetroTemplateCompat | null {
  return templateByKey.get(metroKey) ?? null;
}

/**
 * User-friendly metro label. Census CBSA names like "Houston-Pasadena-The Woodlands, TX"
 * are shortened to "Houston, TX" (primary city + state). Falls back to full label if no comma.
 */
export function getMetroDisplayLabel(metroKey: string): string {
  const template = templateByKey.get(metroKey);
  const label = template?.label ?? metroKey.replace(/_/g, ' ');
  const commaIdx = label.indexOf(',');
  if (commaIdx === -1) return label;
  const primary = label.slice(0, commaIdx).split('-')[0].trim();
  const state = label.slice(commaIdx + 1).trim();
  return state ? `${primary}, ${state}` : label;
}

export function findTemplateContainingCity(cityKey: string): MetroTemplateCompat | null {
  for (const metro of METRO_TEMPLATES) {
    for (const sub of metro.subareas || []) {
      if ((sub.cityKeys || []).includes(cityKey)) return metro;
    }
  }
  return null;
}

export function getCityMetadata(cityKey: string): MetroCity | null {
  return cityMetadataByKey.get(cityKey) ?? null;
}
