import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

/** Replace NaN/Infinity in any value so JSON encoding cannot fail */
function sanitizeForJson(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeForJson);
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && value.constructor?.name === 'Timestamp') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeForJson(v);
    }
    return out;
  }
  return value;
}

/** Convert Firestore doc data to JSON-serializable form (Timestamps -> ISO string, NaN/Infinity -> null) */
function toPlain(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) {
      out[k] = v;
    } else if (typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v))) {
      out[k] = null;
    } else if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
      out[k] = (v as { toDate: () => Date }).toDate().toISOString();
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => {
        if (item != null && typeof item === 'object' && !Array.isArray(item) && 'toDate' in item) {
          return (item as { toDate: () => Date }).toDate().toISOString();
        }
        if (typeof item === 'number' && (Number.isNaN(item) || !Number.isFinite(item))) return null;
        return typeof item === 'object' && item !== null ? toPlain(item as Record<string, unknown>) : item;
      });
    } else if (typeof v === 'object' && v.constructor?.name === 'Timestamp') {
      out[k] = (v as { toDate: () => Date }).toDate().toISOString();
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = toPlain(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Returns read-only CRM data (deals + pipeline stages) for a tenant.
 * Used by the public CRM view at /crm/public?tenant=XXX.
 * cors: true allows requests from custom domains (e.g. hrxone.com).
 */
export const getPublicCrmView = onCall({ cors: true }, async (request) => {
  try {
    const { tenantId } = request.data || {};
    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing or invalid tenantId');
    }

    const db = admin.firestore();
    const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
    const stagesRef = db.collection('tenants').doc(tenantId).collection('crm_pipeline_stages');

    const [dealsSnap, stagesSnap] = await Promise.all([
      dealsRef.limit(500).get(),
      stagesRef.get(),
    ]);

    const rawDeals = dealsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
      .filter((d) => d.archived !== true);

    const getPrimaryCompanyId = (deal: Record<string, unknown>): string | null => {
      const assocCompanies = ((deal.associations as { companies?: Array<string | { id?: string; isPrimary?: boolean }> } | undefined)?.companies || []);
      const primary = assocCompanies
        .map((c) => (typeof c === 'string' ? { id: c } : c))
        .find((c) => c?.isPrimary)?.id;
      if (primary) return primary;
      const directCompanyId = typeof deal.companyId === 'string' ? deal.companyId : null;
      if (directCompanyId) return directCompanyId;
      const firstAssoc = assocCompanies
        .map((c) => (typeof c === 'string' ? c : c?.id))
        .find(Boolean);
      return firstAssoc || null;
    };

    const companyIds = Array.from(new Set(
      rawDeals.flatMap((deal) => {
        const assocCompanies = ((deal.associations as { companies?: Array<string | { id?: string }> } | undefined)?.companies || [])
          .map((c) => (typeof c === 'string' ? c : c?.id))
          .filter((id): id is string => Boolean(id));
        const directCompanyId = typeof deal.companyId === 'string' ? deal.companyId : null;
        return directCompanyId ? [directCompanyId, ...assocCompanies] : assocCompanies;
      }),
    ));

    const companyMap = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < companyIds.length; i += 10) {
      const batch = companyIds.slice(i, i + 10);
      if (batch.length === 0) continue;
      const snap = await db.collection('tenants').doc(tenantId).collection('crm_companies')
        .where(admin.firestore.FieldPath.documentId(), 'in', batch)
        .get();
      snap.docs.forEach((doc) => {
        companyMap.set(doc.id, { id: doc.id, ...toPlain(doc.data() as Record<string, unknown>) });
      });
    }

    const locationRefs = Array.from(new Map(
      rawDeals.flatMap((deal) => {
        const primaryCompanyId = getPrimaryCompanyId(deal);
        const assocLocations = ((deal.associations as { locations?: Array<string | { id?: string; companyId?: string }> } | undefined)?.locations || []);
        const normalized = assocLocations
          .map((loc) => (typeof loc === 'string' ? { id: loc, companyId: primaryCompanyId || undefined } : { id: loc?.id, companyId: loc?.companyId || primaryCompanyId || undefined }))
          .filter((loc) => Boolean(loc.id)) as Array<{ id: string; companyId?: string }>;
        if (normalized.length > 0) {
          return normalized.map((loc) => [`${loc.companyId || 'root'}:${loc.id}`, loc] as const);
        }
        if (typeof deal.locationId === 'string') {
          return [[`${primaryCompanyId || 'root'}:${deal.locationId}`, { id: deal.locationId, companyId: primaryCompanyId || undefined }] as const];
        }
        return [];
      }),
    ).values());

    const locationMap = new Map<string, Record<string, unknown>>();
    await Promise.all(locationRefs.map(async ({ id, companyId }) => {
      let data: Record<string, unknown> | null = null;
      if (companyId) {
        const nestedSnap = await db.collection('tenants').doc(tenantId).collection('crm_companies').doc(companyId).collection('locations').doc(id).get();
        if (nestedSnap.exists) data = nestedSnap.data() as Record<string, unknown>;
      }
      if (!data) {
        const topSnap = await db.collection('tenants').doc(tenantId).collection('crm_locations').doc(id).get();
        if (topSnap.exists) data = topSnap.data() as Record<string, unknown>;
      }
      if (data) {
        locationMap.set(`${companyId || 'root'}:${id}`, { id, ...toPlain(data) });
      }
    }));

    const dealIds = rawDeals.map((d) => d.id as string).filter(Boolean);
    const latestNoteByDealId = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < dealIds.length; i += 10) {
      const batch = dealIds.slice(i, i + 10);
      if (batch.length === 0) continue;
      const snap = await db.collection('tenants').doc(tenantId).collection('deal_notes')
        .where('entityId', 'in', batch)
        .get();
      snap.docs.forEach((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const entityId = data.entityId as string | undefined;
        if (!entityId) return;
        const existing = latestNoteByDealId.get(entityId);
        const currentTs = (data.timestamp as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
        const existingTs = ((existing?.timestamp as admin.firestore.Timestamp | undefined)?.toMillis?.()) ?? 0;
        if (!existing || currentTs > existingTs) {
          latestNoteByDealId.set(entityId, data);
        }
      });
    }

    const deals = rawDeals.map((deal) => {
      const primaryCompanyId = getPrimaryCompanyId(deal);

      const primaryCompany = primaryCompanyId ? companyMap.get(primaryCompanyId) : null;
      const primaryLocationEntry = ((deal.associations as { locations?: Array<string | { id?: string; companyId?: string }> } | undefined)?.locations || [])[0];
      const primaryLocationId = typeof primaryLocationEntry === 'string'
        ? primaryLocationEntry
        : primaryLocationEntry?.id || (typeof deal.locationId === 'string' ? deal.locationId : null);
      const primaryLocationCompanyId = typeof primaryLocationEntry === 'object'
        ? (primaryLocationEntry?.companyId || primaryCompanyId || undefined)
        : (primaryCompanyId || undefined);
      const primaryLocation = primaryLocationId
        ? locationMap.get(`${primaryLocationCompanyId || 'root'}:${primaryLocationId}`) || null
        : null;
      const latestNote = latestNoteByDealId.get(deal.id as string);

      return toPlain({
        ...deal,
        publicPrimaryCompany: primaryCompany || null,
        publicPrimaryLocation: primaryLocation || null,
        latestNote: latestNote
          ? {
              content: latestNote.content || '',
              authorName: latestNote.authorName || '',
              timestamp: latestNote.timestamp || null,
            }
          : null,
      } as Record<string, unknown>);
    });

    const pipelineStages = stagesSnap.docs
      .map((d) => toPlain({ id: d.id, ...d.data() } as Record<string, unknown>))
      .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));

    const payload = { deals, pipelineStages };
    return sanitizeForJson(payload) as { deals: typeof deals; pipelineStages: typeof pipelineStages };
  } catch (err: unknown) {
    if (err instanceof HttpsError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error('getPublicCrmView error:', message);
    throw new HttpsError('internal', `Failed to load CRM data: ${message}`);
  }
});
