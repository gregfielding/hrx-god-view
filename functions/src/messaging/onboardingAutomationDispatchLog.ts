/**
 * Audit log for onboarding automation (assignment-confirmed slice and future triggers).
 * Written by Cloud Functions only (Admin SDK).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export type OnboardingAutomationDispatchOutcome =
  | 'recorded'
  | 'sent'
  | 'skipped'
  | 'failed';

export async function writeOnboardingAutomationDispatchLog(args: {
  tenantId: string;
  eventType: string;
  correlationKey: string;
  assignmentId: string;
  userId: string;
  outcome: OnboardingAutomationDispatchOutcome;
  messageTypeId?: string;
  messageLogId?: string;
  skipReason?: string;
  hiringEntityId?: string | null;
  payrollProvider?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const {
    tenantId,
    eventType,
    correlationKey,
    assignmentId,
    userId,
    outcome,
    messageTypeId,
    messageLogId,
    skipReason,
    hiringEntityId,
    payrollProvider,
    details,
  } = args;

  try {
    await db.collection('tenants').doc(tenantId).collection('onboarding_automation_dispatch').add({
      eventType,
      correlationKey,
      assignmentId,
      userId,
      outcome,
      messageTypeId: messageTypeId ?? null,
      messageLogId: messageLogId ?? null,
      skipReason: skipReason ?? null,
      hiringEntityId: hiringEntityId ?? null,
      payrollProvider: payrollProvider ?? null,
      details: details ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e: any) {
    logger.warn('writeOnboardingAutomationDispatchLog failed', {
      tenantId,
      eventType,
      correlationKey,
      error: e?.message || String(e),
    });
  }
}
