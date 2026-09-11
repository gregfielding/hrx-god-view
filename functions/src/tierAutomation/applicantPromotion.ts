/**
 * User-based Tier 3 → 2 promotion for one worker, evaluated on demand (Greg
 * 2026-09-10: "promotes automatically on all users — this is not
 * account-specific, it is user-based"). tierPromotionSweep applies the rule
 * to every worker nightly; the hourly hiring sweeps (account ramp, job-order
 * hiring plan) call this for applicants in their pools so a qualifying
 * worker can be promoted and hired within the hour. Same scorer, threshold,
 * audit trail and proposal shape as the nightly automatic mode, and it only
 * acts when the tenant's mode is 'automatic' — in 'propose' mode promotions
 * stay a human decision.
 */
import * as admin from 'firebase-admin';

import {
  extractTierScoreSignals,
  normalizeTierAutomationConfig,
  scoreTierPromotion,
} from '../shared/workerTierScoring';

const ENGINE_ACTOR = { id: 'hrx-tier-engine', name: 'HRX Tier Engine' };

export type TierConfig = ReturnType<typeof normalizeTierAutomationConfig>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function resolveGlobalTier(data: Record<string, unknown>): number {
  const tiers = (data.workerTiers ?? {}) as Record<string, unknown>;
  const g = Number(tiers.global);
  return g === 1 || g === 2 ? g : 3;
}

/** A no-show penalty is repaid through earn-back hours, never by the scorecard. */
export function hasActiveTierPenalty(data: Record<string, unknown>): boolean {
  const tiers = (data.workerTiers ?? {}) as Record<string, unknown>;
  return Boolean(tiers.penalty);
}

async function hasAppPushToken(db: admin.firestore.Firestore, uid: string): Promise<boolean> {
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('pushTokens')
    .where('platform', 'in', ['iOS', 'Android', 'ios', 'android'])
    .limit(1)
    .get();
  return !snap.empty;
}

/** AccuSource completions for one candidate (the signals the nightly sweep maps tenant-wide). */
export async function screeningCompletionsFor(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
): Promise<{ bg: boolean; drug: boolean }> {
  const snap = await db
    .collection('backgroundChecks')
    .where('tenantId', '==', tenantId)
    .where('candidateId', '==', uid)
    .limit(25)
    .get();
  return screeningCompletionsFromOrders(snap.docs.map((d) => d.data() as Record<string, unknown>));
}

export function screeningCompletionsFromOrders(
  orders: Array<Record<string, unknown>>,
): { bg: boolean; drug: boolean } {
  let bg = false;
  let drug = false;
  for (const b of orders) {
    const hrxStatus = String(b.hrxStatus ?? '');
    if (b.finalReportReady === true || b.orderCompleted === true || hrxStatus === 'report_ready' || hrxStatus === 'completed') {
      bg = true;
    }
    if (b.drugReportReady === true || hrxStatus === 'drug_report_ready') drug = true;
  }
  return { bg, drug };
}

export async function promoteToTier2IfQualified(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    uid: string;
    userData: Record<string, unknown>;
    tierConfig: TierConfig;
    /** Where the evaluation came from, for the audit trail (e.g. "job order Warehouse Workers"). */
    contextLabel: string;
    /** Precomputed screening completions; fetched when omitted. */
    completions?: { bg: boolean; drug: boolean };
  },
): Promise<boolean> {
  const { tenantId, uid, userData, tierConfig, contextLabel } = args;
  if (tierConfig.mode !== 'automatic') return false;
  if (resolveGlobalTier(userData) !== 3 || hasActiveTierPenalty(userData)) return false;

  const proposalRef = db.doc(`tenants/${tenantId}/tier_promotion_proposals/${uid}`);
  const proposalSnap = await proposalRef.get();
  const proposalStatus = str((proposalSnap.data() ?? {}).status);
  // A human already ruled on this worker — never override.
  if (proposalStatus === 'dismissed' || proposalStatus === 'approved') return false;

  const now = new Date();
  const { bg, drug } = args.completions ?? (await screeningCompletionsFor(db, tenantId, uid));
  const baseOpts = { backgroundCheckCompleted: bg, drugScreenCompleted: drug };
  let card = scoreTierPromotion(
    extractTierScoreSignals(userData, { ...baseOpts, appInstalled: null }),
    tierConfig,
    now,
  );
  const appFactorActive = now.toISOString().slice(0, 10) >= tierConfig.appInstalledEffectiveFrom;
  if (appFactorActive && !card.qualifies && card.total + tierConfig.points.appInstalled >= tierConfig.threshold) {
    const installed = await hasAppPushToken(db, uid);
    card = scoreTierPromotion(
      extractTierScoreSignals(userData, { ...baseOpts, appInstalled: installed }),
      tierConfig,
      now,
    );
  }
  if (!card.qualifies) return false;

  const name =
    `${str(userData.firstName)} ${str(userData.lastName)}`.trim() || str(userData.displayName) || uid;
  const scorecard = {
    total: card.total,
    maxPossible: card.maxPossible,
    threshold: card.threshold,
    factors: card.factors.map((f) => ({ key: f.key, label: f.label, earned: f.earned, max: f.max, detail: f.detail })),
  };
  const batch = db.batch();
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
      reason: `Scorecard ${card.total}/${card.maxPossible}, threshold ${card.threshold} (evaluated for ${contextLabel})`,
    },
  });
  batch.set(db.collection(`users/${uid}/activityLogs`).doc(), {
    action: 'Tier Change',
    actionType: 'security_change',
    description: `Tier changed from Tier 3 to Tier 2 by ${ENGINE_ACTOR.name} (automatic threshold promotion, evaluated for ${contextLabel}) — scorecard ${card.total}/${card.maxPossible}, threshold ${card.threshold}`,
    severity: 'low',
    source: 'system',
    metadata: {
      targetType: 'workerTier',
      from: 3,
      to: 2,
      changeSource: 'auto_threshold',
      changedById: ENGINE_ACTOR.id,
      changedByName: ENGINE_ACTOR.name,
      evaluatedFor: contextLabel,
      scorecard,
    },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(
    proposalRef,
    {
      uid,
      name,
      status: 'auto_applied',
      scorecard,
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: proposalSnap.exists
        ? ((proposalSnap.data() ?? {}).createdAt ?? admin.firestore.FieldValue.serverTimestamp())
        : admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return true;
}
