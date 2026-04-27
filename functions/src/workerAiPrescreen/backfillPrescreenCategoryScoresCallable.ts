/**
 * Admin callable: backfill `interview.ai.categoryScores` + `categoryConfidence` (+ evidence) for historical
 * `worker_ai_prescreen` interviews using current `scoreWorkerAiPrescreen` + `computePrescreenCategoryScores` logic.
 *
 * Future: after large backfills, consider a separate job to bootstrap `users.{uid}.categoryScoresCurrent` for
 * users still missing it (see category score evolution / `applyCategoryScoreEventCore`).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
import { extractPrescreenAnswersFromInterviewDoc } from './extractPrescreenAnswersFromInterviewDoc';
import { mergeDynamicDrugBackgroundIntoCoreAnswers } from './prescreenAnswerMerge';
import { evaluatePrescreenAnswerQuality } from './prescreenTextAnswerQuality';
import { scoreWorkerAiPrescreen } from './scoreWorkerAiPrescreen';
import { computePrescreenCategoryScores } from './prescreenCategoryScores';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const WORKER_AI_PRESCREEN = 'worker_ai_prescreen';
const GLOBAL_USER_PAGE_SIZE = 300;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function tenantFromInterviewData(data: Record<string, unknown>): string | null {
  const ai = data.ai as Record<string, unknown> | undefined;
  const ctx = ai?.aiInterviewContext as Record<string, unknown> | undefined;
  const br = ctx?.businessRules as Record<string, unknown> | undefined;
  const t = br?.tenant;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

function shouldSyncApplicationAiAutomation(args: { sourceInterviewIdOnApp: string; interviewDocId: string }): boolean {
  const src = String(args.sourceInterviewIdOnApp ?? '').trim();
  if (src === '') return true;
  return src === args.interviewDocId;
}

function hasV1CategoryScores(ai: unknown): boolean {
  const o = ai as Record<string, unknown> | undefined;
  const cs = o?.categoryScores as Record<string, unknown> | undefined;
  return !!(
    cs &&
    typeof cs === 'object' &&
    cs.version === 1 &&
    typeof cs.reliability === 'number' &&
    typeof cs.punctuality === 'number'
  );
}

function assertBackfillAuth(
  auth: { uid: string; token?: Record<string, unknown> } | undefined,
  tenantId: string | null,
): void {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (tenantId) {
    return;
  }
  if (auth.token?.hrx === true || auth.token?.isHRX === true) {
    return;
  }
  throw new HttpsError('permission-denied', 'Cross-tenant backfill requires HRX staff (hrx claim)');
}

export type BackfillPrescreenCategoryScoresResult = {
  scanned: number;
  updated: number;
  skippedAlreadyHadCategories: number;
  skippedNoAnswers: number;
  skippedWrongKind: number;
  skippedTenantFilter: number;
  applicationsUpdated: number;
  applicationsSyncSkipped: number;
  usersPagesScanned: number;
  usersDocsVisited: number;
  limit: number;
  tenantId: string | null;
  force: boolean;
};

async function collectPrescreenInterviewRefsGlobal(args: {
  limit: number;
  tenantId: string | null;
}): Promise<{ refs: FirebaseFirestore.DocumentReference[]; usersPagesScanned: number; usersDocsVisited: number }> {
  const refs: FirebaseFirestore.DocumentReference[] = [];
  let usersPagesScanned = 0;
  let usersDocsVisited = 0;
  let lastUser: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (refs.length < args.limit) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(GLOBAL_USER_PAGE_SIZE);
    if (lastUser) q = q.startAfter(lastUser);
    const usersSnap = await q.get();
    usersPagesScanned += 1;
    if (usersSnap.empty) break;

    for (const userDoc of usersSnap.docs) {
      usersDocsVisited += 1;
      const uid = userDoc.id;
      const intSnap = await db.collection('users').doc(uid).collection('interviews').get();
      for (const d of intSnap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (data.interviewKind !== WORKER_AI_PRESCREEN) continue;
        if (args.tenantId) {
          if (tenantFromInterviewData(data) !== args.tenantId) continue;
        }
        refs.push(d.ref);
        if (refs.length >= args.limit) {
          return { refs, usersPagesScanned, usersDocsVisited };
        }
      }
    }

    lastUser = usersSnap.docs[usersSnap.docs.length - 1];
    if (usersSnap.docs.length < GLOBAL_USER_PAGE_SIZE) break;
  }

  return { refs, usersPagesScanned, usersDocsVisited };
}

function computeCategoryLayer(data: Record<string, unknown>) {
  const extracted = extractPrescreenAnswersFromInterviewDoc(data);
  if (!extracted.answers) return null;
  const { merged: answersEffective } = mergeDynamicDrugBackgroundIntoCoreAnswers(extracted.answers, extracted.dynamicAnswers);
  const answerQualityEval = evaluatePrescreenAnswerQuality(answersEffective);
  const scored = scoreWorkerAiPrescreen(answersEffective, {
    answerQualityFlags: answerQualityEval.flags,
    scoreAdjustment: answerQualityEval.scoreAdjustment,
  });
  return computePrescreenCategoryScores({
    answers: answersEffective,
    scored,
    dynamicAnswers: extracted.dynamicAnswers,
  });
}

export const backfillPrescreenCategoryScores = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: false,
    cors: true,
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (request): Promise<BackfillPrescreenCategoryScoresResult> => {
    const raw = (request.data || {}) as {
      limit?: unknown;
      tenantId?: unknown;
      force?: unknown;
    };

    let limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : DEFAULT_LIMIT;
    if (limit < 1) limit = 1;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const tenantId =
      typeof raw.tenantId === 'string' && raw.tenantId.trim() ? raw.tenantId.trim() : null;
    const force = raw.force === true;

    assertBackfillAuth(request.auth as { uid: string; token?: Record<string, unknown> }, tenantId);

    if (tenantId) {
      if (!(await canManageOnboarding(request.auth, tenantId, request.auth!.uid))) {
        throw new HttpsError('permission-denied', 'Not authorized for this tenant');
      }
    }

    const { refs, usersPagesScanned, usersDocsVisited } = await collectPrescreenInterviewRefsGlobal({
      limit,
      tenantId,
    });

    let scanned = 0;
    let updated = 0;
    let skippedAlreadyHadCategories = 0;
    let skippedNoAnswers = 0;
    let skippedWrongKind = 0;
    let skippedTenantFilter = 0;
    let applicationsUpdated = 0;
    let applicationsSyncSkipped = 0;

    for (const ref of refs) {
      scanned += 1;
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data() as Record<string, unknown>;
      if (data.interviewKind !== WORKER_AI_PRESCREEN) {
        skippedWrongKind += 1;
        continue;
      }
      if (tenantId && tenantFromInterviewData(data) !== tenantId) {
        skippedTenantFilter += 1;
        continue;
      }

      const oldAi = (data.ai || {}) as Record<string, unknown>;
      if (hasV1CategoryScores(oldAi) && !force) {
        skippedAlreadyHadCategories += 1;
        continue;
      }

      const layer = computeCategoryLayer(data);
      if (!layer) {
        skippedNoAnswers += 1;
        logger.warn('backfillPrescreenCategoryScores: missing answers', { path: ref.path });
        continue;
      }

      const { categoryScores, categoryConfidence, categoryEvidence } = layer;

      /** Nested merge: only touch category* keys under `ai` (preserves overallScore, recommendation, flags, etc.). */
      await ref.set(
        {
          ai: {
            categoryScores,
            categoryConfidence,
            categoryEvidence,
          },
        },
        { merge: true },
      );
      updated += 1;

      const userId = ref.parent.parent?.id;
      const applicationId =
        data.applicationId != null && String(data.applicationId).trim() !== ''
          ? String(data.applicationId).trim()
          : null;
      const tid = tenantFromInterviewData(data);

      if (applicationId && tid && userId) {
        try {
          const appRef = db.doc(`tenants/${tid}/applications/${applicationId}`);
          const appSnap = await appRef.get();
          if (!appSnap.exists) {
            applicationsSyncSkipped += 1;
          } else {
            const appData = appSnap.data() as Record<string, unknown>;
            const aa = (appData.aiAutomation || {}) as Record<string, unknown>;
            const srcId = String(aa.sourceInterviewId ?? '').trim();
            if (!shouldSyncApplicationAiAutomation({ sourceInterviewIdOnApp: srcId, interviewDocId: ref.id })) {
              applicationsSyncSkipped += 1;
            } else if (aa.categoryScores != null && typeof aa.categoryScores === 'object') {
              applicationsSyncSkipped += 1;
            } else {
              await appRef.set(
                {
                  aiAutomation: {
                    categoryScores,
                  },
                },
                { merge: true },
              );
              applicationsUpdated += 1;
            }
          }
        } catch (e) {
          logger.warn('backfillPrescreenCategoryScores: application sync failed', {
            path: ref.path,
            message: e instanceof Error ? e.message : String(e),
          });
          applicationsSyncSkipped += 1;
        }
      }
    }

    logger.info('backfillPrescreenCategoryScores: done', {
      scanned,
      updated,
      skippedAlreadyHadCategories,
      skippedNoAnswers,
      limit,
      tenantId,
      force,
      actor: request.auth?.uid,
    });

    return {
      scanned,
      updated,
      skippedAlreadyHadCategories,
      skippedNoAnswers,
      skippedWrongKind,
      skippedTenantFilter,
      applicationsUpdated,
      applicationsSyncSkipped,
      usersPagesScanned,
      usersDocsVisited,
      limit,
      tenantId,
      force,
    };
  },
);
