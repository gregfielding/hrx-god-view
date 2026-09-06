/**
 * Enqueue a portal action from the command line (ops / testing).
 *
 *   npm run enqueue -- --provider=indeed_flex --action=smoke_test
 *   npm run enqueue -- --action=book_worker --payload='{"flexJobId":"530960","flexWorkerId":"abc"}'
 *   npm run enqueue -- --action=submit_candidate --payload='{"postingId":"SDXOJP00188954","candidate":{"firstName":"A","lastName":"B","email":"a@b.c"}}' --force
 *
 * Uses the same producer logic as HRX (functions/src/integrations/portalActions)
 * re-implemented inline so this package has no build dependency on functions/.
 */
import {
  PORTAL_ACTION_DEFAULT_MAX_ATTEMPTS,
  PORTAL_ACTION_DEFAULT_PRIORITY,
  PORTAL_ACTION_OPEN_STATUSES,
  PORTAL_ACTION_TYPES,
  buildPortalActionId,
  defaultPortalActionKeyParts,
  providerForAction,
  type PortalActionDoc,
  type PortalActionType,
  type PortalProvider,
} from '../../shared/portalActions.ts';
import { loadConfig } from '../src/config.ts';
import { db as getDb, initFirebase, Timestamp } from '../src/firebase.ts';
import { actionsCollection } from '../src/queue.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const config = loadConfig();
  initFirebase(config);
  const db = getDb();

  const action = (arg('action') || 'smoke_test') as PortalActionType;
  if (!PORTAL_ACTION_TYPES.includes(action)) throw new Error(`unknown action ${action}`);
  const provider = providerForAction(action, arg('provider') as PortalProvider | undefined);
  const payload = JSON.parse(arg('payload') || '{}');
  const priority = Number(arg('priority') || PORTAL_ACTION_DEFAULT_PRIORITY);
  const force = flag('force');

  const keyParts = defaultPortalActionKeyParts(action, payload);
  let id = buildPortalActionId(provider, action, keyParts);
  if (action === 'smoke_test') id = `${id}__${Date.now()}`;
  const ref = actionsCollection(db, config.tenantId).doc(id);

  const existing = await ref.get();
  if (existing.exists) {
    const cur = existing.data() as PortalActionDoc;
    if (PORTAL_ACTION_OPEN_STATUSES.includes(cur.status) || (cur.status === 'succeeded' && !force)) {
      console.log(JSON.stringify({ id, created: false, existingStatus: cur.status }, null, 2));
      return;
    }
  }

  const now = Timestamp.now();
  const doc: PortalActionDoc = {
    tenantId: config.tenantId,
    provider,
    action,
    status: 'pending',
    payload,
    refs: {},
    idempotencyKey: id,
    priority,
    attempts: 0,
    maxAttempts: Number(arg('maxAttempts') || PORTAL_ACTION_DEFAULT_MAX_ATTEMPTS),
    notBefore: null,
    lease: null,
    lastError: null,
    result: null,
    history: [{ at: now.toDate().toISOString(), status: 'pending', note: `enqueued by scripts/enqueue.ts${force ? ' [force]' : ''}` }],
    createdBy: { kind: 'script', id: `enqueue.ts@${config.workerId}` },
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };
  await ref.set(doc);
  console.log(JSON.stringify({ id, created: true, provider, action }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
