/**
 * C1 Events hires everyone who applies (Greg 2026-09-11 — S2 of
 * docs/claude/project_events_onboarding_claim_readiness.md), keyed on the
 * posting's hiring entity. This rule OWNS C1 Events applications (Greg: the
 * new plan takes precedence over group hiring) EXCEPT while the application's
 * group still actively hires everyone at C1 Events: group membership is hired
 * by onUserGroupMemberAddedAutoOnboard at the same moment (444 of the Events
 * hires in the 60 days to 2026-09-11), so hiring here too would race it and
 * double-send invites. Switch a group's hiring off and its postings move to
 * this rule automatically. Before this only the Events postings feeding a
 * `hire_everyone` group hired on apply (18 of 35 active). Group hiring was
 * retired the same day (userGroupHiringRetired.ts): while retired, no group
 * hires, so this rule owns EVERY C1 Events application.
 *
 * Forward-only by construction:
 *   - hires only at the apply moment (application created past `in_progress`,
 *     or leaving `in_progress`) — prescreen / orchestrator re-runs on old
 *     applications never hire;
 *   - an application CREATED already past in_progress must be dated within
 *     APPLY_RECENCY_MS, so imports and historical writes never hire (a draft
 *     leaving in_progress is the apply moment itself — the wizard stamps
 *     `appliedAt` when the draft starts, days before submit);
 *   - a worker with ANY C1 Events employment row (any status) is skipped, so
 *     ended employments are never restarted.
 * Kill switch: `tenants/{t}/settings/eventsAutoHire.enabled === false` — turns
 * this rule off AND hands C1 Events applications back to group hiring.
 * Never throws — the application doc has many listeners.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { isGroupHireEveryonePreset, readGroupOnCallHiringContext } from './userGroupHirePassedCandidates';
import { USER_GROUP_HIRING_RETIRED } from './userGroupHiringRetired';

export const EVENTS_AUTO_HIRE_ENTITY_ID = 'c1_events_llc';
export const APPLY_RECENCY_MS = 48 * 3600 * 1000;
const NOT_LIVE_STATUSES = new Set(['rejected', 'withdrawn', 'in_progress', '']);
const SYSTEM_ACTOR = 'system:auto_application_c1_events';

/** `other` = prescreen / orchestrator signal: owned, but never a hire moment. */
export type EventsAutoHireSignal = 'created' | 'left_in_progress' | 'other';

export type EventsAutoHireSkipReason =
  | 'kill_switch_off'
  | 'not_events'
  | 'group_hires'
  | 'not_apply_moment'
  | 'no_user'
  | 'status_not_live'
  | 'stale_application'
  | 'already_employed';

export interface EventsAutoHireDecision {
  hire: boolean;
  reason: EventsAutoHireSkipReason | null;
}

function toMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof (v as { toMillis?: unknown }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
  if (v instanceof Date) return v.getTime();
  const secs = (v as { seconds?: unknown }).seconds ?? (v as { _seconds?: unknown })._seconds;
  if (typeof secs === 'number') return secs * 1000;
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return Date.parse(v);
  return null;
}

/** appliedAt → submittedAt → createdAt, in ms; null when none is usable. */
export function applicationAppliedAtMs(application: Record<string, unknown>): number | null {
  return toMs(application.appliedAt) ?? toMs(application.submittedAt) ?? toMs(application.createdAt);
}

const skip = (reason: EventsAutoHireSkipReason): EventsAutoHireDecision => ({ hire: false, reason });

export function evaluateEventsAutoHire(args: {
  enabled: boolean;
  entityId: string;
  userId: string;
  status: string;
  signal: EventsAutoHireSignal;
  appliedAtMs: number | null;
  nowMs: number;
  /** The application's group actively hires everyone at C1 Events. */
  groupWillHire: boolean;
  hasEventsEmployment: boolean;
}): EventsAutoHireDecision {
  if (!args.enabled) return skip('kill_switch_off');
  if (args.entityId !== EVENTS_AUTO_HIRE_ENTITY_ID) return skip('not_events');
  if (args.groupWillHire) return skip('group_hires');
  if (args.signal === 'other') return skip('not_apply_moment');
  if (!args.userId) return skip('no_user');
  if (NOT_LIVE_STATUSES.has(args.status.trim().toLowerCase())) return skip('status_not_live');
  // A draft leaving in_progress IS the apply moment (its appliedAt dates the
  // draft's start). A doc created already-submitted must prove it's new.
  const stale =
    args.signal === 'created' &&
    (args.appliedAtMs == null || args.nowMs - args.appliedAtMs > APPLY_RECENCY_MS);
  if (stale) return skip('stale_application');
  if (args.hasEventsEmployment) return skip('already_employed');
  return { hire: true, reason: null };
}

/** True when this rule owns the application: enabled, C1 Events, no hiring group. */
export function eventsRuleOwnsApplication(decision: EventsAutoHireDecision): boolean {
  return decision.reason !== 'kill_switch_off' && decision.reason !== 'not_events' && decision.reason !== 'group_hires';
}

const killSwitchCache = new Map<string, { enabled: boolean; atMs: number }>();

async function autoHireEnabled(db: admin.firestore.Firestore, tenantId: string): Promise<boolean> {
  const cached = killSwitchCache.get(tenantId);
  if (cached && Date.now() - cached.atMs < 60_000) return cached.enabled;
  const snap = await db.doc(`tenants/${tenantId}/settings/eventsAutoHire`).get();
  const enabled = !(snap.exists && snap.data()?.enabled === false);
  killSwitchCache.set(tenantId, { enabled, atMs: Date.now() });
  return enabled;
}

async function resolveApplicationEntityId(
  db: admin.firestore.Firestore,
  tenantId: string,
  application: Record<string, unknown>,
): Promise<string> {
  const direct = String(application.hiringEntityId || '').trim();
  if (direct) return direct;
  const postId = String(application.jobId || application.jobPostId || application.postId || '').trim();
  if (postId) {
    const post = await db.doc(`tenants/${tenantId}/job_postings/${postId}`).get();
    const fromPost = String(post.data()?.hiringEntityId || '').trim();
    if (fromPost) return fromPost;
  }
  const jobOrderId = String(application.jobOrderId || '').trim();
  if (jobOrderId) {
    const jo = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    return String(jo.data()?.entityId || jo.data()?.hiringEntityId || '').trim();
  }
  return '';
}

async function groupsHireEveryoneAtEvents(
  db: admin.firestore.Firestore,
  tenantId: string,
  application: Record<string, unknown>,
): Promise<boolean> {
  if (USER_GROUP_HIRING_RETIRED) return false;
  const ids = new Set<string>();
  if (typeof application.groupId === 'string' && application.groupId.trim()) ids.add(application.groupId.trim());
  if (Array.isArray(application.groupIds)) {
    for (const g of application.groupIds) if (typeof g === 'string' && g.trim()) ids.add(g.trim());
  }
  if (ids.size === 0) return false;
  const snaps = await db.getAll(...[...ids].map((g) => db.doc(`tenants/${tenantId}/userGroups/${g}`)));
  return snaps.some((snap) => {
    if (!snap.exists) return false;
    const group = (snap.data() || {}) as Record<string, unknown>;
    const automation = ((group.hiringConfig as Record<string, unknown> | undefined)?.automation ?? {}) as Record<string, unknown>;
    const ctx = readGroupOnCallHiringContext(group);
    return (
      isGroupHireEveryonePreset(group) &&
      automation.hiringActive === true &&
      ctx.hiringEntityId === EVENTS_AUTO_HIRE_ENTITY_ID &&
      ctx.employmentType === 'on_call'
    );
  });
}

/**
 * Hires the applicant when the rule says so. Returns true when this rule OWNS
 * the application — the caller must then skip group hiring for it. Any
 * unexpected error returns false so group hiring still runs as before.
 */
export async function maybeAutoHireEventsApplicant(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    applicationId: string;
    application: Record<string, unknown>;
    signal: EventsAutoHireSignal;
    nowMs?: number;
  },
): Promise<boolean> {
  const { tenantId, applicationId, application, signal } = args;
  const userId = String(application.userId ?? application.candidateId ?? application.workerId ?? '').trim();
  const base = {
    userId,
    status: String(application.status ?? ''),
    signal,
    appliedAtMs: applicationAppliedAtMs(application),
    nowMs: args.nowMs ?? Date.now(),
  };
  try {
    const enabled = await autoHireEnabled(db, tenantId);
    const entityId = enabled ? await resolveApplicationEntityId(db, tenantId, application) : '';
    const groupWillHire =
      enabled && entityId === EVENTS_AUTO_HIRE_ENTITY_ID ? await groupsHireEveryoneAtEvents(db, tenantId, application) : false;
    // Cheap gates first; the employment read only runs for real candidates.
    const pre = evaluateEventsAutoHire({ ...base, enabled, entityId, groupWillHire, hasEventsEmployment: false });
    const owned = eventsRuleOwnsApplication(pre);
    if (!pre.hire) {
      if (owned && pre.reason !== 'not_apply_moment') {
        logger.info('eventsAutoHire.skipped', { tenantId, applicationId, userId, reason: pre.reason });
      }
      return owned;
    }
    const employmentSnap = await db.collection(`tenants/${tenantId}/entity_employments`).where('userId', '==', userId).get();
    const hasEventsEmployment = employmentSnap.docs.some((d) => d.data()?.entityId === EVENTS_AUTO_HIRE_ENTITY_ID);
    const decision = evaluateEventsAutoHire({ ...base, enabled, entityId, groupWillHire, hasEventsEmployment });
    if (!decision.hire) {
      logger.info('eventsAutoHire.skipped', { tenantId, applicationId, userId, reason: decision.reason });
      return true;
    }
    const { runStartOnCallEmploymentFlow } = await import('../onboarding/startOnCallEmployment');
    const result = await runStartOnCallEmploymentFlow({
      tenantId,
      userId,
      entityId,
      workerType: 'entity_default',
      triggerSource: 'auto_application_c1_events',
      applicationId,
      initiatedByUid: SYSTEM_ACTOR,
      note: `auto_application_c1_events:${applicationId}`,
      enforceOnCallOnboardingPolicy: true,
    });
    logger.info('eventsAutoHire.onboarded', {
      tenantId,
      applicationId,
      userId,
      pipelineId: result.pipelineId,
      created: result.created,
      signal,
      evereeProvisionWarning: result.evereeProvisionWarning ?? null,
    });
    return true;
  } catch (e: unknown) {
    logger.error('eventsAutoHire.error', {
      tenantId,
      applicationId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
