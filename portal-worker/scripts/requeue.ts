/**
 * Ops: push an action back to `pending` (or cancel it).
 *   npm run requeue -- --id=<actionId>            # claimed/running/needs_human/failed → pending (keeps attempts)
 *   npm run requeue -- --id=<actionId> --reset    # also attempts=0
 *   npm run requeue -- --id=<actionId> --cancel   # → cancelled
 * Use when a worker died mid-action and you don't want to wait for the
 * lease sweeper, or to retry a needs_human row after fixing the cause.
 */
import { PORTAL_ACTION_HISTORY_CAP, type PortalActionDoc } from '../../shared/portalActions.ts';
import { loadConfig } from '../src/config.ts';
import { db as getDb, initFirebase, Timestamp } from '../src/firebase.ts';
import { actionsCollection } from '../src/queue.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const id = arg('id');
  if (!id) throw new Error('--id=<actionId> is required');
  const config = loadConfig();
  initFirebase(config);
  const ref = actionsCollection(getDb(), config.tenantId).doc(id);
  const out = await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`no action ${id}`);
    const doc = snap.data() as PortalActionDoc;
    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();
    const cancel = flag('cancel');
    const next = cancel ? 'cancelled' : 'pending';
    if (doc.status === 'succeeded' && !cancel) throw new Error('already succeeded — use enqueue --force to re-run');
    tx.update(ref, {
      status: next,
      lease: null,
      notBefore: null,
      ...(flag('reset') ? { attempts: 0 } : {}),
      ...(cancel ? { finishedAt: now } : { finishedAt: null, startedAt: null }),
      updatedAt: now,
      history: [...(doc.history || []), { at: nowIso, status: next, note: `requeue.ts (was ${doc.status})${flag('reset') ? ' [reset]' : ''}` }].slice(
        -PORTAL_ACTION_HISTORY_CAP,
      ),
    });
    return { id, from: doc.status, to: next, attempts: flag('reset') ? 0 : doc.attempts };
  });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
