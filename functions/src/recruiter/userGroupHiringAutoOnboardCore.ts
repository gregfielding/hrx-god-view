/**
 * Shared per-user auto-onboard core for user-group hiring.
 *
 * One function — `evaluateGroupHiringEligibilityForUser` — encodes the same
 * eligibility gates as the manual `userGroupHirePassedCandidates` callable
 * (interview-completed, terminal-status, orchestrator-advance, blocking C1
 * Select employment, plus the `hire_everyone` bypass and the catchall-group
 * synthetic-no-application path). It's used by:
 *
 *   - `onApplicationHiringSignalsChangedAutoOnboard` (Firestore trigger that
 *     fires when prescreen/orchestrator/status signals change on an
 *     application doc — closes the "worker took 3 days to do their interview"
 *     gap that previously left them un-onboarded).
 *   - `onUserGroupMemberAddedAutoOnboard` (Firestore trigger on user-group
 *     writes that fires when a uid is appended to `memberIds`, including the
 *     catchall pattern under the `hire_everyone` quality preset).
 *
 * The companion `autoOnboardForGroupIfEligible` wraps this evaluator with the
 * `runStartOnCallEmploymentFlow` call, including the screening package and
 * entity-default worker type, so triggers don't re-implement that wiring.
 *
 * Idempotency: `runStartOnCallEmploymentFlow` already short-circuits when an
 * `entity_employments` row exists for the (user, entity) pair, so re-firing
 * the trigger on multiple signal changes is safe.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  runStartOnCallEmploymentFlow,
  type StartOnCallEmploymentPayload,
} from '../onboarding/startOnCallEmployment';
import type { WorkerOnboardingPipelineTriggerSource } from '../onboarding/workerOnboardingPipeline';

import { evaluateCurrentPolicyOrchestratorDecision } from './reevaluateHirePassedPolicy';
import {
  EXCLUSION_CATEGORY_LABELS,
  extractOrchestratorDecision,
  isGroupHireEveryonePreset,
  readGroupOnCallHiringContext,
  resolveAccusourceScreeningFromGroupHiringConfig,
  TERMINAL_APPLICATION,
} from './userGroupHirePassedCandidates';

if (!admin.apps.length) {
  admin.initializeApp();
}

export type GroupAutoOnboardEligibilityMode = 'stored' | 'current_policy';

export type GroupAutoOnboardCategory = keyof typeof EXCLUSION_CATEGORY_LABELS;

export interface GroupAutoOnboardEvaluation {
  outcome: 'eligible' | 'excluded';
  /** Free-form reason strings parallel to the manual scan's `rows[i].reasons[]`. */
  reasons: string[];
  /** Stable category code matching `EXCLUSION_CATEGORY_LABELS` keys. `null` when eligible. */
  category: GroupAutoOnboardCategory | null;
  /**
   * Effective orchestrator decision used for the hire/hold call. `'advance'`
   * when `hire_everyone` short-circuits the orchestrator. `null` when the
   * decision could not be resolved (only happens for `current_policy` mode
   * with a re-evaluation failure).
   */
  effectiveOrch: string | null;
}

export interface EvaluateGroupHiringEligibilityArgs {
  db: admin.firestore.Firestore;
  tenantId: string;
  groupId: string;
  groupData: Record<string, unknown>;
  tenantData: Record<string, unknown>;
  userId: string;
  /**
   * Application doc to evaluate. `null` covers the catchall-member pattern
   * (member is in `memberIds` but no application exists).
   */
  applicationDoc: { id: string; data: Record<string, unknown> } | null;
  /** Defaults to `'current_policy'` (re-runs orchestrator with today's tenant + group rules). */
  eligibilityMode?: GroupAutoOnboardEligibilityMode;
}

/**
 * Same per-row gates as the manual scan. Caller is responsible for fetching
 * `tenantData` and `groupData` once and reusing them across many calls.
 */
export async function evaluateGroupHiringEligibilityForUser(
  args: EvaluateGroupHiringEligibilityArgs,
): Promise<GroupAutoOnboardEvaluation> {
  const {
    db,
    tenantId,
    groupId,
    groupData,
    tenantData,
    userId,
    applicationDoc,
    eligibilityMode = 'current_policy',
  } = args;

  const trimmedUid = String(userId ?? '').trim();
  if (!trimmedUid) {
    return {
      outcome: 'excluded',
      reasons: ['Missing userId'],
      category: 'missing_user_id',
      effectiveOrch: null,
    };
  }

  const hireEveryone = isGroupHireEveryonePreset(groupData);

  // Catchall-member synthesis — no application linked. Eligible only under
  // `hire_everyone` (group used as an invite list); otherwise surfaced as
  // excluded with a reason that points at the preset.
  if (!applicationDoc) {
    if (!hireEveryone) {
      return {
        outcome: 'excluded',
        reasons: [
          'Member has no application linked to this group — cannot evaluate hire-passed criteria. Set the quality preset to "hire_everyone" to onboard catchall-group members without an application.',
        ],
        category: 'no_application_linked',
        effectiveOrch: null,
      };
    }
    // Cross-entity employment is allowed (May 2026). See the matching note
    // in `userGroupHirePassedCandidates.ts` — both this auto-onboard core
    // and the user-driven dialog dropped the active-C1-Select hire block at
    // the same time.
    return {
      outcome: 'eligible',
      reasons: [
        'Eligible: catchall-group member with no application; quality preset "hire_everyone" treats group membership as the hire signal.',
      ],
      category: null,
      effectiveOrch: 'advance',
    };
  }

  const data = applicationDoc.data;
  const appStatus = String(data.status ?? '').trim().toLowerCase();
  const storedOrch = extractOrchestratorDecision(data);

  if (TERMINAL_APPLICATION.has(appStatus)) {
    return {
      outcome: 'excluded',
      reasons: [`Application status is terminal (${appStatus})`],
      category: 'application_terminal',
      effectiveOrch: storedOrch,
    };
  }

  if (!data.workerAiPrescreenInterviewCompletedAt && !hireEveryone) {
    return {
      outcome: 'excluded',
      reasons: ['Interview not completed (no workerAiPrescreenInterviewCompletedAt)'],
      category: 'prescreen_not_completed',
      effectiveOrch: storedOrch,
    };
  }

  let effectiveOrch: string | null = storedOrch;
  if (hireEveryone) {
    effectiveOrch = 'advance';
  } else if (eligibilityMode === 'current_policy') {
    try {
      const re = await evaluateCurrentPolicyOrchestratorDecision(
        db,
        tenantId,
        tenantData,
        applicationDoc.id,
        data,
        groupId,
      );
      if (re.decision === null) {
        return {
          outcome: 'excluded',
          reasons: [
            re.reason
              ? `Current policy re-evaluation failed: ${re.reason}`
              : 'Current policy re-evaluation produced no decision',
            ...(storedOrch ? [`Stored orchestrator decision was “${storedOrch}”.`] : []),
          ],
          category: 'orchestrator_no_decision',
          effectiveOrch: storedOrch,
        };
      }
      effectiveOrch = re.decision;
    } catch (e) {
      return {
        outcome: 'excluded',
        reasons: [
          `Current policy re-evaluation error: ${e instanceof Error ? e.message : String(e)}`,
        ],
        category: 'policy_evaluation_error',
        effectiveOrch: storedOrch,
      };
    }
  }

  if (effectiveOrch !== 'advance') {
    return {
      outcome: 'excluded',
      reasons: [
        eligibilityMode === 'current_policy'
          ? effectiveOrch
            ? `Current-policy orchestrator decision is “${effectiveOrch}” (requires “advance”)`
            : 'No current-policy orchestrator decision'
          : storedOrch
            ? `Orchestrator decision is “${storedOrch}” (requires “advance” to count as passed)`
            : 'No orchestrator decision on application (expected after interview submit)',
      ],
      category: effectiveOrch ? 'orchestrator_below_threshold' : 'orchestrator_no_decision',
      effectiveOrch: effectiveOrch ?? storedOrch,
    };
  }

  // Cross-entity employment is allowed (May 2026). See the per-application
  // loop in `userGroupHirePassedCandidates.ts` for the rationale.

  return {
    outcome: 'eligible',
    reasons: [
      hireEveryone
        ? 'Eligible: group quality preset is “hire_everyone” — interview & orchestrator gates bypassed.'
        : eligibilityMode === 'current_policy'
          ? 'Eligible under current tenant + group hiring policy (orchestrator advance).'
          : 'Passed AI interview (orchestrator advance).',
    ],
    category: null,
    effectiveOrch,
  };
}

// Note: `isBlockedByActiveC1Select` (and `BlockedCheckArgs`) lived here until
// the May 2026 cross-entity hire policy change. They preloaded a worker's
// `entity_employments` rows and refused to start a new hire if any active C1
// Select row existed. Both the helper and its call sites were removed when
// the product confirmed workers can hold concurrent active employments
// across entities. Git history preserves the original implementation if it
// ever needs to come back behind a tenant-level toggle.

export interface AutoOnboardArgs {
  db: admin.firestore.Firestore;
  tenantId: string;
  groupId: string;
  userId: string;
  applicationDoc: { id: string; data: Record<string, unknown> } | null;
  /** UID stamped on `worker_onboarding.triggeredBy.uid`. Use a `system:*` actor for triggers. */
  initiatedByUid: string;
  triggerSource: WorkerOnboardingPipelineTriggerSource;
  eligibilityMode?: GroupAutoOnboardEligibilityMode;
  /** Optional override note recorded on the worker-onboarding pipeline. */
  note?: string;
}

export interface AutoOnboardOutcome {
  /**
   * `true` when the group's hiring rules permitted us to even consider the
   * user (hiringActive + autoOnboardEnabled + on-call employment + entity set).
   * `false` short-circuits before evaluation — useful for triggers that want
   * to skip silently when a recruiter hasn't turned auto-onboarding on yet.
   */
  considered: boolean;
  /** `null` when the group rejected the auto-onboard before evaluation. */
  evaluation: GroupAutoOnboardEvaluation | null;
  /** `true` when `runStartOnCallEmploymentFlow` returned successfully. */
  onboardingStarted: boolean;
  pipelineId?: string | null;
  /** Non-null when the C1 Events / Everee provisioner returned a soft warning. */
  evereeProvisionWarning?: string | null;
  /** Set when `runStartOnCallEmploymentFlow` failed; the trigger logs and continues. */
  errorMessage?: string;
}

/**
 * High-level path used by the new triggers: gate on group config, evaluate the
 * candidate, then (if eligible) call `runStartOnCallEmploymentFlow`. Triggers
 * just hand us the `(tenantId, groupId, userId, applicationDoc)` tuple and
 * stay tiny.
 */
export async function autoOnboardForGroupIfEligible(
  args: AutoOnboardArgs,
): Promise<AutoOnboardOutcome> {
  const {
    db,
    tenantId,
    groupId,
    userId,
    applicationDoc,
    initiatedByUid,
    triggerSource,
    eligibilityMode = 'current_policy',
    note,
  } = args;

  const groupSnap = await db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get();
  if (!groupSnap.exists) {
    return { considered: false, evaluation: null, onboardingStarted: false };
  }
  const groupData = groupSnap.data() ?? {};

  const automation = (groupData.hiringConfig as Record<string, unknown> | undefined)?.automation as
    | Record<string, unknown>
    | undefined;
  const hiringActive = automation?.hiringActive === true;
  // The legacy `autoOnboardEnabled` flag was a second toggle that the UI
  // deprecated (see `UserGroupHiringControlPanel.tsx`: "Card A merged into
  // Card A — only the 'Hiring active' toggle was kept; rest deprecated").
  // Because there's no UI path to flip `autoOnboardEnabled` to true, every
  // group sits at its default `false` and the triggers silently no-op even
  // when recruiters have explicitly turned Hiring active ON. Manual
  // "Apply rules to existing members" never checked this flag, which is
  // why that path worked while triggers didn't. We now mirror the manual
  // path: `hiringActive` is the single user-visible switch and the only
  // gate we enforce here. Anyone reintroducing a second toggle in the
  // future MUST also bring back its UI before re-enabling this check.
  if (!hiringActive) {
    return { considered: false, evaluation: null, onboardingStarted: false };
  }

  const hireCtx = readGroupOnCallHiringContext(groupData);
  if (!hireCtx.hiringEntityId || hireCtx.employmentType !== 'on_call') {
    return { considered: false, evaluation: null, onboardingStarted: false };
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenantData = (tenantSnap.data() ?? {}) as Record<string, unknown>;

  // Note: the prior implementation enumerated `tenants/{t}/entities` here
  // to resolve the C1 Select entity id for the hire-block check. That
  // block is gone (May 2026 cross-entity hire policy), so the entities
  // fetch is gone too.

  const evaluation = await evaluateGroupHiringEligibilityForUser({
    db,
    tenantId,
    groupId,
    groupData,
    tenantData,
    userId,
    applicationDoc,
    eligibilityMode,
  });

  if (evaluation.outcome !== 'eligible') {
    return { considered: true, evaluation, onboardingStarted: false };
  }

  const screening = resolveAccusourceScreeningFromGroupHiringConfig(groupData);
  const payload: StartOnCallEmploymentPayload & { initiatedByUid: string } = {
    tenantId,
    userId,
    entityId: hireCtx.hiringEntityId,
    workerType: hireCtx.workerType,
    initiatedByUid,
    triggerSource,
    applicationId: applicationDoc?.id ?? null,
    note: note ?? `auto_group_onboard:${groupId}`,
    screeningPackageId: screening.screeningPackageId,
    screeningPackageName: screening.screeningPackageName,
    screeningRequestedServiceIds: screening.screeningRequestedServiceIds,
  };

  try {
    const result = await runStartOnCallEmploymentFlow({
      ...payload,
      enforceOnCallOnboardingPolicy: true,
    });
    return {
      considered: true,
      evaluation,
      onboardingStarted: true,
      pipelineId: result.pipelineId,
      evereeProvisionWarning: result.evereeProvisionWarning ?? null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn('userGroupAutoOnboard.run_start_on_call_failed', {
      tenantId,
      groupId,
      userId,
      message,
    });
    return {
      considered: true,
      evaluation,
      onboardingStarted: false,
      errorMessage: message,
    };
  }
}
