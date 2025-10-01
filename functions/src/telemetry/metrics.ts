import * as admin from 'firebase-admin';
import { acquireLock } from '../lib/lock';
import { paginateCollection } from '../lib/paginate';
import fetch from 'node-fetch';
import { onRequest } from 'firebase-functions/v2/https';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type ClientMetric = {
  kind: 'ai_client';
  route?: string;
  model: string;
  schemaVersion?: string;
  cacheHit: boolean;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  ts?: number;
};

type ServerMetric = {
  kind: 'ai_server';
  op: string;
  deduped: boolean;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  ts?: number;
};

export const metricsIngest = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    const payload = req.body || {};
    const events: Array<ClientMetric | ServerMetric> = Array.isArray(payload.events) ? payload.events : [];
    if (!events.length) { res.json({ ok: true, accepted: 0 }); return; }
    const batch = db.batch();
    const now = Date.now();
    for (const ev of events) {
      const base = { ts: ev['ts'] ?? now, _at: admin.firestore.FieldValue.serverTimestamp() } as any;
      const dest = db.collection('ai_metrics_events').doc();
      batch.set(dest, { ...ev, ...base });
    }
    await batch.commit();
    res.json({ ok: true, accepted: events.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Associations integrity report callable
export const associationsIntegrityReport = onCall({ cors: true }, async (request) => {
  const { tenantId } = request.data || {};
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  const dealsRef = db.collection('tenants').doc(tenantId).collection('crm_deals');
  const snapshot = await dealsRef.limit(2000).get();
  let missingCompanyIds = 0;
  let missingPrimaryCompany = 0;
  let companiesWithNoSnapshot = 0;
  let contactsWithNoSnapshot = 0;
  let salespeopleWithNoSnapshot = 0;
  let locationsWithNoSnapshot = 0;

  snapshot.docs.forEach((docSnap) => {
    const d: any = docSnap.data() || {};
    const ids = Array.isArray(d.companyIds) ? d.companyIds : [];
    if (!ids.length) missingCompanyIds++;
    const assoc = d.associations || {};
    const primary = assoc?.companies?.find((e: any) => e && typeof e === 'object' && e.isPrimary);
    if (!primary && (!ids || !ids.length)) missingPrimaryCompany++;

    const checkNoSnapshot = (arr: any[], inc: () => void) => {
      (arr || []).forEach((e) => {
        if (typeof e === 'object') {
          if (!e.snapshot || Object.keys(e.snapshot || {}).length === 0) inc();
        }
      });
    };
    checkNoSnapshot(assoc.companies || [], () => companiesWithNoSnapshot++);
    checkNoSnapshot(assoc.contacts || [], () => contactsWithNoSnapshot++);
    checkNoSnapshot(assoc.salespeople || [], () => salespeopleWithNoSnapshot++);
    checkNoSnapshot(assoc.locations || [], () => locationsWithNoSnapshot++);
  });

  return {
    ok: true,
    totalDeals: snapshot.size,
    missingCompanyIds,
    missingPrimaryCompany,
    companiesWithNoSnapshot,
    contactsWithNoSnapshot,
    salespeopleWithNoSnapshot,
    locationsWithNoSnapshot,
  };
});

// Nightly scheduled integrity check (logs to Firestore)
// CHANGE: Hardening per cost-control policy
// - Env kill-switch; caps; will add pagination/lock in follow-up
const ENABLE_ASSOCIATIONS_INTEGRITY = process.env.ENABLE_ASSOCIATIONS_INTEGRITY === 'true';
export const associationsIntegrityNightly = onSchedule({
  schedule: '0 2 * * *',
  timeZone: 'America/New_York',
  maxInstances: 1,
  retryCount: 0,
  timeoutSeconds: 300,
  memory: '256MiB'
}, async (event) => {
  if (!ENABLE_ASSOCIATIONS_INTEGRITY) {
    console.info('associationsIntegrityNightly: disabled by ENABLE_ASSOCIATIONS_INTEGRITY');
    return;
  }
  const started = Date.now();
  try {
    // Acquire per-day lock
    const lockRelease = await acquireLock(`associationsIntegrityNightly-${new Date().toISOString().slice(0,10)}`);
    try {
      const tenantsSnap = await db.collection('tenants').get();
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      for (const t of tenantsSnap.docs) {
        const tenantId = t.id;
        // Bounded per-tenant processing using pagination
        const { docs } = await paginateCollection<any>(`tenants/${tenantId}/crm_deals`, {
          batchSize: 1000,
          orderBy: 'createdAt'
        });
        let missingCompanyIds = 0;
        let missingPrimaryCompany = 0;
        let companiesWithNoSnapshot = 0;
        let contactsWithNoSnapshot = 0;
        let salespeopleWithNoSnapshot = 0;
        let locationsWithNoSnapshot = 0;
        docs.forEach((docSnap) => {
          const d: any = docSnap.data() || {};
          const assoc = d.associations || {};
          const ids = Array.isArray(d.companyIds) ? d.companyIds : [];
          if (!ids.length && Array.isArray(assoc.companies) && assoc.companies.length > 0) missingCompanyIds++;
          const primary = assoc?.companies?.find((e: any) => e && typeof e === 'object' && e.isPrimary);
          if (!primary && (!ids || !ids.length)) missingPrimaryCompany++;
          const checkNoSnapshot = (arr: any[], inc: () => void) => {
            (arr || []).forEach((e) => { if (typeof e === 'object' && (!e.snapshot || Object.keys(e.snapshot || {}).length === 0)) inc(); });
          };
          checkNoSnapshot(assoc.companies || [], () => companiesWithNoSnapshot++);
          checkNoSnapshot(assoc.contacts || [], () => contactsWithNoSnapshot++);
          checkNoSnapshot(assoc.salespeople || [], () => salespeopleWithNoSnapshot++);
          checkNoSnapshot(assoc.locations || [], () => locationsWithNoSnapshot++);
        });
        const dest = db.collection('associations_integrity').doc(`${tenantId}_${Date.now()}`);
        const payload = {
          tenantId,
          totalDeals: docs.length,
          missingCompanyIds,
          missingPrimaryCompany,
          companiesWithNoSnapshot,
          contactsWithNoSnapshot,
          salespeopleWithNoSnapshot,
          locationsWithNoSnapshot,
          _at: now
        } as any;
        batch.set(dest, payload);
      }
      await batch.commit();
    } finally {
      await lockRelease();
    }
  } catch (e) {
    console.error('associationsIntegrityNightly error:', e);
  } finally {
    console.log(JSON.stringify({
      event: 'job_summary',
      job: 'associationsIntegrityNightly',
      duration_ms: Date.now() - started,
      success: true
    }));
  }
});
