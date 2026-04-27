import * as admin from 'firebase-admin';
import { loadEnvForScripts } from './loadEnv';

type Args = {
  backgroundCheckId?: string;
  providerProfileId?: string;
  clientId?: string;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { limit: 10 };
  for (const arg of argv) {
    if (arg.startsWith('--backgroundCheckId=')) {
      out.backgroundCheckId = arg.split('=')[1]?.trim();
    } else if (arg.startsWith('--providerProfileId=')) {
      out.providerProfileId = arg.split('=')[1]?.trim();
    } else if (arg.startsWith('--clientId=')) {
      out.clientId = arg.split('=')[1]?.trim();
    } else if (arg.startsWith('--limit=')) {
      const v = Number.parseInt(arg.split('=')[1] || '10', 10);
      if (Number.isFinite(v) && v > 0) out.limit = v;
    }
  }
  return out;
}

function hasLookupInput(args: Args): boolean {
  return Boolean(args.backgroundCheckId || args.providerProfileId || args.clientId);
}

function tsToIso(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function compactSummary(id: string, d: Record<string, any>) {
  return {
    backgroundCheckId: id,
    provider: d.provider ?? null,
    providerEnvironment: d.providerEnvironment ?? null,
    clientId: d.clientId ?? null,
    providerClientId: d.providerClientId ?? null,
    providerProfileId: d.providerProfileId ?? null,
    orderMode: d.orderMode ?? null,
    hrxStatus: d.hrxStatus ?? null,
    providerStatus: d.providerStatus ?? null,
    finalReportReady: d.finalReportReady ?? null,
    drugReportReady: d.drugReportReady ?? null,
    profileCompleted: d.profileCompleted ?? null,
    orderCompleted: d.orderCompleted ?? null,
    applicantPortalLink: d.applicantPortalLink ?? null,
    lastWebhookType: d.lastWebhookType ?? null,
    lastWebhookAt: tsToIso(d.lastWebhookAt),
    lastSyncAt: tsToIso(d.lastSyncAt),
    syncError: d.syncError ?? null,
    updatedAt: tsToIso(d.updatedAt),
  };
}

async function loadMirroredEvents(backgroundCheckId: string, limit: number) {
  const db = admin.firestore();
  const snap = await db
    .collection('backgroundChecks')
    .doc(backgroundCheckId)
    .collection('events')
    .orderBy('receivedAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data() as Record<string, any>;
    return {
      id: doc.id,
      type: d.type ?? null,
      processingStatus: d.processingStatus ?? null,
      processingError: d.processingError ?? null,
      providerProfileId: d.providerProfileId ?? null,
      providerClientId: d.providerClientId ?? null,
      receivedAt: tsToIso(d.receivedAt),
      processedAt: tsToIso(d.processedAt),
    };
  });
}

async function loadGlobalIntakeEvents(args: Args, limit: number) {
  const db = admin.firestore();
  const intake = db.collection('integrations_accusource_webhook_events');
  const rows: Array<Record<string, unknown>> = [];

  if (args.providerProfileId) {
    const byProvider = await intake
      .where('providerProfileId', '==', args.providerProfileId)
      .orderBy('receivedAt', 'desc')
      .limit(limit)
      .get();
    for (const doc of byProvider.docs) {
      const d = doc.data() as Record<string, any>;
      rows.push({
        id: doc.id,
        eventType: d.eventType ?? null,
        providerProfileId: d.providerProfileId ?? null,
        clientId: d.clientId ?? null,
        processingStatus: d.processingStatus ?? null,
        processingError: d.processingError ?? null,
        matchedBackgroundCheckId: d.matchedBackgroundCheckId ?? null,
        receivedAt: tsToIso(d.receivedAt),
        processedAt: tsToIso(d.processedAt),
      });
    }
  }

  if (args.clientId) {
    const byClient = await intake
      .where('clientId', '==', args.clientId)
      .orderBy('receivedAt', 'desc')
      .limit(limit)
      .get();
    for (const doc of byClient.docs) {
      const d = doc.data() as Record<string, any>;
      rows.push({
        id: doc.id,
        eventType: d.eventType ?? null,
        providerProfileId: d.providerProfileId ?? null,
        clientId: d.clientId ?? null,
        processingStatus: d.processingStatus ?? null,
        processingError: d.processingError ?? null,
        matchedBackgroundCheckId: d.matchedBackgroundCheckId ?? null,
        receivedAt: tsToIso(d.receivedAt),
        processedAt: tsToIso(d.processedAt),
      });
    }
  }

  const dedup = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    dedup.set(String(row.id), row);
  }
  return Array.from(dedup.values());
}

async function lookupBackgroundChecks(args: Args) {
  const db = admin.firestore();
  const found = new Map<string, FirebaseFirestore.DocumentSnapshot>();

  if (args.backgroundCheckId) {
    const byId = await db.collection('backgroundChecks').doc(args.backgroundCheckId).get();
    if (byId.exists) found.set(byId.id, byId);
  }

  if (args.providerProfileId) {
    const byProvider = await db
      .collection('backgroundChecks')
      .where('providerProfileId', '==', args.providerProfileId)
      .limit(args.limit)
      .get();
    for (const doc of byProvider.docs) found.set(doc.id, doc);
  }

  if (args.clientId) {
    const byClient = await db
      .collection('backgroundChecks')
      .where('clientId', '==', args.clientId)
      .limit(args.limit)
      .get();
    for (const doc of byClient.docs) found.set(doc.id, doc);
  }

  return Array.from(found.values());
}

async function main() {
  loadEnvForScripts();
  const args = parseArgs(process.argv.slice(2));
  if (!hasLookupInput(args)) {
    console.error(
      'Usage: npm --prefix functions run debug:accusource:bgc -- ' +
      '--backgroundCheckId=<id> | --providerProfileId=<id> | --clientId=<id> [--limit=10]',
    );
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const matches = await lookupBackgroundChecks(args);
  console.log(`\nAccuSource backgroundChecks matches: ${matches.length}`);

  if (matches.length === 0) {
    console.log('No backgroundChecks records matched the provided lookup values.');
  }

  for (const snap of matches) {
    const data = (snap.data() || {}) as Record<string, any>;
    console.log('\n=== backgroundChecks/' + snap.id + ' ===');
    console.log(JSON.stringify(compactSummary(snap.id, data), null, 2));

    const mirroredEvents = await loadMirroredEvents(snap.id, Math.min(args.limit, 20));
    console.log(`Mirrored events (${mirroredEvents.length}):`);
    console.log(JSON.stringify(mirroredEvents, null, 2));
  }

  const intakeRows = await loadGlobalIntakeEvents(args, Math.min(args.limit, 25));
  console.log(`\nGlobal intake events (${intakeRows.length}):`);
  console.log(JSON.stringify(intakeRows, null, 2));
}

main().catch((error) => {
  console.error('debugAccusourceBackgroundCheck failed:', error?.message || error);
  process.exit(1);
});

