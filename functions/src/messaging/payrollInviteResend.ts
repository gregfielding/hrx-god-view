/**
 * Manual payroll onboarding invite resend (admin).
 * Skips lifecycle dedupe and does not treat invite_sent / in_progress as a block.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendPayrollOnboardingInviteWithAutomationFallback } from './payrollInviteAutomation';
import { writeOnboardingAutomationDispatchLog } from './onboardingAutomationDispatchLog';
import {
  isPayrollAutomationApplicable,
  loadEntityPayrollInviteContext,
  payrollEntityUrls,
  resolveHiringEntityId,
  shouldBlockPayrollInviteResend,
} from './payrollInviteContext';
import { syncWorkerPayrollAccountAfterInviteSend } from './payrollInviteWorkerPayrollSync';

const db = admin.firestore();

export const PAYROLL_INVITE_RESEND_DISPATCH_MESSAGE_TYPE_ID = 'payroll_onboarding_invite_needed_resend';

const V = 'v1';

function correlationKeyForResend(args: {
  tenantId: string;
  userId: string;
  entityKey: string;
  assignmentId: string;
}): string {
  const ts = Date.now();
  if (args.assignmentId) {
    return `payroll_onboarding_invite_needed__${V}__${args.tenantId}__${args.assignmentId}__manual_resend__${ts}`;
  }
  return `payroll_onboarding_invite_on_call__${V}__${args.tenantId}__${args.userId}__${args.entityKey}__manual_resend__${ts}`;
}

export type PayrollInviteResendRunResult =
  | { ok: true; messageLogId?: string; correlationKey: string }
  | { ok: false; correlationKey: string; skipReason: string };

export async function runPayrollOnboardingInviteResend(args: {
  tenantId: string;
  userId: string;
  hiringEntityId: string;
  initiatedByUid: string;
  assignmentId?: string | null;
  /** On-call / generic path only (ignored when assignmentId is set). */
  contextLabel?: string | null;
}): Promise<PayrollInviteResendRunResult> {
  const { tenantId, userId, initiatedByUid } = args;
  let hiringEntityId = String(args.hiringEntityId || '').trim();
  const assignmentId = String(args.assignmentId || '').trim();

  let assignment: Record<string, unknown> | null = null;
  let jobTitleForMessage = '';
  if (assignmentId) {
    const asSnap = await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get();
    if (!asSnap.exists) {
      return { ok: false, correlationKey: '', skipReason: 'assignment_not_found' };
    }
    assignment = asSnap.data() || {};
    const workerId = String(assignment.userId || assignment.candidateId || '').trim();
    if (!workerId || workerId !== userId) {
      return { ok: false, correlationKey: '', skipReason: 'assignment_worker_mismatch' };
    }
    const resolved = await resolveHiringEntityId(tenantId, assignment, null);
    if (!resolved) {
      return { ok: false, correlationKey: '', skipReason: 'assignment_missing_hiring_entity' };
    }
    if (hiringEntityId && hiringEntityId !== resolved) {
      return { ok: false, correlationKey: '', skipReason: 'entity_mismatch_assignment' };
    }
    hiringEntityId = resolved;
    jobTitleForMessage = String(assignment.jobTitle || 'your assignment');
  } else {
    if (!hiringEntityId) {
      return { ok: false, correlationKey: '', skipReason: 'entityId_required' };
    }
    const empQ = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('userId', '==', userId)
      .where('entityId', '==', hiringEntityId)
      .limit(1)
      .get();
    if (empQ.empty) {
      return { ok: false, correlationKey: '', skipReason: 'no_entity_employment' };
    }
  }

  const { entityName, mergedSettings, onboardingUrl, provider, entityKey, entity } =
    await loadEntityPayrollInviteContext(tenantId, hiringEntityId, userId);
  const { signupUrl, portalLoginUrl } = payrollEntityUrls(mergedSettings);

  const ck = correlationKeyForResend({
    tenantId,
    userId,
    entityKey,
    assignmentId,
  });

  if (!isPayrollAutomationApplicable(mergedSettings, onboardingUrl)) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: assignmentId || '',
      userId,
      outcome: 'skipped',
      skipReason: 'payroll_not_applicable_or_no_url',
      hiringEntityId,
      payrollProvider: provider,
      messageTypeId: PAYROLL_INVITE_RESEND_DISPATCH_MESSAGE_TYPE_ID,
      details: {
        manualResend: true,
        initiatedByUid,
        source: assignmentId ? 'assignment' : 'on_call',
      },
    });
    return { ok: false, correlationKey: ck, skipReason: 'payroll_not_applicable_or_no_url' };
  }

  const payrollDocId = `${userId}__${entityKey}`;
  const payrollSnap = await db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payrollDocId}`).get();
  if (shouldBlockPayrollInviteResend(payrollSnap.exists ? payrollSnap.data() : undefined)) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: assignmentId || '',
      userId,
      outcome: 'skipped',
      skipReason: 'payroll_already_satisfied',
      hiringEntityId,
      payrollProvider: provider,
      messageTypeId: PAYROLL_INVITE_RESEND_DISPATCH_MESSAGE_TYPE_ID,
      details: {
        manualResend: true,
        initiatedByUid,
        workerPayrollAccountId: payrollDocId,
      },
    });
    return { ok: false, correlationKey: ck, skipReason: 'payroll_already_satisfied' };
  }

  const userSnap = await db.doc(`users/${userId}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const firstName = String(
    (assignment && (assignment.firstName as string)) || userData.firstName || 'there'
  );

  const contextLabel =
    String(args.contextLabel || '').trim() || 'your on-call employment';

  const messageText = assignmentId
    ? `Hi ${firstName}, complete your payroll onboarding for ${entityName} before ${jobTitleForMessage}: ${onboardingUrl}`
    : `Hi ${firstName}, complete your payroll onboarding for ${entityName} for ${contextLabel}: ${onboardingUrl}`;
  const emailSubject = `Payroll onboarding — ${entityName}`;

  const workerType =
    String(entity.workerType || 'W2').toUpperCase() === '1099' ? '1099' : 'w2';

  const dispatchSource = assignmentId
    ? ('assignment_confirmed_onboarding' as const)
    : ('on_call_employment' as const);
  const sendSource = assignmentId ? 'assignment_payroll_resend' : 'on_call_payroll_resend';
  const sendSourceId = assignmentId || payrollDocId;

  try {
    const result = await sendPayrollOnboardingInviteWithAutomationFallback({
      tenantId,
      userId,
      firstName,
      hiringEntityId,
      entityName,
      onboardingUrl,
      signupUrl,
      portalLoginUrl,
      provider,
      assignmentId: assignmentId || '',
      jobTitle: assignmentId ? jobTitleForMessage : contextLabel,
      messageText,
      emailSubject,
      correlationKey: ck,
      payrollDocId,
      sendSource,
      sendSourceId,
      dispatchSource,
    });

    const succeededChannels = (result.deliveryResults || [])
      .filter((r) => r.success && (r.channel === 'sms' || r.channel === 'email' || r.channel === 'push'))
      .map((r) => r.channel) as ('sms' | 'email' | 'push')[];

    const anyDelivered = succeededChannels.length > 0;

    if (anyDelivered) {
      await syncWorkerPayrollAccountAfterInviteSend({
        tenantId,
        payrollDocId,
        userId,
        hiringEntityId,
        entityKey,
        entityName,
        payrollProviderRaw: provider,
        payrollModeRaw: mergedSettings.mode,
        workerType,
        outcome: {
          anyChannelSucceeded: true,
          succeededChannels,
          messageTypeId: PAYROLL_INVITE_RESEND_DISPATCH_MESSAGE_TYPE_ID,
          correlationKey: ck,
          dispatchSource: sendSource,
        },
      });
    }

    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: assignmentId || '',
      userId,
      outcome: result.success ? 'sent' : 'failed',
      messageTypeId: PAYROLL_INVITE_RESEND_DISPATCH_MESSAGE_TYPE_ID,
      messageLogId: result.messageLogId,
      hiringEntityId,
      payrollProvider: provider,
      skipReason: result.success ? undefined : result.routingDecision?.reason || 'sendMessage_not_successful',
      details: {
        manualResend: true,
        initiatedByUid,
        channels: result.routingDecision?.channels,
        deliverySuccesses: succeededChannels,
        payrollAccountSynced: anyDelivered,
        source: assignmentId ? 'assignment' : 'on_call',
      },
    });

    if (!result.success) {
      return {
        ok: false,
        correlationKey: ck,
        skipReason: result.routingDecision?.reason || 'send_failed',
      };
    }

    return { ok: true, messageLogId: result.messageLogId, correlationKey: ck };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('runPayrollOnboardingInviteResend failed', { tenantId, userId, hiringEntityId, error: msg });
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: assignmentId || '',
      userId,
      outcome: 'failed',
      messageTypeId: PAYROLL_INVITE_RESEND_DISPATCH_MESSAGE_TYPE_ID,
      hiringEntityId,
      payrollProvider: provider,
      skipReason: msg,
      details: { manualResend: true, initiatedByUid },
    });
    return { ok: false, correlationKey: ck, skipReason: msg };
  }
}
