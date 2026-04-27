/**
 * Operational: classify user group members for interview invite vs profile nudge vs skip.
 * Preview + audit only in v1 — bulk interview send: `userGroupInterviewInviteSend`.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
import {
  runUserGroupMemberNextStepEvaluation,
  type UserGroupMemberNextStepRow,
} from './userGroupMemberNextStepEvaluationCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type NextStepBucket =
  | 'ready_for_interview'
  | 'needs_profile_update'
  | 'already_handled'
  | 'excluded';

export type { UserGroupMemberNextStepRow };

export type UserGroupEvaluateMembersResult = {
  tenantId: string;
  groupId: string;
  mode: 'preview' | 'commit';
  memberCount: number;
  counts: Record<NextStepBucket, number>;
  rows: UserGroupMemberNextStepRow[];
  /** How applications were bound to members (group-linked vs latest tenant app vs profile-only). */
  applicationResolutionStats: {
    groupLinked: number;
    tenantFallback: number;
    profileOnly: number;
  };
  auditId: string | null;
  committedAt: admin.firestore.Timestamp | null;
  note: string;
};

export const userGroupEvaluateMembersNextStep = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '512MiB', timeoutSeconds: 120 },
  async (request): Promise<UserGroupEvaluateMembersResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data || {}) as { tenantId?: unknown; groupId?: unknown; mode?: unknown };
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : '';
    const mode = raw.mode === 'commit' ? 'commit' : 'preview';

    if (!tenantId || !groupId) {
      throw new HttpsError('invalid-argument', 'tenantId and groupId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    let evalResult;
    try {
      evalResult = await runUserGroupMemberNextStepEvaluation(tenantId, groupId);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'USER_GROUP_NOT_FOUND') {
        throw new HttpsError('not-found', 'User group not found');
      }
      throw e;
    }

    const { memberIds, rows, counts, prescreenEligibilityPolicy, applicationResolutionStats } = evalResult;

    let auditId: string | null = null;
    let committedAt: admin.firestore.Timestamp | null = null;

    if (mode === 'commit') {
      const ref = db.collection(`tenants/${tenantId}/user_group_member_next_step_audit`).doc();
      auditId = ref.id;
      committedAt = admin.firestore.Timestamp.now();
      await ref.set({
        type: 'user_group_evaluate_members_next_step',
        tenantId,
        groupId,
        performedByUid: request.auth.uid,
        performedAt: committedAt,
        memberCount: memberIds.length,
        counts,
        rows,
        prescreenEligibilityPolicy,
        applicationResolutionStats,
        note: 'v1: audit only — use userGroupInterviewInviteSend for controlled interview SMS',
      });
      logger.info('user_group_member_next_step_audit', { tenantId, groupId, auditId, performedBy: request.auth.uid });
    }

    return {
      tenantId,
      groupId,
      mode,
      memberCount: memberIds.length,
      counts,
      rows,
      applicationResolutionStats,
      auditId,
      committedAt,
      note:
        'Preview/audit. Interview invites (adaptive prescreen) cover both Ready for interview and Needs profile update buckets — use userGroupInterviewInviteSend.',
    };
  },
);
