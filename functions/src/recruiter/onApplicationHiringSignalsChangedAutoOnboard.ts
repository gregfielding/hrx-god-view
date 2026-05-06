/**
 * Auto-onboard reactor for application-side hiring signals.
 *
 * Fires on every write to `tenants/{tenantId}/applications/{applicationId}`
 * and decides — purely from the before/after diff — whether to run the
 * group's hiring rules for that one user. The signals we react to:
 *
 *   - `workerAiPrescreenInterviewCompletedAt` transitioning from missing → set.
 *     This is the gap that motivated the trigger: a worker added to a group
 *     who finishes their AI prescreen days later was previously invisible to
 *     the auto-onboarding pipeline because nothing fired on their interview
 *     submission.
 *   - `aiAutomation.*.decision` (`extractOrchestratorDecision`) changing —
 *     covers cases where the orchestrator re-runs after profile signals
 *     update (Master Recruiter Score recomputed, etc.).
 *   - `status` transitioning out of `in_progress` — wizard-staged drafts
 *     becoming submitted/reviewing/etc.
 *
 * Gated on the application carrying a `groupId` and that group having
 * `hiringConfig.automation.hiringActive === true` with an on-call hiring
 * entity. The legacy `autoOnboardEnabled` flag's UI was retired (only the
 * "Hiring active" switch is exposed now) so we no longer enforce it —
 * see `userGroupHiringAutoOnboardCore.ts` for the long-form rationale.
 * All eligibility logic (orchestrator advance, blocking C1 Select
 * employment, `hire_everyone` bypass) is delegated to
 * `autoOnboardForGroupIfEligible` so this trigger and the manual
 * "Apply rules to existing members" button stay in lockstep.
 *
 * Idempotency: `runStartOnCallEmploymentFlow` short-circuits when the
 * `entity_employments` row already exists, so re-firing across multiple
 * signal changes for the same worker is safe and produces no duplicate
 * onboarding.
 */
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import {
  TWILIO_A2P_CAMPAIGN,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
} from '../messaging/twilioSecrets';
import { extractOrchestratorDecision } from './userGroupHirePassedCandidates';
import { autoOnboardForGroupIfEligible } from './userGroupHiringAutoOnboardCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SYSTEM_ACTOR = 'system:auto_application_signals_group_hiring';

function hasPrescreenJustCompleted(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): boolean {
  return !before?.workerAiPrescreenInterviewCompletedAt && !!after.workerAiPrescreenInterviewCompletedAt;
}

function hasOrchestratorDecisionChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): boolean {
  const beforeDec = before ? extractOrchestratorDecision(before) : null;
  const afterDec = extractOrchestratorDecision(after);
  return beforeDec !== afterDec;
}

function hasStatusLeftInProgress(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): boolean {
  const beforeStatus = String(before?.status ?? '').trim().toLowerCase();
  const afterStatus = String(after.status ?? '').trim().toLowerCase();
  return beforeStatus === 'in_progress' && afterStatus !== '' && afterStatus !== 'in_progress';
}

export const onApplicationHiringSignalsChangedAutoOnboard = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (event) => {
    const { tenantId, applicationId } = event.params;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!after) return;
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;

    const prescreenJustCompleted = hasPrescreenJustCompleted(before, after);
    const orchestratorDecisionChanged = hasOrchestratorDecisionChanged(before, after);
    const statusLeftInProgress = hasStatusLeftInProgress(before, after);

    if (!prescreenJustCompleted && !orchestratorDecisionChanged && !statusLeftInProgress) {
      return;
    }

    const groupIdRaw = after.groupId;
    const groupId = typeof groupIdRaw === 'string' ? groupIdRaw.trim() : '';
    if (!groupId) return;

    const userIdRaw = after.userId ?? after.candidateId ?? after.workerId ?? after.uid;
    const userId = typeof userIdRaw === 'string' ? userIdRaw.trim() : '';
    if (!userId) return;

    try {
      const result = await autoOnboardForGroupIfEligible({
        db: admin.firestore(),
        tenantId,
        groupId,
        userId,
        applicationDoc: { id: applicationId, data: after },
        initiatedByUid: SYSTEM_ACTOR,
        triggerSource: 'auto_user_group_application_signals',
        note: `auto_application_signals:${applicationId}`,
      });

      if (!result.considered) {
        // Group exists but auto-onboard not enabled, or hiring entity missing,
        // or employment type isn't on-call. Stay silent — recruiter hasn't
        // opted into automation.
        return;
      }

      if (result.onboardingStarted) {
        logger.info('userGroupAutoOnboard.application_signal_onboarded', {
          tenantId,
          groupId,
          applicationId,
          userId,
          pipelineId: result.pipelineId ?? null,
          trigger: prescreenJustCompleted
            ? 'prescreen_completed'
            : orchestratorDecisionChanged
              ? 'orchestrator_decision_changed'
              : 'status_left_in_progress',
          evereeProvisionWarning: result.evereeProvisionWarning ?? null,
        });
      } else {
        logger.info('userGroupAutoOnboard.application_signal_evaluated_excluded', {
          tenantId,
          groupId,
          applicationId,
          userId,
          category: result.evaluation?.category ?? null,
          reason: result.evaluation?.reasons?.[0] ?? null,
          errorMessage: result.errorMessage,
        });
      }
    } catch (e: unknown) {
      // Outer guard: never propagate to the trigger runtime — the application
      // doc is shared across many other listeners and a thrown error here
      // would amplify retries.
      logger.error('userGroupAutoOnboard.application_signal_unexpected_error', {
        tenantId,
        groupId,
        applicationId,
        userId,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }
  },
);
