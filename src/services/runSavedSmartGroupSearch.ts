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
import { geocodeAddress } from '../utils/geocodeAddress';
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
  radiusMiles?: number;
  selectedSkills?: string[];
  selectedCertifications?: string[];
}

const OTHER_METRO_VALUE = '__other__';

export async function runSavedSmartGroupSearch(
  tenantId: string,
  filters: SavedSmartGroupFilters,
  customMetros: CustomMetrosMap = {}
): Promise<string[]> {
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
    const memberIds: string[] = [];
    for (const uid of userIds) {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) continue;
      const userData = userSnap.data();
      const smartGroupData = userData?.smartGroupData as SmartGroupData | undefined;
      if (!smartGroupData?.byApplication || Object.keys(smartGroupData.byApplication).length === 0) continue;
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
          memberIds.push(uid);
          break;
        }
      }
    }
    return [...new Set(memberIds)];
  }

  // Residence mode
  const memberIds: string[] = [];
  if (filters.residenceSubMode === 'radius' && filters.radiusAddress?.trim()) {
    let geo: { lat: number; lng: number };
    try {
      geo = await geocodeAddress(filters.radiusAddress.trim());
    } catch (error: any) {
      const address = filters.radiusAddress.trim();
      const errorMsg = error?.message || 'Geocoding failed';
      throw new Error(`Failed to geocode address "${address}": ${errorMsg}. Please check the address and try again, or edit the Smart Group to update the address.`);
    }
    const radiusMiles = filters.radiusMiles ?? 10;
    for (const uid of userIds) {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) continue;
      const userData = userSnap.data();
      const addr = userData?.addressInfo || userData?.address || {};
      const lat = addr.homeLat ?? addr.coordinates?.lat ?? userData?.homeLat;
      const lng = addr.homeLng ?? addr.coordinates?.lng ?? userData?.homeLng;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (calculateDistance(geo.lat, geo.lng, lat, lng) > radiusMiles) continue;
      const skills = Array.isArray(userData?.skills) ? userData.skills : [];
      const certifications = Array.isArray(userData?.certifications)
        ? (userData.certifications as any[]).map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
        : [];
      const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => skills.includes(s));
      const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => certifications.includes(c));
      if (matchSkills && matchCerts) memberIds.push(uid);
    }
    return memberIds;
  }

  // Residence area
  for (const uid of userIds) {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) continue;
    const userData = userSnap.data();
    const addr = userData?.addressInfo || userData?.address || {};
    const city = (addr.city ?? userData?.city ?? '').trim();
    const state = (addr.state ?? userData?.state ?? '').trim();
    if (!city && !state) continue;
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
    if (matchMetro && matchArea && matchCity && matchSkills && matchCerts) memberIds.push(uid);
  }
  return memberIds;
}
