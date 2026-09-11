/**
 * Print queue counts, recent actions, and worker heartbeats.
 *   npm run status
 *   npm run status -- --limit=30 --status=needs_human
 */
import type { PortalActionDoc, PortalActionStatus } from '../../shared/portalActions.ts';
import { loadConfig } from '../src/config.ts';
import { db as getDb, initFirebase } from '../src/firebase.ts';
import { actionsCollection, queueCounts } from '../src/queue.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const config = loadConfig();
  initFirebase(config);
  const db = getDb();
  const limit = Number(arg('limit') || 15);
  const status = arg('status') as PortalActionStatus | undefined;

  // --id=<actionId>: dump one action (result + lastError) and exit.
  const id = arg('id');
  if (id) {
    const snap = await actionsCollection(db, config.tenantId).doc(id).get();
    if (!snap.exists) throw new Error(`no action ${id}`);
    const a = snap.data() as PortalActionDoc;
    console.log(JSON.stringify({ status: a.status, attempts: a.attempts, lastError: a.lastError, result: a.result, history: a.history }, null, 2));
    return;
  }

  console.log('queue:', await queueCounts(db, config.tenantId));

  const workers = await db.collection('tenants').doc(config.tenantId).collection('portal_workers').get();
  console.log('\nworkers:');
  for (const w of workers.docs) {
    const d = w.data();
    const beat = d.lastHeartbeatAt?.toDate?.() as Date | undefined;
    const ageS = beat ? Math.round((Date.now() - beat.getTime()) / 1000) : null;
    const busy = d.busyWith ? `  busy: ${d.busyWith.action} ${d.busyWith.note ? `(${d.busyWith.note})` : ''} since ${d.busyWith.since}` : '';
    console.log(`  ${w.id.padEnd(28)} ${String(d.status).padEnd(8)} heartbeat ${ageS === null ? '?' : ageS + 's ago'}${busy}`);
    console.log(`  ${''.padEnd(28)} sessions=${JSON.stringify(d.sessions || {})}`);
  }

  let q = actionsCollection(db, config.tenantId).orderBy('updatedAt', 'desc').limit(limit);
  if (status) q = actionsCollection(db, config.tenantId).where('status', '==', status).limit(limit);
  const snap = await q.get();
  console.log(`\nrecent actions${status ? ` (${status})` : ''}:`);
  for (const d of snap.docs) {
    const a = d.data() as PortalActionDoc;
    const err = a.lastError ? ` ${a.lastError.code}: ${a.lastError.message.slice(0, 80)}` : '';
    console.log(`  ${a.status.padEnd(12)} ${a.provider.padEnd(12)} ${a.action.padEnd(18)} att ${a.attempts}/${a.maxAttempts}  ${d.id.slice(0, 70)}${err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
