/**
 * Callable: resend payroll onboarding invite with the same message type + automation as the original flow.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { runPayrollOnboardingInviteResend } from '../messaging/payrollInviteResend';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { canManageOnboarding } from './workerOnboardingPipeline';

if (!admin.apps.length) {
  admin.initializeApp();
}

export interface ResendPayrollOnboardingInvitePayload {
  tenantId: string;
  userId: string;
  /** Hiring entity Firestore id */
  entityId: string;
  /** When set, uses assignment-style copy and validates the worker + entity against the assignment. */
  assignmentId?: string | null;
  /** Used only when assignmentId is omitted (on-call / generic resend). */
  contextLabel?: string | null;
}

export const resendPayrollOnboardingInvite = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    memory: '256MiB',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const data = (request.data || {}) as ResendPayrollOnboardingInvitePayload;
    const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
    const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
    const entityId = typeof data.entityId === 'string' ? data.entityId.trim() : '';
    const assignmentId =
      typeof data.assignmentId === 'string' && data.assignmentId.trim()
        ? data.assignmentId.trim()
        : '';
    const contextLabel =
      typeof data.contextLabel === 'string' && data.contextLabel.trim()
        ? data.contextLabel.trim()
        : null;

    if (!tenantId || !userId || !entityId) {
      throw new HttpsError('invalid-argument', 'tenantId, userId, and entityId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Insufficient permissions');
    }

    try {
      const result = await runPayrollOnboardingInviteResend({
        tenantId,
        userId,
        hiringEntityId: entityId,
        initiatedByUid: request.auth.uid,
        assignmentId: assignmentId || null,
        contextLabel,
      });

      if (result.ok === true) {
        return {
          ok: true as const,
          messageLogId: result.messageLogId ?? null,
          correlationKey: result.correlationKey,
        };
      }

      const reason = result.skipReason || 'resend_failed';
      logger.warn('resendPayrollOnboardingInvite skipped or failed', { tenantId, userId, entityId, reason });
      throw new HttpsError(
        'failed-precondition',
        reason.length > 280 ? `${reason.slice(0, 280)}…` : reason
      );
    } catch (e: unknown) {
      if (e instanceof HttpsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('resendPayrollOnboardingInvite error', { tenantId, userId, message: msg });
      throw new HttpsError('internal', msg.length > 200 ? `${msg.slice(0, 200)}…` : msg || 'Resend failed');
    }
  }
);
