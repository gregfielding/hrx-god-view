/**
 * Core runner for Assignment Readiness seeding. Loads the assignment's
 * associations (job order → assigned recruiters, worker's account + groups,
 * tenant defaults), resolves ownership once, calls the pure seed builder,
 * and batch-writes items idempotently.
 *
 * Parallel to `seedEmployeeReadinessItemsRunner.ts`. Lives as a sibling
 * because the ownership resolution hierarchy is different: Assignment
 * Readiness INCLUDES the job-order tier (top priority), Employee Readiness
 * skips it.
 *
 * @see functions/src/readiness/seedEmployeeReadinessItemsRunner.ts
 * @see recruiter-ownership-model.md §4b (hierarchy walk)
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  seedAssignmentReadinessItems,
  type SeedAssignmentReadinessRequirementSpec,
} from '../shared/seedAssignmentReadinessItems';
import {
  resolveOwnership,
  type ResolveOwnershipWithPoolInput,
} from '../shared/resolveOwnership';
import type { ActionItemOwnership } from '../shared/actionItemOwnership';
import type { AssignmentReadinessItem } from '../shared/assignmentReadinessItemV1';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const IN_LIMIT = 30;

export type AssignmentSeedRunnerInput = {
  tenantId: string;
  assignmentId: string;
  workerUid: string;
  jobOrderId: string;
  shiftId?: string;
  requirements: SeedAssignmentReadinessRequirementSpec[];
  actorUid: string;
  source: AssignmentReadinessItem['source'];
  dryRun?: boolean;
};

export type AssignmentSeedRunnerResult = {
  success: boolean;
  itemsCreated: number;
  itemsSkippedExisting: number;
  ownership: ActionItemOwnership;
  dryRunItems?: AssignmentReadinessItem[];
};

export async function runAssignmentReadinessSeed(
  input: AssignmentSeedRunnerInput,
): Promise<AssignmentSeedRunnerResult> {
  const { tenantId, assignmentId, workerUid, jobOrderId, shiftId, requirements, actorUid, source, dryRun } = input;

  if (!tenantId || !assignmentId || !workerUid || !jobOrderId) {
    throw new Error('runAssignmentReadinessSeed: tenantId, assignmentId, workerUid, jobOrderId are required');
  }
  if (!requirements || requirements.length === 0) {
    throw new Error('runAssignmentReadinessSeed: empty requirement set');
  }

  const ownershipInput = await loadOwnershipInput({ tenantId, workerUid, jobOrderId });
  const resolved = resolveOwnership(ownershipInput);

  const nowIso = new Date().toISOString();
  const ownership: ActionItemOwnership = {
    primaryRecruiterId: resolved.primaryRecruiterId,
    visibleRecruiterIds: resolved.visibleRecruiterIds,
    primarySource: resolved.primarySource,
    history: [
      {
        at: nowIso,
        actorUid,
        action: 'assigned',
        from: null,
        to: resolved.primaryRecruiterId,
        reason: `Initial derivation (source: ${resolved.primarySource})`,
      },
    ],
  };

  const items = seedAssignmentReadinessItems({
    tenantId,
    assignmentId,
    workerUid,
    jobOrderId,
    shiftId,
    requirements,
    ownership,
    nowIso,
    source,
  });

  if (dryRun) {
    return { success: true, itemsCreated: 0, itemsSkippedExisting: 0, ownership, dryRunItems: items };
  }

  const itemsRef = db.collection(`tenants/${tenantId}/assignmentReadinessItems`);
  const existingSnaps = await Promise.all(items.map((it) => itemsRef.doc(it.id).get()));
  const toWrite: AssignmentReadinessItem[] = [];
  let skipped = 0;
  items.forEach((item, i) => {
    if (existingSnaps[i].exists) skipped += 1;
    else toWrite.push(item);
  });

  if (toWrite.length === 0) {
    logger.info('runAssignmentReadinessSeed: all items already exist (no-op)', {
      tenantId,
      assignmentId,
      skipped,
    });
    return { success: true, itemsCreated: 0, itemsSkippedExisting: skipped, ownership };
  }

  const batch = db.batch();
  for (const item of toWrite) batch.set(itemsRef.doc(item.id), serializeItemForFirestore(item));
  await batch.commit();

  logger.info('runAssignmentReadinessSeed: seeded items', {
    tenantId,
    assignmentId,
    workerUid,
    jobOrderId,
    itemsCreated: toWrite.length,
    itemsSkippedExisting: skipped,
    primaryRecruiterId: resolved.primaryRecruiterId,
    primarySource: resolved.primarySource,
  });

  return { success: true, itemsCreated: toWrite.length, itemsSkippedExisting: skipped, ownership };
}

/**
 * Load ownership inputs INCLUDING the job-order tier (which Employee
 * Readiness skips). JO-level ownership takes priority over account /
 * user-group per §4b.
 */
async function loadOwnershipInput(args: {
  tenantId: string;
  workerUid: string;
  jobOrderId: string;
}): Promise<ResolveOwnershipWithPoolInput> {
  const { tenantId, workerUid, jobOrderId } = args;

  // Job order — top priority tier.
  let jobOrderInput: ResolveOwnershipWithPoolInput['jobOrder'] | undefined;
  let accountIdFromJo: string | null = null;
  try {
    const joSnap = await db.doc(`tenants/${tenantId}/jobOrders/${jobOrderId}`).get();
    if (joSnap.exists) {
      const data = (joSnap.data() ?? {}) as Record<string, unknown>;
      const assignedRecruiters = uniqueStringList((data.assignedRecruiters as unknown[]) ?? []);
      jobOrderInput = {
        id: jobOrderId,
        assignedRecruiters,
        accountId: typeof data.accountId === 'string' ? data.accountId : undefined,
      };
      if (typeof data.accountId === 'string' && data.accountId.trim()) accountIdFromJo = data.accountId.trim();
    }
  } catch (err) {
    logger.warn('loadOwnershipInput(assignment): jobOrder lookup failed', {
      tenantId,
      jobOrderId,
      err: (err as Error).message,
    });
  }

  // Worker's own account context (falls back to JO account).
  const userSnap = await db.doc(`users/${workerUid}`).get();
  const userData = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;
  const groupIds = uniqueStringList(
    (userData.userGroupIds as unknown[]) ?? [],
    (((userData.tenantIds as Record<string, Record<string, unknown>>) || {})[tenantId]?.userGroupIds as unknown[]) ?? [],
  );

  let accountInput: ResolveOwnershipWithPoolInput['account'] | undefined;
  const accountId = accountIdFromJo;
  if (accountId) {
    try {
      const acctSnap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      if (acctSnap.exists) {
        const associations = ((acctSnap.data() as Record<string, unknown>)?.associations as Record<string, unknown> | undefined) ?? {};
        const recruiterIds = uniqueStringList((associations.recruiterIds as unknown[]) ?? []);
        if (recruiterIds.length > 0) accountInput = { id: accountId, recruiterIds };
      }
    } catch (err) {
      logger.warn('loadOwnershipInput(assignment): account lookup failed', {
        tenantId,
        accountId,
        err: (err as Error).message,
      });
    }
  }

  const userGroups: ResolveOwnershipWithPoolInput['userGroups'] = [];
  for (let i = 0; i < groupIds.length; i += IN_LIMIT) {
    const chunk = groupIds.slice(i, i + IN_LIMIT);
    try {
      const gsnap = await db
        .collection(`tenants/${tenantId}/userGroups`)
        .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
        .get();
      gsnap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        // Prefer the new `roles.csaIds` field; fall back to legacy
        // `groupManagerIds` for groups that haven't been migrated yet.
        // The UI dual-writes both, so once a group is touched the two
        // arrays are in sync — this fallback only matters for stale data.
        const rolesObj = (data.roles && typeof data.roles === 'object')
          ? (data.roles as Record<string, unknown>)
          : null;
        const csaIds = uniqueStringList((rolesObj?.csaIds as unknown[]) ?? []);
        const legacyIds = uniqueStringList((data.groupManagerIds as unknown[]) ?? []);
        const ids = csaIds.length > 0 ? csaIds : legacyIds;
        if (ids.length > 0) {
          userGroups.push({ id: d.id, csaIds, groupManagerIds: legacyIds });
        }
      });
    } catch (err) {
      logger.warn('loadOwnershipInput(assignment): userGroups lookup failed for chunk', {
        tenantId,
        chunk,
        err: (err as Error).message,
      });
    }
  }

  let tenantDefaults: ResolveOwnershipWithPoolInput['tenantDefaults'];
  let unassignedPool: string[] | undefined;
  try {
    const cfgSnap = await db.doc(`tenants/${tenantId}/messagingConfig/ownershipDefaults`).get();
    if (cfgSnap.exists) {
      const cfg = (cfgSnap.data() ?? {}) as Record<string, unknown>;
      tenantDefaults = {
        defaultRecruiterId: typeof cfg.defaultRecruiterId === 'string' ? cfg.defaultRecruiterId : undefined,
        unassignedPoolEnabled: cfg.unassignedPoolEnabled !== false,
      };
    } else {
      tenantDefaults = { unassignedPoolEnabled: true };
    }
  } catch {
    tenantDefaults = { unassignedPoolEnabled: true };
  }
  if (tenantDefaults?.unassignedPoolEnabled) {
    unassignedPool = await loadUnassignedPoolForTenant(tenantId);
  }

  return {
    tenantId,
    workerUid,
    jobOrder: jobOrderInput,
    account: accountInput,
    userGroups: userGroups.length > 0 ? userGroups : undefined,
    tenantDefaults,
    unassignedPool,
    tieBreakers: { stableSeed: workerUid },
  };
}

async function loadUnassignedPoolForTenant(tenantId: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const snap = await db
      .collection('users')
      .where(`tenantIds.${tenantId}.securityLevel`, 'in', ['5', '6', '7'])
      .limit(200)
      .get();
    snap.docs.forEach((d) => out.add(d.id));
  } catch {
    /* empty pool on query error */
  }
  return Array.from(out);
}

function uniqueStringList(...sources: unknown[][]): string[] {
  const out = new Set<string>();
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      if (typeof v === 'string' && v.trim().length > 0) out.add(v.trim());
    }
  }
  return Array.from(out);
}

function serializeItemForFirestore(item: AssignmentReadinessItem): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  out.createdAt = admin.firestore.Timestamp.fromDate(new Date(item.createdAt));
  out.updatedAt = admin.firestore.Timestamp.fromDate(new Date(item.updatedAt));
  if (item.completedAt) out.completedAt = admin.firestore.Timestamp.fromDate(new Date(item.completedAt));
  if (item.blockedAt) out.blockedAt = admin.firestore.Timestamp.fromDate(new Date(item.blockedAt));
  if (item.ownership?.history?.length) {
    out.ownership = {
      ...item.ownership,
      history: item.ownership.history.map((h) => ({
        ...h,
        at: admin.firestore.Timestamp.fromDate(new Date(h.at)),
      })),
    };
  }
  return out;
}
