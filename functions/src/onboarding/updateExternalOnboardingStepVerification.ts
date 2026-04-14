/**
 * Admin verification for TempWorks-driven milestones on worker_onboarding.externalOnboardingSteps.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { canManageOnboarding } from './workerOnboardingPipeline';

const db = admin.firestore();

const ENTITY_KEYS = new Set(['select', 'workforce', 'events']);

/**
 * Must stay in sync with client `EXTERNAL_ONBOARDING_STEP_VERIFICATION_UI_KEYS`
 * (`src/types/externalOnboardingSteps.ts`).
 */
const ALLOWED_STEP_KEYS = new Set([
  'payroll_onboarding',
  'direct_deposit',
  'tax_withholding_forms',
  'contractor_tax_form_w9',
  'i9_employee_section',
  'independent_contractor_agreement',
  'handbook_acknowledgment',
  'policies_acknowledgment',
]);

type Action = 'verify_complete' | 'request_correction' | 'mark_error';

/** Firestore update() rejects undefined anywhere in the payload (unless ignoreUndefinedProperties is set early). */
function shallowOmitUndefined(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function sanitizeExternalOnboardingStepsMap(
  steps: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(steps)) {
    out[k] = shallowOmitUndefined(v);
  }
  return out;
}

function coerceStepRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return { status: 'not_started', externalSource: 'tempworks' };
  }
  const o = raw as Record<string, unknown>;
  const status = typeof o.status === 'string' ? o.status : 'not_started';
  const externalSource = o.externalSource === 'tempworks' ? 'tempworks' : 'tempworks';
  return { ...o, status, externalSource };
}

export const updateExternalOnboardingStepVerification = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    memory: '512MiB',
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    const data = request.data as {
      tenantId?: unknown;
      userId?: unknown;
      entityKey?: unknown;
      stepKey?: unknown;
      action?: unknown;
      note?: unknown;
    };

    const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
    const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
    const entityKey = typeof data.entityKey === 'string' ? data.entityKey.trim().toLowerCase() : '';
    const stepKey = typeof data.stepKey === 'string' ? data.stepKey.trim() : '';
    const action = data.action as Action;
    const note = typeof data.note === 'string' ? data.note.trim() : '';

    if (!tenantId || !userId || !entityKey || !stepKey || !action) {
      throw new HttpsError('invalid-argument', 'tenantId, userId, entityKey, stepKey, and action are required');
    }

    if (!ENTITY_KEYS.has(entityKey)) {
      throw new HttpsError('invalid-argument', 'Invalid entityKey');
    }

    if (!ALLOWED_STEP_KEYS.has(stepKey)) {
      throw new HttpsError('invalid-argument', 'This step is not enabled for verification actions yet');
    }

    if (!['verify_complete', 'request_correction', 'mark_error'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Invalid action');
    }

    if (!(await canManageOnboarding(auth, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions');
    }

    if ((action === 'request_correction' || action === 'mark_error') && !note) {
      throw new HttpsError('invalid-argument', 'note is required for this action');
    }

    const pipelineId = `${userId}__${entityKey}`;
    const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Worker onboarding pipeline not found');
    }

    const docData = snap.data() as Record<string, unknown>;
    if (String(docData.userId || '') !== userId) {
      throw new HttpsError('permission-denied', 'Pipeline userId mismatch');
    }

    const rawSteps = docData.externalOnboardingSteps;
    const steps: Record<string, Record<string, unknown>> =
      rawSteps && typeof rawSteps === 'object' && !Array.isArray(rawSteps)
        ? { ...(rawSteps as Record<string, Record<string, unknown>>) }
        : {};

    const prev = coerceStepRecord(steps[stepKey]);
    const status = String(prev.status || 'not_started');

    const now = FieldValue.serverTimestamp();
    const uid = auth.uid;

    const alreadyVerifiedComplete = status === 'completed' && prev.verifiedAt != null;

    if (action === 'verify_complete') {
      if (alreadyVerifiedComplete) {
        return { ok: true };
      }
      /** TempWorks has no API — admins mark completion in HRX from cold start or after fixing errors. */
      const allowedVerifyFrom = new Set([
        'worker_completed_external',
        'pending_admin_verification',
        'invite_sent',
        'not_started',
        'error',
        'completed',
      ]);
      if (!allowedVerifyFrom.has(status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot verify from status "${status}". Use mark_error if this step needs review.`
        );
      }
      const next: Record<string, unknown> = {
        ...prev,
        status: 'completed',
        externalSource: 'tempworks',
        verifiedBy: uid,
        verifiedAt: now,
        updatedAt: now,
        updatedBy: uid,
      };
      delete next.correctionRequestedAt;
      if (note) {
        next.verificationNote = note;
      } else {
        delete next.verificationNote;
      }
      steps[stepKey] = next;
    } else if (action === 'request_correction') {
      if (!['worker_completed_external', 'pending_admin_verification'].includes(status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot request correction from status "${status}". Expected worker_completed_external or pending_admin_verification.`
        );
      }
      steps[stepKey] = {
        ...prev,
        status: 'invite_sent',
        externalSource: 'tempworks',
        verificationNote: note,
        correctionRequestedAt: now,
        updatedAt: now,
        updatedBy: uid,
      };
    } else if (action === 'mark_error') {
      steps[stepKey] = {
        ...prev,
        status: 'error',
        externalSource: 'tempworks',
        verificationNote: note,
        updatedAt: now,
        updatedBy: uid,
      };
    }

    const stepsClean = sanitizeExternalOnboardingStepsMap(steps);

    await ref.update({
      externalOnboardingSteps: stepsClean,
      updatedAt: now,
    });

    return { ok: true };
  }
);
