/**
 * Read-only plan for worker UI: dynamic pre-screen steps for an application (no scoring side effects).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { buildAiInterviewContext } from './buildAiInterviewContext';
import { buildDynamicPrescreenSteps } from './buildDynamicPrescreenQuestions';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const getWorkerAiPrescreenInterviewPlan = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '512MiB' },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const data = request.data as { applicationId?: unknown; tenantId?: unknown };
    const applicationId = String(data.applicationId ?? '').trim().slice(0, 200);
    if (!applicationId) {
      throw new HttpsError('invalid-argument', 'applicationId is required');
    }
    const tenantId =
      data.tenantId == null || data.tenantId === ''
        ? null
        : String(data.tenantId).trim().slice(0, 120) || null;

    const ctx = await buildAiInterviewContext(db, {
      userId: auth.uid,
      applicationId,
      tenantId,
    });
    if (!ctx) {
      return {
        interviewType: 'worker_ai_prescreen' as const,
        workerAiPrescreenRequired: true,
        dynamicSteps: [],
      };
    }

    const steps = buildDynamicPrescreenSteps(ctx);
    const ri = ctx.hiringPolicy?.resolvedInterview;
    return {
      interviewType: ri?.interviewType ?? 'worker_ai_prescreen',
      workerAiPrescreenRequired: ri?.workerAiPrescreenRequired ?? true,
      dynamicSteps: steps.map((s) => ({
        id: s.id,
        type: s.type,
        prompt: s.prompt,
        options: s.options,
        module: s.module,
      })),
    };
  },
);
