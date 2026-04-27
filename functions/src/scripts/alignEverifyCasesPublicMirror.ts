/**
 * One-off: align tenants/{tid}/everify_cases_public with private everify_cases linkage + public payload.
 *
 * Usage (from functions/):
 *   npx ts-node src/scripts/alignEverifyCasesPublicMirror.ts --dry-run
 *   npx ts-node src/scripts/alignEverifyCasesPublicMirror.ts --apply
 *   npx ts-node src/scripts/alignEverifyCasesPublicMirror.ts --dry-run --tenantId=<tid> --limit=200
 *
 * Uses upsertEverifyCasePublicMirror so field set matches production writers.
 */

import * as admin from 'firebase-admin';
import { loadEnvForScripts } from './loadEnv';

type Args = { dryRun: boolean; tenantId?: string; limitPerTenant: number };

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: true, limitPerTenant: 5000 };
  for (const arg of argv) {
    if (arg === '--apply') out.dryRun = false;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--tenantId=')) out.tenantId = arg.split('=')[1]?.trim();
    else if (arg.startsWith('--limit=')) {
      const v = Number.parseInt(arg.split('=')[1] || '5000', 10);
      if (Number.isFinite(v) && v > 0) out.limitPerTenant = v;
    }
  }
  return out;
}

function publicPayloadFromPrivate(data: Record<string, unknown>): {
  status?: string;
  statusDisplay?: string;
  eligibilityStatement?: string;
  deadlines?: { tncResponseDueAt?: unknown; referralDueAt?: unknown };
} {
  const pub = (data.public as Record<string, unknown>) || {};
  const status = (pub.status as string) || (data.status as string) || 'unknown';
  const statusDisplay =
    (pub.statusDisplay as string) || String(data.providerStatus || '') || String(status);
  const eligibilityStatement =
    typeof pub.eligibilityStatement === 'string' ? pub.eligibilityStatement : undefined;
  const deadlines = pub.deadlines as { tncResponseDueAt?: unknown; referralDueAt?: unknown } | undefined;
  const out: {
    status?: string;
    statusDisplay?: string;
    eligibilityStatement?: string;
    deadlines?: { tncResponseDueAt?: unknown; referralDueAt?: unknown };
  } = { status, statusDisplay };
  if (eligibilityStatement) out.eligibilityStatement = eligibilityStatement;
  if (deadlines && typeof deadlines === 'object') out.deadlines = deadlines;
  return out;
}

async function processTenant(
  db: admin.firestore.Firestore,
  tenantId: string,
  args: Args,
  upsert: (
    tenantId: string,
    caseId: string,
    userId: string | null,
    publicPayload: import('../integrations/everify/everifyService').EverifyCasePublicPayload,
    linkage: import('../integrations/everify/everifyService').EverifyCasePublicLinkage
  ) => Promise<void>,
  linkageFrom: (data: Record<string, unknown> | undefined | null) => import('../integrations/everify/everifyService').EverifyCasePublicLinkage,
  stats: { examined: number; wouldWrite: number; written: number }
): Promise<void> {
  const casesRef = db.collection('tenants').doc(tenantId).collection('everify_cases');
  const snap = await casesRef.limit(args.limitPerTenant).get();

  for (const doc of snap.docs) {
    stats.examined++;
    const data = (doc.data() || {}) as Record<string, unknown>;
    const userId = (data.userId as string) || null;
    const publicPayload = publicPayloadFromPrivate(data);
    const linkage = linkageFrom(data);

    if (args.dryRun) {
      stats.wouldWrite++;
      console.log(
        `[dry-run] mirror ${tenantId}/everify_cases_public/${doc.id} userId=${userId || 'null'} linkage=${JSON.stringify(linkage)}`
      );
      continue;
    }

    await upsert(tenantId, doc.id, userId, publicPayload, linkage);
    stats.written++;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvForScripts();
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const { upsertEverifyCasePublicMirror, everifyCasePublicLinkageFromPrivate } = await import(
    '../integrations/everify/everifyService'
  );
  const db = admin.firestore();

  console.log(
    `alignEverifyCasesPublicMirror: mode=${args.dryRun ? 'DRY-RUN' : 'APPLY'} tenantId=${args.tenantId || 'ALL'} limitPerTenant=${args.limitPerTenant}`
  );

  const stats = { examined: 0, wouldWrite: 0, written: 0 };

  if (args.tenantId) {
    await processTenant(db, args.tenantId, args, upsertEverifyCasePublicMirror, everifyCasePublicLinkageFromPrivate, stats);
  } else {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tref of tenants) {
      await processTenant(
        db,
        tref.id,
        args,
        upsertEverifyCasePublicMirror,
        everifyCasePublicLinkageFromPrivate,
        stats
      );
    }
  }

  console.log('\nSummary:', JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
