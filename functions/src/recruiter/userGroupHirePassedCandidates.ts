/**
 * Narrow operational tool: preview (and optional audit log) for "hire passed" candidates
 * for a user group. Scans:
 * - applications with `groupId` matching this group, and
 * - applications for users listed in the group's `memberIds` (membership as source of truth).
 * `execute`: same scan + audit, then starts on-call onboarding (`runStartOnCallEmploymentFlow`) for each
 * eligible distinct user (requires group `hiringConfig.employment` on-call + hiring entity).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
import { runStartOnCallEmploymentFlow } from '../onboarding/startOnCallEmployment';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import { evaluateCurrentPolicyOrchestratorDecision } from './reevaluateHirePassedPolicy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type UserGroupHirePassedMode = 'preview' | 'commit' | 'execute';

/** `current_policy` (default): re-run orchestrator with merged tenant+group hiring config. `stored`: legacy read of saved decision only. */
export type UserGroupHirePassedEligibilityMode = 'stored' | 'current_policy';

export type UserGroupHirePassedRow = {
  applicationId: string;
  userId: string;
  displayNameHint: string;
  outcome: 'eligible' | 'excluded';
  reasons: string[];
  orchestratorDecision: string | null;
  applicationStatus: string | null;
};

export type UserGroupHirePassedResult = {
  groupId: string;
  tenantId: string;
  mode: UserGroupHirePassedMode;
  eligibilityMode: UserGroupHirePassedEligibilityMode;
  c1SelectEntityId: string | null;
  c1SelectResolved: boolean;
  /** Count of user IDs on the group document (`memberIds`). */
  groupMemberCount: number;
  applicationsScanned: number;
  /**
   * Members in `memberIds` who have no application linked to them. These are
   * surfaced as synthetic rows by the scan: under `hire_everyone` they count
   * toward `eligibleCount` (subject to the C1 Select employment block); under
   * any other preset they count toward `excludedCount` with a guiding reason.
   */
  membersWithoutApplicationCount: number;
  rows: UserGroupHirePassedRow[];
  eligibleCount: number;
  excludedCount: number;
  /**
   * Diagnostic histogram of exclusion reasons. Lets the dialog tell recruiters
   * *why* most of their scan came back excluded (e.g. "84 prescreens not
   * completed", "12 below score threshold") rather than just an aggregate count.
   * Sorted by `count` desc so the top blocker reads first.
   */
  exclusionBreakdown: Array<{ category: string; label: string; count: number }>;
  auditId: string | null;
  committedAt: admin.firestore.Timestamp | null;
  /** Set when `mode === 'execute'`. */
  onboardingStarted?: number;
  onboardingFailed?: Array<{ userId: string; message: string }>;
};

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

export function resolveC1SelectEntityId(
  entities: Array<{ id: string; name: string; entityCode?: string }>,
): string | null {
  const byCode = entities.find((e) => (e.entityCode || '').trim().toUpperCase() === 'C1SL');
  if (byCode) return byCode.id;
  const found =
    entities.find((e) => {
      const n = e.name.trim().toLowerCase();
      return n === 'c1 select llc' || /^c1\s+select\b/i.test(e.name.trim());
    }) ?? null;
  return found?.id ?? null;
}

/** Orchestrator final decision (advance = passed hiring rules for this tool). */
export function extractOrchestratorDecision(data: Record<string, unknown>): string | null {
  const aa = data.aiAutomation as Record<string, unknown> | undefined;
  if (!aa || typeof aa !== 'object') return null;
  const legacy = aa.decision;
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim().toLowerCase();
  const v1 = aa.orchestratorV1 as Record<string, unknown> | undefined;
  if (!v1 || typeof v1 !== 'object') return null;
  const final = v1.finalResult as Record<string, unknown> | undefined;
  const policyEngine = v1.policyEngineResult as Record<string, unknown> | undefined;
  const fr =
    final && typeof final.decision === 'string'
      ? final
      : policyEngine && typeof policyEngine.decision === 'string'
        ? policyEngine
        : final ?? policyEngine;
  const decRaw = fr && typeof fr.decision === 'string' ? fr.decision : '';
  return decRaw ? decRaw.trim().toLowerCase() : null;
}

export function applicantNameFromApplication(data: Record<string, unknown>): string {
  const direct = String(data.applicantName || data.displayName || '').trim();
  if (direct) return direct;
  const fn = String(data.firstName || '').trim();
  const ln = String(data.lastName || '').trim();
  const j = [fn, ln].filter(Boolean).join(' ');
  return j || '—';
}

export const TERMINAL_APPLICATION = new Set(['rejected', 'withdrawn']);
const BLOCKING_C1_STATUSES = new Set(['active', 'onboarding', 'hired', 'offer_pending', 'pending', 'in_progress']);

export function isC1SelectEmployment(rec: Record<string, unknown>, c1EntityId: string | null): boolean {
  const ek = norm(rec.entityKey);
  if (ek === 'select') return true;
  const eid = String(rec.entityId || '').trim();
  if (c1EntityId && eid && eid === c1EntityId) return true;
  return false;
}

export function c1EmploymentBlocksHire(rec: Record<string, unknown>): { blocks: boolean; detail: string } {
  const st = norm(rec.status || rec.employmentState);
  if (st && BLOCKING_C1_STATUSES.has(st)) {
    return { blocks: true, detail: `C1 Select employment status “${st}”` };
  }
  return { blocks: false, detail: '' };
}

/**
 * Stable category codes for excluded rows. Keep in sync with `categorizeExclusionRow`.
 * The dialog renders the histogram these produce so recruiters can see *why* a
 * scan returned mostly excluded rows (e.g. 84 prescreens not completed) instead
 * of having to dig through audit-log row reasons.
 */
export const EXCLUSION_CATEGORY_LABELS: Record<string, string> = {
  prescreen_not_completed: 'Prescreen not completed',
  application_terminal: 'Application terminal (rejected/withdrawn)',
  orchestrator_below_threshold: 'Below score threshold / orchestrator hold',
  orchestrator_no_decision: 'No orchestrator decision',
  policy_evaluation_error: 'Policy re-evaluation error',
  blocked_by_c1_select: 'Active C1 Select employment',
  no_application_linked: 'Member has no application linked',
  missing_user_id: 'Application missing userId',
  other: 'Other',
};

export function categorizeExclusionRow(row: UserGroupHirePassedRow): keyof typeof EXCLUSION_CATEGORY_LABELS {
  const first = (row.reasons[0] ?? '').toLowerCase();
  if (!first) return 'other';
  if (first.includes('missing userid')) return 'missing_user_id';
  if (first.includes('application status is terminal')) return 'application_terminal';
  if (first.includes('interview not completed')) return 'prescreen_not_completed';
  if (first.includes('current policy re-evaluation')) return 'policy_evaluation_error';
  if (
    first.includes('orchestrator decision is') ||
    first.includes('current-policy orchestrator decision is')
  ) {
    return 'orchestrator_below_threshold';
  }
  if (
    first.includes('no orchestrator decision') ||
    first.includes('no current-policy orchestrator decision')
  ) {
    return 'orchestrator_no_decision';
  }
  if (first.includes('c1 select employment')) return 'blocked_by_c1_select';
  if (first.includes('no application linked')) return 'no_application_linked';
  return 'other';
}

/**
 * Returns true when the group's saved quality preset is `hire_everyone`. In that
 * case the eligibility scan bypasses the interview-completion + orchestrator-advance
 * gates (since "hire everyone" cannot mean "everyone who happened to finish a prescreen
 * AND was scored ≥ 0"). Sanity gates that protect data integrity still apply: missing
 * userId, terminal application status, and active blocking C1 Select employment.
 */
export function isGroupHireEveryonePreset(groupData: Record<string, unknown>): boolean {
  const hc = groupData.hiringConfig as Record<string, unknown> | undefined;
  const q =
    hc && typeof hc === 'object' ? (hc.quality as Record<string, unknown> | undefined) : undefined;
  const preset = String(q?.preset ?? '').trim().toLowerCase();
  return preset === 'hire_everyone';
}

export function readGroupOnCallHiringContext(groupData: Record<string, unknown>): {
  hiringEntityId: string;
  /**
   * Worker type is owned by the tenant Entity, not the user group: we always pass
   * `'entity_default'` to `runStartOnCallEmploymentFlow` so the server resolves it via
   * `resolveEvereeWorkerTypeForOnCall(entityId, entityDoc)`. This matches the
   * auto-onboarding trigger in `onApplicationCreatedPush.ts` (search: `entity_default`)
   * and avoids drift when a recruiter ever toggled W-2/1099 on the group while the
   * Entity disagreed.
   */
  workerType: 'entity_default';
  employmentType: string;
} {
  const hc = groupData.hiringConfig as Record<string, unknown> | undefined;
  const emp =
    hc && typeof hc === 'object' ? (hc.employment as Record<string, unknown> | undefined) : undefined;
  const e = emp && typeof emp === 'object' ? emp : {};
  const hiringEntityId = String(e.hiringEntityId || '').trim();
  const employmentType = String(e.employmentType || 'standard').trim().toLowerCase();
  return { hiringEntityId, workerType: 'entity_default', employmentType };
}

/**
 * Group hiring tab: `hiringConfig.requirements` AccuSource package for on-call execute.
 * Aligns with Recruiter UI (`accusourceScreeningRequired` + package id/name) and migrates legacy drug/bg toggles.
 */
export function resolveAccusourceScreeningFromGroupHiringConfig(groupData: Record<string, unknown>): {
  screeningPackageId: string | null;
  screeningPackageName: string | null;
  screeningRequestedServiceIds: string[] | null;
} {
  const hc = groupData.hiringConfig as Record<string, unknown> | undefined;
  const req =
    hc && typeof hc === 'object' ? (hc.requirements as Record<string, unknown> | undefined) : undefined;
  if (!req || typeof req !== 'object') {
    return { screeningPackageId: null, screeningPackageName: null, screeningRequestedServiceIds: null };
  }
  const pkgId = String(req.accusourcePackageId ?? '').trim();
  if (!pkgId) return { screeningPackageId: null, screeningPackageName: null, screeningRequestedServiceIds: null };
  if (req.accusourceScreeningRequired === false) {
    return { screeningPackageId: null, screeningPackageName: null, screeningRequestedServiceIds: null };
  }
  const explicit = req.accusourceScreeningRequired === true;
  const legacy = req.drugScreenRequired === true || req.backgroundCheckRequired === true;
  const legacyPackageOnly =
    req.accusourceScreeningRequired === undefined &&
    req.drugScreenRequired !== true &&
    req.backgroundCheckRequired !== true;
  const rawSvc = req.accusourceRequestedServiceIds;
  const screeningRequestedServiceIds =
    Array.isArray(rawSvc) && rawSvc.length > 0
      ? rawSvc.map((x) => String(x).trim()).filter(Boolean)
      : null;
  if (explicit || legacy || legacyPackageOnly) {
    const name = String(req.accusourcePackageName ?? '').trim();
    return {
      screeningPackageId: pkgId,
      screeningPackageName: name || null,
      screeningRequestedServiceIds,
    };
  }
  return { screeningPackageId: null, screeningPackageName: null, screeningRequestedServiceIds: null };
}

export const userGroupHirePassedCandidates = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request): Promise<UserGroupHirePassedResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data || {}) as {
      tenantId?: unknown;
      groupId?: unknown;
      mode?: unknown;
      eligibilityMode?: unknown;
    };
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const groupId = typeof raw.groupId === 'string' ? raw.groupId.trim() : '';
    const modeRaw = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : 'preview';
    const mode: UserGroupHirePassedMode =
      modeRaw === 'commit' ? 'commit' : modeRaw === 'execute' ? 'execute' : 'preview';
    const eligibilityModeRaw = typeof raw.eligibilityMode === 'string' ? raw.eligibilityMode.trim().toLowerCase() : '';
    const eligibilityMode: UserGroupHirePassedEligibilityMode =
      eligibilityModeRaw === 'stored' ? 'stored' : 'current_policy';

    if (!tenantId || !groupId) {
      throw new HttpsError('invalid-argument', 'tenantId and groupId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    const groupSnap = await db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get();
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', 'User group not found');
    }

    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenantData = (tenantSnap.data() || {}) as Record<string, unknown>;

    // Note: prior implementations enumerated `tenants/{t}/entities` here to
    // resolve a C1 Select entity id used by the active-employment hire block.
    // The block is gone (May 2026 cross-entity hire policy) so the entities
    // fetch + `c1SelectEntityId` resolution is gone too. The response shape
    // still carries `c1SelectEntityId: null, c1SelectResolved: false` for
    // backwards compatibility with audit-log readers.
    const c1SelectEntityId: string | null = null;

    const groupData = (groupSnap.data() || {}) as Record<string, unknown>;
    const memberIds: string[] = Array.isArray(groupData.memberIds)
      ? (groupData.memberIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    const hireEveryone = isGroupHireEveryonePreset(groupData);

    const appsCol = db.collection(`tenants/${tenantId}/applications`);
    const appById = new Map<string, { id: string; data: Record<string, unknown> }>();

    const snapByGroupId = await appsCol.where('groupId', '==', groupId).limit(500).get();
    for (const d of snapByGroupId.docs) {
      appById.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> });
    }

    const IN_MAX = 10;
    for (let i = 0; i < memberIds.length; i += IN_MAX) {
      const chunk = memberIds.slice(i, i + IN_MAX);
      if (chunk.length === 0) continue;
      const [snapUid, snapCand] = await Promise.all([
        appsCol.where('userId', 'in', chunk).limit(500).get(),
        appsCol.where('candidateId', 'in', chunk).limit(500).get(),
      ]);
      for (const d of snapUid.docs) {
        if (!appById.has(d.id)) {
          appById.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> });
        }
      }
      for (const d of snapCand.docs) {
        if (!appById.has(d.id)) {
          appById.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> });
        }
      }
    }

    const appRows = [...appById.values()];
    if (appRows.length > 900) {
      logger.warn('userGroupHirePassedCandidates: large application merge', {
        tenantId,
        groupId,
        count: appRows.length,
        memberCount: memberIds.length,
      });
    }

    const memberIdsWithApplication = new Set<string>();
    for (const { data } of appRows) {
      const uid = String(data.userId || data.candidateId || '').trim();
      if (uid) memberIdsWithApplication.add(uid);
    }

    // Note: prior implementations preloaded `entity_employments` for every
    // user in `memberIds` here to support the active-C1-Select hire block.
    // That block is gone (May 2026); we no longer need the preload.

    const rows: UserGroupHirePassedRow[] = [];
    let eligibleCount = 0;
    let excludedCount = 0;

    for (const { id: applicationId, data } of appRows) {
      const reasons: string[] = [];
      const userId = String(data.userId || data.candidateId || '').trim();
      const appStatus = norm(data.status);
      const storedOrch = extractOrchestratorDecision(data);
      const nameHint = applicantNameFromApplication(data);

      if (!userId) {
        excludedCount += 1;
        rows.push({
          applicationId,
          userId: '',
          displayNameHint: nameHint,
          outcome: 'excluded',
          reasons: ['Missing userId / candidateId on application'],
          orchestratorDecision: storedOrch,
          applicationStatus: appStatus || null,
        });
        continue;
      }

      if (TERMINAL_APPLICATION.has(appStatus)) {
        excludedCount += 1;
        reasons.push(`Application status is terminal (${appStatus})`);
        rows.push({
          applicationId,
          userId,
          displayNameHint: nameHint,
          outcome: 'excluded',
          reasons,
          orchestratorDecision: storedOrch,
          applicationStatus: appStatus || null,
        });
        continue;
      }

      if (!data.workerAiPrescreenInterviewCompletedAt && !hireEveryone) {
        excludedCount += 1;
        reasons.push('Interview not completed (no workerAiPrescreenInterviewCompletedAt)');
        rows.push({
          applicationId,
          userId,
          displayNameHint: nameHint,
          outcome: 'excluded',
          reasons,
          orchestratorDecision: storedOrch,
          applicationStatus: appStatus || null,
        });
        continue;
      }

      // `hire_everyone` preset short-circuits the orchestrator: with no score
      // floor, "advance" is the inevitable outcome anyway, and for members who
      // never completed a prescreen we have nothing to grade. Sanity gates
      // (userId, application status, blocking C1 Select employment) still run.
      let effectiveOrch: string | null = storedOrch;
      if (hireEveryone) {
        effectiveOrch = 'advance';
      } else if (eligibilityMode === 'current_policy') {
        try {
          const re = await evaluateCurrentPolicyOrchestratorDecision(
            db,
            tenantId,
            tenantData,
            applicationId,
            data,
            groupId,
          );
          if (re.decision === null) {
            excludedCount += 1;
            reasons.push(
              re.reason
                ? `Current policy re-evaluation failed: ${re.reason}`
                : 'Current policy re-evaluation produced no decision',
            );
            if (storedOrch) reasons.push(`Stored orchestrator decision was “${storedOrch}”.`);
            rows.push({
              applicationId,
              userId,
              displayNameHint: nameHint,
              outcome: 'excluded',
              reasons,
              orchestratorDecision: storedOrch,
              applicationStatus: appStatus || null,
            });
            continue;
          }
          effectiveOrch = re.decision;
        } catch (e) {
          excludedCount += 1;
          reasons.push(
            `Current policy re-evaluation error: ${e instanceof Error ? e.message : String(e)}`,
          );
          rows.push({
            applicationId,
            userId,
            displayNameHint: nameHint,
            outcome: 'excluded',
            reasons,
            orchestratorDecision: storedOrch,
            applicationStatus: appStatus || null,
          });
          continue;
        }
      }

      if (effectiveOrch !== 'advance') {
        excludedCount += 1;
        reasons.push(
          eligibilityMode === 'current_policy'
            ? effectiveOrch
              ? `Current-policy orchestrator decision is “${effectiveOrch}” (requires “advance”)`
              : 'No current-policy orchestrator decision'
            : storedOrch
              ? `Orchestrator decision is “${storedOrch}” (requires “advance” to count as passed)`
              : 'No orchestrator decision on application (expected after interview submit)',
        );
        rows.push({
          applicationId,
          userId,
          displayNameHint: nameHint,
          outcome: 'excluded',
          reasons,
          orchestratorDecision: effectiveOrch ?? storedOrch,
          applicationStatus: appStatus || null,
        });
        continue;
      }

      // Cross-entity employment is allowed (May 2026 policy change). A worker
      // already active at C1 Select can be concurrently hired at C1 Events
      // (or any other entity). Each entity has its own Everee tenant, its own
      // entity_employments doc, and its own everee_workers link doc keyed by
      // `{entityId}__{userId}`, so multi-entity employment is naturally
      // modeled. The previous block lived here and in
      // `userGroupHiringAutoOnboardCore.ts`; both were removed in the same
      // change. The C1-Select detection helpers (`isC1SelectEmployment`,
      // `c1EmploymentBlocksHire`) are kept exported because interview-invite
      // and profile-reminder validators use them for messaging gates — those
      // are unaffected by this hire-side relaxation.

      eligibleCount += 1;
      const eligibleReasons: string[] = [
        hireEveryone
          ? 'Eligible: group quality preset is “hire_everyone” — interview & orchestrator gates bypassed.'
          : eligibilityMode === 'current_policy'
            ? 'Eligible under current tenant + group hiring policy (orchestrator advance).'
            : 'Passed AI interview (orchestrator advance).',
      ];
      if (
        !hireEveryone &&
        eligibilityMode === 'current_policy' &&
        storedOrch &&
        storedOrch !== 'advance'
      ) {
        eligibleReasons.push(`Earlier stored decision was “${storedOrch}” (superseded by current-policy re-evaluation).`);
      }
      rows.push({
        applicationId,
        userId,
        displayNameHint: nameHint,
        outcome: 'eligible',
        reasons: eligibleReasons,
        orchestratorDecision: effectiveOrch ?? storedOrch,
        applicationStatus: appStatus || null,
      });
    }

    // Catchall-group synthesis: members without an application would otherwise
    // be invisible to this scan. We surface them as synthetic rows so:
    //   - Under `hire_everyone`, they're treated as eligible (group-as-invite-list
    //     pattern). Blocking C1 Select employment still excludes them.
    //   - Under any other preset, they're surfaced as excluded with a reason that
    //     guides the recruiter toward `hire_everyone` if that's their intent.
    // `memberIdsWithApplication` was populated alongside the per-app loop so we
    // don't double-count members who already produced a row above.
    let membersWithoutApplicationCount = 0;
    for (const memberId of memberIds) {
      const uid = memberId.trim();
      if (!uid) continue;
      if (memberIdsWithApplication.has(uid)) continue;
      membersWithoutApplicationCount += 1;
      const synthAppId = `synthetic:no_application:${uid}`;

      if (!hireEveryone) {
        excludedCount += 1;
        rows.push({
          applicationId: synthAppId,
          userId: uid,
          displayNameHint: '—',
          outcome: 'excluded',
          reasons: [
            'Member has no application linked to this group — cannot evaluate hire-passed criteria. Set the quality preset to "hire_everyone" to onboard catchall-group members without an application.',
          ],
          orchestratorDecision: null,
          applicationStatus: null,
        });
        continue;
      }

      // Cross-entity employment is allowed (see note in the per-application
      // loop above). Catchall-group catchall members with active C1 Select
      // employment can be hired at C1 Events too.

      eligibleCount += 1;
      rows.push({
        applicationId: synthAppId,
        userId: uid,
        displayNameHint: '—',
        outcome: 'eligible',
        reasons: [
          'Eligible: catchall-group member with no application; quality preset "hire_everyone" treats group membership as the hire signal.',
        ],
        orchestratorDecision: null,
        applicationStatus: null,
      });
    }

    rows.sort((a, b) => {
      if (a.outcome !== b.outcome) return a.outcome === 'eligible' ? -1 : 1;
      return a.applicationId.localeCompare(b.applicationId);
    });

    const exclusionTallies = new Map<string, number>();
    for (const r of rows) {
      if (r.outcome !== 'excluded') continue;
      const cat = categorizeExclusionRow(r);
      exclusionTallies.set(cat, (exclusionTallies.get(cat) ?? 0) + 1);
    }
    const exclusionBreakdown = [...exclusionTallies.entries()]
      .map(([category, count]) => ({
        category,
        label: EXCLUSION_CATEGORY_LABELS[category] ?? category,
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    let auditId: string | null = null;
    let committedAt: admin.firestore.Timestamp | null = null;
    let onboardingStarted = 0;
    const onboardingFailed: Array<{ userId: string; message: string }> = [];

    if (mode === 'commit') {
      const ref = db.collection(`tenants/${tenantId}/user_group_hire_passed_audit`).doc();
      auditId = ref.id;
      committedAt = admin.firestore.Timestamp.now();
      await ref.set({
        type: 'user_group_hire_passed',
        tenantId,
        groupId,
        mode: 'commit',
        eligibilityMode,
        performedByUid: request.auth.uid,
        performedAt: committedAt,
        c1SelectEntityId,
        c1SelectResolved: Boolean(c1SelectEntityId),
        applicationsScanned: appRows.length,
        membersWithoutApplicationCount,
        groupMemberCount: memberIds.length,
        eligibleCount,
        excludedCount,
        exclusionBreakdown,
        rows,
        note: 'Audit only — no application status changes or background orders',
      });
      logger.info('user_group_hire_passed_audit', {
        tenantId,
        groupId,
        auditId,
        eligibleCount,
        performedBy: request.auth.uid,
      });
    }

    if (mode === 'execute') {
      const hireCtx = readGroupOnCallHiringContext(groupData);
      if (!hireCtx.hiringEntityId) {
        throw new HttpsError(
          'failed-precondition',
          'Set a hiring entity on this group’s Hiring tab (Employment setup) before running hire-passed onboarding.',
        );
      }
      if (hireCtx.employmentType !== 'on_call') {
        throw new HttpsError(
          'failed-precondition',
          'Turn on “Use on-call employment” for this group — this action only starts on-call pool onboarding.',
        );
      }

      const eligibleUids: string[] = [];
      const seenEligible = new Set<string>();
      for (const r of rows) {
        if (r.outcome !== 'eligible' || !r.userId.trim()) continue;
        if (seenEligible.has(r.userId)) continue;
        seenEligible.add(r.userId);
        eligibleUids.push(r.userId.trim());
      }

      const screening = resolveAccusourceScreeningFromGroupHiringConfig(groupData);
      const authTok = request.auth?.token as Record<string, unknown> | undefined;
      for (const uid of eligibleUids) {
        try {
          await runStartOnCallEmploymentFlow({
            tenantId,
            userId: uid,
            entityId: hireCtx.hiringEntityId,
            workerType: hireCtx.workerType,
            initiatedByUid: request.auth!.uid,
            authForAccusource: { token: authTok },
            enforceOnCallOnboardingPolicy: true,
            note: `user_group_hire_passed:${groupId}`,
            screeningPackageId: screening.screeningPackageId,
            screeningPackageName: screening.screeningPackageName,
            screeningRequestedServiceIds: screening.screeningRequestedServiceIds,
          });
          onboardingStarted += 1;
        } catch (e: unknown) {
          const message =
            e instanceof HttpsError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e);
          onboardingFailed.push({ userId: uid, message });
          logger.warn('userGroupHirePassedCandidates.onboarding_failed', {
            tenantId,
            groupId,
            userId: uid,
            message,
          });
        }
      }

      const ref = db.collection(`tenants/${tenantId}/user_group_hire_passed_audit`).doc();
      auditId = ref.id;
      committedAt = admin.firestore.Timestamp.now();
      await ref.set({
        type: 'user_group_hire_passed',
        tenantId,
        groupId,
        mode: 'execute',
        eligibilityMode,
        performedByUid: request.auth.uid,
        performedAt: committedAt,
        c1SelectEntityId,
        c1SelectResolved: Boolean(c1SelectEntityId),
        applicationsScanned: appRows.length,
        membersWithoutApplicationCount,
        groupMemberCount: memberIds.length,
        eligibleCount,
        excludedCount,
        exclusionBreakdown,
        rows,
        hiringEntityId: hireCtx.hiringEntityId,
        employmentType: hireCtx.employmentType,
        onboardingStarted,
        onboardingFailed,
        note: 'Execute: audit + on-call onboarding start per eligible user (deduped by userId)',
      });
      logger.info('user_group_hire_passed_execute', {
        tenantId,
        groupId,
        auditId,
        eligibleCount,
        onboardingStarted,
        onboardingFailedCount: onboardingFailed.length,
        performedBy: request.auth.uid,
      });
    }

    return {
      groupId,
      tenantId,
      mode,
      eligibilityMode,
      c1SelectEntityId,
      c1SelectResolved: Boolean(c1SelectEntityId),
      groupMemberCount: memberIds.length,
      applicationsScanned: appRows.length,
      membersWithoutApplicationCount,
      rows,
      eligibleCount,
      excludedCount,
      exclusionBreakdown,
      auditId,
      committedAt,
      onboardingStarted: mode === 'execute' ? onboardingStarted : undefined,
      onboardingFailed: mode === 'execute' ? onboardingFailed : undefined,
    };
  },
);
