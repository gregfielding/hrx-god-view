/**
 * Transactional processor: idempotent append to category_score_events + update users.categoryScoresCurrent (v2).
 * Supports multi-category deltas in one event. Does not modify interview or application snapshots.
 */

import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { ApplyCategoryScoreEventInput, ApplyCategoryScoreEventResult } from './categoryScoreEventTypes';
import { clampDeltaForSource } from './deltaBounds';
import {
  confidenceIncrementForSource,
  interviewDeltaWeight,
  sourceWeightFor,
} from './categoryScoreRules';
import { diminishFactorForPositiveDelta, tallyKey } from './categoryScoreDiminishing';
import {
  PREENSCREEN_CATEGORY_IDS,
  parseCategoryScoresCurrent,
  parseInterviewCategoryBootstrapFromAi,
  migrateV1ToV2,
  prescreenCategoryScoresV1FromV2,
  type PrescreenCategoryId,
  type PrescreenCategoryScoresV2,
  type CategoryScoreEntryV2,
} from './prescreenCategoryScoresParse';

export const CATEGORY_SCORE_EVENTS_COLLECTION = 'category_score_events';
export const CATEGORY_SCORE_EVENT_KEYS_COLLECTION = 'category_score_event_keys';

/** Firestore field: per-source:category repeat counts for diminishing returns. */
export const CATEGORY_SCORE_EVENT_TALLIES_FIELD = 'categoryScoreEventTallies';

/** Prior interview applies (for dampening interview-sourced deltas only). Not incremented on idempotent replay. */
export const CATEGORY_SCORE_INTERVIEW_APPLY_COUNT_FIELD = 'categoryScoreInterviewApplyCount';

export function idempotencyKeyHash(uid: string, idempotencyKey: string): string {
  return createHash('sha256').update(`${uid}\n${idempotencyKey}`, 'utf8').digest('hex');
}

function assertCategory(id: string): asserts id is PrescreenCategoryId {
  if (!PREENSCREEN_CATEGORY_IDS.includes(id as PrescreenCategoryId)) {
    throw new HttpsError('invalid-argument', `Invalid category: ${id}`);
  }
}

function resolveCategoryDeltas(input: ApplyCategoryScoreEventInput): Partial<Record<PrescreenCategoryId, number>> {
  const raw = input.categoryDeltas;
  if (raw && typeof raw === 'object') {
    const out: Partial<Record<PrescreenCategoryId, number>> = {};
    for (const k of PREENSCREEN_CATEGORY_IDS) {
      const v = raw[k];
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) continue;
      out[k] = n;
    }
    if (Object.keys(out).length > 0) return out;
  }
  if (input.category && input.delta != null && input.delta !== 0) {
    assertCategory(input.category);
    return { [input.category]: input.delta };
  }
  return {};
}

function validateInput(input: ApplyCategoryScoreEventInput): void {
  if (!input.uid || typeof input.uid !== 'string') {
    throw new HttpsError('invalid-argument', 'uid is required');
  }
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
    throw new HttpsError('invalid-argument', 'idempotencyKey is required');
  }
  if (input.idempotencyKey.length > 512) {
    throw new HttpsError('invalid-argument', 'idempotencyKey too long (max 512)');
  }
  if (typeof input.source !== 'string') {
    throw new HttpsError('invalid-argument', 'source is required');
  }
  const deltas = resolveCategoryDeltas(input);
  if (Object.keys(deltas).length === 0) {
    throw new HttpsError('invalid-argument', 'categoryDeltas (or legacy category + delta) must include a non-zero delta');
  }
  const allowed = new Set([
    'interview',
    'background_check',
    'shift_completion',
    'no_show',
    'activity',
    'recruiter_override',
  ]);
  if (!allowed.has(input.source)) {
    throw new HttpsError('invalid-argument', `Unsupported source for this processor: ${input.source}`);
  }
  if (input.referenceId != null && typeof input.referenceId !== 'string') {
    throw new HttpsError('invalid-argument', 'referenceId must be a string when set');
  }
}

async function loadBootstrapScoresFromInterviews(
  tx: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  uid: string,
): Promise<ReturnType<typeof parseInterviewCategoryBootstrapFromAi>> {
  const base = db.collection('users').doc(uid).collection('interviews');
  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await tx.get(base.orderBy('createdAt', 'desc').limit(40));
  } catch (e) {
    logger.warn('categoryScoreEvolution.bootstrap.queryFallback', { uid, err: String(e) });
    snap = await tx.get(base.limit(80));
  }
  const docs = snap.docs.slice().sort((a, b) => {
    const ad = a.data() as { createdAt?: admin.firestore.Timestamp; timestamp?: admin.firestore.Timestamp };
    const bd = b.data() as { createdAt?: admin.firestore.Timestamp; timestamp?: admin.firestore.Timestamp };
    const at = ad.createdAt?.toMillis?.() ?? ad.timestamp?.toMillis?.() ?? 0;
    const bt = bd.createdAt?.toMillis?.() ?? bd.timestamp?.toMillis?.() ?? 0;
    return bt - at;
  });
  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.interviewKind !== 'worker_ai_prescreen') continue;
    const parsed = parseInterviewCategoryBootstrapFromAi(data.ai);
    if (parsed) return parsed;
  }
  return null;
}

function cloneV2(v: PrescreenCategoryScoresV2): PrescreenCategoryScoresV2 {
  const out: PrescreenCategoryScoresV2 = { version: 2 } as PrescreenCategoryScoresV2;
  for (const k of PREENSCREEN_CATEGORY_IDS) {
    const e = v[k];
    out[k] = {
      score: e.score,
      confidence: e.confidence,
      ...(e.updatedAt !== undefined ? { updatedAt: e.updatedAt } : {}),
    };
  }
  return out;
}

function readTallies(udata: Record<string, unknown> | undefined): Record<string, number> {
  const t = udata?.[CATEGORY_SCORE_EVENT_TALLIES_FIELD];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.min(5000, Math.floor(n));
  }
  return out;
}

/**
 * Appends one event and updates `categoryScoresCurrent` (bootstrap from latest worker_ai_prescreen if missing).
 */
export async function applyCategoryScoreEventInternal(
  db: admin.firestore.Firestore,
  input: ApplyCategoryScoreEventInput,
): Promise<ApplyCategoryScoreEventResult> {
  validateInput(input);
  const { uid, source, idempotencyKey, referenceId } = input;
  const deltasRequested = resolveCategoryDeltas(input);
  const keyHash = idempotencyKeyHash(uid, idempotencyKey);
  const userRef = db.collection('users').doc(uid);
  const idemRef = userRef.collection(CATEGORY_SCORE_EVENT_KEYS_COLLECTION).doc(keyHash);

  const requestedSumAbs = PREENSCREEN_CATEGORY_IDS.reduce((s, k) => s + Math.abs(deltasRequested[k] ?? 0), 0);
  const legacyPrimaryDelta = PREENSCREEN_CATEGORY_IDS.map((k) => deltasRequested[k] ?? 0).find((d) => d !== 0) ?? 0;

  return db.runTransaction(async (tx) => {
    const idemSnap = await tx.get(idemRef);
    const userSnap = await tx.get(userRef);

    if (!userSnap.exists) {
      throw new HttpsError('not-found', `User not found: ${uid}`);
    }

    if (idemSnap.exists) {
      const idem = idemSnap.data() as { eventId?: string };
      const eventId = typeof idem.eventId === 'string' ? idem.eventId : undefined;
      const udata = userSnap.data() as Record<string, unknown> | undefined;
      const currentV2 = parseCategoryScoresCurrent(udata?.categoryScoresCurrent);
      if (!currentV2) {
        throw new HttpsError(
          'failed-precondition',
          'Idempotent replay but user.categoryScoresCurrent is missing or invalid.',
        );
      }
      return {
        duplicate: true,
        eventId,
        categoryScoresCurrent: prescreenCategoryScoresV1FromV2(currentV2),
        categoryScoresCurrentV2: currentV2,
        requestedDelta: legacyPrimaryDelta,
        appliedDelta: 0,
        appliedTotalAbs: 0,
        deltaClamped: false,
        deltaClampedAny: false,
        bootstrappedFromInterview: false,
        categoryDeltasRequested: deltasRequested,
        categoryDeltasApplied: {},
      };
    }

    let bootstrappedFromInterview = false;
    let baseV2 = parseCategoryScoresCurrent(
      (userSnap.data() as Record<string, unknown> | undefined)?.categoryScoresCurrent,
    );
    if (!baseV2) {
      const boot = await loadBootstrapScoresFromInterviews(tx, db, uid);
      if (!boot) {
        throw new HttpsError(
          'failed-precondition',
          'No categoryScoresCurrent and no worker_ai_prescreen interview snapshot to bootstrap from.',
        );
      }
      baseV2 = migrateV1ToV2(boot.scores, boot.confidence);
      bootstrappedFromInterview = true;
    }

    const udataFull = userSnap.data() as Record<string, unknown> | undefined;
    const tallies = readTallies(udataFull);
    const rawIc = udataFull?.[CATEGORY_SCORE_INTERVIEW_APPLY_COUNT_FIELD];
    const priorInterviewApplyCount =
      typeof rawIc === 'number' && Number.isFinite(rawIc) ? Math.max(0, Math.floor(rawIc)) : 0;
    const interviewWeight = source === 'interview' ? interviewDeltaWeight(priorInterviewApplyCount) : 1;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const working = cloneV2(baseV2);
    const beforeSnap = cloneV2(baseV2);

    const appliedMap: Partial<Record<PrescreenCategoryId, number>> = {};
    let clampedAny = false;
    let appliedTotalAbs = 0;

    const sw = sourceWeightFor(source);

    for (const cat of PREENSCREEN_CATEGORY_IDS) {
      const rawReq = deltasRequested[cat];
      if (rawReq === undefined || rawReq === 0) continue;

      let workingDelta = rawReq * sw;
      if (source === 'interview') {
        workingDelta *= interviewWeight;
      }

      const priorT = tallies[tallyKey(source, cat)] ?? 0;
      if (workingDelta > 0) {
        workingDelta *= diminishFactorForPositiveDelta(priorT);
      }

      if (!Number.isFinite(workingDelta)) {
        workingDelta = 0;
      }

      const { appliedDelta, clamped } = clampDeltaForSource(workingDelta, source);
      if (clamped) clampedAny = true;

      const confBefore = working[cat].confidence;
      const prevScore = working[cat].score;
      const nextScore = Math.round(Math.max(0, Math.min(100, prevScore + appliedDelta)));
      const bump = confidenceIncrementForSource(source);
      const nextConf = Math.round(Math.max(0, Math.min(100, confBefore + bump)));

      const nextEntry: CategoryScoreEntryV2 = {
        score: Number.isFinite(nextScore) ? nextScore : prevScore,
        confidence: Number.isFinite(nextConf) ? nextConf : confBefore,
        updatedAt: now,
      };
      working[cat] = nextEntry;
      appliedMap[cat] = appliedDelta;
      appliedTotalAbs += Math.abs(appliedDelta);

      if (appliedDelta > 0) {
        const tk = tallyKey(source, cat);
        tallies[tk] = (tallies[tk] ?? 0) + 1;
      }
    }

    const eventRef = userRef.collection(CATEGORY_SCORE_EVENTS_COLLECTION).doc();

    const legacyCategory =
      PREENSCREEN_CATEGORY_IDS.find((k) => deltasRequested[k] != null && deltasRequested[k] !== 0) ?? null;

    const scoreAudit: Record<
      string,
      {
        requestedDelta: number;
        appliedDelta: number;
        sourceWeight: number;
        diminishFactor: number | null;
        interviewWeight?: number;
        previousScore: number;
        newScore: number;
        previousConfidence: number;
        newConfidence: number;
      }
    > = {};
    for (const cat of PREENSCREEN_CATEGORY_IDS) {
      if (appliedMap[cat] === undefined) continue;
      const rawReq = deltasRequested[cat] ?? 0;
      const postT = tallies[tallyKey(source, cat)] ?? 0;
      const applied = appliedMap[cat] ?? 0;
      const preApplyTally = applied > 0 ? Math.max(0, postT - 1) : postT;
      const dim = applied > 0 ? diminishFactorForPositiveDelta(preApplyTally) : null;
      const entry: (typeof scoreAudit)[string] = {
        requestedDelta: rawReq,
        appliedDelta: applied,
        sourceWeight: sw,
        diminishFactor: dim,
        previousScore: beforeSnap[cat].score,
        newScore: working[cat].score,
        previousConfidence: beforeSnap[cat].confidence,
        newConfidence: working[cat].confidence,
      };
      if (source === 'interview') {
        entry.interviewWeight = interviewWeight;
      }
      scoreAudit[cat] = entry;
    }

    tx.set(idemRef, {
      eventId: eventRef.id,
      idempotencyKeySha256: keyHash,
      createdAt: now,
      source,
      categoryDeltas: deltasRequested,
      appliedCategoryDeltas: appliedMap,
      category: legacyCategory,
      referenceId: referenceId ?? null,
    });

    const primaryApplied =
      PREENSCREEN_CATEGORY_IDS.map((k) => appliedMap[k] ?? 0).find((d) => d !== 0) ?? 0;

    tx.set(eventRef, {
      categoryDeltas: deltasRequested,
      appliedCategoryDeltas: appliedMap,
      category: PREENSCREEN_CATEGORY_IDS.find((k) => appliedMap[k] !== undefined && appliedMap[k] !== 0) ?? null,
      source,
      referenceId: referenceId ?? null,
      requestedDelta: legacyPrimaryDelta,
      /** Sum requested abs for quick audit */
      requestedTotalAbs: requestedSumAbs,
      appliedDelta: primaryApplied,
      appliedTotalAbs,
      delta: primaryApplied,
      deltaClamped: clampedAny,
      deltaClampedAny: clampedAny,
      idempotencyKeySha256: keyHash,
      bootstrappedFromInterview,
      createdAt: now,
      policyVersion: 'category_score_v2_2',
      sourceWeight: sw,
      ...(source === 'interview' ? { interviewWeight } : {}),
      scoreAudit,
    });

    tx.update(userRef, {
      categoryScoresCurrent: working,
      [CATEGORY_SCORE_EVENT_TALLIES_FIELD]: tallies,
      ...(source === 'interview'
        ? { [CATEGORY_SCORE_INTERVIEW_APPLY_COUNT_FIELD]: admin.firestore.FieldValue.increment(1) }
        : {}),
    });

    return {
      duplicate: false,
      eventId: eventRef.id,
      categoryScoresCurrent: prescreenCategoryScoresV1FromV2(working),
      categoryScoresCurrentV2: working,
      requestedDelta: legacyPrimaryDelta,
      appliedDelta: primaryApplied,
      appliedTotalAbs,
      deltaClamped: clampedAny,
      deltaClampedAny: clampedAny,
      bootstrappedFromInterview,
      categoryDeltasRequested: deltasRequested,
      categoryDeltasApplied: appliedMap,
    };
  });
}
