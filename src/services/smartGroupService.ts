/**
 * Smart Groups service: updates user doc with geographic and industry dimensions
 * derived from application events. Does not touch User Groups.
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getGeoHierarchy, type GeoHierarchy } from '../data/metroSubareaSchema';

export type JobCategory = 'industrial' | 'hospitality' | 'janitorial' | 'other';

export interface SmartGroupEntry {
  jobTitle: string;
  worksiteCity: string;
  userAddressCity: string;
  userGeocoordinates?: { lat: number; lng: number };
  skills?: string[];
  certifications?: string[];
  jobCategory: JobCategory;
  timestamp: any;
  cityKey: string;
  subareaKeys: string[];
  metroKey: string;
  stateKey: string;
  companyName?: string;
  companyId?: string;
  worksiteName?: string;
  worksiteId?: string;
  worksiteAddress?: { street?: string; city?: string; state?: string; zipCode?: string };
  worksiteGeocoordinates?: { lat: number; lng: number };
}

export interface SmartGroupData {
  cityKeys: string[];
  subareaKeys: string[];
  metroKeys: string[];
  stateKeys: string[];
  industryCategories: string[];
  byApplication: Record<string, SmartGroupEntry>;
  updatedAt?: any;
}

const INDUSTRIAL_KEYWORDS = ['industrial', 'warehouse', 'manufacturing', 'production', 'assembly', 'forklift', 'distribution', 'logistics', 'factory'];
const HOSPITALITY_KEYWORDS = ['hospitality', 'hotel', 'restaurant', 'food service', 'server', 'bartender', 'cook', 'chef', 'banquet', 'catering', 'front desk'];
const JANITORIAL_KEYWORDS = ['janitor', 'cleaner', 'custodial', 'housekeeping', 'cleaning', 'sanitation', 'maintenance'];

export function resolveIndustryCategory(jobTitle: string): JobCategory {
  const t = (jobTitle || '').toLowerCase();
  if (JANITORIAL_KEYWORDS.some((k) => t.includes(k))) return 'janitorial';
  if (HOSPITALITY_KEYWORDS.some((k) => t.includes(k))) return 'hospitality';
  if (INDUSTRIAL_KEYWORDS.some((k) => t.includes(k))) return 'industrial';
  return 'other';
}

function collectUnique<T>(entries: SmartGroupEntry[], getKeys: (e: SmartGroupEntry) => string[]): string[] {
  const set = new Set<string>();
  entries.forEach((e) => getKeys(e).forEach((k) => set.add(k)));
  return Array.from(set);
}

function collectCategories(entries: SmartGroupEntry[]): string[] {
  const set = new Set<string>();
  entries.forEach((e) => set.add(e.jobCategory));
  return Array.from(set);
}

export async function updateUserSmartGroupOnApply(
  userId: string,
  tenantId: string,
  applicationId: string,
  params: {
    worksite: { city?: string; state?: string; zipCode?: string };
    jobTitle: string;
    userAddressCity?: string;
    userGeocoordinates?: { lat: number; lng: number };
    skills?: string[];
    certifications?: string[];
    companyName?: string;
    companyId?: string;
    worksiteName?: string;
    worksiteId?: string;
    worksiteAddress?: { street?: string; city?: string; state?: string; zipCode?: string };
    worksiteGeocoordinates?: { lat: number; lng: number };
  }
): Promise<void> {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const existing = userSnap.exists() ? userSnap.data() : {};
    const current: SmartGroupData = existing?.smartGroupData ?? {
      cityKeys: [],
      subareaKeys: [],
      metroKeys: [],
      stateKeys: [],
      industryCategories: [],
      byApplication: {},
    };

    const geo = getGeoHierarchy(params.worksite);
    const jobCategory = resolveIndustryCategory(params.jobTitle);

    const entry: SmartGroupEntry = {
      jobTitle: params.jobTitle,
      worksiteCity: params.worksite?.city ?? '',
      userAddressCity: params.userAddressCity ?? '',
      userGeocoordinates: params.userGeocoordinates,
      skills: params.skills ?? [],
      certifications: params.certifications ?? [],
      jobCategory,
      timestamp: serverTimestamp(),
      companyName: params.companyName,
      companyId: params.companyId,
      worksiteName: params.worksiteName,
      worksiteId: params.worksiteId,
      worksiteAddress: params.worksiteAddress,
      worksiteGeocoordinates: params.worksiteGeocoordinates,
      cityKey: geo.cityKey,
      subareaKeys: geo.subareaKeys,
      metroKey: geo.metroKey,
      stateKey: geo.stateKey,
    };

    const byApplication = { ...(current.byApplication || {}), [applicationId]: entry };
    const entries = Object.values(byApplication);

    const cityKeys = collectUnique(entries, (e) => [e.cityKey]);
    const subareaKeys = collectUnique(entries, (e) => e.subareaKeys);
    const metroKeys = collectUnique(entries, (e) => [e.metroKey]);
    const stateKeys = collectUnique(entries, (e) => [e.stateKey]);
    const industryCategories = collectCategories(entries);

    const next: SmartGroupData = {
      cityKeys,
      subareaKeys,
      metroKeys,
      stateKeys,
      industryCategories,
      byApplication,
      updatedAt: serverTimestamp(),
    };

    await setDoc(userRef, { smartGroupData: next, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('Smart Groups: failed to update user on apply', err);
  }
}

export async function updateUserSmartGroupOnWithdraw(
  userId: string,
  tenantId: string,
  applicationId: string
): Promise<void> {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const existing = userSnap.exists() ? userSnap.data() : {};
    const current: SmartGroupData = existing?.smartGroupData ?? {
      cityKeys: [],
      subareaKeys: [],
      metroKeys: [],
      stateKeys: [],
      industryCategories: [],
      byApplication: {},
    };

    const byApplication = { ...(current.byApplication || {}) };
    delete byApplication[applicationId];
    const entries = Object.values(byApplication);

    const cityKeys = collectUnique(entries, (e) => [e.cityKey]);
    const subareaKeys = collectUnique(entries, (e) => e.subareaKeys);
    const metroKeys = collectUnique(entries, (e) => [e.metroKey]);
    const stateKeys = collectUnique(entries, (e) => [e.stateKey]);
    const industryCategories = collectCategories(entries);

    const next: SmartGroupData = {
      cityKeys,
      subareaKeys,
      metroKeys,
      stateKeys,
      industryCategories,
      byApplication,
      updatedAt: serverTimestamp(),
    };

    await setDoc(userRef, { smartGroupData: next, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('Smart Groups: failed to update user on withdraw', err);
  }
}
