/**
 * One-click: commit evaluation audit + server prepare/send for interview + profile SMS.
 * Uses server max batch size (25) and override cooldowns, matching prior dialog defaults at cap.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const REGION = 'us-central1';

/** Server hard cap per prepare/send (see functions userGroupInterviewInviteSend). */
export const EVALUATE_OUTREACH_MAX_BATCH = 25;

export type EvaluateMembersResult = {
  tenantId: string;
  groupId: string;
  mode: 'preview' | 'commit';
  memberCount: number;
  counts: Record<string, number>;
  auditId: string | null;
  note: string;
};

export type InterviewInviteSendClientResult = {
  action: 'send';
  auditId: string;
  sent: number;
  skipped: number;
  failed: number;
};

export type ProfileReminderSendClientResult = {
  action: 'send';
  flow: 'profile_reminder';
  auditId: string;
  sent: number;
  skipped: number;
  failed: number;
};

export type EvaluateMembersOneClickResult = {
  evaluate: EvaluateMembersResult;
  interviewSend: InterviewInviteSendClientResult | null;
  profileSend: ProfileReminderSendClientResult | null;
};

const userGroupEvaluateMembersNextStep = httpsCallable<
  { tenantId: string; groupId: string; mode: 'preview' | 'commit' },
  EvaluateMembersResult
>(getFunctions(app, REGION), 'userGroupEvaluateMembersNextStep');

type InterviewPrepare = {
  action: 'prepare';
  previewToken: string;
  confirmationRequired: string;
  selectedRecipients: unknown[];
};

type ProfilePrepare = {
  action: 'prepare';
  previewToken: string;
  confirmationRequired: string;
  selectedRecipients: unknown[];
};

const userGroupInterviewInviteSendCallable = httpsCallable<
  {
    action: 'prepare' | 'send';
    tenantId: string;
    groupId: string;
    maxRecipients?: number;
    includeCooldownWarnings?: boolean;
    previewToken?: string;
    idempotencyKey?: string;
    typedConfirmation?: string;
  },
  InterviewPrepare | InterviewInviteSendClientResult
>(getFunctions(app, REGION), 'userGroupInterviewInviteSend');

const userGroupProfileReminderSendCallable = httpsCallable<
  {
    action: 'prepare' | 'send';
    tenantId: string;
    groupId: string;
    maxRecipients?: number;
    includeCooldownWarnings?: boolean;
    previewToken?: string;
    idempotencyKey?: string;
    typedConfirmation?: string;
  },
  ProfilePrepare | ProfileReminderSendClientResult
>(getFunctions(app, REGION), 'userGroupProfileReminderSend');

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Writes audit (commit), then for each non-empty bucket runs prepare → send with confirmation string from the server.
 * Single batch per channel (max {@link EVALUATE_OUTREACH_MAX_BATCH} recipients each); override cooldowns enabled.
 */
export async function runEvaluateMembersOneClick(params: {
  tenantId: string;
  groupId: string;
}): Promise<EvaluateMembersOneClickResult> {
  const { tenantId, groupId } = params;

  const { data: evaluate } = await userGroupEvaluateMembersNextStep({
    tenantId,
    groupId,
    mode: 'commit',
  });

  const cap = EVALUATE_OUTREACH_MAX_BATCH;
  const includeCooldownWarnings = true;

  let interviewSend: InterviewInviteSendClientResult | null = null;
  let profileSend: ProfileReminderSendClientResult | null = null;

  if ((evaluate.counts.ready_for_interview ?? 0) > 0) {
    const { data: prep } = await userGroupInterviewInviteSendCallable({
      action: 'prepare',
      tenantId,
      groupId,
      maxRecipients: cap,
      includeCooldownWarnings,
    });
    if (prep.action !== 'prepare') {
      throw new Error('Unexpected interview prepare response');
    }
    if (prep.selectedRecipients.length > 0) {
      const { data: send } = await userGroupInterviewInviteSendCallable({
        action: 'send',
        tenantId,
        groupId,
        previewToken: prep.previewToken,
        idempotencyKey: newIdempotencyKey(),
        typedConfirmation: prep.confirmationRequired,
      });
      if (send.action !== 'send') {
        throw new Error('Unexpected interview send response');
      }
      interviewSend = send;
    }
  }

  if ((evaluate.counts.needs_profile_update ?? 0) > 0) {
    const { data: prep } = await userGroupProfileReminderSendCallable({
      action: 'prepare',
      tenantId,
      groupId,
      maxRecipients: cap,
      includeCooldownWarnings,
    });
    if (prep.action !== 'prepare') {
      throw new Error('Unexpected profile prepare response');
    }
    if (prep.selectedRecipients.length > 0) {
      const { data: send } = await userGroupProfileReminderSendCallable({
        action: 'send',
        tenantId,
        groupId,
        previewToken: prep.previewToken,
        idempotencyKey: newIdempotencyKey(),
        typedConfirmation: prep.confirmationRequired,
      });
      if (send.action !== 'send') {
        throw new Error('Unexpected profile send response');
      }
      profileSend = send;
    }
  }

  return { evaluate, interviewSend, profileSend };
}

export function formatEvaluateMembersOneClickSuccess(r: EvaluateMembersOneClickResult): string {
  const lines: string[] = [];
  lines.push('Evaluation completed.');
  if (r.evaluate.auditId) {
    lines.push(`Audit log: ${r.evaluate.auditId}`);
  }
  lines.push(
    `Buckets — Ready for interview: ${r.evaluate.counts.ready_for_interview ?? 0}, Needs profile: ${r.evaluate.counts.needs_profile_update ?? 0}`,
  );
  if (r.interviewSend) {
    lines.push(
      `Interview SMS — sent ${r.interviewSend.sent}, skipped ${r.interviewSend.skipped}, failed ${r.interviewSend.failed} (audit ${r.interviewSend.auditId})`,
    );
  } else if ((r.evaluate.counts.ready_for_interview ?? 0) > 0) {
    lines.push('Interview SMS — no messages sent (all candidates skipped in this batch).');
  }
  if (r.profileSend) {
    lines.push(
      `Profile SMS — sent ${r.profileSend.sent}, skipped ${r.profileSend.skipped}, failed ${r.profileSend.failed} (audit ${r.profileSend.auditId})`,
    );
  } else if ((r.evaluate.counts.needs_profile_update ?? 0) > 0) {
    lines.push('Profile SMS — no messages sent (all candidates skipped in this batch).');
  }
  if (
    (r.evaluate.counts.ready_for_interview ?? 0) === 0 &&
    (r.evaluate.counts.needs_profile_update ?? 0) === 0
  ) {
    lines.push('No outreach SMS (no members in Ready for interview or Needs profile update).');
  }
  return lines.join('\n');
}
