/**
 * Payroll onboarding invite when there is no assignment (on-call / labor pool hire).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { buildWorkerPayrollEvereeTenantUrl } from '../utils/workerUrls';
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

/** Dedupe key after Everee worker provisioning — distinct from the legacy on-call invite key (often skipped when no payroll URL). */
export function payrollEvereePostProvisionCorrelationKey(
  tenantId: string,
  userId: string,
  entityKey: string,
): string {
  return `payroll_onboarding_invite_everee_postprovision__${V}__${tenantId}__${userId}__${entityKey}`;
}

/**
 * Fire `payroll_onboarding_invite_needed` with HRX payroll URLs once Everee worker create succeeds.
 * Uses {@link sendPayrollOnboardingInviteWithAutomationFallback} (same as assignment-confirmed slice).
 */
export async function runEvereePayrollOnboardingInviteAfterOnCallProvision(args: {
  tenantId: string;
  userId: string;
  hiringEntityId: string;
  entityName: string;
  entityKey: string;
  pipelineId: string;
  evereeTenantId: string;
  firstName: string;
  workerType: 'w2' | '1099';
}): Promise<void> {
  const {
    tenantId,
    userId,
    hiringEntityId,
    entityName,
    entityKey,
    pipelineId,
    evereeTenantId,
    firstName,
    workerType,
  } = args;

  const payrollUrl = buildWorkerPayrollEvereeTenantUrl(evereeTenantId);
  if (!payrollUrl) {
    logger.warn('runEvereePayrollOnboardingInviteAfterOnCallProvision: empty payroll URL', {
      tenantId,
      evereeTenantId,
    });
    return;
  }

  const ck = payrollEvereePostProvisionCorrelationKey(tenantId, userId, entityKey);
  const first = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: ck,
    eventType: 'payroll_onboarding_invite_needed',
    context: {
      userId,
      hiringEntityId,
      source: 'on_call_everee_provisioned',
      evereeTenantId,
      pipelineId,
    },
  });
  if (!first) {
    logger.info('Everee post-provision payroll invite skipped: dedupe', { tenantId, userId, entityKey });
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
      payrollProvider: 'everee',
      details: { source: 'on_call_everee_provisioned', workerPayrollAccountId: payrollDocId },
    });
    return;
  }

  const fn = String(firstName || '').trim() || 'there';
  const contextLabel = 'your on-call employment';
  const messageText = `Hi ${fn}, complete your payroll onboarding for ${entityName} for ${contextLabel}: ${payrollUrl}`;
  const emailSubject = `Payroll onboarding — ${entityName}`;

  try {
    const result = await sendPayrollOnboardingInviteWithAutomationFallback({
      tenantId,
      userId,
      firstName: fn,
      hiringEntityId,
      entityName,
      onboardingUrl: payrollUrl,
      signupUrl: payrollUrl,
      portalLoginUrl: '',
      provider: 'everee',
      assignmentId: '',
      jobTitle: '',
      messageText,
      emailSubject,
      correlationKey: ck,
      payrollDocId,
      sendSource: 'on_call_everee_provisioned',
      sendSourceId: pipelineId,
      dispatchSource: 'on_call_everee_provisioned',
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
        payrollProviderRaw: 'everee',
        payrollModeRaw: 'integrated',
        workerType,
        outcome: {
          anyChannelSucceeded: true,
          succeededChannels,
          messageTypeId: 'payroll_onboarding_invite_needed',
          correlationKey: ck,
          dispatchSource: 'on_call_everee_provisioned',
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
      payrollProvider: 'everee',
      skipReason: result.success ? undefined : result.routingDecision?.reason || 'sendMessage_not_successful',
      details: {
        source: 'on_call_everee_provisioned',
        channels: result.routingDecision?.channels,
        deliverySuccesses: succeededChannels,
      },
    });
  } catch (e: unknown) {
    logger.error('runEvereePayrollOnboardingInviteAfterOnCallProvision failed', {
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
      payrollProvider: 'everee',
      skipReason: e instanceof Error ? e.message : 'sendMessage_threw',
      details: { source: 'on_call_everee_provisioned' },
    });
  }
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
