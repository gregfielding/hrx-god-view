import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

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

    const deals = dealsSnap.docs
      .map((d) => toPlain({ id: d.id, ...d.data() } as Record<string, unknown>))
      .filter((d) => d.archived !== true);

    const pipelineStages = stagesSnap.docs
      .map((d) => toPlain({ id: d.id, ...d.data() } as Record<string, unknown>))
      .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));

    return { deals, pipelineStages };
  } catch (err: unknown) {
    if (err instanceof HttpsError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error('getPublicCrmView error:', err);
    throw new HttpsError('internal', `Failed to load CRM data: ${message}`);
  }
});
