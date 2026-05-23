/**
 * Re-run a saved smart group search and return member IDs.
 * Used by SavedSmartGroupDetailPage "Update results".
 */

import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { SmartGroupData, SmartGroupEntry } from './smartGroupService';
import {
  getGeoHierarchy,
  getCityKeysForMetro,
  getMergedMetroOptions,
} from '../data/metroSubareaSchema';
import { getCityMetadata } from '../data/metroMaster';
import { calculateDistance } from '../utils/locationUtils';
import type { CustomMetrosMap } from '../hooks/useSmartGroupSettings';

export interface SavedSmartGroupFilters {
  filterMode: 'residence' | 'application';
  residenceSubMode?: 'area' | 'radius';
  metroFilter?: string | null;
  areaFilter?: string | null;
  cityFilter?: string | null;
  categoryFilter?: string | null;
  radiusAddress?: string;
  radiusLat?: number | null;
  radiusLng?: number | null;
  radiusMiles?: number;
  selectedSkills?: string[];
  selectedCertifications?: string[];
}

const OTHER_METRO_VALUE = '__other__';

function getUserResidenceData(userData: any) {
  const addressInfo = userData?.addressInfo || {};
  const address = userData?.address || {};
  const addressCoords = address?.coordinates || {};
  const addressInfoCoords = addressInfo?.coordinates || {};

  const city = addressInfo.city ?? address.city ?? userData?.city ?? '';
  const state = addressInfo.state ?? address.state ?? userData?.state ?? '';
  const lat =
    addressInfo.homeLat ??
    address.homeLat ??
    addressInfoCoords.lat ??
    addressInfoCoords.latitude ??
    addressCoords.lat ??
    addressCoords.latitude ??
    userData?.homeLat ??
    null;
  const lng =
    addressInfo.homeLng ??
    address.homeLng ??
    addressInfoCoords.lng ??
    addressInfoCoords.longitude ??
    addressCoords.lng ??
    addressCoords.longitude ??
    userData?.homeLng ??
    null;

  if (typeof lat === 'number' && typeof lng === 'number') {
    return { city, state, lat, lng };
  }

  if (city && state) {
    const cityKey = getGeoHierarchy({ city, state }).cityKey;
    const cityMeta = getCityMetadata(cityKey);
    const fallbackLat = cityMeta?.coordinates?.lat ?? null;
    const fallbackLng = cityMeta?.coordinates?.lng ?? null;
    if (typeof fallbackLat === 'number' && typeof fallbackLng === 'number') {
      return { city, state, lat: fallbackLat, lng: fallbackLng };
    }
  }

  return { city, state, lat, lng };
}

/**
 * Infer the missing discriminator fields on a legacy / partially-saved filter
 * blob. Some pre-fix docs in `tenants/{tid}/savedSmartGroups` were written
 * without `filterMode` / `residenceSubMode` (see SmartGroupsPage save bug,
 * 2026-05-05). Without this normalisation those docs fall through to the
 * "Residence area" loop in the runner with no filters set — matching every
 * applicant in the tenant and producing a member count in the thousands.
 *
 * Inference rules (least surprise):
 *   - `filterMode` defaults to `'residence'` (the only mode the create page
 *     ever wrote; `'application'` mode is detail-page editor only).
 *   - `residenceSubMode` is `'radius'` when a `radiusAddress` is present,
 *     otherwise `'area'`. We never silently coerce to anything else; if the
 *     blob is genuinely empty (no radius, no metro/area/city), the search
 *     still runs but with all-pass predicates — same as today, just made
 *     explicit.
 */
function normalizeFilters(filters: SavedSmartGroupFilters): SavedSmartGroupFilters {
  const next: SavedSmartGroupFilters = { ...filters };
  if (!next.filterMode) next.filterMode = 'residence';
  if (next.filterMode === 'residence' && !next.residenceSubMode) {
    next.residenceSubMode = next.radiusAddress?.trim() ? 'radius' : 'area';
  }
  return next;
}

/**
 * Hydrate `users/{uid}` docs for an array of uids in parallel, in
 * chunks of `chunkSize` so the Firestore client SDK's connection
 * pool doesn't get hammered. Per-user predicate decides inclusion.
 *
 * **Why this exists (2026-05-23, Greg's report — Richmond, VA smart
 * group spins forever)**: the previous implementation iterated
 * applicants with `for (const uid of userIds) { await getDoc(...) }`
 * — strictly sequential, ~100ms per RTT, so a tenant with 1,000+
 * applicants legitimately spent 2–3 minutes on a single "Update
 * results" click. The auto-refresh on mount hit the same path,
 * making the spinner appear to spin forever. Chunked parallel
 * fetches cut wall time by ~chunkSize, putting us at 2–4 seconds
 * for the same 1,000-applicant scan.
 */
async function filterUsersChunked<T>(
  userIds: Iterable<string>,
  chunkSize: number,
  predicate: (uid: string, data: any) => T | null,
): Promise<T[]> {
  const ids = Array.from(userIds);
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const settled = await Promise.all(
      slice.map(async (uid) => {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) return null;
        return predicate(uid, snap.data());
      }),
    );
    for (const v of settled) {
      if (v !== null && v !== undefined) out.push(v);
    }
  }
  return out;
}

const USER_HYDRATE_CHUNK_SIZE = 50;

export async function runSavedSmartGroupSearch(
  tenantId: string,
  rawFilters: SavedSmartGroupFilters,
  customMetros: CustomMetrosMap = {}
): Promise<string[]> {
  const filters = normalizeFilters(rawFilters);
  const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
  const applicationsSnap = await getDocs(applicationsRef);
  const userIds = new Set<string>();
  applicationsSnap.docs.forEach((d) => {
    const data = d.data();
    const status = (data.status || '').toLowerCase();
    if (status !== 'withdrawn' && status !== 'deleted' && (data.userId || data.uid)) {
      userIds.add(data.userId || data.uid);
    }
  });

  const metroOptions = getMergedMetroOptions(customMetros);
  const cityKeysForMetro =
    filters.metroFilter && filters.metroFilter !== OTHER_METRO_VALUE
      ? getCityKeysForMetro(filters.metroFilter, customMetros)
      : [];
  const selectedSkills = filters.selectedSkills ?? [];
  const selectedCertifications = filters.selectedCertifications ?? [];

  if (filters.filterMode === 'application') {
    const memberIds = await filterUsersChunked(userIds, USER_HYDRATE_CHUNK_SIZE, (uid, userData) => {
      const smartGroupData = userData?.smartGroupData as SmartGroupData | undefined;
      if (!smartGroupData?.byApplication || Object.keys(smartGroupData.byApplication).length === 0) return null;
      for (const entry of Object.values(smartGroupData.byApplication) as SmartGroupEntry[]) {
        const matchMetro = !filters.metroFilter
          ? true
          : filters.metroFilter === OTHER_METRO_VALUE
            ? (entry.metroKey && !metroOptions.includes(entry.metroKey))
            : (entry.metroKey === filters.metroFilter) ||
              (entry.cityKey && cityKeysForMetro.includes(entry.cityKey));
        const matchArea =
          !filters.areaFilter ||
          (Array.isArray(entry.subareaKeys) && entry.subareaKeys.includes(filters.areaFilter));
        const matchCity = !filters.cityFilter || entry.cityKey === filters.cityFilter;
        const matchCategory =
          !filters.categoryFilter || entry.jobCategory === filters.categoryFilter;
        const entrySkills = entry.skills ?? [];
        const entryCerts = entry.certifications ?? [];
        const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => entrySkills.includes(s));
        const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => entryCerts.includes(c));
        if (matchMetro && matchArea && matchCity && matchCategory && matchSkills && matchCerts) {
          return uid;
        }
      }
      return null;
    });
    return [...new Set(memberIds)];
  }

  // Residence mode
  const memberIds: string[] = [];
  if (filters.residenceSubMode === 'radius' && filters.radiusAddress?.trim()) {
    let geo: { lat: number; lng: number };
    
    // Use saved coordinates from a selected place only.
    if (filters.radiusLat != null && filters.radiusLng != null && 
        typeof filters.radiusLat === 'number' && typeof filters.radiusLng === 'number' &&
        !isNaN(filters.radiusLat) && !isNaN(filters.radiusLng)) {
      geo = { lat: filters.radiusLat, lng: filters.radiusLng };
    } else {
      const address = filters.radiusAddress.trim();
      throw new Error(`Radius search for "${address}" is missing saved coordinates. Re-open the Smart Group, select the address from Google suggestions again, and save it.`);
    }
    const radiusMiles = filters.radiusMiles ?? 10;
    const radiusMatches = await filterUsersChunked(userIds, USER_HYDRATE_CHUNK_SIZE, (uid, userData) => {
      const residence = getUserResidenceData(userData);
      const lat = residence.lat;
      const lng = residence.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;
      if (calculateDistance(geo.lat, geo.lng, lat, lng) > radiusMiles) return null;
      const skills = Array.isArray(userData?.skills) ? userData.skills : [];
      const certifications = Array.isArray(userData?.certifications)
        ? (userData.certifications as any[]).map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
        : [];
      const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => skills.includes(s));
      const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => certifications.includes(c));
      return matchSkills && matchCerts ? uid : null;
    });
    return radiusMatches;
  }

  // Residence area
  const areaMatches = await filterUsersChunked(userIds, USER_HYDRATE_CHUNK_SIZE, (uid, userData) => {
    const residence = getUserResidenceData(userData);
    const city = String(residence.city || '').trim();
    const state = String(residence.state || '').trim();
    if (!city && !state) return null;
    const hierarchy = getGeoHierarchy({ city, state });
    const matchMetro = !filters.metroFilter
      ? true
      : filters.metroFilter === OTHER_METRO_VALUE
        ? !metroOptions.includes(hierarchy.metroKey)
        : hierarchy.metroKey === filters.metroFilter || cityKeysForMetro.includes(hierarchy.cityKey);
    const matchArea =
      !filters.areaFilter ||
      (Array.isArray(hierarchy.subareaKeys) && hierarchy.subareaKeys.includes(filters.areaFilter));
    const matchCity = !filters.cityFilter || hierarchy.cityKey === filters.cityFilter;
    const skills = Array.isArray(userData?.skills) ? userData.skills : [];
    const certifications = Array.isArray(userData?.certifications)
      ? (userData.certifications as any[]).map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
      : [];
    const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => skills.includes(s));
    const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => certifications.includes(c));
    return matchMetro && matchArea && matchCity && matchSkills && matchCerts ? uid : null;
  });
  return areaMatches;
}
