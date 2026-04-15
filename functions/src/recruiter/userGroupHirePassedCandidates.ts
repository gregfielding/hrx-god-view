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
  rows: UserGroupHirePassedRow[];
  eligibleCount: number;
  excludedCount: number;
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

function resolveC1SelectEntityId(
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
function extractOrchestratorDecision(data: Record<string, unknown>): string | null {
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

function applicantNameFromApplication(data: Record<string, unknown>): string {
  const direct = String(data.applicantName || data.displayName || '').trim();
  if (direct) return direct;
  const fn = String(data.firstName || '').trim();
  const ln = String(data.lastName || '').trim();
  const j = [fn, ln].filter(Boolean).join(' ');
  return j || '—';
}

const TERMINAL_APPLICATION = new Set(['rejected', 'withdrawn']);
const BLOCKING_C1_STATUSES = new Set(['active', 'onboarding', 'hired', 'offer_pending', 'pending', 'in_progress']);

function isC1SelectEmployment(rec: Record<string, unknown>, c1EntityId: string | null): boolean {
  const ek = norm(rec.entityKey);
  if (ek === 'select') return true;
  const eid = String(rec.entityId || '').trim();
  if (c1EntityId && eid && eid === c1EntityId) return true;
  return false;
}

function c1EmploymentBlocksHire(rec: Record<string, unknown>): { blocks: boolean; detail: string } {
  const st = norm(rec.status || rec.employmentState);
  if (st && BLOCKING_C1_STATUSES.has(st)) {
    return { blocks: true, detail: `C1 Select employment status “${st}”` };
  }
  return { blocks: false, detail: '' };
}

function readGroupOnCallHiringContext(groupData: Record<string, unknown>): {
  hiringEntityId: string;
  workerType: 'w2' | '1099';
  employmentType: string;
} {
  const hc = groupData.hiringConfig as Record<string, unknown> | undefined;
  const emp =
    hc && typeof hc === 'object' ? (hc.employment as Record<string, unknown> | undefined) : undefined;
  const e = emp && typeof emp === 'object' ? emp : {};
  const hiringEntityId = String(e.hiringEntityId || '').trim();
  const employmentType = String(e.employmentType || 'standard').trim().toLowerCase();
  const wtRaw = String(e.workerType || 'W2').trim().toLowerCase();
  const workerType: 'w2' | '1099' = wtRaw === '1099' ? '1099' : 'w2';
  return { hiringEntityId, workerType, employmentType };
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

    const entitiesSnap = await db.collection(`tenants/${tenantId}/entities`).get();
    const entities = entitiesSnap.docs.map((d) => ({
      id: d.id,
      name: String((d.data() as { name?: string }).name || ''),
      entityCode: (d.data() as { entityCode?: string }).entityCode,
    }));
    const c1SelectEntityId = resolveC1SelectEntityId(entities);

    const groupData = (groupSnap.data() || {}) as Record<string, unknown>;
    const memberIds: string[] = Array.isArray(groupData.memberIds)
      ? (groupData.memberIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];

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

    const userIds = new Set<string>();
    for (const { data } of appRows) {
      const uid = String(data.userId || data.candidateId || '').trim();
      if (uid) userIds.add(uid);
    }

    const c1EmploymentByUser = new Map<string, Array<Record<string, unknown>>>();
    const uidList = [...userIds];
    for (let i = 0; i < uidList.length; i += 10) {
      const chunk = uidList.slice(i, i + 10);
      if (chunk.length === 0) continue;
      const emSnap = await db
        .collection(`tenants/${tenantId}/entity_employments`)
        .where('userId', 'in', chunk)
        .get();
      for (const ed of emSnap.docs) {
        const u = String((ed.data() as { userId?: string }).userId || '').trim();
        if (!u) continue;
        const arr = c1EmploymentByUser.get(u) ?? [];
        arr.push({ id: ed.id, ...(ed.data() as Record<string, unknown>) });
        c1EmploymentByUser.set(u, arr);
      }
    }

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

      if (!data.workerAiPrescreenInterviewCompletedAt) {
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

      let effectiveOrch: string | null = storedOrch;
      if (eligibilityMode === 'current_policy') {
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

      const c1recs = c1EmploymentByUser.get(userId) ?? [];
      let blockedByC1 = false;
      for (const rec of c1recs) {
        if (!isC1SelectEmployment(rec, c1SelectEntityId)) continue;
        const { blocks, detail } = c1EmploymentBlocksHire(rec);
        if (blocks) {
          blockedByC1 = true;
          reasons.push(detail);
          break;
        }
      }

      if (blockedByC1) {
        excludedCount += 1;
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

      eligibleCount += 1;
      const eligibleReasons: string[] = [
        eligibilityMode === 'current_policy'
          ? 'Eligible under current tenant + group hiring policy (orchestrator advance) and no blocking C1 Select employment'
          : 'Passed AI interview (orchestrator advance) and no blocking C1 Select employment row',
      ];
      if (eligibilityMode === 'current_policy' && storedOrch && storedOrch !== 'advance') {
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

    rows.sort((a, b) => {
      if (a.outcome !== b.outcome) return a.outcome === 'eligible' ? -1 : 1;
      return a.applicationId.localeCompare(b.applicationId);
    });

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
        groupMemberCount: memberIds.length,
        eligibleCount,
        excludedCount,
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
        groupMemberCount: memberIds.length,
        eligibleCount,
        excludedCount,
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
      rows,
      eligibleCount,
      excludedCount,
      auditId,
      committedAt,
      onboardingStarted: mode === 'execute' ? onboardingStarted : undefined,
      onboardingFailed: mode === 'execute' ? onboardingFailed : undefined,
    };
  },
);
