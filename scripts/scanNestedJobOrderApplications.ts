#!/usr/bin/env node
/**
 * List nested legacy applications per job order for one tenant:
 * tenants/{tenantId}/job_orders/{jobOrderId}/applications
 *
 * Also reports tenant-level application counts per jobOrderId (same query shape as PR2 dry-run).
 *
 * Usage:
 *   npm run consolidation:scan-nested -- --tenantId=<TID> [options]
 *
 * Options:
 *   --onlyWithNested     only rows where nestedApplications > 0
 *   --top=10             limit output rows (after sort; default all)
 *   --sort=nestedDesc    nestedDesc | nestedAsc | jobOrderId (default nestedDesc)
 *   --output=path.json   write full JSON report
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

import { initAdmin } from './applicationConsolidationShared';

type Row = {
  jobOrderId: string;
  nestedApplications: number;
  tenantApplicationsForJobOrder: number;
};

function parseArgs(): {
  tenantId: string;
  onlyWithNested: boolean;
  top: number | null;
  sort: 'nestedDesc' | 'nestedAsc' | 'jobOrderId';
  outputPath: string | null;
} {
  const argv = process.argv.slice(2);
  let tenantId = '';
  let onlyWithNested = false;
  let top: number | null = null;
  let sort: 'nestedDesc' | 'nestedAsc' | 'jobOrderId' = 'nestedDesc';
  let outputPath: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim();
    if (a === '--onlyWithNested') onlyWithNested = true;
    if (a.startsWith('--top=')) {
      const n = parseInt(a.slice('--top='.length), 10);
      top = Number.isFinite(n) && n > 0 ? n : null;
    }
    if (a.startsWith('--sort=')) {
      const s = a.slice('--sort='.length).trim();
      if (s === 'nestedAsc' || s === 'jobOrderId') sort = s;
      else sort = 'nestedDesc';
    }
    if (a.startsWith('--output=')) outputPath = a.slice('--output='.length).trim() || null;
  }
  if (!tenantId) {
    console.error(
      'Usage: npm run consolidation:scan-nested -- --tenantId=<TID> [--onlyWithNested] [--top=N] [--sort=nestedDesc|nestedAsc|jobOrderId] [--output=path.json]',
    );
    process.exit(1);
  }
  return { tenantId, onlyWithNested, top, sort, outputPath };
}

async function countNestedApplications(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
): Promise<number> {
  const coll = db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .collection('applications');
  const snap = await coll.count().get();
  return snap.data().count;
}

async function main(): Promise<void> {
  const { tenantId, onlyWithNested, top, sort, outputPath } = parseArgs();
  initAdmin();
  const db = admin.firestore();

  const joSnap = await db.collection('tenants').doc(tenantId).collection('job_orders').get();
  const jobOrderIds = joSnap.docs.map((d) => d.id);

  const tenantAppsByJobOrder = new Map<string, number>();
  const tenantAppsSnap = await db.collection('tenants').doc(tenantId).collection('applications').get();
  for (const d of tenantAppsSnap.docs) {
    const jo = String((d.data() as { jobOrderId?: string })?.jobOrderId ?? '').trim();
    if (!jo) continue;
    tenantAppsByJobOrder.set(jo, (tenantAppsByJobOrder.get(jo) || 0) + 1);
  }

  const rows: Row[] = [];
  const BATCH = 40;
  for (let i = 0; i < jobOrderIds.length; i += BATCH) {
    const slice = jobOrderIds.slice(i, i + BATCH);
    const counts = await Promise.all(
      slice.map(async (jobOrderId) => ({
        jobOrderId,
        nestedApplications: await countNestedApplications(db, tenantId, jobOrderId),
      })),
    );
    for (const { jobOrderId, nestedApplications } of counts) {
      rows.push({
        jobOrderId,
        nestedApplications,
        tenantApplicationsForJobOrder: tenantAppsByJobOrder.get(jobOrderId) || 0,
      });
    }
  }

  let filtered = onlyWithNested ? rows.filter((r) => r.nestedApplications > 0) : [...rows];

  if (sort === 'nestedDesc') {
    filtered.sort((a, b) => b.nestedApplications - a.nestedApplications || a.jobOrderId.localeCompare(b.jobOrderId));
  } else if (sort === 'nestedAsc') {
    filtered.sort((a, b) => a.nestedApplications - b.nestedApplications || a.jobOrderId.localeCompare(b.jobOrderId));
  } else {
    filtered.sort((a, b) => a.jobOrderId.localeCompare(b.jobOrderId));
  }

  const withNested = rows.filter((r) => r.nestedApplications > 0);
  const topNested = [...withNested].sort((a, b) => b.nestedApplications - a.nestedApplications).slice(0, 3);

  const displayRows = top != null ? filtered.slice(0, top) : filtered;

  const report = {
    meta: {
      tenantId,
      scannedAtIso: new Date().toISOString(),
      jobOrdersScanned: jobOrderIds.length,
      tenantLevelApplicationsRead: tenantAppsSnap.size,
      jobOrdersWithNestedApplications: withNested.length,
      totalNestedApplicationDocs: withNested.reduce((s, r) => s + r.nestedApplications, 0),
    },
    suggestedPr2TestJobOrders: topNested.map((r) => r.jobOrderId),
    rows: displayRows,
  };

  const text = JSON.stringify(report, null, 2);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, text, 'utf8');
    console.error(`Wrote ${outputPath}`);
  }
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
