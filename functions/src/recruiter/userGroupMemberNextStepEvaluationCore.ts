/**
 * Shared evaluation for user group "next step" (interview vs profile vs skip).
 * Used by `userGroupEvaluateMembersNextStep` and `userGroupInterviewInviteSend`.
 */
import * as admin from 'firebase-admin';
import { resolveAiPrescreenTenantPolicy } from '../workerAiPrescreen/aiPrescreenJobSlice';
import { evaluateAiPrescreenEligibility } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';

const db = admin.firestore();

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
/** Warnings for automated prescreen-related SMS cadence (aligns with interview-invite cooldown policy). */
const PRESCREEN_SMS_WARNING_MS = 72 * 60 * 60 * 1000;

export type NextStepBucket = 'ready_for_interview' | 'needs_profile_update' | 'already_handled' | 'excluded';

export type ApplicationResolution = 'group_linked' | 'tenant_fallback' | 'profile_only';

export type UserGroupMemberNextStepRow = {
  userId: string;
  displayName: string;
  applicationId: string | null;
  /** How the evaluator bound an application to this member (membership does not require a group-linked application). */
  applicationResolution?: ApplicationResolution;
  bucket: NextStepBucket;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  eligibilityReason: string | null;
};

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function tsMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function isRecentFirestoreTime(v: unknown): boolean {
  const ms = tsMillis(v);
  if (ms == null) return false;
  return Date.now() - ms < RECENT_MS;
}

function isWithinMs(v: unknown, ms: number): boolean {
  const t = tsMillis(v);
  if (t == null) return false;
  return Date.now() - t < ms;
}

const TERMINAL_EXCLUDED = new Set(['rejected', 'withdrawn']);
const BLOCKING_EMPLOYMENT = new Set(['active', 'onboarding', 'hired', 'offer_pending', 'pending', 'in_progress']);

const LIFECYCLE_SUPPRESS_INVITE = new Set([
  'qualified',
  'review',
  'waitlisted',
  'hired',
  'onboarding',
  'interview_pending',
]);

function displayNameFromUser(data: Record<string, unknown>): string {
  const d = String(data.displayName || '').trim();
  if (d) return d;
  const fn = String(data.firstName || '').trim();
  const ln = String(data.lastName || '').trim();
  const j = [fn, ln].filter(Boolean).join(' ');
  return j || '—';
}

function getMaxTenantSecurityLevel(userData: Record<string, unknown>, tenantId: string): number {
  const top = Number.parseInt(String(userData.securityLevel ?? '0'), 10);
  const t = userData.tenantIds as Record<string, { securityLevel?: string | number }> | undefined;
  const te = t?.[tenantId]?.securityLevel;
  const tl = Number.parseInt(String(te ?? '0'), 10);
  return Math.max(Number.isFinite(top) ? top : 0, Number.isFinite(tl) ? tl : 0);
}

function anyEmploymentBlocks(records: Array<Record<string, unknown>>): { blocks: boolean; detail: string } {
  for (const rec of records) {
    const st = norm(rec.status || rec.employmentState);
    if (st && BLOCKING_EMPLOYMENT.has(st)) {
      return { blocks: true, detail: `Entity employment status “${st}” (${String(rec.entityKey || rec.entityId || '')})` };
    }
  }
  return { blocks: false, detail: '' };
}

export type UserGroupMemberNextStepEvalResult = {
  memberIds: string[];
  rows: UserGroupMemberNextStepRow[];
  counts: Record<NextStepBucket, number>;
  prescreenEligibilityPolicy: Record<string, unknown>;
  applicationResolutionStats: {
    groupLinked: number;
    tenantFallback: number;
    profileOnly: number;
  };
};

function pickNewerApp(
  current: { id: string; data: Record<string, unknown> } | undefined,
  candidate: { id: string; data: Record<string, unknown> },
): { id: string; data: Record<string, unknown> } {
  if (!current) return candidate;
  const cm = tsMillis(current.data.updatedAt) ?? tsMillis(current.data.createdAt) ?? 0;
  const nm = tsMillis(candidate.data.updatedAt) ?? tsMillis(candidate.data.createdAt) ?? 0;
  return nm >= cm ? candidate : current;
}

/** Latest application per user by `userId` (batched `in` queries). */
async function loadTenantApplicationsByUserIdField(
  tenantId: string,
  userIds: string[],
  field: 'userId' | 'candidateId',
): Promise<Map<string, { id: string; data: Record<string, unknown> }>> {
  const byUser = new Map<string, { id: string; data: Record<string, unknown> }>();
  for (let i = 0; i < userIds.length; i += 10) {
    const chunk = userIds.slice(i, i + 10);
    if (chunk.length === 0) continue;
    const snap = await db.collection(`tenants/${tenantId}/applications`).where(field, 'in', chunk).get();
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const key = String(data[field] || '').trim();
      if (!key) continue;
      const cur = byUser.get(key);
      const next = { id: d.id, data };
      byUser.set(key, pickNewerApp(cur, next));
    }
  }
  return byUser;
}

async function resolveEffectiveApplicationsForGroup(
  tenantId: string,
  groupId: string,
  memberIds: string[],
): Promise<{
  groupAppByUser: Map<string, { id: string; data: Record<string, unknown> }>;
  tenantAppByUser: Map<string, { id: string; data: Record<string, unknown> }>;
}> {
  const groupSnap = await db
    .collection(`tenants/${tenantId}/applications`)
    .where('groupId', '==', groupId)
    .limit(500)
    .get();

  const groupAppByUser = new Map<string, { id: string; data: Record<string, unknown> }>();
  for (const d of groupSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    const uid = String(data.userId || data.candidateId || '').trim();
    if (!uid) continue;
    const prev = groupAppByUser.get(uid);
    const curMs = tsMillis(data.updatedAt) ?? tsMillis(data.createdAt) ?? 0;
    const prevMs = prev ? tsMillis(prev.data.updatedAt) ?? tsMillis(prev.data.createdAt) ?? 0 : -1;
    if (!prev || curMs >= prevMs) {
      groupAppByUser.set(uid, { id: d.id, data });
    }
  }

  const needFallback = memberIds.filter((id) => !groupAppByUser.has(id));
  let tenantAppByUser = await loadTenantApplicationsByUserIdField(tenantId, needFallback, 'userId');
  const stillMissing = needFallback.filter((id) => !tenantAppByUser.has(id));
  if (stillMissing.length > 0) {
    const byCandidate = await loadTenantApplicationsByUserIdField(tenantId, stillMissing, 'candidateId');
    for (const [uid, entry] of byCandidate) {
      const cur = tenantAppByUser.get(uid);
      tenantAppByUser.set(uid, pickNewerApp(cur, entry));
    }
  }

  return { groupAppByUser, tenantAppByUser };
}

export async function runUserGroupMemberNextStepEvaluation(tenantId: string, groupId: string): Promise<UserGroupMemberNextStepEvalResult> {
  const [groupSnap, tenantSnap] = await Promise.all([
    db.doc(`tenants/${tenantId}/userGroups/${groupId}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  if (!groupSnap.exists) {
    throw new Error('USER_GROUP_NOT_FOUND');
  }
  const groupData = groupSnap.data() as { memberIds?: string[] };
  const memberIds = Array.isArray(groupData.memberIds) ? groupData.memberIds.map((x) => String(x).trim()).filter(Boolean) : [];

  const tenantData = (tenantSnap.data() || {}) as Record<string, unknown>;
  const prescreenPolicy = resolveAiPrescreenTenantPolicy(tenantData);
  const eligOpts = {
    requireResumeOrSkill: prescreenPolicy.eligibility.requireResumeOrSkill,
    requirePhone: prescreenPolicy.eligibility.requirePhone,
    requireLocation: prescreenPolicy.eligibility.requireLocation,
    requireWorkAuthorization: prescreenPolicy.eligibility.requireWorkAuthorization,
  };

  const { groupAppByUser, tenantAppByUser } = await resolveEffectiveApplicationsForGroup(tenantId, groupId, memberIds);

  const employmentByUser = new Map<string, Array<Record<string, unknown>>>();
  for (let i = 0; i < memberIds.length; i += 10) {
    const chunk = memberIds.slice(i, i + 10);
    if (chunk.length === 0) continue;
    const emSnap = await db.collection(`tenants/${tenantId}/entity_employments`).where('userId', 'in', chunk).get();
    for (const ed of emSnap.docs) {
      const u = String((ed.data() as { userId?: string }).userId || '').trim();
      if (!u) continue;
      const arr = employmentByUser.get(u) ?? [];
      arr.push({ id: ed.id, ...(ed.data() as Record<string, unknown>) });
      employmentByUser.set(u, arr);
    }
  }

  const rows: UserGroupMemberNextStepRow[] = [];
  const counts: Record<NextStepBucket, number> = {
    ready_for_interview: 0,
    needs_profile_update: 0,
    already_handled: 0,
    excluded: 0,
  };

  for (const userId of memberIds) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let bucket: NextStepBucket = 'excluded';
    let applicationId: string | null = null;
    let displayName = '—';
    let missingFields: string[] = [];
    let eligibilityReason: string | null = null;

    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      counts.excluded += 1;
      rows.push({
        userId,
        displayName: '—',
        applicationId: null,
        bucket: 'excluded',
        reasons: ['User document not found'],
        warnings: [],
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    const userData = userSnap.data() as Record<string, unknown>;
    displayName = displayNameFromUser(userData);

    const sec = getMaxTenantSecurityLevel(userData, tenantId);
    if (sec >= 5) {
      counts.excluded += 1;
      rows.push({
        userId,
        displayName,
        applicationId: null,
        bucket: 'excluded',
        reasons: ['Internal / staff-level user (security level ≥ 5)'],
        warnings: [],
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    if (isRecentFirestoreTime(userData.profileUpdateReminderLastSentAt)) {
      warnings.push('Profile update reminder sent within the last 7 days (user.profileUpdateReminderLastSentAt)');
    }

    const groupEntry = groupAppByUser.get(userId);
    const tenantEntry = tenantAppByUser.get(userId);
    let applicationResolution: ApplicationResolution = 'profile_only';
    let appEntry: { id: string; data: Record<string, unknown> } | undefined;
    if (groupEntry) {
      appEntry = groupEntry;
      applicationResolution = 'group_linked';
    } else if (tenantEntry) {
      appEntry = tenantEntry;
      applicationResolution = 'tenant_fallback';
    }

    const app = appEntry?.data;
    if (appEntry) applicationId = appEntry.id;

    if (!app) {
      const emRecsPf = employmentByUser.get(userId) ?? [];
      const emBlockPf = anyEmploymentBlocks(emRecsPf);
      if (emBlockPf.blocks) {
        counts.already_handled += 1;
        reasons.push(emBlockPf.detail);
        rows.push({
          userId,
          displayName,
          applicationId: null,
          applicationResolution: 'profile_only',
          bucket: 'already_handled',
          reasons,
          warnings,
          missingFields: [],
          eligibilityReason: null,
        });
        continue;
      }

      warnings.push(
        'No tenant application on file — interview/prescreen completion flags and SMS cadence are not read from an application (membership-only evaluation).',
      );

      const eligPf = evaluateAiPrescreenEligibility(userData, eligOpts);
      eligibilityReason = eligPf.reason;
      missingFields = [...eligPf.missingFields];

      if (!eligPf.eligibleForInterview) {
        bucket = 'needs_profile_update';
        reasons.push(`Profile gates: ${eligPf.reason}`);
        if (eligPf.missingFields.length) {
          reasons.push(`Missing: ${eligPf.missingFields.join(', ')}`);
        }
        reasons.push('Group member — evaluated on profile only (no application in this tenant).');
      } else {
        bucket = 'ready_for_interview';
        reasons.push('Eligible per tenant aiPrescreen eligibility (group membership; no tenant application on file).');
      }

      counts[bucket] += 1;
      rows.push({
        userId,
        displayName,
        applicationId: null,
        applicationResolution: 'profile_only',
        bucket,
        reasons,
        warnings,
        missingFields,
        eligibilityReason,
      });
      continue;
    }

    if (applicationResolution === 'tenant_fallback') {
      warnings.push('Using latest tenant application (not linked to this user group).');
    }

    const appStatus = norm(app.status);
    if (TERMINAL_EXCLUDED.has(appStatus)) {
      counts.excluded += 1;
      reasons.push(`Application status excluded (${appStatus})`);
      rows.push({
        userId,
        displayName,
        applicationId,
        applicationResolution,
        bucket: 'excluded',
        reasons,
        warnings,
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    if (appStatus === 'accepted') {
      counts.already_handled += 1;
      reasons.push('Application already accepted');
      rows.push({
        userId,
        displayName,
        applicationId,
        applicationResolution,
        bucket: 'already_handled',
        reasons,
        warnings,
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    const hl = app.hiringLifecycle as { stage?: string } | undefined;
    const stage = norm(hl?.stage);
    if (stage && LIFECYCLE_SUPPRESS_INVITE.has(stage)) {
      counts.already_handled += 1;
      reasons.push(`Hiring lifecycle stage “${stage}” (outreach suppressed)`);
      rows.push({
        userId,
        displayName,
        applicationId,
        applicationResolution,
        bucket: 'already_handled',
        reasons,
        warnings,
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    if (app.workerAiPrescreenInterviewCompletedAt) {
      counts.already_handled += 1;
      reasons.push('AI prescreen interview already completed');
      rows.push({
        userId,
        displayName,
        applicationId,
        applicationResolution,
        bucket: 'already_handled',
        reasons,
        warnings,
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    const emRecs = employmentByUser.get(userId) ?? [];
    const emBlock = anyEmploymentBlocks(emRecs);
    if (emBlock.blocks) {
      counts.already_handled += 1;
      reasons.push(emBlock.detail);
      rows.push({
        userId,
        displayName,
        applicationId,
        applicationResolution,
        bucket: 'already_handled',
        reasons,
        warnings,
        missingFields: [],
        eligibilityReason: null,
      });
      continue;
    }

    const prescreenSmsFields: Array<[string, unknown]> = [
      ['workerAiPrescreenReminderSentAt', app.workerAiPrescreenReminderSentAt],
      ['workerAiPrescreenChase1SentAt', app.workerAiPrescreenChase1SentAt],
      ['workerAiPrescreenChase2SentAt', app.workerAiPrescreenChase2SentAt],
      ['workerAiPrescreenFollowUpInviteSentAt', app.workerAiPrescreenFollowUpInviteSentAt],
    ];
    for (const [name, val] of prescreenSmsFields) {
      if (isWithinMs(val, PRESCREEN_SMS_WARNING_MS)) {
        warnings.push(`Automated prescreen SMS (${name}) within the last 72 hours`);
      }
    }

    const elig = evaluateAiPrescreenEligibility(userData, eligOpts);
    eligibilityReason = elig.reason;
    missingFields = [...elig.missingFields];

    if (!elig.eligibleForInterview) {
      bucket = 'needs_profile_update';
      reasons.push(`Profile gates: ${elig.reason}`);
      if (elig.missingFields.length) {
        reasons.push(`Missing: ${elig.missingFields.join(', ')}`);
      }
    } else {
      bucket = 'ready_for_interview';
      reasons.push('Eligible for prescreen / interview invite per tenant aiPrescreen eligibility');
      reasons.push('No blocking employment; interview not completed; lifecycle allows invite');
    }

    counts[bucket] += 1;
    rows.push({
      userId,
      displayName,
      applicationId,
      applicationResolution,
      bucket,
      reasons,
      warnings,
      missingFields,
      eligibilityReason,
    });
  }

  rows.sort((a, b) => {
    const order: NextStepBucket[] = ['ready_for_interview', 'needs_profile_update', 'already_handled', 'excluded'];
    const cmp = order.indexOf(a.bucket) - order.indexOf(b.bucket);
    if (cmp !== 0) return cmp;
    return a.displayName.localeCompare(b.displayName);
  });

  const applicationResolutionStats = {
    groupLinked: rows.filter((r) => r.applicationResolution === 'group_linked').length,
    tenantFallback: rows.filter((r) => r.applicationResolution === 'tenant_fallback').length,
    profileOnly: rows.filter((r) => r.applicationResolution === 'profile_only').length,
  };

  return {
    memberIds,
    rows,
    counts,
    prescreenEligibilityPolicy: prescreenPolicy.eligibility as unknown as Record<string, unknown>,
    applicationResolutionStats,
  };
}
