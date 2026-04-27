#!/usr/bin/env node
/**
 * Sprint 4 PR1/PR2: read-only consolidation dry-run (no Firestore writes).
 *
 * Compares legacy nested job-order applications vs tenant applications for one job order,
 * evaluates classifyPairMerge for nested×tenant pairs (capped), prints JSON report.
 *
 * Usage:
 *   npm run consolidation:dry-run -- --tenantId=<TID> --jobOrderId=<JOID> [--maxPairs=500] [--allowEmailFallbackMerge]
 *
 * Requires Firebase Admin (service account, firebase-adminsdk.json, or application default).
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

import {
  classifyPairMerge,
  type ConsolidationClassification,
} from '../src/utils/applicationConsolidationPolicy';
import {
  fingerprintForConsolidationDoc,
  makeConsolidationClusterId,
} from '../src/utils/applicationConsolidationClusterId';
import {
  candidateSummary,
  initAdmin,
  loadApplicationsForJobOrder,
  toIdentity,
} from './applicationConsolidationShared';

function parseArgs(): {
  tenantId: string;
  jobOrderId: string;
  maxPairs: number;
  allowEmailFallbackMerge: boolean;
  outputPath: string | null;
} {
  const argv = process.argv.slice(2);
  let tenantId = '';
  let jobOrderId = '';
  let maxPairs = 500;
  let allowEmailFallbackMerge = false;
  let outputPath: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim();
    if (a.startsWith('--jobOrderId=')) jobOrderId = a.slice('--jobOrderId='.length).trim();
    if (a.startsWith('--maxPairs=')) maxPairs = Math.max(1, parseInt(a.slice('--maxPairs='.length), 10) || 500);
    if (a === '--allowEmailFallbackMerge') allowEmailFallbackMerge = true;
    if (a.startsWith('--output=')) outputPath = a.slice('--output='.length).trim() || null;
  }
  if (!tenantId || !jobOrderId) {
    console.error('Usage: npm run consolidation:dry-run -- --tenantId=<TID> --jobOrderId=<JOID> [options]');
    process.exit(1);
  }
  return { tenantId, jobOrderId, maxPairs, allowEmailFallbackMerge, outputPath };
}

async function main(): Promise<void> {
  const { tenantId, jobOrderId, maxPairs, allowEmailFallbackMerge, outputPath } = parseArgs();
  initAdmin();
  const db = admin.firestore();

  const { tenantDocs, nestedDocs } = await loadApplicationsForJobOrder(db, tenantId, jobOrderId);

  const pairEvaluations: Array<{
    clusterId: string;
    nestedDocId: string;
    tenantDocId: string;
    classification: ConsolidationClassification;
    candidates: ReturnType<typeof candidateSummary>[];
  }> = [];

  let pairs = 0;
  for (const n of nestedDocs) {
    for (const t of tenantDocs) {
      if (n.id === t.id) continue;
      if (pairs >= maxPairs) break;
      pairs++;
      const idA = toIdentity(n.id, n.data(), 'nested');
      const idB = toIdentity(t.id, t.data(), 'tenant');
      const classification = classifyPairMerge(jobOrderId, idA, idB, { allowEmailFallbackMerge });
      const clusterId = makeConsolidationClusterId(tenantId, jobOrderId, [
        fingerprintForConsolidationDoc('nested', n.id),
        fingerprintForConsolidationDoc('tenant', t.id),
      ]);
      pairEvaluations.push({
        clusterId,
        nestedDocId: n.id,
        tenantDocId: t.id,
        classification,
        candidates: [
          candidateSummary(n.id, n.data(), 'nested'),
          candidateSummary(t.id, t.data(), 'tenant'),
        ],
      });
    }
    if (pairs >= maxPairs) break;
  }

  let autoMerge = 0;
  let requiresReview = 0;
  for (const p of pairEvaluations) {
    if (p.classification.outcome === 'auto_merge') autoMerge++;
    else requiresReview++;
  }

  const report = {
    meta: {
      dryRun: true,
      tenantId,
      jobOrderId,
      generatedAtIso: new Date().toISOString(),
      allowEmailFallbackMerge,
      maxPairsCap: maxPairs,
      pairsEvaluated: pairEvaluations.length,
    },
    counts: {
      nestedApplications: nestedDocs.length,
      tenantApplicationsForJobOrder: tenantDocs.length,
    },
    summary: {
      autoMergePairClassifications: autoMerge,
      requiresReviewPairClassifications: requiresReview,
    },
    pairEvaluations,
    proposedReviewQueuePath: `tenants/${tenantId}/application_consolidation_review/{clusterId}`,
    note:
      'PR2: review doc id is clusterId (deterministic). Run consolidation:execute --execute to enqueue reviews and apply strong-key merges.',
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
