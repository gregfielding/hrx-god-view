/**
 * Auto-onboard reactor for user-group `memberIds` additions.
 *
 * Fires on every write to `tenants/{tenantId}/userGroups/{groupId}` and runs
 * the group's hiring rules (via the shared evaluator) for any uid that just
 * appeared in `memberIds`. Handles two patterns equally:
 *
 *   1. Member already has an application linked to this group → evaluator
 *      runs the standard interview/orchestrator/C1-Select gates against that
 *      application (current-policy mode).
 *   2. Member has NO application linked (catchall pattern, recruiter using
 *      the group as an invite list) → under the `hire_everyone` quality
 *      preset the evaluator returns eligible directly; under any other
 *      preset the member is silently skipped (the manual "Apply rules to
 *      existing members" button surfaces the same case as excluded with a
 *      guiding reason — but we don't want triggers to write noise into
 *      `system_logs` for every catchall member).
 *
 * Companion to `onApplicationHiringSignalsChangedAutoOnboard`: between them,
 * every door into eligibility (member added; signal arrives later) is
 * covered. Both delegate to `autoOnboardForGroupIfEligible` so the rules
 * stay in lockstep with the manual button.
 *
 * Idempotency: `runStartOnCallEmploymentFlow` short-circuits when an
 * `entity_employments` row already exists for the (user, entity) pair, so
 * re-firing this trigger on subsequent group writes is safe.
 *
 * NOT in scope: re-evaluating MEMBER REMOVALS. Removing a uid from
 * `memberIds` does NOT revoke onboarding — that's a deliberate manual
 * decision the recruiter must take through the existing offboarding paths.
 */
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import {
  TWILIO_A2P_CAMPAIGN,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
} from '../messaging/twilioSecrets';
import { isGroupHireEveryonePreset } from './userGroupHirePassedCandidates';
import { autoOnboardForGroupIfEligible } from './userGroupHiringAutoOnboardCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SYSTEM_ACTOR = 'system:auto_user_group_member_added';

function readMemberIds(data: Record<string, unknown> | undefined): string[] {
  if (!data || !Array.isArray(data.memberIds)) return [];
  return (data.memberIds as unknown[]).map((x) => String(x).trim()).filter(Boolean);
}

/**
 * Find an application linked to (group, user) for the per-row evaluator. We
 * prefer `groupId === groupId` matches (explicit attachment), then fall back
 * to any application by this user — under `hire_everyone` the evaluator can
 * also accept `null` for the catchall case.
 *
 * Capped at 1 doc; if the worker has many open applications we'll evaluate
 * the most-likely-correct one and leave the rest to the application-signal
 * trigger.
 */
async function findApplicationForGroupAndUser(
  db: admin.firestore.Firestore,
  tenantId: string,
  groupId: string,
  userId: string,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  try {
    const byGroup = await db
      .collection(`tenants/${tenantId}/applications`)
      .where('groupId', '==', groupId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (!byGroup.empty) {
      const d = byGroup.docs[0];
      return { id: d.id, data: d.data() as Record<string, unknown> };
    }
  } catch (e) {
    logger.warn('userGroupAutoOnboard.member_added_find_app_by_group_failed', {
      tenantId,
      groupId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    const byUser = await db
      .collection(`tenants/${tenantId}/applications`)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    if (!byUser.empty) {
      const d = byUser.docs[0];
      return { id: d.id, data: d.data() as Record<string, unknown> };
    }
  } catch (e) {
    logger.warn('userGroupAutoOnboard.member_added_find_app_by_user_failed', {
      tenantId,
      groupId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return null;
}

export const onUserGroupMemberAddedAutoOnboard = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/userGroups/{groupId}',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (event) => {
    const { tenantId, groupId } = event.params;
    const beforeData = event.data?.before?.data() as Record<string, unknown> | undefined;
    const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!afterData) return;

    const before = new Set(readMemberIds(beforeData));
    const after = readMemberIds(afterData);
    const newlyAdded = after.filter((uid) => !before.has(uid));
    if (newlyAdded.length === 0) return;

    // Quick pre-filter against the group's own automation gates so we skip
    // expensive per-uid work entirely for groups that haven't enabled
    // hiring. The shared core re-checks this so the trigger remains safe
    // in isolation.
    //
    // We deliberately do NOT check `autoOnboardEnabled` here: that flag's
    // UI was retired and groups have no path to flip it to `true`, so
    // requiring it would silently no-op every legitimate recruiter
    // configuration. `hiringActive` is the single user-visible switch and
    // the manual "Apply rules to existing members" callable already
    // mirrors this. See userGroupHiringAutoOnboardCore.ts for the long
    // form of the same explanation.
    const automation = (afterData.hiringConfig as Record<string, unknown> | undefined)?.automation as
      | Record<string, unknown>
      | undefined;
    if (automation?.hiringActive !== true) {
      return;
    }
    const employment = (afterData.hiringConfig as Record<string, unknown> | undefined)?.employment as
      | Record<string, unknown>
      | undefined;
    if (
      String(employment?.employmentType ?? '').trim().toLowerCase() !== 'on_call' ||
      !String(employment?.hiringEntityId ?? '').trim()
    ) {
      return;
    }

    const hireEveryone = isGroupHireEveryonePreset(afterData);
    const db = admin.firestore();

    let onboarded = 0;
    let evaluatedExcluded = 0;
    let skippedNoApp = 0;
    const failures: Array<{ userId: string; message: string }> = [];
    // Histogram of exclusion `category` codes (matches
    // EXCLUSION_CATEGORY_LABELS in userGroupHirePassedCandidates.ts) so the
    // summary log surfaces the dominant blocker without needing to
    // jq-merge per-uid lines.
    const excludedCategoryCounts: Record<string, number> = {};

    for (const userId of newlyAdded) {
      try {
        const applicationDoc = await findApplicationForGroupAndUser(
          db,
          tenantId,
          groupId,
          userId,
        );

        // Catchall path: under any preset other than `hire_everyone`, a
        // member without an application produces noise rather than action.
        // Skip silently — the manual button still surfaces them in the
        // `Why excluded` breakdown if the recruiter wants to investigate.
        if (!applicationDoc && !hireEveryone) {
          skippedNoApp += 1;
          continue;
        }

        const result = await autoOnboardForGroupIfEligible({
          db,
          tenantId,
          groupId,
          userId,
          applicationDoc,
          initiatedByUid: SYSTEM_ACTOR,
          triggerSource: 'auto_user_group_membership_added',
          note: `auto_member_added:${groupId}`,
        });

        if (result.onboardingStarted) {
          onboarded += 1;
          logger.info('userGroupAutoOnboard.member_added_onboarded', {
            tenantId,
            groupId,
            userId,
            applicationId: applicationDoc?.id ?? null,
            pipelineId: result.pipelineId ?? null,
            evereeProvisionWarning: result.evereeProvisionWarning ?? null,
          });
        } else if (result.evaluation?.outcome === 'excluded') {
          evaluatedExcluded += 1;
          const category = result.evaluation.category ?? 'unknown';
          excludedCategoryCounts[category] = (excludedCategoryCounts[category] ?? 0) + 1;
          // Per-uid exclusion line so recruiters debugging "member added but
          // not onboarded" can see WHY in one log query without re-running
          // the manual scan. Mirrors `application_signal_evaluated_excluded`
          // shape on the companion trigger.
          logger.info('userGroupAutoOnboard.member_added_evaluated_excluded', {
            tenantId,
            groupId,
            userId,
            applicationId: applicationDoc?.id ?? null,
            category,
            reason: result.evaluation.reasons?.[0] ?? null,
          });
        } else if (result.errorMessage) {
          failures.push({ userId, message: result.errorMessage });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push({ userId, message });
        logger.warn('userGroupAutoOnboard.member_added_unexpected_error', {
          tenantId,
          groupId,
          userId,
          message,
        });
      }
    }

    logger.info('userGroupAutoOnboard.member_added_processed', {
      tenantId,
      groupId,
      addedCount: newlyAdded.length,
      onboarded,
      evaluatedExcluded,
      skippedNoApp,
      failureCount: failures.length,
      excludedCategoryCounts,
    });
  },
);
