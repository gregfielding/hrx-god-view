/**
 * Cascading Order Data — Firestore loaders (handoff §6 + O.3).
 *
 * Builds the `AncestorLevel[]` chain that
 * {@link ./resolveCascadedField | resolveCascadedField} consumes.
 * The cascade engine itself is framework-agnostic; this module is
 * the only place that talks to Firestore + the only place that
 * knows where each cascading field lives on each level's doc.
 *
 * CRA-only: imports the modular `firebase/firestore` SDK via
 * `../../firebase`. The cloud-functions side (forward-sync trigger
 * P.2) needs an admin-SDK twin — kept out-of-scope for O.3 because
 * the only consumer right now is the recruiter UI (Instructions tab,
 * O.4 slice). When we wire P.2 we'll mirror this file under
 * `functions/src/shared/cascade/loaders.ts` against `firebase-admin`.
 */

import { doc, getDoc, type DocumentSnapshot } from 'firebase/firestore';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';

import type { CascadingFieldKey } from './registry';
import type { AncestorLevel, LevelType } from './types';

// ---- Field-path map -----------------------------------------------

/**
 * Where each cascading field lives on the raw doc, per level type.
 * Dotted paths into the raw Firestore data; the loader walks them
 * with {@link readPath} and writes the result into a flat
 * `deltas[fieldKey]` so the engine doesn't have to know about
 * `orderDefaults` nesting on accounts vs. top-level fields on JOs.
 *
 * NOTE: only fields the Instructions tab (O.4 slice) actually
 * needs are populated today. Adding a new field for cascade
 * resolution? Add the per-level path here AND register in
 * `./registry.ts`. The engine + loader stay generic.
 */
const FIELD_PATHS_BY_LEVEL: Record<
  LevelType,
  Partial<Record<CascadingFieldKey, string>>
> = {
  // Recruiter account doc (`tenants/{tid}/accounts/{rid}`). National
  // and standalone accounts both land here as top-tier roots.
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
    // Pricing tab positions (handoff §5 + §16.1 snapshot envelope).
    // Path matches `extractAccountPricingPositions` in
    // `src/utils/accountPricingForJobOrder.ts`.
    positions: 'pricing.positions',
    // §16.2c additions — paths match the form sources noted in the
    // R.16.2c brief Phase 1.
    scheduler: 'roles.schedulerIds',
    pricingFlatMarkupPercent: 'pricing.flatMarkupPercent',
    physicalRequirements: 'orderDefaults.orderDetails.physicalRequirements',
    customUniformRequirements: 'orderDefaults.orderDetails.customUniformRequirements',
    attachments: 'orderDefaults.staffInstructions.attachments.files',
  },
  // Same shape as `account` — child accounts share the recruiter
  // account doc layout. The only difference is the levelType tag,
  // which the engine uses for `editableAt` mapping (child & location
  // both collapse to the `'child'` editable tier).
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
    // Pricing tab positions (handoff §5 + §16.1 snapshot envelope).
    // Job-order resolution merges parent + child by title — see
    // `mergeParentAndChildPricingPositions` in `accountPricingForJobOrder.ts`.
    positions: 'pricing.positions',
    // §16.2c additions — same Firestore layout as account.
    scheduler: 'roles.schedulerIds',
    pricingFlatMarkupPercent: 'pricing.flatMarkupPercent',
    physicalRequirements: 'orderDefaults.orderDetails.physicalRequirements',
    customUniformRequirements: 'orderDefaults.orderDetails.customUniformRequirements',
    attachments: 'orderDefaults.staffInstructions.attachments.files',
  },
  // Location override for standalone accounts
  // (`accounts/{rid}/location_defaults/{cid_wid}`). Same nesting as
  // the parent account.
  location: {
    staffInstructions: 'orderDefaults.staffInstructions',
    additionalScreenings: 'orderDefaults.orderDetails.additionalScreenings',
    screeningPackageId: 'orderDefaults.screeningPackageId',
    uniformRequirements: 'orderDefaults.orderDetails.dressCode',
    customerSpecificRules: 'orderDefaults.customerSpecificRules',
    // §16.2c — location-level overrides for the Compliance &
    // Requirements form fields. The location form (`AccountLocationDetail`)
    // already writes these under the same nested path.
    physicalRequirements: 'orderDefaults.orderDetails.physicalRequirements',
    customUniformRequirements: 'orderDefaults.orderDetails.customUniformRequirements',
  },
  // JO doc (`tenants/{tid}/job_orders/{joId}`). Fields live at the
  // top level — the JO's own form writes them flat. Note: snapshot-
  // policy fields live ALSO under `jo.snapshot.{fieldKey}` post-
  // activation; the loader reads the cascade-level fields only —
  // snapshot resolution is the consumer's job (via
  // `getEffectiveJobOrderField`).
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
    // §16.2c — JO-level overrides where the JO doc stores its own
    // copy of the field. Omitted intentionally:
    //   - `scheduler` — JO has `schedulerUid` (single-uid stamp), not
    //     a per-JO array. Cascade resolves to parent value; consumer
    //     rewire to honor `snapshot.scheduler` is deferred (R.16.2c L2).
    //   - `pricingFlatMarkupPercent` — JOs use per-position markups
    //     via the `positions` blob; no JO-level flat markup field.
    //   - `attachments` — no JO-level attachments storage at this
    //     path. Snapshot resolves from parent only.
    physicalRequirements: 'physicalRequirements',
    customUniformRequirements: 'customUniformRequirements',
  },
  // Shift doc (`tenants/{tid}/job_orders/{joId}/shifts/{sid}`). Most
  // fields aren't yet stored at the shift tier — overrides land here
  // when the user picks "Override at this shift" in the drawer.
  shift: {
    staffInstructions: 'staffInstructions',
    uniformRequirements: 'uniformRequirements',
  },
};

// ---- LoaderContext (per-request cache) -----------------------------

/**
 * Per-request memoization: dedupes `getDoc` calls when a caller
 * asks for multiple chains in close succession (e.g. the Shift
 * Drawer fans out 7 Instructions cards on mount, each running the
 * same cascade — we want one network round-trip per doc, not 7).
 *
 * Hold a single `LoaderContext` across the React effect / callback
 * scope and pass it to every loader. Don't share across user
 * sessions — the cache has no TTL.
 */
export interface LoaderContext {
  /** Map<fullDocPath, Promise<DocumentSnapshot>>. */
  readonly cache: Map<string, Promise<DocumentSnapshot>>;
}

export function createLoaderContext(): LoaderContext {
  return { cache: new Map() };
}

function getDocCached(ctx: LoaderContext, path: string): Promise<DocumentSnapshot> {
  const hit = ctx.cache.get(path);
  if (hit) return hit;
  const ref = doc(db, path);
  const promise = getDoc(ref);
  ctx.cache.set(path, promise);
  return promise;
}

// ---- Public loader API --------------------------------------------

export interface ChainTarget {
  tenantId: string;
  /** JO is required — the chain is always rooted in a JO. */
  jobOrderId: string;
  /** Optional — when set, the chain ends with the shift level. */
  shiftId?: string | null;
}

/**
 * Build the ancestor chain for a JO (or a JO + shift). Order:
 *
 *   - National account hierarchy:
 *       [parent_account, child_account, jo, shift?]
 *   - Standalone account hierarchy:
 *       [standalone_account, location?, jo, shift?]
 *   - Edge case (JO references a national account directly):
 *       [account, jo, shift?]
 *
 * Levels with no doc / no data are still emitted with `deltas: {}`
 * so provenance has stable level metadata to display ("(set by
 * Account)"). Levels we couldn't fetch (permission errors, missing
 * docs) are *omitted* — caller can detect this by inspecting chain
 * length if needed.
 *
 * @param ctx Per-request cache. Reuse the same context for all
 *            chain loads in a single render tick.
 */
export async function loadCascadeChain(
  ctx: LoaderContext,
  target: ChainTarget,
): Promise<AncestorLevel[]> {
  const { tenantId, jobOrderId, shiftId } = target;
  if (!tenantId || !jobOrderId) {
    throw new Error('[cascade.loadCascadeChain] tenantId and jobOrderId are required');
  }

  // Step 1: load JO (need recruiterAccountId / companyId / worksiteId
  // off it to know what else to fetch).
  const joSnap = await getDocCached(ctx, p.jobOrder(tenantId, jobOrderId));
  if (!joSnap.exists()) {
    // No JO → caller probably navigated to a stale drawer. Return an
    // empty chain rather than throwing so the UI can render
    // gracefully.
    return [];
  }
  const joRaw = joSnap.data() as Record<string, unknown>;

  const recruiterAccountId = strField(joRaw, 'recruiterAccountId');
  const companyId = strField(joRaw, 'companyId') ?? strField(joRaw, 'crmCompanyId');
  const worksiteId = strField(joRaw, 'worksiteId') ?? strField(joRaw, 'locationId');

  // Step 2: load the recruiter account chain (parent ↔ child OR
  // standalone ↔ location). Skip if no recruiterAccountId — the JO
  // is essentially orphaned from a cascade perspective; chain
  // collapses to [jo, shift?].
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
    const shiftSnap = await getDocCached(ctx, p.shift(tenantId, jobOrderId, shiftId));
    if (shiftSnap.exists()) {
      const shiftRaw = shiftSnap.data() as Record<string, unknown>;
      shiftLevel = {
        levelType: 'shift',
        levelId: shiftId,
        levelLabel: strField(shiftRaw, 'name') ?? `Shift ${shiftId.slice(0, 6)}`,
        deltas: extractDeltas('shift', shiftRaw),
      };
    } else {
      // Shift missing — emit an empty level so provenance still has
      // a stable anchor for "Reset to inherited" UX.
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

// ---- Internals -----------------------------------------------------

async function loadAccountChain(
  ctx: LoaderContext,
  tenantId: string,
  accountId: string,
  companyId: string | null | undefined,
  worksiteId: string | null | undefined,
): Promise<AncestorLevel[]> {
  const accSnap = await getDocCached(ctx, p.recruiterAccount(tenantId, accountId));
  if (!accSnap.exists()) return [];
  const accRaw = accSnap.data() as Record<string, unknown>;

  const accountType = inferAccountType(accRaw);
  const parentId = strField(accRaw, 'parentAccountId');

  if (accountType === 'child' && parentId) {
    // National hierarchy: [parent, child].
    const parentSnap = await getDocCached(ctx, p.recruiterAccount(tenantId, parentId));
    const out: AncestorLevel[] = [];
    if (parentSnap.exists()) {
      const parentRaw = parentSnap.data() as Record<string, unknown>;
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

  // Location overrides only apply when we have a (companyId,
  // worksiteId) pair AND the account treats them as a worksite-
  // specific config. The merge layer in
  // `recruiterAccountOrderDefaultsMerge.ts` runs this lookup
  // unconditionally on standalone + national alike, so do the same.
  const cid = companyId ? String(companyId).trim() : '';
  const wid = worksiteId ? String(worksiteId).trim() : '';
  if (cid && wid) {
    const locationKey = `${cid}_${wid}`.replace(/\//g, '_');
    const locSnap = await getDocCached(
      ctx,
      p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey),
    );
    if (locSnap.exists()) {
      const locRaw = locSnap.data() as Record<string, unknown>;
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

/**
 * Apply the per-level field-path map to a raw doc, producing the
 * flat `deltas` blob the cascade engine expects. Skips fields whose
 * source path is missing on the raw doc (so the engine treats them
 * as "no contribution at this level").
 */
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

/**
 * Mirrors `inferParentId` from `recruiterAccountOrderDefaultsMerge.ts`
 * but returns the inferred account type rather than the parent id —
 * the loader uses this to decide hierarchy shape (national vs.
 * standalone vs. orphaned national).
 */
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

// Exposed for tests + future tooling that wants to introspect the
// per-level extraction map without re-deriving it.
export const __INTERNAL_FIELD_PATHS_BY_LEVEL = FIELD_PATHS_BY_LEVEL;
