/**
 * Trigger — recompute `users/{uid}.primaryRecruiterId` for every worker
 * whose Onboarding Specialist assignment could have shifted when a user
 * group's `roles.onboardingSpecialistIds` (preferred) or legacy
 * `roles.csaIds` or `memberIds` changed.
 *
 * Phase 4b of `docs/RECRUITING_ROLE_MODEL.md`. The Onboarding Specialist
 * tier walk (§2.1, §3.1) resolves a worker's specialist from their
 * user-group memberships. This trigger is the server-side glue that
 * keeps the denormalized scalar in sync with both directions of change:
 *
 *   - A group's specialist list is rewritten → every current member's
 *     primary is recomputed.
 *   - A worker is added to / removed from a group → their primary is
 *     recomputed (they just gained or lost a specialist source).
 *
 * Works by delegating each affected worker to `recomputePrimaryForWorker`,
 * which tries the Onboarding Specialist path first and falls back to
 * the legacy anchor computation. That shared helper also owns the
 * transactional write, so this trigger stays a thin fan-out.
 *
 * Defensive read pattern: prefers `roles.onboardingSpecialistIds`;
 * falls back to the legacy `roles.csaIds` while the rename migration
 * soaks. After the cleanup PR drops the legacy field, the `?? csaIds`
 * clause goes away.
 *
 * Idempotent — `recomputePrimaryForWorker` compares before/after and
 * skips the write when the scalar hasn't actually changed.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { recomputePrimaryForWorker } from '../readiness/recomputePrimaryForWorker';

if (!admin.apps.length) {
  admin.initializeApp();
}

/** Return true when the two arrays have the same set of strings. */
function stringArraysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  const aSet = new Set(a.filter((x): x is string => typeof x === 'string'));
  for (const v of b) {
    if (typeof v !== 'string') continue;
    if (!aSet.has(v)) return false;
  }
  return true;
}

function readStringArray(data: Record<string, unknown> | null | undefined, path: string[]): string[] {
  let cursor: unknown = data;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return [];
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (!Array.isArray(cursor)) return [];
  return cursor.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

export const onUserGroupRolesOrMembersChangeRecomputeWorkersPrimary = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/userGroups/{groupId}',
    region: 'us-central1',
    maxInstances: 3,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const groupId = String(event.params.groupId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    const beforeMembers = readStringArray(beforeData, ['memberIds']);
    const afterMembers = readStringArray(afterData, ['memberIds']);
    // Defensive read pattern: prefer the new
    // `roles.onboardingSpecialistIds`, fall back to legacy
    // `roles.csaIds` so the trigger correctly fires while data
    // co-exists in both fields during the rename transition window.
    const beforeOnboardingSpecialists =
      readStringArray(beforeData, ['roles', 'onboardingSpecialistIds']).length > 0
        ? readStringArray(beforeData, ['roles', 'onboardingSpecialistIds'])
        : readStringArray(beforeData, ['roles', 'csaIds']);
    const afterOnboardingSpecialists =
      readStringArray(afterData, ['roles', 'onboardingSpecialistIds']).length > 0
        ? readStringArray(afterData, ['roles', 'onboardingSpecialistIds'])
        : readStringArray(afterData, ['roles', 'csaIds']);

    const membersChanged = !stringArraysEqual(beforeMembers, afterMembers);
    const onboardingSpecialistsChanged = !stringArraysEqual(
      beforeOnboardingSpecialists,
      afterOnboardingSpecialists,
    );
    if (!membersChanged && !onboardingSpecialistsChanged) return;

    // Workers to recompute:
    //   - Onboarding Specialists changed → everyone currently in the group.
    //   - Members changed → the symmetric difference (added ∪ removed).
    const affected = new Set<string>();
    if (onboardingSpecialistsChanged) {
      for (const m of afterMembers) affected.add(m);
    }
    if (membersChanged) {
      const beforeSet = new Set(beforeMembers);
      const afterSet = new Set(afterMembers);
      for (const m of afterMembers) {
        if (!beforeSet.has(m)) affected.add(m); // added
      }
      for (const m of beforeMembers) {
        if (!afterSet.has(m)) affected.add(m); // removed
      }
    }

    if (affected.size === 0) return;

    // Fan out sequentially. Each recompute is cheap (2 queries + a
    // transaction), but a burst of updates could still stack up — cap
    // at a reasonable batch size to stay under the function's memory
    // / timeout. For groups with huge membership (>1000), the daily
    // reconciliation job (separate) is the fallback.
    const CHUNK = 25;
    const ids = Array.from(affected);
    let recomputed = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async (workerUid) => {
          try {
            const result = await recomputePrimaryForWorker(tenantId, workerUid);
            if (result.changed) recomputed += 1;
          } catch (err) {
            logger.warn('onUserGroupRolesOrMembersChange: recompute failed for worker', {
              tenantId,
              groupId,
              workerUid,
              err: (err as Error).message,
            });
          }
        }),
      );
    }

    logger.info('onUserGroupRolesOrMembersChange: recomputed primaries', {
      tenantId,
      groupId,
      onboardingSpecialistsChanged,
      membersChanged,
      affectedCount: affected.size,
      scalarChanges: recomputed,
    });
  },
);
