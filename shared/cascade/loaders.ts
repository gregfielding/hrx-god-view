/**
 * Cascading Order Data — admin-SDK Firestore loaders (handoff §6 + §16.1 L4).
 *
 * Server-side twin of `src/shared/cascade/loaders.ts`. Built for
 * cloud functions (snapshot trigger, Push-to-Active, backfill
 * migration). Mirrors the CRA loader's chain composition exactly,
 * the only differences are:
 *
 *   - `firebase-admin/firestore` instead of the modular `firebase`
 *     SDK. We accept an `admin.firestore.Firestore` instance via
 *     `LoaderContext` rather than reaching for a global, so callers
 *     in tests / scripts can inject a fake Firestore.
 *
 *   - Firestore paths are inlined (`tenants/{tid}/...`) — the
 *     `functions/` package has no `firestorePaths.ts` helper. The
 *     two paths used (`recruiterAccount`, `recruiterAccountLocationDefaults`,
 *     `jobOrder`, `shift`) are short and copied with the same shape
 *     the CRA helper produces.
 *
 *   - The `FIELD_PATHS_BY_LEVEL` map is *not* re-declared here. The
 *     CRA loader is the single source of truth — we re-export its
 *     internal map for the admin loader to consume. CI guard
 *     (`scripts/check-cascade-mirror.sh`) enforces field-path
 *     parity across the trees regardless.
 *
 * NOT a drop-in replacement for the CRA loader: client code keeps
 * importing from `src/shared/cascade/loaders.ts`. Don't import this
 * module from React.
 */

import * as admin from 'firebase-admin';

import type { CascadingFieldKey } from './registry';
import type { AncestorLevel, LevelType } from './types';

// ---- Field-path map -----------------------------------------------

/**
 * Where each cascading field lives on the raw doc, per level type.
 * Identical to the CRA loader's map (`src/shared/cascade/loaders.ts`).
 *
 * Keep in lockstep with the CRA loader. CI guard
 * `scripts/check-cascade-mirror.sh` diffs the two maps and fails
 * the PR if they drift.
 *
 * NOTE: the comment block on the CRA side is the canonical
 * documentation for *why* each path is what it is — see that file
 * before adding/renaming a field.
 */
const FIELD_PATHS_BY_LEVEL: Record<
  LevelType,
  Partial<Record<CascadingFieldKey, string>>
> = {
  account: {
    staffInstructions: 'orderDefaults.staffInstructions',
    additionalScreenings: 'orderDefaults.orderDetails.additionalScreenings',
    screeningPackageId: 'orderDefaults.screeningPackageId',
    eVerifyRequired: 'orderDefaults.eVerify.eVerifyRequired',
    hiringEntityId: 'orderDefaults.hiringEntityId',
    workersCompCode: 'workersCompCode',
    uniformRequirements: 'orderDefaults.orderDetails.dressCode',
    customerSpecificRules: 'orderDefaults.customerSpecificRules',
    postingVisibility: 'orderDefaults.postingVisibility',
    postingPolicy: 'orderDefaults.postingPolicy',
    positions: 'pricing.positions',
  },
  child: {
    staffInstructions: 'orderDefaults.staffInstructions',
    additionalScreenings: 'orderDefaults.orderDetails.additionalScreenings',
    screeningPackageId: 'orderDefaults.screeningPackageId',
    eVerifyRequired: 'orderDefaults.eVerify.eVerifyRequired',
    hiringEntityId: 'orderDefaults.hiringEntityId',
    workersCompCode: 'workersCompCode',
    uniformRequirements: 'orderDefaults.orderDetails.dressCode',
    customerSpecificRules: 'orderDefaults.customerSpecificRules',
    postingVisibility: 'orderDefaults.postingVisibility',
    postingPolicy: 'orderDefaults.postingPolicy',
    positions: 'pricing.positions',
  },
  location: {
    staffInstructions: 'orderDefaults.staffInstructions',
    additionalScreenings: 'orderDefaults.orderDetails.additionalScreenings',
    screeningPackageId: 'orderDefaults.screeningPackageId',
    uniformRequirements: 'orderDefaults.orderDetails.dressCode',
    customerSpecificRules: 'orderDefaults.customerSpecificRules',
  },
  jo: {
    staffInstructions: 'staffInstructions',
    additionalScreenings: 'additionalScreenings',
    screeningPackageId: 'screeningPackageId',
    workersCompCode: 'workersCompCode',
    selectedPositionIds: 'selectedPositionIds',
    shiftTemplate: 'shiftTemplate',
    uniformRequirements: 'uniformRequirements',
    postingVisibility: 'postingVisibility',
    postingPolicy: 'postingPolicy',
  },
  shift: {
    staffInstructions: 'staffInstructions',
    uniformRequirements: 'uniformRequirements',
  },
};

// ---- LoaderContext (per-request cache + Firestore handle) ---------

/**
 * Per-request memoization of `getDoc` calls + injected Firestore
 * handle. The Firestore handle is part of the context so unit tests
 * can pass a fake without monkey-patching `admin.firestore()`.
 *
 * Hold a single `LoaderContext` across one cloud-function
 * invocation (one trigger fire = one chain build per JO). Don't
 * cache across invocations — the cache has no TTL.
 */
export interface LoaderContext {
  readonly db: admin.firestore.Firestore;
  /** Map<fullDocPath, Promise<DocumentSnapshot>>. */
  readonly cache: Map<string, Promise<admin.firestore.DocumentSnapshot>>;
}

export interface CreateLoaderContextOptions {
  /** Firestore handle. Defaults to `admin.firestore()`. */
  db?: admin.firestore.Firestore;
}

export function createLoaderContext(opts: CreateLoaderContextOptions = {}): LoaderContext {
  return {
    db: opts.db ?? admin.firestore(),
    cache: new Map(),
  };
}

function getDocCached(
  ctx: LoaderContext,
  path: string,
): Promise<admin.firestore.DocumentSnapshot> {
  const hit = ctx.cache.get(path);
  if (hit) return hit;
  const ref = ctx.db.doc(path);
  const promise = ref.get();
  ctx.cache.set(path, promise);
  return promise;
}

// ---- Firestore path helpers (mirrored from src/data/firestorePaths) -

const paths = {
  recruiterAccount: (tenantId: string, id: string) =>
    `tenants/${tenantId}/accounts/${id}`,
  recruiterAccountLocationDefaults: (
    tenantId: string,
    accountId: string,
    locationKey: string,
  ) => `tenants/${tenantId}/accounts/${accountId}/location_defaults/${locationKey}`,
  jobOrder: (tenantId: string, id: string) => `tenants/${tenantId}/job_orders/${id}`,
  shift: (tenantId: string, jobOrderId: string, shiftId: string) =>
    `tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`,
};

// ---- Public loader API --------------------------------------------

export interface ChainTarget {
  tenantId: string;
  jobOrderId: string;
  shiftId?: string | null;
  /**
   * Optional pre-fetched JO doc data. When the snapshot trigger
   * fires it already has `change.after.data()` — passing it here
   * avoids one Firestore read. Same shape as `joSnap.data()`.
   */
  preloadedJoData?: Record<string, unknown> | null;
}

/**
 * Build the ancestor chain for a JO (or a JO + shift). Mirrors
 * `src/shared/cascade/loaders.ts:loadCascadeChain` exactly — see
 * that file's docstring for the hierarchy rules.
 */
export async function loadCascadeChain(
  ctx: LoaderContext,
  target: ChainTarget,
): Promise<AncestorLevel[]> {
  const { tenantId, jobOrderId, shiftId, preloadedJoData } = target;
  if (!tenantId || !jobOrderId) {
    throw new Error('[cascade.loadCascadeChain] tenantId and jobOrderId are required');
  }

  // Step 1: load JO. Prefer preloaded data when caller has it.
  let joRaw: Record<string, unknown> | null;
  if (preloadedJoData) {
    joRaw = preloadedJoData;
  } else {
    const joSnap = await getDocCached(ctx, paths.jobOrder(tenantId, jobOrderId));
    if (!joSnap.exists) return [];
    joRaw = (joSnap.data() ?? null) as Record<string, unknown> | null;
    if (!joRaw) return [];
  }

  const recruiterAccountId = strField(joRaw, 'recruiterAccountId');
  const companyId = strField(joRaw, 'companyId') ?? strField(joRaw, 'crmCompanyId');
  const worksiteId = strField(joRaw, 'worksiteId') ?? strField(joRaw, 'locationId');

  // Step 2: load the recruiter account chain.
  const accountChain: AncestorLevel[] = [];
  if (recruiterAccountId) {
    accountChain.push(
      ...(await loadAccountChain(ctx, tenantId, recruiterAccountId, companyId, worksiteId)),
    );
  }

  // Step 3: JO level always present.
  const joLevel: AncestorLevel = {
    levelType: 'jo',
    levelId: jobOrderId,
    levelLabel: strField(joRaw, 'jobTitle') ?? strField(joRaw, 'title') ?? 'Job Order',
    deltas: extractDeltas('jo', joRaw),
  };

  // Step 4: optional shift level.
  let shiftLevel: AncestorLevel | null = null;
  if (shiftId) {
    const shiftSnap = await getDocCached(ctx, paths.shift(tenantId, jobOrderId, shiftId));
    if (shiftSnap.exists) {
      const shiftRaw = (shiftSnap.data() ?? {}) as Record<string, unknown>;
      shiftLevel = {
        levelType: 'shift',
        levelId: shiftId,
        levelLabel: strField(shiftRaw, 'name') ?? `Shift ${shiftId.slice(0, 6)}`,
        deltas: extractDeltas('shift', shiftRaw),
      };
    } else {
      shiftLevel = {
        levelType: 'shift',
        levelId: shiftId,
        deltas: {},
      };
    }
  }

  const chain: AncestorLevel[] = [...accountChain, joLevel];
  if (shiftLevel) chain.push(shiftLevel);
  return chain;
}

// ---- Internals ----------------------------------------------------

async function loadAccountChain(
  ctx: LoaderContext,
  tenantId: string,
  accountId: string,
  companyId: string | null | undefined,
  worksiteId: string | null | undefined,
): Promise<AncestorLevel[]> {
  const accSnap = await getDocCached(ctx, paths.recruiterAccount(tenantId, accountId));
  if (!accSnap.exists) return [];
  const accRaw = (accSnap.data() ?? {}) as Record<string, unknown>;

  const accountType = inferAccountType(accRaw);
  const parentId = strField(accRaw, 'parentAccountId');

  if (accountType === 'child' && parentId) {
    const parentSnap = await getDocCached(
      ctx,
      paths.recruiterAccount(tenantId, parentId),
    );
    const out: AncestorLevel[] = [];
    if (parentSnap.exists) {
      const parentRaw = (parentSnap.data() ?? {}) as Record<string, unknown>;
      out.push({
        levelType: 'account',
        levelId: parentId,
        levelLabel: strField(parentRaw, 'name') ?? undefined,
        deltas: extractDeltas('account', parentRaw),
      });
    }
    out.push({
      levelType: 'child',
      levelId: accountId,
      levelLabel: strField(accRaw, 'name') ?? undefined,
      deltas: extractDeltas('child', accRaw),
    });
    return out;
  }

  // National-without-parent OR standalone: [account] (+ optional
  // location override for the standalone case).
  const out: AncestorLevel[] = [
    {
      levelType: 'account',
      levelId: accountId,
      levelLabel: strField(accRaw, 'name') ?? undefined,
      deltas: extractDeltas('account', accRaw),
    },
  ];

  const cid = companyId ? String(companyId).trim() : '';
  const wid = worksiteId ? String(worksiteId).trim() : '';
  if (cid && wid) {
    const locationKey = `${cid}_${wid}`.replace(/\//g, '_');
    const locSnap = await getDocCached(
      ctx,
      paths.recruiterAccountLocationDefaults(tenantId, accountId, locationKey),
    );
    if (locSnap.exists) {
      const locRaw = (locSnap.data() ?? {}) as Record<string, unknown>;
      out.push({
        levelType: 'location',
        levelId: locationKey,
        levelLabel: strField(locRaw, 'name') ?? `Worksite ${wid.slice(0, 6)}`,
        deltas: extractDeltas('location', locRaw),
      });
    }
  }

  return out;
}

function extractDeltas(
  level: LevelType,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const fieldPaths = FIELD_PATHS_BY_LEVEL[level];
  if (!fieldPaths) return {};

  const deltas: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(fieldPaths) as Array<
    [CascadingFieldKey, string]
  >) {
    const value = readPath(raw, path);
    if (value !== undefined) deltas[field] = value;
  }
  return deltas;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function strField(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function inferAccountType(raw: Record<string, unknown>): 'national' | 'child' | 'standalone' {
  const rawType = raw.accountType;
  if (rawType === 'national' || rawType === 'child' || rawType === 'standalone') {
    return rawType;
  }
  if (typeof raw.parentAccountId === 'string' && raw.parentAccountId.trim() !== '') {
    return 'child';
  }
  if (Array.isArray(raw.childAccountIds) && raw.childAccountIds.length > 0) {
    return 'national';
  }
  return 'standalone';
}

// Exposed for the CI mirror-check + tests.
export const __INTERNAL_FIELD_PATHS_BY_LEVEL = FIELD_PATHS_BY_LEVEL;
