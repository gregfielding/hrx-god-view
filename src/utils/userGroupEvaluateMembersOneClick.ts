/**
 * One-click: commit evaluation audit + adaptive interview SMS for both evaluator buckets
 * (`ready_for_interview` and `needs_profile_update`). Uses server max batch size (25) and cooldown overrides.
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

/** Legacy profile-reminder SMS path — no longer used by one-click (both buckets use adaptive interview invites). */
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
  /** Always null — profile SMS removed from Evaluate; `needs_profile_update` uses interview invites. */
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

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Writes audit (commit), then prepare → send adaptive interview SMS when either bucket has members.
 * Override cooldowns enabled; max {@link EVALUATE_OUTREACH_MAX_BATCH} recipients per send.
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
  const profileSend: ProfileReminderSendClientResult | null = null;

  const outreachCount =
    (evaluate.counts.ready_for_interview ?? 0) + (evaluate.counts.needs_profile_update ?? 0);
  if (outreachCount > 0) {
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
      `Adaptive interview SMS — sent ${r.interviewSend.sent}, skipped ${r.interviewSend.skipped}, failed ${r.interviewSend.failed} (audit ${r.interviewSend.auditId}). Includes Ready for interview + Needs profile update buckets.`,
    );
  } else if (
    (r.evaluate.counts.ready_for_interview ?? 0) > 0 ||
    (r.evaluate.counts.needs_profile_update ?? 0) > 0
  ) {
    lines.push(
      'Adaptive interview SMS — no messages sent (all candidates skipped in this batch).',
    );
  }
  if (
    (r.evaluate.counts.ready_for_interview ?? 0) === 0 &&
    (r.evaluate.counts.needs_profile_update ?? 0) === 0
  ) {
    lines.push('No outreach SMS (no members in Ready for interview or Needs profile update).');
  }
  return lines.join('\n');
}
