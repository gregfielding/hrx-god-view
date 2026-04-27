/**
 * Core runner for Employee Readiness seeding. Loads the worker's associations,
 * resolves ownership once, calls the pure seed builder, and batch-writes items
 * idempotently. Shared by both the callable (manual / debug-button invocation)
 * and the automatic `entity_employments` create trigger.
 *
 * Pure pipeline wrapper — keep ALL auth / role checks in the caller layers.
 *
 * @see recruiter-ownership-model.md §13 (Firestore storage + trigger decisions)
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  seedEmployeeReadinessItems,
  type SeedEmployeeReadinessRequirementSpec,
} from '../shared/seedEmployeeReadinessItems';
import {
  resolveOwnership,
  type ResolveOwnershipWithPoolInput,
} from '../shared/resolveOwnership';
import type { ActionItemOwnership } from '../shared/actionItemOwnership';
import type { EmployeeReadinessItem } from '../shared/employeeReadinessItemV1';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Firestore `in` cap. */
const IN_LIMIT = 30;

export type SeedRunnerInput = {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  hiringEntityName?: string;
  requirements: SeedEmployeeReadinessRequirementSpec[];
  /** `'system'` for triggers; the invoking uid for callables. */
  actorUid: string;
  /** Audit attribution for the `source` field on every item. */
  source: EmployeeReadinessItem['source'];
  /** When true, build items + return them but DON'T write. Callable preview path uses this. */
  dryRun?: boolean;
};

export type SeedRunnerResult = {
  success: boolean;
  itemsCreated: number;
  itemsSkippedExisting: number;
  ownership: ActionItemOwnership;
  /** Populated only when `dryRun: true`. */
  dryRunItems?: EmployeeReadinessItem[];
};

/**
 * Run the seed pipeline for one (worker × hiring entity). Idempotent.
 */
export async function runEmployeeReadinessSeed(input: SeedRunnerInput): Promise<SeedRunnerResult> {
  const { tenantId, workerUid, hiringEntityId, requirements, actorUid, source, dryRun } = input;

  if (!tenantId || !workerUid || !hiringEntityId) {
    throw new Error('runEmployeeReadinessSeed: tenantId, workerUid, hiringEntityId are required');
  }
  if (!requirements || requirements.length === 0) {
    throw new Error('runEmployeeReadinessSeed: empty requirement set');
  }

  // Hydrate entity name (best-effort; non-fatal).
  let hiringEntityName: string | undefined = input.hiringEntityName;
  if (!hiringEntityName) {
    try {
      const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
      if (entitySnap.exists) {
        const v = (entitySnap.data() as Record<string, unknown> | undefined)?.name;
        if (typeof v === 'string') hiringEntityName = v;
      }
    } catch (err) {
      logger.warn('runEmployeeReadinessSeed: entity name lookup failed', {
        tenantId,
        hiringEntityId,
        err: (err as Error).message,
      });
    }
  }

  // Resolve ownership ONCE — all items for this (worker × entity) share the same snapshot.
  const ownershipInput = await loadOwnershipInput({ tenantId, workerUid, hiringEntityId });
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

  const items = seedEmployeeReadinessItems({
    tenantId,
    workerUid,
    hiringEntityId,
    hiringEntityName,
    requirements,
    ownership,
    nowIso,
    source,
  });

  if (dryRun) {
    return {
      success: true,
      itemsCreated: 0,
      itemsSkippedExisting: 0,
      ownership,
      dryRunItems: items,
    };
  }

  // Idempotent write — skip doc ids that already exist.
  const itemsRef = db.collection(`tenants/${tenantId}/employeeReadinessItems`);
  const existingSnaps = await Promise.all(items.map((it) => itemsRef.doc(it.id).get()));
  const toWrite: EmployeeReadinessItem[] = [];
  let skipped = 0;
  items.forEach((item, i) => {
    if (existingSnaps[i].exists) {
      skipped += 1;
    } else {
      toWrite.push(item);
    }
  });

  if (toWrite.length === 0) {
    logger.info('runEmployeeReadinessSeed: all items already exist (no-op)', {
      tenantId,
      workerUid,
      hiringEntityId,
      skipped,
    });
    return {
      success: true,
      itemsCreated: 0,
      itemsSkippedExisting: skipped,
      ownership,
    };
  }

  const batch = db.batch();
  for (const item of toWrite) {
    batch.set(itemsRef.doc(item.id), serializeItemForFirestore(item));
  }
  await batch.commit();

  logger.info('runEmployeeReadinessSeed: seeded items', {
    tenantId,
    workerUid,
    hiringEntityId,
    itemsCreated: toWrite.length,
    itemsSkippedExisting: skipped,
    primaryRecruiterId: resolved.primaryRecruiterId,
    primarySource: resolved.primarySource,
  });

  return {
    success: true,
    itemsCreated: toWrite.length,
    itemsSkippedExisting: skipped,
    ownership,
  };
}

/**
 * Load the ResolveOwnershipInput for an employee-readiness context.
 * Employee Readiness items are entity-scoped, so we skip the job-order tier;
 * only account / user-group / tenant-default tiers are consulted.
 */
async function loadOwnershipInput(args: {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
}): Promise<ResolveOwnershipWithPoolInput> {
  const { tenantId, workerUid, hiringEntityId } = args;

  const userSnap = await db.doc(`users/${workerUid}`).get();
  const userData = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;

  const groupIds = uniqueStringList(
    (userData.userGroupIds as unknown[]) ?? [],
    (((userData.tenantIds as Record<string, Record<string, unknown>>) || {})[tenantId]?.userGroupIds as unknown[]) ?? [],
  );

  // Account inferred from the entity_employments row.
  let accountId: string | null = null;
  try {
    const employmentSnap = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('userId', '==', workerUid)
      .where('hiringEntityId', '==', hiringEntityId)
      .limit(1)
      .get();
    if (!employmentSnap.empty) {
      const emp = employmentSnap.docs[0].data() as Record<string, unknown>;
      const candidate = (emp.accountId ?? emp.companyId) as unknown;
      if (typeof candidate === 'string' && candidate.trim()) accountId = candidate.trim();
    }
  } catch (err) {
    logger.warn('loadOwnershipInput: entity_employments lookup failed', {
      tenantId,
      workerUid,
      hiringEntityId,
      err: (err as Error).message,
    });
  }

  let accountInput: ResolveOwnershipWithPoolInput['account'] | undefined;
  if (accountId) {
    try {
      const acctSnap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      if (acctSnap.exists) {
        const associations = ((acctSnap.data() as Record<string, unknown>)?.associations as Record<string, unknown> | undefined) ?? {};
        const recruiterIds = uniqueStringList((associations.recruiterIds as unknown[]) ?? []);
        if (recruiterIds.length > 0) accountInput = { id: accountId, recruiterIds };
      }
    } catch (err) {
      logger.warn('loadOwnershipInput: account lookup failed', {
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
      logger.warn('loadOwnershipInput: userGroups lookup failed for chunk', {
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
        defaultRecruiterId:
          typeof cfg.defaultRecruiterId === 'string' ? cfg.defaultRecruiterId : undefined,
        unassignedPoolEnabled: cfg.unassignedPoolEnabled !== false,
      };
    } else {
      // Pool enabled by default if the config doc doesn't exist yet.
      tenantDefaults = { unassignedPoolEnabled: true };
    }
  } catch (err) {
    logger.warn('loadOwnershipInput: ownershipDefaults lookup failed', {
      tenantId,
      err: (err as Error).message,
    });
    tenantDefaults = { unassignedPoolEnabled: true };
  }

  if (tenantDefaults?.unassignedPoolEnabled) {
    unassignedPool = await loadUnassignedPoolForTenant(tenantId);
  }

  return {
    tenantId,
    workerUid,
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
  } catch (err) {
    logger.warn('loadUnassignedPoolForTenant: query failed (returning empty pool)', {
      tenantId,
      err: (err as Error).message,
    });
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

/** Convert ISO date strings → Firestore Timestamps at the write boundary. */
function serializeItemForFirestore(item: EmployeeReadinessItem): Record<string, unknown> {
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
