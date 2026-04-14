/**
 * Scoring distribution: compute percentiles of AI score (and components) per tenant
 * so the frontend can show relative scores (evolving bar). Written by a scheduled
 * job and optional callable; read by the client for getRelativeAiScore().
 *
 * COST / LOOP SAFETY:
 * - Scheduled job: runs once daily (3 AM ET); one users query per tenant (limit 15k)
 *   plus one write to tenants/{id}/scoringDistribution/current. No writes to users,
 *   so no trigger loops. Firestore read volume = sum over tenants of min(userCount, 15k).
 * - Callable: invoked only by authenticated users (e.g. admin). Rate-limited for
 *   "all tenants" to prevent accidental repeated runs. Single-tenant recompute is not rate limited.
 * - Frontend: useScoringDistribution does one getDoc per tenant on mount; no polling or loops.
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

/** Percentiles stored per metric (0–100). */
export interface Percentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** Stored at tenants/{tenantId}/scoringDistribution */
export interface ScoringDistributionDoc {
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  userCount: number;
  aiScore: Percentiles;
  completenessScore: Percentiles;
  responsivenessScore: Percentiles;
  qualityScore: Percentiles;
}

const MIN_USERS_FOR_DISTRIBUTION = 10;
const SECURITY_LEVELS = ['0', '1', '2', '3', '4'];

/** Rate limit "recompute all tenants" to once per 5 minutes per caller (by uid). */
const RECOMPUTE_ALL_COOLDOWN_MS = 5 * 60 * 1000;
const lastRecomputeAllByUid = new Map<string, number>();

function computePercentiles(sorted: number[]): Percentiles {
  const n = sorted.length;
  if (n === 0) {
    return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  }
  const at = (p: number) => {
    const i = (p / 100) * (n - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
  };
  return {
    p10: Math.round(at(10) * 10) / 10,
    p25: Math.round(at(25) * 10) / 10,
    p50: Math.round(at(50) * 10) / 10,
    p75: Math.round(at(75) * 10) / 10,
    p90: Math.round(at(90) * 10) / 10,
  };
}

function toNum(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute and write scoring distribution for one tenant.
 * Queries users where tenantIds.{tenantId}.securityLevel in ['0','1','2','3','4'],
 * collects scoreSummary fields, computes percentiles, writes to tenants/{tenantId}/scoringDistribution.
 */
export async function computeDistributionForTenant(tenantId: string): Promise<{
  userCount: number;
  usersWithScores: number;
  success: boolean;
  error?: string;
}> {
  const aiScores: number[] = [];
  const completenessScores: number[] = [];
  const responsivenessScores: number[] = [];
  const qualityScores: number[] = [];

  try {
    const usersSnap = await db
      .collection('users')
      .where(`tenantIds.${tenantId}.securityLevel`, 'in', SECURITY_LEVELS)
      .limit(15000)
      .get();

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const ss = data?.scoreSummary;
      if (!ss || typeof ss !== 'object') continue;

      const c = toNum(ss.completenessScore);
      const r = toNum(ss.responsivenessScore);
      const q = toNum(ss.qualityScore);
      const ai = toNum(ss.aiScore);

      if (c !== null) completenessScores.push(Math.max(0, Math.min(100, c)));
      if (r !== null) responsivenessScores.push(Math.max(0, Math.min(100, r)));
      if (q !== null) qualityScores.push(Math.max(0, Math.min(100, q)));
      if (ai !== null) aiScores.push(Math.max(0, Math.min(100, ai)));
    }

    const usersWithScores = aiScores.length;
    if (usersWithScores < MIN_USERS_FOR_DISTRIBUTION) {
      logger.info('scoringDistribution: skipping tenant (insufficient users with scores)', {
        tenantId,
        userCount: usersSnap.size,
        usersWithScores,
      });
      return { userCount: usersSnap.size, usersWithScores, success: true };
    }

    aiScores.sort((a, b) => a - b);
    completenessScores.sort((a, b) => a - b);
    responsivenessScores.sort((a, b) => a - b);
    qualityScores.sort((a, b) => a - b);

    const doc: Omit<ScoringDistributionDoc, 'updatedAt'> & {
      updatedAt: admin.firestore.FieldValue;
    } = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      userCount: usersSnap.size,
      aiScore: computePercentiles(aiScores),
      completenessScore: computePercentiles(completenessScores),
      responsivenessScore: computePercentiles(responsivenessScores),
      qualityScore: computePercentiles(qualityScores),
    };

    await db.doc(`tenants/${tenantId}/scoringDistribution/current`).set(doc, { merge: true });

    logger.info('scoringDistribution: updated', {
      tenantId,
      userCount: usersSnap.size,
      usersWithScores,
    });
    return { userCount: usersSnap.size, usersWithScores, success: true };
  } catch (err: any) {
    logger.error('scoringDistribution: compute failed', { tenantId, error: err.message });
    return {
      userCount: 0,
      usersWithScores: 0,
      success: false,
      error: err.message,
    };
  }
}

/**
 * Scheduled job: daily recompute of scoring distribution for all tenants.
 */
export const scheduledScoringDistribution = onSchedule(
  {
    schedule: '0 3 * * *', // 3 AM daily
    timeZone: 'America/New_York',
    maxInstances: 1,
    memory: '512MiB',
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();
    let ok = 0;
    let fail = 0;
    for (const t of tenantsSnap.docs) {
      const result = await computeDistributionForTenant(t.id);
      if (result.success) ok++;
      else fail++;
    }
    logger.info('scheduledScoringDistribution: done', { tenants: tenantsSnap.size, ok, fail });
  }
);

/**
 * Callable: recompute scoring distribution for one tenant (or all if not specified).
 * Caller must be authenticated; optional tenantId for admin to trigger one tenant.
 */
export const recomputeScoringDistribution = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const uid = request.auth.uid;
    const tenantId = request.data?.tenantId as string | undefined;
    if (tenantId) {
      const result = await computeDistributionForTenant(tenantId);
      return { success: result.success, tenantId, ...result };
    }
    const now = Date.now();
    const last = lastRecomputeAllByUid.get(uid);
    if (last != null && now - last < RECOMPUTE_ALL_COOLDOWN_MS) {
      throw new HttpsError(
        'resource-exhausted',
        'Recompute all tenants can only be run once per 5 minutes. Specify a tenantId to recompute a single tenant.'
      );
    }
    lastRecomputeAllByUid.set(uid, now);
    const tenantsSnap = await db.collection('tenants').get();
    const results: { tenantId: string; success: boolean; userCount?: number; usersWithScores?: number; error?: string }[] = [];
    for (const t of tenantsSnap.docs) {
      const result = await computeDistributionForTenant(t.id);
      results.push({
        tenantId: t.id,
        success: result.success,
        userCount: result.userCount,
        usersWithScores: result.usersWithScores,
        error: result.error,
      });
    }
    return { success: true, tenants: results };
  }
);
