/**
 * Payroll onboarding invite when there is no assignment (on-call / labor pool hire).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { markLifecycleEventIfFirst } from './lifecycleDedupe';
import { sendPayrollOnboardingInviteWithAutomationFallback } from './payrollInviteAutomation';
import { writeOnboardingAutomationDispatchLog } from './onboardingAutomationDispatchLog';
import {
  isPayrollAutomationApplicable,
  loadEntityPayrollInviteContext,
  payrollEntityUrls,
  resolveEntityKeyForWorkerPayroll,
  shouldSkipAutomatedPayrollInvite,
} from './payrollInviteContext';
import { syncWorkerPayrollAccountAfterInviteSend } from './payrollInviteWorkerPayrollSync';

const db = admin.firestore();
const V = 'v1';

export function payrollOnCallInviteCorrelationKey(tenantId: string, userId: string, entityKey: string): string {
  return `payroll_onboarding_invite_on_call__${V}__${tenantId}__${userId}__${entityKey}`;
}

export async function runPayrollOnboardingInviteForOnCallEmployment(args: {
  tenantId: string;
  userId: string;
  hiringEntityId: string;
  /** Shown in SMS/email instead of a job title (e.g. "your on-call employment"). */
  contextLabel?: string;
}): Promise<void> {
  const { tenantId, userId, hiringEntityId } = args;
  const contextLabel = String(args.contextLabel || 'your on-call employment').trim() || 'your on-call employment';

  const { entityName, mergedSettings, onboardingUrl, provider, entityKey, entity } =
    await loadEntityPayrollInviteContext(tenantId, hiringEntityId, userId);
  const { signupUrl, portalLoginUrl } = payrollEntityUrls(mergedSettings);

  const ck = payrollOnCallInviteCorrelationKey(tenantId, userId, entityKey);
  const first = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: ck,
    eventType: 'payroll_onboarding_invite_needed',
    context: { userId, hiringEntityId, source: 'on_call_employment' },
  });
  if (!first) {
    logger.info('payroll on-call invite skipped: dedupe', { tenantId, userId, entityKey });
    return;
  }

  if (!isPayrollAutomationApplicable(mergedSettings, onboardingUrl)) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: '',
      userId,
      outcome: 'skipped',
      skipReason: 'payroll_not_applicable_or_no_url',
      hiringEntityId,
      payrollProvider: provider,
      details: { source: 'on_call_employment', mode: mergedSettings.mode ?? null, hasUrl: !!onboardingUrl },
    });
    return;
  }

  const payrollDocId = `${userId}__${entityKey}`;
  const payrollSnap = await db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payrollDocId}`).get();
  if (shouldSkipAutomatedPayrollInvite(payrollSnap.exists ? payrollSnap.data() : undefined)) {
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: '',
      userId,
      outcome: 'skipped',
      skipReason: 'payroll_already_satisfied_or_invite_pending',
      hiringEntityId,
      payrollProvider: provider,
      details: { source: 'on_call_employment', workerPayrollAccountId: payrollDocId },
    });
    return;
  }

  const userSnap = await db.doc(`users/${userId}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const firstName = String(userData.firstName || 'there');

  const messageText = `Hi ${firstName}, complete your payroll onboarding for ${entityName} for ${contextLabel}: ${onboardingUrl}`;
  const emailSubject = `Payroll onboarding — ${entityName}`;

  const workerType =
    String(entity.workerType || 'W2').toUpperCase() === '1099' ? '1099' : 'w2';

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
      assignmentId: '',
      jobTitle: contextLabel,
      messageText,
      emailSubject,
      correlationKey: ck,
      payrollDocId,
      sendSource: 'on_call_employment',
      sendSourceId: payrollDocId,
      dispatchSource: 'on_call_employment',
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
          messageTypeId: 'payroll_onboarding_invite_needed',
          correlationKey: ck,
          dispatchSource: 'on_call_employment',
        },
      });
    }

    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: '',
      userId,
      outcome: result.success ? 'sent' : 'failed',
      messageTypeId: 'payroll_onboarding_invite_needed',
      messageLogId: result.messageLogId,
      hiringEntityId,
      payrollProvider: provider,
      skipReason: result.success ? undefined : result.routingDecision?.reason || 'sendMessage_not_successful',
      details: {
        source: 'on_call_employment',
        channels: result.routingDecision?.channels,
        deliverySuccesses: succeededChannels,
      },
    });
  } catch (e: unknown) {
    logger.error('runPayrollOnboardingInviteForOnCallEmployment failed', {
      tenantId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: 'payroll_onboarding_invite_needed',
      correlationKey: ck,
      assignmentId: '',
      userId,
      outcome: 'failed',
      messageTypeId: 'payroll_onboarding_invite_needed',
      hiringEntityId,
      payrollProvider: provider,
      skipReason: e instanceof Error ? e.message : 'sendMessage_threw',
      details: { source: 'on_call_employment' },
    });
  }
}
