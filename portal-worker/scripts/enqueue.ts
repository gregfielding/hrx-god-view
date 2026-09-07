/**
 * Enqueue a portal action from the command line (ops / testing).
 *
 *   npm run enqueue -- --provider=indeed_flex --action=smoke_test
 *   npm run enqueue -- --action=fieldglass_sync                          # full Sync Sodexo pass
 *   npm run enqueue -- --action=fieldglass_sync --payload='{"postingIds":["SDXOJP00196229"],"force":true}'
 *   npm run enqueue -- --action=book_worker --payload='{"flexJobId":"530960","flexWorkerId":"abc"}'
 *   npm run enqueue -- --action=submit_candidate --payload='{"postingId":"SDXOJP00188954","candidate":{"firstName":"A","lastName":"B","email":"a@b.c"}}' --force
 */
import { PORTAL_ACTION_TYPES, type PortalActionType, type PortalProvider } from '../../shared/portalActions.ts';
import { loadConfig } from '../src/config.ts';
import { enqueuePortalAction } from '../src/enqueue.ts';
import { db as getDb, initFirebase } from '../src/firebase.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const config = loadConfig();
  initFirebase(config);
  const action = (arg('action') || 'smoke_test') as PortalActionType;
  if (!PORTAL_ACTION_TYPES.includes(action)) throw new Error(`unknown action ${action}`);
  const payload = JSON.parse(arg('payload') || '{}');
  if ((action === 'fieldglass_sync' || action === 'indeed_flex_sync') && !payload.reason) payload.reason = 'manual';
  const result = await enqueuePortalAction(getDb(), {
    tenantId: config.tenantId,
    action,
    provider: arg('provider') as PortalProvider | undefined,
    payload,
    createdBy: { kind: 'script', id: `enqueue.ts@${config.workerId}` },
    priority: arg('priority') ? Number(arg('priority')) : undefined,
    maxAttempts: arg('maxAttempts') ? Number(arg('maxAttempts')) : undefined,
    force: flag('force'),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
