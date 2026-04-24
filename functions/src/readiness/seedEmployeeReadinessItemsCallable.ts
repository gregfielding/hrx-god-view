/**
 * Callable: `seedEmployeeReadinessItems`
 *
 * Manually trigger the creation of `EmployeeReadinessItem` docs for a worker
 * × hiring entity. Loads the worker's associations (job order assignments,
 * account, user groups, tenant defaults), resolves ownership ONCE, calls the
 * pure builder, and batch-writes to Firestore.
 *
 * Used today as the hand-pulled producer (debug button on a user profile).
 * Will eventually be wrapped by an `onDocumentCreated` trigger on
 * `tenants/{tid}/entity_employments/{id}` so first-time entity association
 * automatically seeds the readiness items — but the pull-mode callable
 * stays around for backfills, manual reseeds after policy changes, and QA.
 *
 * Permissions: any L4+ recruiter at the tenant (`canManageOnboarding`).
 *
 * @see shared/seedEmployeeReadinessItems.ts (the pure builder).
 * @see shared/resolveOwnership.ts (the ownership resolver).
 * @see recruiter-ownership-model.md §13a (per-item Firestore source of truth).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  seedEmployeeReadinessItems,
  BASELINE_W2_REQUIREMENTS,
  BASELINE_1099_REQUIREMENTS,
  type SeedEmployeeReadinessRequirementSpec,
} from '../shared/seedEmployeeReadinessItems';
import {
  resolveOwnership,
  type ResolveOwnershipWithPoolInput,
} from '../shared/resolveOwnership';
import type { ActionItemOwnership } from '../shared/actionItemOwnership';
import type { EmployeeReadinessItem } from '../shared/employeeReadinessItemV1';

import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Chunk size for Firestore `in` queries (Firestore caps at 30). */
const IN_LIMIT = 30;

/** Which baseline requirement preset to use when caller doesn't supply explicit `requirements`. */
type BaselinePreset = 'w2' | '1099' | 'none';

interface SeedPayload {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  /** Optional human-readable name; denormalized onto every item. */
  hiringEntityName?: string;
  /** When omitted, uses BASELINE_W2_REQUIREMENTS. Pass `'1099'` for the contractor flow. */
  baseline?: BaselinePreset;
  /** Custom requirement set; takes precedence over `baseline` when both are supplied. */
  requirements?: SeedEmployeeReadinessRequirementSpec[];
  /** When `true`, returns the items that WOULD be written without writing them. Useful for debug button preview. */
  dryRun?: boolean;
}

interface SeedResponse {
  success: boolean;
  itemsCreated: number;
  itemsSkippedExisting: number;
  ownership: ActionItemOwnership;
  /** When `dryRun: true`, includes the full item docs that would be written. */
  dryRunItems?: EmployeeReadinessItem[];
}

export const seedEmployeeReadinessItemsCallable = onCall(
  {
    cors: true,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request): Promise<SeedResponse> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const callerUid = request.auth.uid;

    const data = (request.data || {}) as SeedPayload;
    const tenantId = String(data.tenantId || '').trim();
    const workerUid = String(data.workerUid || '').trim();
    const hiringEntityId = String(data.hiringEntityId || '').trim();

    if (!tenantId || !workerUid || !hiringEntityId) {
      throw new HttpsError('invalid-argument', 'tenantId, workerUid, and hiringEntityId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, callerUid))) {
      throw new HttpsError('permission-denied', 'Not authorized to seed readiness items for this tenant');
    }

    // Pick the requirement set: explicit > baseline preset > BASELINE_W2_REQUIREMENTS default.
    const requirements = pickRequirementSet(data);
    if (requirements.length === 0) {
      throw new HttpsError('invalid-argument', 'Empty requirement set — pass either `requirements` or `baseline`');
    }

    // Hydrate the entity name for denormalization (best-effort; non-fatal).
    let hiringEntityName: string | undefined = data.hiringEntityName;
    if (!hiringEntityName) {
      try {
        const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
        if (entitySnap.exists) {
          const v = (entitySnap.data() as Record<string, unknown> | undefined)?.name;
          if (typeof v === 'string') hiringEntityName = v;
        }
      } catch (err) {
        logger.warn('seedEmployeeReadinessItemsCallable: failed to load entity name', {
          tenantId,
          hiringEntityId,
          err: (err as Error).message,
        });
      }
    }

    // Resolve ownership ONCE for the entire seed batch (Employee Readiness items
    // for the same worker × entity all share the same ownership snapshot at
    // creation — see recruiter-ownership-model.md §13b).
    const ownershipInput = await loadOwnershipInput({
      tenantId,
      workerUid,
      hiringEntityId,
      stableSeed: workerUid,
    });
    const resolved = resolveOwnership(ownershipInput);

    const nowIso = new Date().toISOString();
    const ownership: ActionItemOwnership = {
      primaryRecruiterId: resolved.primaryRecruiterId,
      visibleRecruiterIds: resolved.visibleRecruiterIds,
      primarySource: resolved.primarySource,
      history: [
        {
          at: nowIso,
          actorUid: callerUid,
          action: 'assigned',
          from: null,
          to: resolved.primaryRecruiterId,
          reason: `Initial derivation by seedEmployeeReadinessItemsCallable (source: ${resolved.primarySource})`,
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
      source: { kind: 'recruiterManual', ref: callerUid },
    });

    if (data.dryRun) {
      return {
        success: true,
        itemsCreated: 0,
        itemsSkippedExisting: 0,
        ownership,
        dryRunItems: items,
      };
    }

    // Skip items that already exist (idempotent reseed). We use `create` semantics
    // via `set` with a `merge: false` write batch wouldn't catch existing docs;
    // instead, batch-read first to count what's already there, then only write
    // the new ones.
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
      logger.info('seedEmployeeReadinessItemsCallable: nothing to write (all items already exist)', {
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

    // Batch write — Firestore caps at 500 ops per batch, well above our seed sets.
    const batch = db.batch();
    for (const item of toWrite) {
      batch.set(itemsRef.doc(item.id), serializeItemForFirestore(item));
    }
    await batch.commit();

    logger.info('seedEmployeeReadinessItemsCallable: seeded readiness items', {
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
  },
);

/** Pick the requirement set per the caller's preference. */
function pickRequirementSet(data: SeedPayload): SeedEmployeeReadinessRequirementSpec[] {
  if (Array.isArray(data.requirements) && data.requirements.length > 0) {
    return data.requirements;
  }
  switch (data.baseline) {
    case '1099':
      return BASELINE_1099_REQUIREMENTS;
    case 'none':
      return [];
    case 'w2':
    default:
      return BASELINE_W2_REQUIREMENTS;
  }
}

/**
 * Load the inputs for `resolveOwnership` from Firestore. Uses what's currently
 * available: account associations (when an `entity_employments` row points to
 * an account), user-group memberships, and the tenant's ownership defaults.
 *
 * Job-order context is intentionally NOT loaded here — Employee Readiness items
 * are entity-scoped, not shift-scoped. The JO-context branch only fires for
 * `AssignmentReadinessItem` seeding (separate path).
 */
async function loadOwnershipInput(args: {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  stableSeed: string;
}): Promise<ResolveOwnershipWithPoolInput> {
  const { tenantId, workerUid, hiringEntityId, stableSeed } = args;

  // 1. Worker doc — we need their userGroupIds + active account associations.
  const userSnap = await db.doc(`users/${workerUid}`).get();
  const userData = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;

  const groupIds = uniqueStringList(
    (userData.userGroupIds as unknown[]) ?? [],
    (((userData.tenantIds as Record<string, Record<string, unknown>>) || {})[tenantId]?.userGroupIds as unknown[]) ?? [],
  );

  // 2. Account context — derived from the entity_employments row, when present.
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
    logger.warn('loadOwnershipInput: entity_employments lookup failed (proceeding without account context)', {
      tenantId,
      workerUid,
      hiringEntityId,
      err: (err as Error).message,
    });
  }

  // 3. Account doc → recruiterIds.
  let accountInput: ResolveOwnershipWithPoolInput['account'] | undefined;
  if (accountId) {
    try {
      const acctSnap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      if (acctSnap.exists) {
        const acct = (acctSnap.data() ?? {}) as Record<string, unknown>;
        const associations = (acct.associations as Record<string, unknown> | undefined) ?? {};
        const recruiterIds = uniqueStringList((associations.recruiterIds as unknown[]) ?? []);
        if (recruiterIds.length > 0) {
          accountInput = { id: accountId, recruiterIds };
        }
      }
    } catch (err) {
      logger.warn('loadOwnershipInput: account lookup failed', {
        tenantId,
        accountId,
        err: (err as Error).message,
      });
    }
  }

  // 4. User-group docs → groupManagerIds.
  const userGroups: ResolveOwnershipWithPoolInput['userGroups'] = [];
  if (groupIds.length > 0) {
    for (let i = 0; i < groupIds.length; i += IN_LIMIT) {
      const chunk = groupIds.slice(i, i + IN_LIMIT);
      try {
        const groupsSnap = await db
          .collection(`tenants/${tenantId}/userGroups`)
          .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
          .get();
        groupsSnap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const managerIds = uniqueStringList((data.groupManagerIds as unknown[]) ?? []);
          if (managerIds.length > 0) {
            userGroups.push({ id: d.id, groupManagerIds: managerIds });
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
  }

  // 5. Tenant defaults + unassigned pool list.
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
    }
  } catch (err) {
    logger.warn('loadOwnershipInput: ownershipDefaults lookup failed', {
      tenantId,
      err: (err as Error).message,
    });
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
    tieBreakers: { stableSeed },
  };
}

/**
 * Load the L5+ recruiters at this tenant (canonical Unassigned pool — see
 * recruiter-ownership-model.md §5). This is intentionally a fresh query each
 * call; the resolver doc explicitly says we don't persist this list.
 *
 * Best-effort and bounded: caps at 200 results to keep the resolver fast on
 * very large tenants. If your tenant routinely has >200 L5+ recruiters this
 * cap should be revisited.
 */
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

/**
 * Convert ISO-8601 date strings to Firestore Timestamps before write. The pure
 * builder uses ISO strings so it stays runtime-neutral; the callable converts
 * at the boundary.
 */
function serializeItemForFirestore(item: EmployeeReadinessItem): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  out.createdAt = admin.firestore.Timestamp.fromDate(new Date(item.createdAt));
  out.updatedAt = admin.firestore.Timestamp.fromDate(new Date(item.updatedAt));
  if (item.completedAt) {
    out.completedAt = admin.firestore.Timestamp.fromDate(new Date(item.completedAt));
  }
  if (item.blockedAt) {
    out.blockedAt = admin.firestore.Timestamp.fromDate(new Date(item.blockedAt));
  }
  // ownership.history[].at -> Timestamp
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
