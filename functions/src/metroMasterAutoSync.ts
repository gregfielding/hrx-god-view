import * as admin from 'firebase-admin';
import {onCall, onRequest} from 'firebase-functions/v2/https';

const db = admin.firestore();

type MetroTemplate = {
  metroKey: string;
  label: string;
  subareas: Array<{ subareaKey: string; label: string; cityKeys: string[] }>;
};

function toCityKey(city: string, state: string): string {
  const c = (city || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const s = (state || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return s ? `${c}_${s}` : c || 'unknown';
}

function normalizeMetroKey(name: string): string {
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

function labelFromCsaName(name: string): string {
  if (!name || typeof name !== 'string') return 'Unknown Metro';
  return name.replace(/\s*(?:CSA|MSA)\s*$/i, '').trim();
}

function formatGeoLabel(key: string): string {
  return (key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function stripState(cityKey: string): string {
  const parts = cityKey.split('_');
  return parts.length > 1 ? parts.slice(0, -1).join('_') : cityKey;
}

function dedupeCityKeys(cityKeys: string[]): string[] {
  return Array.from(new Set((cityKeys || []).filter(Boolean))).sort();
}

function removeRedundantStandalones(next: Record<string, any>): Record<string, any> {
  const cityKeysInFullMetros = new Set<string>();
  for (const metro of Object.values(next)) {
    for (const sub of metro?.subareas ?? []) {
      for (const ck of sub?.cityKeys ?? []) cityKeysInFullMetros.add(ck);
    }
  }
  const out = { ...next };
  for (const cityKey of cityKeysInFullMetros) {
    const standaloneKey = `${cityKey}_metro`;
    if (standaloneKey in out) delete out[standaloneKey];
  }
  return out;
}

async function geocodeMetroByCoordinates(lat: number, lng: number): Promise<{ metroKey: string; label: string; geoid: string } | null> {
  const u = new URL('https://geocoding.geo.census.gov/geocoder/geographies/coordinates');
  u.searchParams.set('x', String(lng));
  u.searchParams.set('y', String(lat));
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('vintage', 'Current_Current');
  u.searchParams.set('format', 'json');
  const res = await fetch(u.toString());
  if (!res.ok) return null;
  const data = await res.json() as any;
  const geo = data?.result?.geographies || {};
  const csa = geo['Combined Statistical Areas']?.[0];
  const msa = geo['Metropolitan Statistical Areas']?.[0];
  const metro = csa || msa;
  if (!metro) return null;
  const name = metro?.BASENAME || metro?.NAME || '';
  const geoid = String(metro?.GEOID || metro?.CSA || metro?.CBSA || '');
  return { metroKey: normalizeMetroKey(name), label: labelFromCsaName(name), geoid };
}

async function geocodeMetroByAddress(city: string, state: string, street?: string, zip?: string): Promise<{ metroKey: string; label: string; geoid: string } | null> {
  const u = new URL('https://geocoding.geo.census.gov/geocoder/geographies/address');
  u.searchParams.set('street', (street || '1 Main St').trim());
  u.searchParams.set('city', (city || '').trim());
  u.searchParams.set('state', (state || '').trim());
  if (zip) u.searchParams.set('zip', String(zip).trim());
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('vintage', 'Current_Current');
  u.searchParams.set('format', 'json');
  const res = await fetch(u.toString());
  if (!res.ok) return null;
  const data = await res.json() as any;
  const match = data?.result?.addressMatches?.[0];
  const geo = match?.geographies || {};
  const csa = geo['Combined Statistical Areas']?.[0];
  const msa = geo['Metropolitan Statistical Areas']?.[0];
  const metro = csa || msa;
  if (!metro) return null;
  const name = metro?.BASENAME || metro?.NAME || '';
  const geoid = String(metro?.GEOID || metro?.CSA || metro?.CBSA || '');
  return { metroKey: normalizeMetroKey(name), label: labelFromCsaName(name), geoid };
}

async function resolveMetro(input: {
  city: string;
  state: string;
  street?: string;
  zip?: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ metroKey: string; label: string; geoid: string } | null> {
  if (typeof input.lat === 'number' && typeof input.lng === 'number') {
    const byCoords = await geocodeMetroByCoordinates(input.lat, input.lng);
    if (byCoords) return byCoords;
  }
  const byAddress = await geocodeMetroByAddress(input.city, input.state, input.street, input.zip);
  if (byAddress) return byAddress;
  return null;
}

function metroTemplateFromMasterDoc(metroKey: string, data: any): MetroTemplate {
  const subareas = Array.isArray(data?.subareas)
    ? data.subareas.map((s: any) => ({
        subareaKey: String(s?.subareaKey || 'metro'),
        label: String(s?.label || formatGeoLabel(String(s?.subareaKey || 'metro'))),
        cityKeys: dedupeCityKeys(Array.isArray(s?.cityKeys) ? s.cityKeys : []),
      }))
    : [];
  return {
    metroKey,
    label: String(data?.label || formatGeoLabel(metroKey)),
    subareas,
  };
}

async function ensureCityInTenantSmartGroups(tenantId: string, cityKey: string, metroTemplate: MetroTemplate): Promise<void> {
  const ref = db.doc(`tenants/${tenantId}/settings/smartGroups`);
  const snap = await ref.get();
  const existing = (snap.data()?.customMetros || {}) as Record<string, any>;

  for (const metro of Object.values(existing)) {
    for (const sub of metro?.subareas || []) {
      if ((sub?.cityKeys || []).includes(cityKey)) return;
    }
  }

  const next = { ...existing };
  next[metroTemplate.metroKey] = {
    label: metroTemplate.label,
    subareas: metroTemplate.subareas.map((s) => ({
      subareaKey: s.subareaKey,
      label: s.label,
      cityKeys: dedupeCityKeys(s.cityKeys),
    })),
  };
  delete next[`${cityKey}_metro`];

  const cleaned = removeRedundantStandalones(next);
  await ref.set({ customMetros: cleaned, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function upsertMetroMasterAndReturnTemplate(params: {
  city: string;
  state: string;
  cityKey: string;
  resolved: { metroKey: string; label: string; geoid: string };
}): Promise<MetroTemplate> {
  const metroRef = db.doc(`system/geo/metro_master/${params.resolved.metroKey}`);
  const cityIndexRef = db.doc(`system/geo/metro_city_index/${params.cityKey}`);

  await db.runTransaction(async (tx) => {
    const metroSnap = await tx.get(metroRef);
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (!metroSnap.exists) {
      tx.set(metroRef, {
        metroKey: params.resolved.metroKey,
        label: params.resolved.label,
        geoid: params.resolved.geoid || null,
        source: 'census_auto',
        createdAt: now,
        updatedAt: now,
        subareas: [
          {
            subareaKey: 'metro',
            label: 'Metro',
            cityKeys: [params.cityKey],
          },
        ],
      });
    } else {
      const data = metroSnap.data() || {};
      const subareas = Array.isArray(data.subareas) ? data.subareas : [];
      let updated = false;
      const nextSubareas = subareas.map((s: any) => {
        if (String(s?.subareaKey) !== 'metro') return s;
        const mergedCityKeys = dedupeCityKeys([...(s?.cityKeys || []), params.cityKey]);
        if (mergedCityKeys.length !== (s?.cityKeys || []).length) updated = true;
        return { ...s, cityKeys: mergedCityKeys };
      });
      if (!nextSubareas.some((s: any) => String(s?.subareaKey) === 'metro')) {
        nextSubareas.push({ subareaKey: 'metro', label: 'Metro', cityKeys: [params.cityKey] });
        updated = true;
      }
      tx.set(
        metroRef,
        {
          metroKey: params.resolved.metroKey,
          label: data.label || params.resolved.label,
          geoid: data.geoid || params.resolved.geoid || null,
          source: data.source || 'census_auto',
          subareas: nextSubareas,
          updatedAt: now,
        },
        { merge: true }
      );
      if (!updated) {
        // still update timestamp + index below
      }
    }

    tx.set(
      cityIndexRef,
      {
        cityKey: params.cityKey,
        city: params.city,
        state: params.state,
        metroKey: params.resolved.metroKey,
        subareaKey: 'metro',
        updatedAt: now,
      },
      { merge: true }
    );
  });

  const metroDoc = await metroRef.get();
  return metroTemplateFromMasterDoc(params.resolved.metroKey, metroDoc.data() || {});
}

function parseLocationGeo(location: any): {
  city: string;
  state: string;
  zip?: string;
  street?: string;
  lat?: number | null;
  lng?: number | null;
} {
  const city = String(location?.city || location?.address?.city || '').trim();
  const state = String(location?.state || location?.address?.state || '').trim();
  const zip = String(location?.zipCode || location?.zipcode || location?.address?.zipCode || '').trim() || undefined;
  const street = String(location?.street || location?.address?.street || '').trim() || undefined;
  const coords = location?.coordinates || location?.coords || location?.address?.coordinates;
  const lat = typeof coords?.lat === 'number' ? coords.lat : null;
  const lng = typeof coords?.lng === 'number' ? coords.lng : null;
  return { city, state, zip, street, lat, lng };
}

export async function autoSyncUnknownWorksiteMetroToMaster(tenantId: string, locationData: any): Promise<void> {
  const geo = parseLocationGeo(locationData);
  if (!tenantId || !geo.city || !geo.state) return;

  const cityKey = toCityKey(geo.city, geo.state);
  if (!cityKey || cityKey === 'unknown') return;

  const existingIndex = await db.doc(`system/geo/metro_city_index/${cityKey}`).get();
  if (existingIndex.exists) {
    const idx = existingIndex.data() || {};
    const metroKey = String(idx.metroKey || '');
    if (!metroKey) return;
    const metroSnap = await db.doc(`system/geo/metro_master/${metroKey}`).get();
    if (!metroSnap.exists) return;
    const template = metroTemplateFromMasterDoc(metroKey, metroSnap.data());
    await ensureCityInTenantSmartGroups(tenantId, cityKey, template);
    return;
  }

  const resolved = await resolveMetro({
    city: geo.city,
    state: geo.state,
    street: geo.street,
    zip: geo.zip,
    lat: geo.lat,
    lng: geo.lng,
  });
  if (!resolved) {
    const standaloneTemplate: MetroTemplate = {
      metroKey: `${cityKey}_metro`,
      label: formatGeoLabel(stripState(cityKey)),
      subareas: [{ subareaKey: 'other', label: 'Other', cityKeys: [cityKey] }],
    };
    await ensureCityInTenantSmartGroups(tenantId, cityKey, standaloneTemplate);
    return;
  }

  const template = await upsertMetroMasterAndReturnTemplate({
    city: geo.city,
    state: geo.state,
    cityKey,
    resolved,
  });
  await ensureCityInTenantSmartGroups(tenantId, cityKey, template);
}

async function cleanupStandaloneMetrosForTenant(tenantId: string): Promise<{
  removed: string[];
  kept: string[];
}> {
  const ref = db.doc(`tenants/${tenantId}/settings/smartGroups`);
  const snap = await ref.get();
  const customMetros = (snap.data()?.customMetros || {}) as Record<string, any>;

  const cityKeysCoveredByFullMetros = new Set<string>();
  for (const [metroKey, metro] of Object.entries(customMetros)) {
    if (metroKey.endsWith("_metro")) continue;
    for (const sub of metro?.subareas || []) {
      for (const cityKey of sub?.cityKeys || []) {
        cityKeysCoveredByFullMetros.add(String(cityKey));
      }
    }
  }

  const standaloneKeys = Object.keys(customMetros).filter((k) => k.endsWith("_metro"));
  if (standaloneKeys.length === 0) return {removed: [], kept: []};

  const cityKeys = standaloneKeys.map((k) => k.slice(0, -"_metro".length));
  const refs = cityKeys.map((cityKey) => db.doc(`system/geo/metro_city_index/${cityKey}`));
  const docs = refs.length > 0 ? await db.getAll(...refs) : [];
  const indexedCityKeys = new Set<string>();
  for (const d of docs) {
    if (d.exists) indexedCityKeys.add(d.id);
  }

  const next = {...customMetros};
  const removed: string[] = [];
  const kept: string[] = [];

  for (let i = 0; i < standaloneKeys.length; i += 1) {
    const standaloneKey = standaloneKeys[i];
    const cityKey = cityKeys[i];
    const shouldRemove =
      cityKeysCoveredByFullMetros.has(cityKey) || indexedCityKeys.has(cityKey);
    if (shouldRemove) {
      delete next[standaloneKey];
      removed.push(standaloneKey);
    } else {
      kept.push(standaloneKey);
    }
  }

  if (removed.length > 0) {
    await ref.set(
      {
        customMetros: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
  }

  return {removed, kept};
}

export const backfillMetroMasterFromLocations = onCall({
  memory: "1GiB",
  timeoutSeconds: 540,
  maxInstances: 1,
}, async (req) => {
  const data = req.data || {};
  const tenantId = String(data.tenantId || "").trim();
  const companyId = data.companyId ? String(data.companyId).trim() : "";
  const maxCities = Math.max(1, Number(data.maxCities || 1000));

  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  let scannedLocations = 0;
  let uniqueCities = 0;
  let syncedCities = 0;
  let skippedNoCityState = 0;
  let skippedDuplicateCity = 0;
  const errors: Array<{companyId: string; locationId: string; message: string}> = [];
  const seenCityKeys = new Set<string>();

  const companies = companyId
    ? [await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get()]
    : (await db.collection(`tenants/${tenantId}/crm_companies`).get()).docs;

  outer:
  for (const companyDoc of companies) {
    if (!companyDoc.exists) continue;
    const cid = companyDoc.id;
    const locations = await db.collection(`tenants/${tenantId}/crm_companies/${cid}/locations`).get();
    for (const locDoc of locations.docs) {
      scannedLocations += 1;
      const locData = locDoc.data() || {};
      const geo = parseLocationGeo(locData);
      if (!geo.city || !geo.state) {
        skippedNoCityState += 1;
        continue;
      }

      const cityKey = toCityKey(geo.city, geo.state);
      if (!cityKey || cityKey === "unknown") {
        skippedNoCityState += 1;
        continue;
      }

      if (seenCityKeys.has(cityKey)) {
        skippedDuplicateCity += 1;
        continue;
      }

      seenCityKeys.add(cityKey);
      uniqueCities += 1;

      try {
        await autoSyncUnknownWorksiteMetroToMaster(tenantId, locData);
        syncedCities += 1;
      } catch (e: any) {
        errors.push({
          companyId: cid,
          locationId: locDoc.id,
          message: String(e?.message || e),
        });
      }

      if (uniqueCities >= maxCities) {
        break outer;
      }
    }
  }

  const cleanup = await cleanupStandaloneMetrosForTenant(tenantId);

  return {
    ok: true,
    tenantId,
    companyId: companyId || null,
    scannedLocations,
    uniqueCities,
    syncedCities,
    skippedNoCityState,
    skippedDuplicateCity,
    maxCities,
    errorsCount: errors.length,
    errors: errors.slice(0, 50),
    removedStandaloneMetros: cleanup.removed,
    keptStandaloneMetros: cleanup.kept,
  };
});

export const cleanupTenantStandaloneMetros = onCall(async (req) => {
  const tenantId = String(req.data?.tenantId || "").trim();
  if (!tenantId) {
    throw new Error("tenantId is required");
  }
  const result = await cleanupStandaloneMetrosForTenant(tenantId);
  return {
    ok: true,
    tenantId,
    removedCount: result.removed.length,
    keptCount: result.kept.length,
    removed: result.removed,
    kept: result.kept,
  };
});

export const backfillMetroMasterFromLocationsHttp = onRequest({
  memory: "1GiB",
  timeoutSeconds: 540,
  maxInstances: 1,
}, async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || (req.body?.tenantId as string) || "";
    const companyId = (req.query.companyId as string) || (req.body?.companyId as string) || "";
    const maxCitiesRaw = (req.query.maxCities as string) || (req.body?.maxCities as string) || "1000";
    const maxCities = Number(maxCitiesRaw);

    const result = await backfillMetroMasterFromLocations.run({
      data: {
        tenantId,
        companyId: companyId || undefined,
        maxCities: Number.isFinite(maxCities) ? maxCities : 1000,
      },
    } as any);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ok: false, error: String(e?.message || e)});
  }
});

