/**
 * Smart Groups metro sync: when company worksite locations are created/updated in Firestore,
 * ensure the city is represented in the tenant's Smart Groups metro config (built-in, custom, or auto-added).
 * - If the city is already in the built-in hierarchy or in custom metros, no change.
 * - If the city appears in a metro template (e.g. Houston), add that full metro to custom metros.
 * - Otherwise add a standalone "metro" for that city so it shows in filters.
 * Settings > Smart Groups still shows and edits these; auto-added metros are editable/removable.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { toCityKey, getGeoHierarchy, formatGeoLabel } from '../data/metroSubareaSchema';
import type { CustomMetrosMap } from '../hooks/useSmartGroupSettings';

import metroTemplatesData from '../data/metroTemplates.json';

interface MetroTemplate {
  metroKey: string;
  label: string;
  subareas: Array<{ subareaKey: string; label: string; cityKeys: string[] }>;
}

const metroTemplates = metroTemplatesData as MetroTemplate[];

/** Check if cityKey is in the built-in hierarchy (without exporting the map). */
function isCityInBuiltInHierarchy(cityKey: string): boolean {
  if (!cityKey || cityKey === 'unknown') return false;
  const parts = cityKey.split('_');
  if (parts.length < 2) return false;
  const stateAbbr = parts[parts.length - 1];
  const cityName = parts.slice(0, -1).join(' ');
  const state = stateAbbr.length === 2 ? stateAbbr.toUpperCase() : stateAbbr;
  const h = getGeoHierarchy({ city: cityName, state });
  return h.metroKey !== `${cityKey}_metro`;
}

/** Check if cityKey is in any custom metro's subareas. */
function isCityInCustomMetros(cityKey: string, customMetros: CustomMetrosMap): boolean {
  for (const metro of Object.values(customMetros)) {
    for (const sub of metro.subareas || []) {
      if ((sub.cityKeys || []).includes(cityKey)) return true;
    }
  }
  return false;
}

/** Find a metro template that contains this cityKey (spawn full metro). */
function findTemplateContainingCity(cityKey: string): MetroTemplate | null {
  for (const t of metroTemplates) {
    for (const sub of t.subareas || []) {
      if ((sub.cityKeys || []).includes(cityKey)) return t;
    }
  }
  return null;
}

/** Convert template to CustomMetro shape for storage. */
function templateToCustomMetro(t: MetroTemplate): { label: string; subareas: Array<{ subareaKey: string; label: string; cityKeys: string[] }> } {
  return {
    label: t.label,
    subareas: (t.subareas || []).map((s) => ({
      subareaKey: s.subareaKey,
      label: s.label,
      cityKeys: s.cityKeys ?? [],
    })),
  };
}

/**
 * Ensure a worksite city is represented in the tenant's Smart Groups metros.
 * Call this after creating or updating a worksite location (city + state).
 * - If the city is already in built-in hierarchy or in custom metros, no-op.
 * - If the city is in a metro template (e.g. Houston), add that full metro to custom metros.
 * - Otherwise add a standalone metro for this city (Other subarea, single city).
 */
export async function ensureCityInSmartGroups(
  tenantId: string,
  city: string,
  state: string
): Promise<void> {
  if (!tenantId || !city?.trim()) return;

  const cityKey = toCityKey(city.trim(), (state || '').trim());
  if (!cityKey || cityKey === 'unknown') return;

  if (isCityInBuiltInHierarchy(cityKey)) return;

  const smartGroupsRef = doc(db, 'tenants', tenantId, 'settings', 'smartGroups');
  const snap = await getDoc(smartGroupsRef);
  const existing = (snap.data()?.customMetros || {}) as CustomMetrosMap;

  if (isCityInCustomMetros(cityKey, existing)) return;

  const next = { ...existing };

  const template = findTemplateContainingCity(cityKey);
  if (template) {
    next[template.metroKey] = templateToCustomMetro(template);
  } else {
    const standaloneMetroKey = `${cityKey}_metro`;
    next[standaloneMetroKey] = {
      label: formatGeoLabel(cityKey),
      subareas: [{ subareaKey: 'other', label: 'Other', cityKeys: [cityKey] }],
    };
  }

  await setDoc(smartGroupsRef, { customMetros: next, updatedAt: new Date() }, { merge: true });
}
