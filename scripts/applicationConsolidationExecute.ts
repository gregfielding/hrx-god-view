#!/usr/bin/env node
/**
 * Sprint 4 PR2: script-driven consolidation (review enqueue + strong-key auto-merge + soft-retire).
 *
 * Default: plan only (no Firestore writes). Pass --execute to apply.
 *
 * Usage:
 *   npm run consolidation:execute -- --tenantId=<TID> --jobOrderId=<JOID> [options]
 *
 * Options:
 *   --maxPairs=500
 *   --allowEmailFallbackMerge   also execute email_jobOrderId auto-merges (default: strong key only)
 *   --execute                   perform writes (otherwise JSON plan to stdout)
 *   --batchId=<id>              idempotency / audit (default: random UUID when --execute)
 *
 * Writes:
 *   - tenants/{tenantId}/application_consolidation_review/{clusterId}  (requires_review; merge set)
 *   - Loser application docs: mergedIntoApplicationId, consolidationRetiredAt, consolidationRetiredReason, consolidationBatchId
 *
 * Does not: hard-delete, change loser status (unless you add that later), retire triggers, read-path cleanup.
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';

import {
  classifyPairMerge,
  type ConsolidationClassification,
} from '../src/utils/applicationConsolidationPolicy';
import {
  fingerprintForConsolidationDoc,
  makeConsolidationClusterId,
} from '../src/utils/applicationConsolidationClusterId';
import {
  APPLICATION_CONSOLIDATION_REVIEW_COLLECTION,
  type ApplicationConsolidationReviewDoc,
} from '../src/types/applicationConsolidationReview';
import { APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS } from '../src/types/applicationConsolidationApplicationFields';
import {
  candidateSummary,
  initAdmin,
  loadApplicationsForJobOrder,
  nestedApplicationRef,
  tenantApplicationRef,
  toIdentity,
} from './applicationConsolidationShared';

const RETIRE_REASON_STRONG = 'duplicate_application_consolidation_userId_jobOrderId';
const RETIRE_REASON_EMAIL = 'duplicate_application_consolidation_email_jobOrderId';

function parseArgs(): {
  tenantId: string;
  jobOrderId: string;
  maxPairs: number;
  allowEmailFallbackMerge: boolean;
  execute: boolean;
  batchId: string | null;
} {
  const argv = process.argv.slice(2);
  let tenantId = '';
  let jobOrderId = '';
  let maxPairs = 500;
  let allowEmailFallbackMerge = false;
  let execute = false;
  let batchId: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--tenantId=')) tenantId = a.slice('--tenantId='.length).trim();
    if (a.startsWith('--jobOrderId=')) jobOrderId = a.slice('--jobOrderId='.length).trim();
    if (a.startsWith('--maxPairs=')) maxPairs = Math.max(1, parseInt(a.slice('--maxPairs='.length), 10) || 500);
    if (a === '--allowEmailFallbackMerge') allowEmailFallbackMerge = true;
    if (a === '--execute') execute = true;
    if (a.startsWith('--batchId=')) batchId = a.slice('--batchId='.length).trim() || null;
  }
  if (!tenantId || !jobOrderId) {
    console.error(
      'Usage: npm run consolidation:execute -- --tenantId=<TID> --jobOrderId=<JOID> [--execute] [options]',
    );
    process.exit(1);
  }
  return { tenantId, jobOrderId, maxPairs, allowEmailFallbackMerge, execute, batchId };
}

function clusterIdForPair(
  tenantId: string,
  jobOrderId: string,
  nestedDocId: string,
  tenantDocId: string,
): string {
  return makeConsolidationClusterId(tenantId, jobOrderId, [
    fingerprintForConsolidationDoc('nested', nestedDocId),
    fingerprintForConsolidationDoc('tenant', tenantDocId),
  ]);
}

function shouldExecuteAutoMerge(
  c: ConsolidationClassification,
  allowEmailFallbackMerge: boolean,
): c is Extract<ConsolidationClassification, { outcome: 'auto_merge' }> {
  if (c.outcome !== 'auto_merge') return false;
  if (c.basis === 'userId_jobOrderId') return true;
  if (allowEmailFallbackMerge && c.basis === 'email_jobOrderId') return true;
  return false;
}

function retireReasonForBasis(basis: 'userId_jobOrderId' | 'email_jobOrderId'): string {
  return basis === 'userId_jobOrderId' ? RETIRE_REASON_STRONG : RETIRE_REASON_EMAIL;
}

function applicationRefForDocId(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
  docId: string,
  storage: 'tenant' | 'nested',
): admin.firestore.DocumentReference {
  return storage === 'tenant'
    ? tenantApplicationRef(db, tenantId, docId)
    : nestedApplicationRef(db, tenantId, jobOrderId, docId);
}

async function main(): Promise<void> {
  const { tenantId, jobOrderId, maxPairs, allowEmailFallbackMerge, execute, batchId: batchIdArg } =
    parseArgs();
  const batchId = execute ? batchIdArg || randomUUID() : batchIdArg || 'plan-only';

  initAdmin();
  const db = admin.firestore();
  const { tenantDocs, nestedDocs } = await loadApplicationsForJobOrder(db, tenantId, jobOrderId);

  type PlannedReview = {
    clusterId: string;
    reviewPath: string;
    doc: ApplicationConsolidationReviewDoc;
  };
  type PlannedRetirement = {
    clusterId: string;
    loserPath: string;
    loserStorage: 'tenant' | 'nested';
    loserDocId: string;
    winnerApplicationId: string;
    basis: 'userId_jobOrderId' | 'email_jobOrderId';
  };

  const plannedReviews: PlannedReview[] = [];
  const plannedRetirements: PlannedRetirement[] = [];
  const skippedRetirements: Array<{ clusterId: string; reason: string; loserPath: string }> = [];

  let pairs = 0;
  for (const n of nestedDocs) {
    for (const t of tenantDocs) {
      if (n.id === t.id) continue;
      if (pairs >= maxPairs) break;
      pairs++;

      const idNested = toIdentity(n.id, n.data(), 'nested');
      const idTenant = toIdentity(t.id, t.data(), 'tenant');
      const classification = classifyPairMerge(jobOrderId, idNested, idTenant, {
        allowEmailFallbackMerge,
      });
      const clusterId = clusterIdForPair(tenantId, jobOrderId, n.id, t.id);
      const reviewPath = `tenants/${tenantId}/${APPLICATION_CONSOLIDATION_REVIEW_COLLECTION}/${clusterId}`;

      const candidates = [
        candidateSummary(n.id, n.data(), 'nested'),
        candidateSummary(t.id, t.data(), 'tenant'),
      ];

      if (classification.outcome === 'requires_review') {
        const reviewDoc: ApplicationConsolidationReviewDoc = {
          tenantId,
          jobOrderId,
          clusterId,
          candidateDocIds: [n.id, t.id].sort(),
          candidates,
          suggestedWinnerId: classification.suggestedWinnerId,
          suggestedLoserIds: classification.suggestedLoserIds,
          matchBasis: classification.matchBasis,
          reason: classification.reason,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          dryRunBatchId: execute ? null : batchId,
        };
        plannedReviews.push({ clusterId, reviewPath, doc: reviewDoc });
      }

      if (shouldExecuteAutoMerge(classification, allowEmailFallbackMerge)) {
        const winnerId = classification.suggestedWinnerId;
        for (const loserId of classification.suggestedLoserIds) {
          const loserStorage: 'tenant' | 'nested' = loserId === n.id ? 'nested' : 'tenant';
          const loserPath = applicationRefForDocId(db, tenantId, jobOrderId, loserId, loserStorage).path;
          plannedRetirements.push({
            clusterId,
            loserPath,
            loserStorage,
            loserDocId: loserId,
            winnerApplicationId: winnerId,
            basis: classification.basis,
          });
        }
      }
    }
    if (pairs >= maxPairs) break;
  }

  if (!execute) {
    const plan = {
      meta: {
        dryRun: true,
        tenantId,
        jobOrderId,
        batchId,
        generatedAtIso: new Date().toISOString(),
        allowEmailFallbackMerge,
        maxPairsCap: maxPairs,
        pairsEvaluated: pairs,
        counts: {
          nestedApplications: nestedDocs.length,
          tenantApplicationsForJobOrder: tenantDocs.length,
        },
      },
      plannedReviewWrites: plannedReviews.length,
      plannedRetirementWrites: plannedRetirements.length,
      plannedReviews,
      plannedRetirements,
      note: 'No writes performed. Re-run with --execute to apply.',
    };
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.error(`Execute batchId=${batchId}`);

  const FieldValue = admin.firestore.FieldValue;
  const MAX_BATCH = 450;

  const reviewSnaps = await Promise.all(plannedReviews.map((pr) => db.doc(pr.reviewPath).get()));

  // Pre-read losers for idempotency
  const retirementOps: Array<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown> }> =
    [];
  for (const r of plannedRetirements) {
    const ref = applicationRefForDocId(db, tenantId, jobOrderId, r.loserDocId, r.loserStorage);
    const snap = await ref.get();
    if (!snap.exists) {
      skippedRetirements.push({ clusterId: r.clusterId, reason: 'missing_doc', loserPath: ref.path });
      continue;
    }
    const data = snap.data() || {};
    if (data[APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS.consolidationRetiredAt] != null) {
      const existingWinner = data[APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS.mergedIntoApplicationId];
      if (existingWinner === r.winnerApplicationId) {
        skippedRetirements.push({
          clusterId: r.clusterId,
          reason: 'already_retired_same_winner',
          loserPath: ref.path,
        });
        continue;
      }
      skippedRetirements.push({
        clusterId: r.clusterId,
        reason: 'already_retired_different_winner',
        loserPath: ref.path,
      });
      continue;
    }
    retirementOps.push({
      ref,
      data: {
        [APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS.mergedIntoApplicationId]: r.winnerApplicationId,
        [APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS.consolidationRetiredAt]: FieldValue.serverTimestamp(),
        [APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS.consolidationRetiredReason]: retireReasonForBasis(
          r.basis,
        ),
        [APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS.consolidationBatchId]: batchId,
      },
    });
  }

  let chunk: admin.firestore.WriteBatch = db.batch();
  let n = 0;
  let reviewWritesApplied = 0;
  let reviewDocsCreated = 0;
  let reviewDocsUpdated = 0;
  const commitChunk = async () => {
    if (n === 0) return;
    await chunk.commit();
    chunk = db.batch();
    n = 0;
  };

  for (let i = 0; i < plannedReviews.length; i++) {
    const pr = plannedReviews[i];
    const ref = db.doc(pr.reviewPath);
    const snap = reviewSnaps[i];
    const { createdAt: _planCreated, updatedAt: _planUpdated, ...rest } = pr.doc;
    void _planCreated;
    void _planUpdated;

    if (snap.exists) {
      const st = String((snap.data() as { status?: string })?.status ?? '');
      if (st && st !== 'pending') {
        continue;
      }
      chunk.set(
        ref,
        {
          ...rest,
          updatedAt: FieldValue.serverTimestamp(),
          dryRunBatchId: null,
        },
        { merge: true },
      );
      reviewDocsUpdated++;
    } else {
      chunk.set(ref, {
        ...rest,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        dryRunBatchId: null,
      });
      reviewDocsCreated++;
    }
    reviewWritesApplied++;
    n++;
    if (n >= MAX_BATCH) await commitChunk();
  }
  await commitChunk();

  for (const ro of retirementOps) {
    chunk.update(ro.ref, ro.data);
    n++;
    if (n >= MAX_BATCH) await commitChunk();
  }

  await commitChunk();

  // PR2 does not write winner/survivor application docs — only losers + review queue.
  const summary = {
    meta: {
      dryRun: false,
      tenantId,
      jobOrderId,
      batchId,
      completedAtIso: new Date().toISOString(),
    },
    winnerApplicationDocsUpdated: 0,
    reviewQueue: {
      writesApplied: reviewWritesApplied,
      docsCreated: reviewDocsCreated,
      docsUpdatedPending: reviewDocsUpdated,
    },
    loserRetirements: {
      writesApplied: retirementOps.length,
      skipped: skippedRetirements,
    },
    reviewWrites: reviewWritesApplied,
    retirementWrites: retirementOps.length,
    skippedRetirements,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
