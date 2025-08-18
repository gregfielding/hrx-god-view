import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onCall, onRequest } from 'firebase-functions/v2/https';

const db = admin.firestore();

function mirrorDocPath(tenantId: string, companyId: string, locationId: string) {
  const id = `${companyId}_${locationId}`;
  return `tenants/${tenantId}/company_locations/${id}`;
}

const STATE_MAP: Record<string, string> = {
  'ALABAMA': 'AL','ALASKA': 'AK','ARIZONA': 'AZ','ARKANSAS': 'AR','CALIFORNIA': 'CA','COLORADO': 'CO','CONNECTICUT': 'CT','DELAWARE': 'DE','FLORIDA': 'FL','GEORGIA': 'GA','HAWAII': 'HI','IDAHO': 'ID','ILLINOIS': 'IL','INDIANA': 'IN','IOWA': 'IA','KANSAS': 'KS','KENTUCKY': 'KY','LOUISIANA': 'LA','MAINE': 'ME','MARYLAND': 'MD','MASSACHUSETTS': 'MA','MICHIGAN': 'MI','MINNESOTA': 'MN','MISSISSIPPI': 'MS','MISSOURI': 'MO','MONTANA': 'MT','NEBRASKA': 'NE','NEVADA': 'NV','NEW HAMPSHIRE': 'NH','NEW JERSEY': 'NJ','NEW MEXICO': 'NM','NEW YORK': 'NY','NORTH CAROLINA': 'NC','NORTH DAKOTA': 'ND','OHIO': 'OH','OKLAHOMA': 'OK','OREGON': 'OR','PENNSYLVANIA': 'PA','RHODE ISLAND': 'RI','SOUTH CAROLINA': 'SC','SOUTH DAKOTA': 'SD','TENNESSEE': 'TN','TEXAS': 'TX','UTAH': 'UT','VERMONT': 'VT','VIRGINIA': 'VA','WASHINGTON': 'WA','WEST VIRGINIA': 'WV','WISCONSIN': 'WI','WYOMING': 'WY'
};

function normalizeState(input?: string | null): { stateCode: string | null; stateName: string | null } {
  if (!input) return { stateCode: null, stateName: null };
  const s = String(input).trim();
  if (!s) return { stateCode: null, stateName: null };
  const upper = s.toUpperCase();
  // If already a 2-letter code
  if (upper.length === 2 && Object.values(STATE_MAP).includes(upper)) {
    const name = Object.keys(STATE_MAP).find((k) => STATE_MAP[k] === upper) || null;
    return { stateCode: upper, stateName: name ? toTitle(name) : null };
  }
  // Try full name
  const code = STATE_MAP[upper];
  if (code) return { stateCode: code, stateName: toTitle(upper) };
  return { stateCode: null, stateName: null };
}

function toTitle(s: string): string { return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }

function deriveStateFromAddressText(text?: string | null): { stateCode: string | null; stateName: string | null } {
  if (!text) return { stateCode: null, stateName: null };
  const t = String(text);
  // Try ", Illinois 60639" or ", IL 60639"
  const nameMatch = t.match(/,\s*([A-Za-z]{3,})\s+\d{5}(-\d{4})?/);
  if (nameMatch) return normalizeState(nameMatch[1]);
  const codeMatch = t.match(/,\s*([A-Za-z]{2})\b/);
  if (codeMatch) return normalizeState(codeMatch[1]);
  return { stateCode: null, stateName: null };
}

function computeStateFields(locData: any): { stateCode: string | null; stateName: string | null; raw: string | null } {
  const raw = locData?.state ?? locData?.stateCode ?? locData?.address?.state ?? locData?.address?.stateCode ?? null;
  let norm = normalizeState(raw);
  if (!norm.stateCode) {
    // Try address text variants
    const addrText = locData?.addressText || locData?.address || locData?.streetAddress || null;
    norm = deriveStateFromAddressText(addrText);
  }
  return { stateCode: norm.stateCode, stateName: norm.stateName, raw: raw || null };
}

export const onCompanyLocationCreated = onDocumentCreated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  const { tenantId, companyId, locationId } = event.params as any;
  const data = event.data?.data() as any;
  if (!data) return;
  // Load company as fallback for state
  const { stateCode, stateName, raw } = computeStateFields(data);
  if (!stateCode) return;
  const path = mirrorDocPath(tenantId, companyId, locationId);
  await db.doc(path).set({ companyId, state: raw, stateCode, stateName }, { merge: true });
});

export const onCompanyLocationUpdated = onDocumentUpdated('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  const { tenantId, companyId, locationId } = event.params as any;
  const after = event.data?.after?.data() as any;
  const { stateCode, stateName, raw } = computeStateFields(after);
  const path = mirrorDocPath(tenantId, companyId, locationId);
  if (!stateCode) {
    await db.doc(path).delete().catch(() => {});
    return;
  }
  await db.doc(path).set({ companyId, state: raw, stateCode, stateName }, { merge: true });
});

export const onCompanyLocationDeleted = onDocumentDeleted('tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}', async (event) => {
  const { tenantId, companyId, locationId } = event.params as any;
  const path = mirrorDocPath(tenantId, companyId, locationId);
  await db.doc(path).delete().catch(() => {});
});

// Callable/HTTP backfill to populate mirror for existing locations
export const rebuildCompanyLocationMirror = onCall(async (req) => {
  const { tenantId, companyId, truncate = false } = req.data || {};
  if (!tenantId) throw new Error('tenantId is required');
  let count = 0;
  if (!companyId && truncate) {
    const mirrorSnap = await db.collection(`tenants/${tenantId}/company_locations`).get();
    const delBatch = db.batch();
    mirrorSnap.forEach((d) => delBatch.delete(d.ref));
    await delBatch.commit();
  }
  const companiesSnap = companyId
    ? [await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get()]
    : (await db.collection(`tenants/${tenantId}/crm_companies`).get()).docs;
  for (const c of companiesSnap) {
    if (!c.exists) continue;
    const cid = c.id;
    const locs = await db.collection(`tenants/${tenantId}/crm_companies/${cid}/locations`).get();
    const batch = db.batch();
    locs.forEach((l) => {
      const data = l.data() as any;
      const { stateCode, stateName, raw } = computeStateFields(data);
      if (!stateCode) return;
      const path = mirrorDocPath(tenantId, cid, l.id);
      batch.set(db.doc(path), { companyId: cid, state: raw, stateCode, stateName }, { merge: true });
      count += 1;
    });
    await batch.commit();
  }
  return { ok: true, count };
});

export const rebuildCompanyLocationMirrorHttp = onRequest(async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || (req.body?.tenantId as string);
    const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
    const truncate = (req.query.truncate as string) === 'true' || req.body?.truncate === true;
    const result = await rebuildCompanyLocationMirror.run({ data: { tenantId, companyId, truncate } } as any);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Diagnostics: counts per stateCode and sample mirror docs
export const companyLocationMirrorStats = onRequest(async (req, res): Promise<void> => {
  try {
    const tenantId = (req.query.tenantId as string) || '';
    const state = (req.query.state as string) || '';
    if (!tenantId) {
      res.status(400).json({ ok: false, error: 'tenantId required' });
      return;
    }
    const snap = await db.collection(`tenants/${tenantId}/company_locations`).get();
    const counts: Record<string, number> = {};
    const samples: any[] = [];
    snap.forEach((d) => {
      const sc = (d.data() as any).stateCode || 'UNKNOWN';
      counts[sc] = (counts[sc] || 0) + 1;
      if (state && sc === state && samples.length < 10) samples.push({ id: d.id, ...d.data() });
    });
    res.json({ ok: true, total: snap.size, counts, samples: state ? samples : undefined });
    return;
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
    return;
  }
});


