/**
 * After a payroll onboarding invite is delivered, sync tenants/{tid}/worker_payroll_accounts
 * so Employment V2 can show invite state without inferring from messageLogs alone.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export type PayrollInviteDeliveryChannel = 'sms' | 'email' | 'push';

export interface PayrollInviteSendOutcome {
  anyChannelSucceeded: boolean;
  succeededChannels: PayrollInviteDeliveryChannel[];
  messageTypeId: string;
  correlationKey?: string | null;
  dispatchSource: string;
}

function normalizeProvider(p: string | undefined | null): 'tempworks' | 'everee' | 'manual' {
  const v = String(p || '').toLowerCase();
  if (v === 'everee') return 'everee';
  if (v === 'manual' || v === 'none') return 'manual';
  return 'tempworks';
}

function normalizeMode(m: string | undefined | null): 'portal_link_only' | 'manual_tracking' | 'integrated' {
  const v = String(m || '').toLowerCase();
  if (v === 'manual_tracking') return 'manual_tracking';
  if (v === 'integrated') return 'integrated';
  return 'portal_link_only';
}

function nextPayrollStatusAfterInvite(current: string | undefined): string {
  const s = String(current || 'not_started').toLowerCase();
  if (['complete', 'blocked', 'account_created', 'in_progress', 'inactive'].includes(s)) return s;
  return 'invite_sent';
}

function pickLastInviteChannel(channels: PayrollInviteDeliveryChannel[]): PayrollInviteDeliveryChannel {
  const order: PayrollInviteDeliveryChannel[] = ['sms', 'email', 'push'];
  for (const c of order) {
    if (channels.includes(c)) return c;
  }
  return channels[0] ?? 'email';
}

/**
 * Document: tenants/{tenantId}/worker_payroll_accounts/{userId}__{entityKey}
 *
 * User-facing automation fields (spec):
 * - inviteSentAt — timestamp of last successful invite send
 * - inviteFirstSentAt — first successful send only
 * - lastInviteChannel — primary channel that succeeded (sms | email | push)
 * - inviteStatus — 'sent' after successful delivery
 *
 * Legacy / V2 compatibility:
 * - payrollStatus, payrollInviteSentAt, payrollInviteLastSentAt, payrollLastInviteChannelsSucceeded, …
 */
export async function syncWorkerPayrollAccountAfterInviteSend(args: {
  tenantId: string;
  payrollDocId: string;
  userId: string;
  hiringEntityId: string;
  entityKey: string;
  entityName: string;
  payrollProviderRaw: string | null | undefined;
  payrollModeRaw: string | null | undefined;
  workerType?: 'w2' | '1099';
  outcome: PayrollInviteSendOutcome;
}): Promise<void> {
  const {
    tenantId,
    payrollDocId,
    userId,
    hiringEntityId,
    entityKey,
    entityName,
    payrollProviderRaw,
    payrollModeRaw,
    workerType = 'w2',
    outcome,
  } = args;

  if (!outcome.anyChannelSucceeded || outcome.succeededChannels.length === 0) {
    return;
  }

  const ref = db.doc(`tenants/${tenantId}/worker_payroll_accounts/${payrollDocId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : {};
  const prevStatus = existing.payrollStatus as string | undefined;
  const hadFirstSent = Boolean(existing.inviteFirstSentAt || existing.payrollInviteSentAt);

  const lastCh = pickLastInviteChannel(outcome.succeededChannels);

  const updates: Record<string, unknown> = {
    tenantId,
    userId,
    entityId: hiringEntityId,
    entityKey,
    entityName,
    workerType,
    payrollProvider: normalizeProvider(payrollProviderRaw),
    payrollMode: normalizeMode(payrollModeRaw),
    payrollStatus: nextPayrollStatusAfterInvite(prevStatus),
    inviteSentAt: now,
    inviteStatus: 'sent',
    lastInviteChannel: lastCh,
    payrollInviteLastSentAt: now,
    payrollLastInviteChannelsSucceeded: outcome.succeededChannels,
    payrollLastInviteMessageTypeId: outcome.messageTypeId,
    payrollLastInviteSource: outcome.dispatchSource,
    payrollLastInviteCorrelationKey: outcome.correlationKey ?? null,
    updatedAt: now,
  };

  if (!hadFirstSent) {
    updates.inviteFirstSentAt = now;
    updates.payrollInviteSentAt = now;
    updates.payrollInviteFirstSentAt = now;
  }

  try {
    await ref.set(updates, { merge: true });
  } catch (e: any) {
    logger.error('syncWorkerPayrollAccountAfterInviteSend failed', {
      tenantId,
      payrollDocId,
      error: e?.message || String(e),
    });
  }
}
