/**
 * Read-only plan for worker UI: dynamic pre-screen steps for an application (no scoring side effects).
 * Cumulative-interview mode also returns `bankCoverage` — which steps are satisfied by the worker's
 * answer bank so the client renders only the delta (docs/prescreen-cumulative-interview.md).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { stampPlanFetch, saveSessionProgress, loadSessionDrafts } from './interviewSession';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { buildAiInterviewContext, buildProfileFirstAiInterviewContext } from './buildAiInterviewContext';
import { buildDynamicPrescreenSteps } from './buildDynamicPrescreenQuestions';
import { applyPrescreenDynamicDedupe } from './prescreenDynamicDedupe';
import {
  computePrescreenBankDelta,
  freshPrescreenBankAnswers,
  type PrescreenBankAnswerValue,
} from '../shared/prescreenAnswerBank';
import { readPrescreenAnswerBank } from './prescreenAnswerBankStore';
import { userDocNeedsLegalFirstNameConfirm } from './legalFirstNameConfirm';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export type PlanBankCoverage = {
  coveredCoreStepIds: string[];
  coveredDynamicStepIds: string[];
  neededCoreStepIds: string[];
  neededDynamicStepIds: string[];
  zeroDelta: boolean;
  /** Fresh carriable bank answers so the client can seed state (worker's own data). */
  bankCoreAnswers: Record<string, PrescreenBankAnswerValue>;
  bankDynamicAnswers: Record<string, string>;
};

/**
 * Bank coverage for this worker + dynamic plan. Fail-open: any error returns null and the client
 * runs the full interview.
 */
async function computePlanBankCoverage(
  uid: string,
  dynamicStepIds: string[],
): Promise<PlanBankCoverage | null> {
  try {
    const [bank, userSnap] = await Promise.all([
      readPrescreenAnswerBank(db, uid),
      db.collection('users').doc(uid).get(),
    ]);
    if (Object.keys(bank).length === 0) return null;
    const userDoc = (userSnap.data() || {}) as Record<string, unknown>;
    const needsLegalNameConfirm = userDocNeedsLegalFirstNameConfirm(userDoc);

    const fresh = freshPrescreenBankAnswers(bank, Date.now());
    const dedupe = applyPrescreenDynamicDedupe(
      dynamicStepIds.map((id) => ({ id })),
      {
        attendance_issues: String(fresh.coreAnswers.attendance_issues ?? ''),
        transportation_plan: String(fresh.coreAnswers.transportation_plan ?? ''),
        backup_transportation: String(fresh.coreAnswers.backup_transportation ?? ''),
        physical_comfort: String(fresh.coreAnswers.physical_comfort ?? ''),
      },
      fresh.dynamicAnswers,
    );
    const delta = computePrescreenBankDelta({
      fresh,
      dynamicStepIds,
      dedupeCoveredDynamicIds: dedupe.skipped.map((s) => s.id),
      needsLegalNameConfirm,
    });

    return {
      coveredCoreStepIds: delta.coveredCoreStepIds,
      coveredDynamicStepIds: delta.coveredDynamicStepIds,
      neededCoreStepIds: delta.neededCoreStepIds,
      neededDynamicStepIds: delta.neededDynamicStepIds,
      zeroDelta: delta.zeroDelta,
      bankCoreAnswers: fresh.coreAnswers,
      bankDynamicAnswers: { ...fresh.dynamicAnswers, ...dedupe.mergedDynamicAnswers },
    };
  } catch (e) {
    logger.warn('getWorkerAiPrescreenInterviewPlan.bank_coverage_failed', {
      uid,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export const getWorkerAiPrescreenInterviewPlan = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '512MiB' },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const data = request.data as {
      applicationId?: unknown;
      tenantId?: unknown;
      mode?: unknown;
      entry?: unknown;
      progress?: unknown;
    };
    const applicationId = String(data.applicationId ?? '').trim().slice(0, 200);
    const tenantId =
      data.tenantId == null || data.tenantId === ''
        ? null
        : String(data.tenantId).trim().slice(0, 120) || null;

    // INT-2 save/resume: mode 'saveProgress' persists in-progress answers to
    // users/{uid}/prescreen/session and returns — no plan build.
    if (data.mode === 'saveProgress') {
      const progress = (data.progress ?? {}) as {
        lastStepId?: unknown;
        lastStepIndex?: unknown;
        totalSteps?: unknown;
        draftAnswers?: unknown;
        draftMultiAnswers?: unknown;
      };
      const saved = await saveSessionProgress({
        uid: auth.uid,
        lastStepId: String(progress.lastStepId ?? ''),
        lastStepIndex: Number(progress.lastStepIndex ?? 0),
        totalSteps: Number(progress.totalSteps ?? 0),
        draftAnswers: (progress.draftAnswers ?? {}) as Record<string, string>,
        draftMultiAnswers: (progress.draftMultiAnswers ?? {}) as Record<string, string[]>,
        applicationId: applicationId || null,
      });
      return { ok: saved.ok };
    }

    // INT-1 "started" stage: best-effort, fail-open, first-fetch-wins.
    await stampPlanFetch({
      uid: auth.uid,
      applicationId: applicationId || null,
      entry: data.entry == null ? null : String(data.entry).slice(0, 80),
      tenantId,
    });
    const savedSession = await loadSessionDrafts(auth.uid);

    if (applicationId) {
      const ctx = await buildAiInterviewContext(db, {
        userId: auth.uid,
        applicationId,
        tenantId,
      });
      if (!ctx) {
        return {
          interviewType: 'worker_ai_prescreen' as const,
          interviewMode: 'application' as const,
          workerAiPrescreenRequired: true,
          dynamicSteps: [],
          bankCoverage: await computePlanBankCoverage(auth.uid, []),
        };
      }

      const steps = buildDynamicPrescreenSteps(ctx);
      const ri = ctx.hiringPolicy?.resolvedInterview;
      return {
        interviewType: ri?.interviewType ?? 'worker_ai_prescreen',
        interviewMode: 'application' as const,
        workerAiPrescreenRequired: ri?.workerAiPrescreenRequired ?? true,
        dynamicSteps: steps.map((s) => ({
          id: s.id,
          type: s.type,
          prompt: s.prompt,
          promptKey: s.promptKey,
          promptParams: s.promptParams,
          options: s.options,
          module: s.module,
        })),
        bankCoverage: await computePlanBankCoverage(
          auth.uid,
          steps.map((s) => s.id),
        ),
        savedSession,
      };
    }

    /** Profile-first path: same page + core flow; dynamics from tenant policy only (e.g. gig path). */
    if (!tenantId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId is required when applicationId is omitted (profile-first interview plan)',
      );
    }

    const profileCtx = await buildProfileFirstAiInterviewContext(db, {
      userId: auth.uid,
      tenantId,
    });
    if (!profileCtx) {
      return {
        interviewType: 'worker_ai_prescreen' as const,
        interviewMode: 'profile_first' as const,
        workerAiPrescreenRequired: true,
        dynamicSteps: [],
        bankCoverage: await computePlanBankCoverage(auth.uid, []),
      };
    }

    const steps = buildDynamicPrescreenSteps(profileCtx);
    return {
      interviewType: 'worker_ai_prescreen',
      interviewMode: 'profile_first' as const,
      workerAiPrescreenRequired: true,
      dynamicSteps: steps.map((s) => ({
        id: s.id,
        type: s.type,
        prompt: s.prompt,
        promptKey: s.promptKey,
        promptParams: s.promptParams,
        options: s.options,
        module: s.module,
      })),
      bankCoverage: await computePlanBankCoverage(
        auth.uid,
        steps.map((s) => s.id),
      ),
      savedSession,
    };
  },
);
