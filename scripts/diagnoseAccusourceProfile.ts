/**
 * One-shot diagnostic for an AccuSource profile that isn't showing per-item statuses in the UI.
 *
 * Usage (from repo root):
 *   GCLOUD_PROJECT=hrx1-d3beb npx ts-node scripts/diagnoseAccusourceProfile.ts <firestoreDocId>
 *
 * Optionally pin the tenant to skip the scan:
 *   GCLOUD_PROJECT=hrx1-d3beb TENANT_ID=<tid> npx ts-node scripts/diagnoseAccusourceProfile.ts <firestoreDocId>
 *
 * Avoids collectionGroup + composite-index requirements by iterating tenants and hitting each
 * tenants/{tid}/backgroundChecks/{docId} directly.
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function pretty(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) => {
      if (val && typeof val === 'object' && typeof (val as { toDate?: () => Date }).toDate === 'function') {
        try { return (val as { toDate: () => Date }).toDate().toISOString(); } catch { return String(val); }
      }
      return val;
    },
    2,
  );
}

async function findBackgroundCheckDoc(docId: string) {
  // Top-level `backgroundChecks/{docId}` — direct get, no index needed.
  const ref = db.collection('backgroundChecks').doc(docId);
  const snap = await ref.get();
  return snap.exists ? snap : null;
}

async function fetchRecentWebhookEvents(needles: string[], limit = 25) {
  const col = db.collection('integrations_accusource_webhook_events');
  const buckets: FirebaseFirestore.QueryDocumentSnapshot[][] = [];
  for (const n of needles) {
    try {
      const a = await col.where('providerClientId', '==', n).limit(50).get();
      buckets.push(a.docs);
    } catch { /* no index */ }
    try {
      const b = await col.where('providerProfileId', '==', n).limit(50).get();
      buckets.push(b.docs);
    } catch { /* no index */ }
    if (/^\d+$/.test(n)) {
      try {
        const c = await col.where('providerProfileId', '==', Number(n)).limit(50).get();
        buckets.push(c.docs);
      } catch { /* no index */ }
    }
  }
  const seen = new Set<string>();
  const flat: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const b of buckets) for (const d of b) if (!seen.has(d.id)) { seen.add(d.id); flat.push(d); }
  flat.sort((a, b) => {
    const ta = (a.data().receivedAt?.toMillis?.() ?? 0) as number;
    const tb = (b.data().receivedAt?.toMillis?.() ?? 0) as number;
    return tb - ta;
  });
  return flat.slice(0, limit);
}

async function main() {
  const needle = process.argv[2];
  if (!needle) {
    console.error('Usage: ts-node scripts/diagnoseAccusourceProfile.ts <firestoreDocId>');
    process.exit(2);
  }
  console.log(`\n=== AccuSource diagnostic for doc "${needle}" in project ${PROJECT_ID} ===\n`);

  const snap = await findBackgroundCheckDoc(needle);
  if (!snap) {
    console.log(`No top-level backgroundChecks/${needle} doc found.`);
    console.log('If this doc lives in a different collection path, inspect Firestore directly and report the path.');
    process.exit(0);
  }
  const data = snap.data()!;
  console.log(`Found at backgroundChecks/${snap.id}\n`);

  const summary = {
    id: snap.id,
    tenantId: data.tenantId ?? null,
    providerProfileId: data.providerProfileId,
    providerProfileNumber: data.providerProfileNumber,
    providerClientId: data.providerClientId ?? data.clientId,
    package: data.packageName ?? data.package?.name,
    packageId: data.packageId ?? data.package?.id,
    orderMode: data.orderMode,
    status: data.status,
    providerStatus: data.providerStatus,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    lastSyncAt: data.lastSyncAt,
    lastWebhookAt: data.lastWebhookAt,
    lastWebhookType: data.lastWebhookType,
    orderCompleted: data.orderCompleted,
    profileCompleted: data.profileCompleted,
    finalReportReady: data.finalReportReady,
    drugReportReady: data.drugReportReady,
    lastServiceComponent: data.lastServiceComponent,
    requestedServices: data.requestedServices,
    requestedServicesCatalog: data.requestedServicesCatalog,
    providerServiceOrderStatusKeys: data.providerServiceOrderStatus ? Object.keys(data.providerServiceOrderStatus) : null,
    providerServiceOrderStatus: data.providerServiceOrderStatus,
  };
  console.log('--- backgroundChecks doc summary ---');
  console.log(pretty(summary));

  const allKeys = Object.keys(data).sort();
  const dottedKeys = allKeys.filter((k) => k.includes('.'));
  console.log(`\n--- all top-level field keys on doc (${allKeys.length}) ---`);
  console.log(pretty(allKeys));
  if (dottedKeys.length > 0) {
    console.log(`\n!!! LITERAL DOTTED KEYS (smoking gun for set({merge:true}) bug):`);
    for (const k of dottedKeys) {
      console.log(`  "${k}" = ${pretty((data as Record<string, unknown>)[k])}`);
    }
  }
  console.log(`\n--- requestedServicesCatalog (raw) ---`);
  console.log(pretty((data as Record<string, unknown>).requestedServicesCatalog));

  const needles = new Set<string>([needle]);
  if (data.providerClientId) needles.add(String(data.providerClientId));
  if (data.clientId) needles.add(String(data.clientId));
  if (data.providerProfileId != null) needles.add(String(data.providerProfileId));
  if (data.providerProfileNumber) needles.add(String(data.providerProfileNumber));

  const events = await fetchRecentWebhookEvents([...needles], 25);
  console.log(`\n=== ${events.length} webhook event(s) from integrations_accusource_webhook_events ===`);
  for (const e of events) {
    const d = e.data();
    console.log(`\n--- event ${e.id} (type=${d.type ?? 'unknown'} status=${d.processingStatus ?? '-'})`);
    console.log(pretty({
      receivedAt: d.receivedAt,
      processingError: d.processingError,
      providerProfileId: d.providerProfileId,
      providerClientId: d.providerClientId,
      payload: d.payload,
    }));
  }

  console.log('\n=== done ===\n');
  process.exit(0);
}

main().catch((err) => { console.error('fatal', err); process.exit(1); });
