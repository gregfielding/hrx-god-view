/**
 * First onboarding automation slice: assignment → confirmed → payroll onboarding invite (unified sendMessage).
 *
 * On first `onboarding_started` for this assignment, ensures `worker_onboarding` + `entity_employments` via
 * `ensureWorkerOnboardingPipelineForAssignmentConfirmed` (`triggerSource: "assignment_confirmed"`, auditable
 * `SYSTEM_ASSIGNMENT_CONFIRMED_ACTOR`). Idempotent with placement callables that also call `ensureWorkerOnboardingPipeline`.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { markLifecycleEventIfFirst } from './lifecycleDedupe';
import { sendPayrollOnboardingInviteWithAutomationFallback } from './payrollInviteAutomation';
import { writeOnboardingAutomationDispatchLog } from './onboardingAutomationDispatchLog';
import {
  isPayrollAutomationApplicable,
  shouldSkipAutomatedPayrollInvite,
  loadEntityPayrollInviteContext,
  payrollEntityUrls,
  resolveEntityKeyForWorkerPayroll,
  resolveHiringEntityId,
} from './payrollInviteContext';
import { syncWorkerPayrollAccountAfterInviteSend } from './payrollInviteWorkerPayrollSync';

const db = admin.firestore();

const V = 'v1';

async function setEntityEmploymentOnboardingPhaseInProgress(args: {
  tenantId: string;
  userId: string;
  assignment: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, userId, assignment } = args;
  const hiringEntityId = await resolveHiringEntityId(tenantId, assignment, null);
  if (!hiringEntityId) return;
  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
  if (!entitySnap.exists) return;
  const entityData = entitySnap.data() || {};
  const entityKey = await resolveEntityKeyForWorkerPayroll({
    tenantId,
    userId,
    hiringEntityId,
    entityDoc: entityData as Record<string, unknown>,
  });
  const employmentId = `${userId}__${entityKey}`;
  await db
    .doc(`tenants/${tenantId}/entity_employments/${employmentId}`)
    .set(
      {
        onboardingPhase: 'in_progress',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export function onboardingStartedCorrelationKey(tenantId: string, assignmentId: string): string {
  return `onboarding_started__${V}__${tenantId}__${assignmentId}`;
}

export function payrollOnboardingInviteCorrelationKey(tenantId: string, assignmentId: string): string {
  return `payroll_onboarding_invite_needed__${V}__${tenantId}__${assignmentId}`;
}

export async function runAssignmentConfirmedOnboardingSlice(args: {
  tenantId: string;
  assignmentId: string;
  assignment: Record<string, unknown>;
  userId: string;
}): Promise<void> {
  const { tenantId, assignmentId, assignment, userId } = args;
  const workerId = String(
    userId || (assignment.userId as string) || (assignment.candidateId as string) || ''
  ).trim();
  if (!workerId) {
    logger.warn('runAssignmentConfirmedOnboardingSlice: missing worker id', { tenantId, assignmentId });
    return;
  }

  const ckStarted = onboardingStartedCorrelationKey(tenantId, assignmentId);
  const startedFirst = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: ckStarted,
    eventType: 'onboarding_started',
    context: { assignmentId, userId: workerId, source: 'assignment_confirmed' },
  });

  if (startedFirst) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'onboarding_started',
      correlationKey: ckStarted,
      assignmentId,
      userId: workerId,
      outcome: 'recorded',
      details: { gate: 'assignment_confirmed' },
    });
    try {
      const { ensureWorkerOnboardingPipelineForAssignmentConfirmed } = await import(
        '../onboarding/workerOnboardingPipeline'
      );
      const pipelineResult = await ensureWorkerOnboardingPipelineForAssignmentConfirmed({
        tenantId,
        userId: workerId,
        assignmentId,
        assignment,
      });
      logger.info('assignment_confirmed: worker onboarding pipeline ensured', {
        tenantId,
        assignmentId,
        userId: workerId,
        pipelineId: pipelineResult?.pipelineId,
        created: pipelineResult?.created,
      });
    } catch (e: unknown) {
      logger.warn('ensureWorkerOnboardingPipelineForAssignmentConfirmed failed', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      await setEntityEmploymentOnboardingPhaseInProgress({ tenantId, userId: workerId, assignment });
    } catch (e: unknown) {
      logger.warn('setEntityEmploymentOnboardingPhaseInProgress failed', {
        tenantId,
        assignmentId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const ckPayroll = payrollOnboardingInviteCorrelationKey(tenantId, assignmentId);
  const payrollFirst = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: ckPayroll,
    eventType: 'payroll_onboarding_invite_needed',
    context: { assignmentId, userId: workerId },
  });

  if (!payrollFirst) {
    logger.info('payroll_onboarding_invite_needed skipped: idempotency (correlationKey already claimed)', {
      tenantId,
      assignmentId,
      correlationKey: ckPayroll,
    });
    return;
  }

  const hiringEntityId = await resolveHiringEntityId(tenantId, assignment, null);
  if (!hiringEntityId) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ckPayroll,
      assignmentId,
      userId: workerId,
      outcome: 'skipped',
      skipReason: 'no_hiring_entity',
      hiringEntityId: null,
    });
    return;
  }

  const { entityName, mergedSettings, onboardingUrl, provider, entityKey, entity } =
    await loadEntityPayrollInviteContext(tenantId, hiringEntityId, workerId);
  const { signupUrl, portalLoginUrl } = payrollEntityUrls(mergedSettings);

  if (!isPayrollAutomationApplicable(mergedSettings, onboardingUrl)) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ckPayroll,
      assignmentId,
      userId: workerId,
      outcome: 'skipped',
      skipReason: 'payroll_not_applicable_or_no_url',
      hiringEntityId,
      payrollProvider: provider,
      details: { mode: mergedSettings.mode ?? null, hasUrl: !!onboardingUrl },
    });
    return;
  }

  const payrollDocId = `${workerId}__${entityKey}`;
  const payrollSnap = await db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payrollDocId}`).get();
  if (shouldSkipAutomatedPayrollInvite(payrollSnap.exists ? payrollSnap.data() : undefined)) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ckPayroll,
      assignmentId,
      userId: workerId,
      outcome: 'skipped',
      skipReason: 'payroll_already_satisfied_or_invite_pending',
      hiringEntityId,
      payrollProvider: provider,
      details: { workerPayrollAccountId: payrollDocId, payrollStatus: payrollSnap.data()?.payrollStatus },
    });
    return;
  }

  const userSnap = await db.doc(`users/${workerId}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const firstName = String(assignment.firstName || userData.firstName || 'there');
  const jobTitle = String(assignment.jobTitle || 'your assignment');

  const messageText = `Hi ${firstName}, complete your payroll onboarding for ${entityName} before ${jobTitle}: ${onboardingUrl}`;
  const emailSubject = `Payroll onboarding — ${entityName}`;

  const workerType =
    String(entity.workerType || 'W2').toUpperCase() === '1099' ? '1099' : 'w2';

  try {
    const result = await sendPayrollOnboardingInviteWithAutomationFallback({
      tenantId,
      userId: workerId,
      firstName,
      hiringEntityId,
      entityName,
      onboardingUrl,
      signupUrl,
      portalLoginUrl,
      provider,
      assignmentId,
      jobTitle,
      messageText,
      emailSubject,
      correlationKey: ckPayroll,
      payrollDocId,
      sendSource: 'assignment_confirmed_onboarding',
      sendSourceId: assignmentId,
      dispatchSource: 'assignment_confirmed_onboarding',
    });

    const succeededChannels = (result.deliveryResults || [])
      .filter((r) => r.success && (r.channel === 'sms' || r.channel === 'email' || r.channel === 'push'))
      .map((r) => r.channel) as ('sms' | 'email' | 'push')[];

    const anyDelivered = succeededChannels.length > 0;

    if (anyDelivered) {
      await syncWorkerPayrollAccountAfterInviteSend({
        tenantId,
        payrollDocId,
        userId: workerId,
        hiringEntityId,
        entityKey,
        entityName,
        payrollProviderRaw: provider,
        payrollModeRaw: mergedSettings.mode,
        workerType,
        outcome: {
          anyChannelSucceeded: true,
          succeededChannels,
          messageTypeId: 'payroll_onboarding_invite_needed',
          correlationKey: ckPayroll,
          dispatchSource: 'assignment_confirmed_onboarding',
        },
      });
    }

    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ckPayroll,
      assignmentId,
      userId,
      outcome: result.success ? 'sent' : 'failed',
      messageTypeId: 'payroll_onboarding_invite_needed',
      messageLogId: result.messageLogId,
      hiringEntityId,
      payrollProvider: provider,
      skipReason: result.success ? undefined : result.routingDecision?.reason || 'sendMessage_not_successful',
      details: {
        channels: result.routingDecision?.channels,
        deliverySuccesses: succeededChannels,
        payrollAccountSynced: anyDelivered,
      },
    });
  } catch (e: any) {
    logger.error('runAssignmentConfirmedOnboardingSlice sendMessage failed', {
      tenantId,
      assignmentId,
      error: e?.message || String(e),
    });
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ckPayroll,
      assignmentId,
      userId: workerId,
      outcome: 'failed',
      messageTypeId: 'payroll_onboarding_invite_needed',
      hiringEntityId,
      payrollProvider: provider,
      skipReason: e?.message || 'sendMessage_threw',
    });
  }
}
