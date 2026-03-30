/**
 * One-off: backfill tenants/{tid}/everify_cases.entityId when missing or orphan.
 *
 * Usage (from functions/):
 *   npx ts-node src/scripts/backfillEverifyCaseEntityId.ts --dry-run
 *   npx ts-node src/scripts/backfillEverifyCaseEntityId.ts --apply
 *   npx ts-node src/scripts/backfillEverifyCaseEntityId.ts --dry-run --tenantId=<tid> --limit=500
 *
 * Rules:
 * - Skip if entityId points to an existing entities/* doc (valid for any C1 key: Select / Workforce / Events).
 * - Do not change rows that already have a valid entity reference.
 * - Infer from userEmploymentId -> user_employments.entityId, else assignmentId -> job order hiringEntityId/entityId.
 * - If both sources yield different non-empty entityIds, skip (unsafe) and log.
 */

import * as admin from 'firebase-admin';
import { loadEnvForScripts } from './loadEnv';

type Args = { dryRun: boolean; tenantId?: string; limitPerTenant: number };

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: true, limitPerTenant: 2000 };
  for (const arg of argv) {
    if (arg === '--apply') out.dryRun = false;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--tenantId=')) out.tenantId = arg.split('=')[1]?.trim();
    else if (arg.startsWith('--limit=')) {
      const v = Number.parseInt(arg.split('=')[1] || '2000', 10);
      if (Number.isFinite(v) && v > 0) out.limitPerTenant = v;
    }
  }
  return out;
}

async function entityDocExists(
  db: admin.firestore.Firestore,
  tenantId: string,
  entityId: string
): Promise<boolean> {
  const snap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
  return snap.exists;
}

/** Valid linkage: non-empty entityId and entities/{id} exists. */
async function hasValidEntityId(
  db: admin.firestore.Firestore,
  tenantId: string,
  rawEntityId: unknown
): Promise<boolean> {
  const id = typeof rawEntityId === 'string' ? rawEntityId.trim() : '';
  if (!id) return false;
  return entityDocExists(db, tenantId, id);
}

async function inferFromUserEmployment(
  db: admin.firestore.Firestore,
  tenantId: string,
  userEmploymentId: string
): Promise<string | null> {
  const snap = await db.doc(`tenants/${tenantId}/user_employments/${userEmploymentId}`).get();
  if (!snap.exists) return null;
  const id = String((snap.data() as { entityId?: string }).entityId || '').trim();
  return id || null;
}

async function inferFromAssignment(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string
): Promise<string | null> {
  const asSnap = await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get();
  if (!asSnap.exists) return null;
  const jobOrderId = String((asSnap.data() as { jobOrderId?: string }).jobOrderId || '').trim();
  if (!jobOrderId) return null;

  let joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  if (!joSnap.exists) {
    joSnap = await db.doc(`tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`).get();
  }
  if (!joSnap.exists) return null;

  const jd = (joSnap.data() || {}) as Record<string, unknown>;
  const hid = String(jd.hiringEntityId || jd.entityId || '').trim();
  return hid || null;
}

async function inferEntityId(
  db: admin.firestore.Firestore,
  tenantId: string,
  data: Record<string, unknown>
): Promise<{ entityId: string | null; reason: string }> {
  const empRef = String(data.userEmploymentId || '').trim();
  const assignRef = String(data.assignmentId || '').trim();

  let fromEmp: string | null = null;
  let fromAssign: string | null = null;

  if (empRef) fromEmp = await inferFromUserEmployment(db, tenantId, empRef);
  if (assignRef) fromAssign = await inferFromAssignment(db, tenantId, assignRef);

  if (fromEmp && fromAssign && fromEmp !== fromAssign) {
    return { entityId: null, reason: 'conflict_userEmployment_vs_assignment' };
  }
  const resolved = fromEmp || fromAssign;
  if (!resolved) return { entityId: null, reason: 'no_inference_source' };
  const exists = await entityDocExists(db, tenantId, resolved);
  if (!exists) return { entityId: null, reason: 'inferred_entity_missing' };
  return { entityId: resolved, reason: fromEmp ? 'user_employments' : 'assignment_job_order' };
}

async function processTenant(
  db: admin.firestore.Firestore,
  tenantId: string,
  args: Args,
  stats: { examined: number; skippedValid: number; skippedUnsafe: number; updated: number }
): Promise<void> {
  const casesRef = db.collection('tenants').doc(tenantId).collection('everify_cases');
  const snap = await casesRef.limit(args.limitPerTenant).get();

  for (const doc of snap.docs) {
    stats.examined++;
    const data = (doc.data() || {}) as Record<string, unknown>;

    const valid = await hasValidEntityId(db, tenantId, data.entityId);
    if (valid) {
      stats.skippedValid++;
      continue;
    }

    const { entityId, reason } = await inferEntityId(db, tenantId, data);
    if (!entityId) {
      stats.skippedUnsafe++;
      console.log(
        `[skip] ${tenantId}/everify_cases/${doc.id} reason=${reason} userEmploymentId=${data.userEmploymentId || '—'} assignmentId=${data.assignmentId || '—'}`
      );
      continue;
    }

    if (args.dryRun) {
      stats.updated++;
      console.log(
        `[dry-run] would set entityId=${entityId} on ${tenantId}/everify_cases/${doc.id} (was ${JSON.stringify(data.entityId ?? null)})`
      );
      continue;
    }

    await doc.ref.update({
      entityId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    stats.updated++;
    console.log(`[apply] ${tenantId}/everify_cases/${doc.id} entityId=${entityId}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvForScripts();
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  console.log(
    `backfillEverifyCaseEntityId: mode=${args.dryRun ? 'DRY-RUN' : 'APPLY'} tenantId=${args.tenantId || 'ALL'} limitPerTenant=${args.limitPerTenant}`
  );

  const stats = { examined: 0, skippedValid: 0, skippedUnsafe: 0, updated: 0 };

  if (args.tenantId) {
    await processTenant(db, args.tenantId, args, stats);
  } else {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tref of tenants) {
      await processTenant(db, tref.id, args, stats);
    }
  }

  console.log('\nSummary:', JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
