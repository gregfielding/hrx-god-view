/**
 * Inspect recent messageLogs for a user — shows exactly which channels attempted,
 * status, failure reasons, and the routing decision snapshot.
 *
 * Path: tenants/{tenantId}/messageLogs/{logId}
 *
 * Use to answer: "why didn't Hamadi get the worker_hired SMS (or push)?"
 * Compare his worker_hired entries to the onboarding entries that DID fire SMS.
 *
 * Usage:
 *   # All recent logs for this user across all tenants (default 20)
 *   GCLOUD_PROJECT=hrx1-d3beb USER_ID=<uid> npx ts-node scripts/inspectMessageLogs.ts
 *
 *   # Filter to just worker_hired logs, larger window
 *   GCLOUD_PROJECT=hrx1-d3beb USER_ID=<uid> TYPE=worker_hired LIMIT=50 \
 *     npx ts-node scripts/inspectMessageLogs.ts
 */
import * as admin from 'firebase-admin';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'hrx1-d3beb';
const USER_ID = (process.env.USER_ID || '').trim();
const TYPE = (process.env.TYPE || '').trim();
const LIMIT = Math.max(1, Math.min(200, parseInt(process.env.LIMIT || '20', 10) || 20));

if (!USER_ID) {
  console.error('USER_ID env var required. e.g. USER_ID=abc123 npx ts-node scripts/inspectMessageLogs.ts');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function trunc(s: unknown, n = 80): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function fmtTs(ts: unknown): string {
  if (ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    try {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return String(ts);
    }
  }
  return String(ts);
}

async function main(): Promise<void> {
  console.log(
    `\n=== messageLogs for user=${USER_ID}${TYPE ? `, type=${TYPE}` : ''} (project=${PROJECT_ID}, limit=${LIMIT}/tenant) ===\n`,
  );

  const tenantsSnap = await db.collection('tenants').get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    const tenantName = String(tenantDoc.get('name') ?? '(no name)');

    let q: FirebaseFirestore.Query = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageLogs')
      .where('userId', '==', USER_ID);
    if (TYPE) q = q.where('messageTypeId', '==', TYPE);

    let snap: FirebaseFirestore.QuerySnapshot;
    try {
      snap = await q.orderBy('createdAt', 'desc').limit(LIMIT).get();
    } catch (err) {
      // Missing composite index — fall back to fetch-and-sort client-side.
      const raw = await q.limit(LIMIT * 4).get();
      const docs = raw.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .sort((a, b) => {
          const ta = (a.data.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
          const tb = (b.data.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
          return tb - ta;
        })
        .slice(0, LIMIT);
      snap = { docs: docs.map((d) => ({ id: d.id, data: () => d.data })), size: docs.length, empty: docs.length === 0 } as unknown as FirebaseFirestore.QuerySnapshot;
    }

    if (snap.empty) {
      console.log(`---- tenant ${tenantId} (${tenantName}): no logs for this user${TYPE ? ` / type=${TYPE}` : ''}\n`);
      continue;
    }

    console.log(`---- tenant ${tenantId} (${tenantName}): ${snap.size} log(s) ----`);
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const when = fmtTs(data.createdAt);
      const typ = String(data.messageTypeId ?? '—');
      const ch = String(data.channel ?? '—');
      const status = String(data.status ?? '—');
      const failureReason = data.failureReason ? trunc(data.failureReason, 200) : '';
      const content = trunc(data.contentSent ?? data.contentOriginal ?? '', 60);
      const phone = String(data.recipientPhoneE164 ?? '');
      const email = String(data.recipientEmail ?? '');
      const dest = phone ? `phone=${phone}` : email ? `email=${email}` : '';
      const direction = String(data.direction ?? '');

      console.log(
        `  [${when}] type=${typ} ch=${ch} dir=${direction} status=${status}${dest ? ` ${dest}` : ''}`,
      );
      if (content) console.log(`    content: ${content}`);
      if (failureReason) console.log(`    failureReason: ${failureReason}`);

      // Full routing decision if present (older entries may not have it)
      const rd = data.routingDecision as Record<string, unknown> | undefined;
      if (rd) {
        const channels = rd.channels;
        const skipped = rd.skippedChannels;
        console.log(`    routingDecision.channels:        ${JSON.stringify(channels)}`);
        console.log(`    routingDecision.skippedChannels: ${JSON.stringify(skipped)}`);
        if (rd.reason) console.log(`    routingDecision.reason:          ${rd.reason}`);
      }
    }
    console.log('');
  }

  console.log('=== done ===');
  console.log('');
  console.log('Read the SMS row for worker_hired:');
  console.log('  status=sent / delivered  → SMS fired. The activity log might just be hiding it.');
  console.log('  status=suppressed_*      → the failureReason tells you which gate blocked it.');
  console.log('  (no SMS row at all)      → shouldUseChannel returned allowed:false; compare to the');
  console.log('                             onboarding SMS row to see what differs.');
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
