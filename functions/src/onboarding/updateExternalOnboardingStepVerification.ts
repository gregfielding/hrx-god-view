/**
 * Admin verification for TempWorks-driven milestones on worker_onboarding.externalOnboardingSteps.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';

const db = admin.firestore();

const ENTITY_KEYS = new Set(['select', 'workforce', 'events']);

/** Matches client EXTERNAL_ONBOARDING_STEP_VERIFICATION_UI_KEYS (first rollout). */
const ALLOWED_STEP_KEYS = new Set([
  'payroll_onboarding',
  'direct_deposit',
  'tax_withholding_forms',
  'contractor_tax_form_w9',
  'i9_employee_section',
  'independent_contractor_agreement',
]);

type Action = 'verify_complete' | 'request_correction' | 'mark_error';

function canManageTenantOnboarding(
  auth: { token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } } | null | undefined,
  tenantId: string
): boolean {
  if (!auth) return false;
  const roles = auth.token?.roles || {};
  const tenantRole = roles[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return true;
  if (auth.token?.hrx === true) return true;
  return false;
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
    memory: '256MiB',
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

    if (!canManageTenantOnboarding(auth as { token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } }, tenantId)) {
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

    if (action === 'verify_complete') {
      if (!['worker_completed_external', 'pending_admin_verification', 'invite_sent'].includes(status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot verify from status "${status}". Expected worker_completed_external, pending_admin_verification, or invite_sent.`
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

    await ref.update({
      externalOnboardingSteps: steps,
      updatedAt: now,
    });

    return { ok: true };
  }
);
