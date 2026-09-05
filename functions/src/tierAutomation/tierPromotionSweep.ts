/**
 * Nightly Tier 3 -> Tier 2 promotion sweep. NOT a Cloud Function of its own
 * (Cloud Run cap) — it rides scheduledScoringDistribution's tenant loop.
 *
 * Per tenant: reads tenants/{t}/settings/tierAutomation (missing or mode
 * 'off' => no-op, so unconfigured tenants cost one doc read), scans tenant
 * members, scores each Tier 3 worker with the shared scorer, and either
 * writes a proposal doc (mode 'propose') or applies the promotion directly
 * (mode 'automatic', audit-logged as the engine).
 *
 * COST / LOOP SAFETY: one users query (limit 15k) + one pending-proposals
 * query per CONFIGURED tenant nightly. Proposal writes go to
 * tenants/{t}/tier_promotion_proposals/{uid} — never to users in propose
 * mode, so no user-trigger loops. Automatic mode writes users docs at most
 * once per worker per promotion (tier flips to 2, so re-runs skip them).
 * Human decisions are respected: dismissed/approved proposals are never
 * re-proposed; a pending proposal for a worker no longer Tier 3 is marked
 * superseded.
 *
 * The appInstalled signal (pushTokens subcollection, ios/android only) is
 * checked lazily: only after the factor's effective date, and only for
 * workers whose score without it lands within reach of the threshold.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  TierScorecard,
  extractTierScoreSignals,
  normalizeTierAutomationConfig,
  scoreTierPromotion,
} from '../shared/workerTierScoring';

const ENGINE_ACTOR = { id: 'hrx-tier-engine', name: 'HRX Tier Engine' };

export interface TierSweepResult {
  configured: boolean;
  mode?: string;
  evaluated: number;
  proposed: number;
  refreshed: number;
  autoApplied: number;
  superseded: number;
  /** Penalized workers whose 40 clean hours restored their original tier. */
  earnBackRestored: number;
  success: boolean;
  error?: string;
}

function resolveGlobalTier(data: Record<string, unknown>): number {
  const tiers = (data.workerTiers ?? {}) as Record<string, unknown>;
  const g = Number(tiers.global);
  return g === 1 || g === 2 ? g : 3;
}

async function hasAppPushToken(db: admin.firestore.Firestore, uid: string): Promise<boolean> {
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('pushTokens')
    .where('platform', 'in', ['ios', 'android'])
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Clean hours since the demotion date. `workDate` is a 'YYYY-MM-DD' string
 * (worksite-local), so the range is a lexicographic compare; the composite
 * index (workerId, workDate) already exists. `totalFlsaOTHours`/`totalNonFlsa*`
 * are subdivisions of totalOTHours — never add them (double-count).
 */
async function sumTimesheetHoursSince(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
  sinceDate: string,
): Promise<number> {
  const snap = await db
    .collection(`tenants/${tenantId}/timesheet_entries`)
    .where('workerId', '==', uid)
    .where('workDate', '>=', sinceDate)
    .get();
  let hours = 0;
  for (const d of snap.docs) {
    const t = d.data() as Record<string, unknown>;
    hours +=
      (Number(t.totalRegularHours) || 0) +
      (Number(t.totalOTHours) || 0) +
      (Number(t.totalDoubleTimeHours) || 0);
  }
  return hours;
}

function scorecardForStorage(card: TierScorecard): Record<string, unknown> {
  return {
    total: card.total,
    maxPossible: card.maxPossible,
    threshold: card.threshold,
    factors: card.factors.map((f) => ({
      key: f.key,
      label: f.label,
      earned: f.earned,
      max: f.max,
      detail: f.detail,
    })),
  };
}

export async function runTierPromotionSweepForTenant(
  db: admin.firestore.Firestore,
  tenantId: string,
): Promise<TierSweepResult> {
  const result: TierSweepResult = {
    configured: false,
    evaluated: 0,
    proposed: 0,
    refreshed: 0,
    autoApplied: 0,
    superseded: 0,
    earnBackRestored: 0,
    success: true,
  };
  try {
    const settingsSnap = await db.doc(`tenants/${tenantId}/settings/tierAutomation`).get();
    if (!settingsSnap.exists) return result;
    const config = normalizeTierAutomationConfig(settingsSnap.data());
    if (config.mode === 'off') return result;
    result.configured = true;
    result.mode = config.mode;

    const proposalsCol = db.collection(`tenants/${tenantId}/tier_promotion_proposals`);
    const existingSnap = await proposalsCol.get();
    const existingByUid = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

    // AccuSource screening completions by candidate uid — the real screening
    // pipeline (user-doc order arrays are the near-empty legacy path). One
    // query per configured tenant. Verdict lines live in the vendor payload;
    // COMPLETION is the scored signal (Greg 2026-09-04), clearance stays a
    // hiring-gate concern.
    const bgCompletedUids = new Set<string>();
    const drugCompletedUids = new Set<string>();
    const bgcSnap = await db
      .collection('backgroundChecks')
      .where('tenantId', '==', tenantId)
      .get();
    for (const d of bgcSnap.docs) {
      const b = d.data() as Record<string, unknown>;
      const uid = String(b.candidateId ?? '');
      if (!uid) continue;
      const hrxStatus = String(b.hrxStatus ?? '');
      if (b.finalReportReady === true || b.orderCompleted === true || hrxStatus === 'report_ready' || hrxStatus === 'completed') {
        bgCompletedUids.add(uid);
      }
      if (b.drugReportReady === true || hrxStatus === 'drug_report_ready') {
        drugCompletedUids.add(uid);
      }
    }

    const usersSnap = await db
      .collection('users')
      .where(`tenantIds.${tenantId}.securityLevel`, 'in', ['0', '1', '2', '3', '4'])
      .limit(15000)
      .get();

    const now = new Date();
    const appFactorActive = now.toISOString().slice(0, 10) >= config.appInstalledEffectiveFrom;

    let batch = db.batch();
    let batchSize = 0;
    const commitIfFull = async () => {
      if (batchSize >= 400) {
        await batch.commit();
        batch = db.batch();
        batchSize = 0;
      }
    };

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data() as Record<string, unknown>;
      const uid = userDoc.id;
      const tier = resolveGlobalTier(data);
      const existing = existingByUid.get(uid);

      // Earn-back (forward-only, so nightly is safe despite timesheet entry
      // lag — a late-keyed week merely delays the restore, never falsely
      // demotes): 40 clean hours since the penalty restore the original tier.
      const penalty = ((data.workerTiers ?? {}) as Record<string, unknown>).penalty as
        | Record<string, unknown>
        | undefined;
      if (penalty) {
        const demotedAtTs = penalty.demotedAt as admin.firestore.Timestamp | undefined;
        const demotedAt = typeof demotedAtTs?.toDate === 'function' ? demotedAtTs.toDate() : null;
        const restoreTo = Number(penalty.restoreTo);
        const hoursRequired = Number(penalty.hoursRequired) || 40;
        if (demotedAt && (restoreTo === 1 || restoreTo === 2)) {
          const hours = await sumTimesheetHoursSince(
            db,
            tenantId,
            uid,
            demotedAt.toISOString().slice(0, 10),
          );
          if (hours >= hoursRequired) {
            batch.update(db.doc(`users/${uid}`), {
              'workerTiers.global': restoreTo,
              'workerTiers.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
              'workerTiers.lastChange': {
                from: tier,
                to: restoreTo,
                at: admin.firestore.Timestamp.now(),
                byId: ENGINE_ACTOR.id,
                byName: ENGINE_ACTOR.name,
                source: 'earn_back',
                reason: `${Math.round(hours)} clean hours since the no-show penalty (required ${hoursRequired})`,
              },
              'workerTiers.penalty': admin.firestore.FieldValue.delete(),
            });
            batch.set(db.collection(`users/${uid}/activityLogs`).doc(), {
              action: 'Tier Change',
              actionType: 'security_change',
              description: `Tier restored to Tier ${restoreTo} by ${ENGINE_ACTOR.name} — ${Math.round(hours)} clean hours worked since the no-show penalty (40 required)`,
              severity: 'low',
              source: 'system',
              metadata: {
                targetType: 'workerTier',
                from: tier,
                to: restoreTo,
                changeSource: 'earn_back',
                changedById: ENGINE_ACTOR.id,
                changedByName: ENGINE_ACTOR.name,
                hoursWorked: Math.round(hours),
              },
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            batchSize += 2;
            result.earnBackRestored++;
            await commitIfFull();
            continue; // restored this run — promotion logic can wait a night
          }
        }
      }

      if (tier !== 3) {
        // Promoted some other way — retire any still-pending proposal.
        if (existing && existing.status === 'pending') {
          batch.update(proposalsCol.doc(uid), {
            status: 'superseded',
            supersededAt: admin.firestore.FieldValue.serverTimestamp(),
            supersededReason: `worker is Tier ${tier}`,
          });
          batchSize++;
          result.superseded++;
          await commitIfFull();
        }
        continue;
      }

      // A human already ruled on this worker — respect it.
      if (existing && (existing.status === 'dismissed' || existing.status === 'approved')) continue;

      result.evaluated++;

      const baseOpts = {
        backgroundCheckCompleted: bgCompletedUids.has(uid),
        drugScreenCompleted: drugCompletedUids.has(uid),
      };
      let card = scoreTierPromotion(
        extractTierScoreSignals(data, { ...baseOpts, appInstalled: null }),
        config,
        now,
      );
      // Lazy app-token check: only when the factor is live AND it could flip
      // the outcome (score within [threshold - points, threshold)).
      if (
        appFactorActive &&
        !card.qualifies &&
        card.total + config.points.appInstalled >= config.threshold
      ) {
        const installed = await hasAppPushToken(db, uid);
        card = scoreTierPromotion(
          extractTierScoreSignals(data, { ...baseOpts, appInstalled: installed }),
          config,
          now,
        );
      }
      if (!card.qualifies) continue;

      const name =
        `${String(data.firstName ?? '').trim()} ${String(data.lastName ?? '').trim()}`.trim() ||
        String(data.displayName ?? '').trim() ||
        uid;

      if (config.mode === 'automatic') {
        // Promotion + audit, same shape as the web writer (setWorkerTierGlobal).
        batch.update(db.doc(`users/${uid}`), {
          'workerTiers.global': 2,
          'workerTiers.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
          'workerTiers.lastChange': {
            from: 3,
            to: 2,
            at: admin.firestore.Timestamp.now(),
            byId: ENGINE_ACTOR.id,
            byName: ENGINE_ACTOR.name,
            source: 'auto_threshold',
            reason: `Scorecard ${card.total}/${card.maxPossible}, threshold ${card.threshold}`,
          },
        });
        batch.set(db.collection(`users/${uid}/activityLogs`).doc(), {
          action: 'Tier Change',
          actionType: 'security_change',
          description: `Tier changed from Tier 3 to Tier 2 by ${ENGINE_ACTOR.name} (automatic threshold promotion) — scorecard ${card.total}/${card.maxPossible}, threshold ${card.threshold}`,
          severity: 'low',
          source: 'system',
          metadata: {
            targetType: 'workerTier',
            from: 3,
            to: 2,
            changeSource: 'auto_threshold',
            changedById: ENGINE_ACTOR.id,
            changedByName: ENGINE_ACTOR.name,
            scorecard: scorecardForStorage(card),
          },
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batch.set(
          proposalsCol.doc(uid),
          {
            uid,
            name,
            status: 'auto_applied',
            scorecard: scorecardForStorage(card),
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: existing ? (existing.createdAt ?? admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        batchSize += 3;
        result.autoApplied++;
      } else {
        batch.set(
          proposalsCol.doc(uid),
          {
            uid,
            name,
            status: 'pending',
            scorecard: scorecardForStorage(card),
            lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: existing ? (existing.createdAt ?? admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        batchSize++;
        if (existing) result.refreshed++;
        else result.proposed++;
      }
      await commitIfFull();
    }

    if (batchSize > 0) await batch.commit();

    logger.info('tierPromotionSweep: done', { tenantId, ...result });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('tierPromotionSweep: failed', { tenantId, error: message });
    return { ...result, success: false, error: message };
  }
}
