/**
 * Payroll onboarding invite: try tenant automation rules (trigger payroll_onboarding_invite_needed),
 * then fall back to the legacy default body via sendMessage.
 */
import { logger } from 'firebase-functions/v2';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { sendMessage, type SendMessageResult } from './routingOrchestrator';
import { SYSTEM_TRIGGER_KEYS } from './triggerRegistry';

export interface PayrollOnboardingInviteAutomationParams {
  tenantId: string;
  userId: string;
  firstName: string;
  hiringEntityId: string;
  entityName: string;
  onboardingUrl: string | null;
  signupUrl: string | null;
  portalLoginUrl: string | null;
  provider: string | null;
  /** Empty string when invite is from on-call (no assignment). */
  assignmentId: string;
  jobTitle: string;
  messageText: string;
  emailSubject: string;
  correlationKey: string;
  payrollDocId: string;
  /** `source` / `sourceId` on the final sendMessage (metadata + envelope). */
  sendSource: string;
  sendSourceId: string;
  dispatchSource:
    | 'on_call_employment'
    | 'assignment_confirmed_onboarding'
    | 'on_call_everee_provisioned';
}

export async function sendPayrollOnboardingInviteWithAutomationFallback(
  params: PayrollOnboardingInviteAutomationParams
): Promise<SendMessageResult> {
  const obUrl = params.onboardingUrl || '';
  const variablePayload = {
    firstName: params.firstName,
    entityName: params.entityName,
    hiringEntityId: params.hiringEntityId,
    payrollOnboardingUrl: obUrl,
    payrollSignupUrl: params.signupUrl || '',
    payrollPortalLoginUrl: params.portalLoginUrl || '',
    payrollProvider: params.provider || '',
    assignmentId: params.assignmentId,
    jobTitle: params.jobTitle,
    correlationKey: params.correlationKey,
    message: params.messageText,
    _message: params.messageText,
    _subject: params.emailSubject,
  };

  const dispatched = await dispatchSystemMessage({
    tenantId: params.tenantId,
    userId: params.userId,
    triggerKey: SYSTEM_TRIGGER_KEYS.payrollOnboardingInviteNeeded,
    context: variablePayload,
    metadata: {
      correlationKey: params.correlationKey,
      hiringEntityId: params.hiringEntityId,
      entityId: params.hiringEntityId,
      dispatchSource: params.dispatchSource,
    },
    source: params.sendSource,
    sourceId: params.sendSourceId,
  });

  if (dispatched.handled && dispatched.sent && dispatched.sendMessageResult) {
    return dispatched.sendMessageResult;
  }

  if (dispatched.handled && !dispatched.sent) {
    logger.info('payroll_onboarding_invite_needed: no successful automation send, using default body', {
      tenantId: params.tenantId,
      userId: params.userId,
      errors: dispatched.errors,
    });
  }

  return sendMessage({
    userId: params.userId,
    tenantId: params.tenantId,
    messageTypeId: 'payroll_onboarding_invite_needed',
    variables: variablePayload,
    metadata: {
      source: params.sendSource,
      sourceId: params.sendSourceId,
      correlationKey: params.correlationKey,
      hiringEntityId: params.hiringEntityId,
      entityId: params.hiringEntityId,
    },
    source: params.sendSource,
    sourceId: params.sendSourceId,
  });
}
