/**
 * Cascading Order Data — loader tests (handoff §6 + O.3).
 *
 * Mocks `firebase/firestore` so we can hand the loader synthetic
 * snapshots and assert chain shape, level types, deltas extraction,
 * and per-request memoization (cache reuse on repeat reads).
 */

// CRA's Jest config sets `resetMocks: true`, which wipes mock
// implementations between every test. So we wrap `doc` and `getDoc`
// in plain functions that delegate to module-level vars and re-bind
// those vars in beforeEach, instead of relying on a `jest.fn(impl)`
// implementation surviving the reset.
//
// Names MUST be prefixed with `mock` — Jest's hoisting check rejects
// any other out-of-scope reference inside a `jest.mock` factory.
let mockDocImpl: (...args: unknown[]) => unknown = () => {
  throw new Error('doc mock not initialised — beforeEach should set this');
};
let mockGetDocImpl: (ref: unknown) => Promise<unknown> = () => {
  throw new Error('getDoc mock not initialised — beforeEach should set this');
};

jest.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDocImpl(...args),
  getDoc: (ref: unknown) => mockGetDocImpl(ref),
}));

jest.mock('../../../firebase', () => ({
  db: {},
}));

import {
  __INTERNAL_FIELD_PATHS_BY_LEVEL,
  createLoaderContext,
  loadCascadeChain,
} from '../loaders';
import { resolveCascadedField } from '../resolveCascadedField';

// ---- Test helpers --------------------------------------------------

interface Snap {
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
  __path: string;
}

function snap(path: string, data: Record<string, unknown> | null): Snap {
  return {
    exists: () => data !== null,
    data: () => data ?? undefined,
    __path: path,
  };
}

// Per-test stats so memoization tests can introspect call counts.
let getDocCallCount = 0;

/**
 * Configure `getDoc` to look up snapshots by the path the
 * `firebase/firestore` `doc` mock builds (full firestore path
 * passed as a single segment by the loader).
 */
function setupDocMap(map: Record<string, Record<string, unknown> | null>) {
  getDocCallCount = 0;
  mockGetDocImpl = (ref: unknown) => {
    getDocCallCount += 1;
    const path = (ref as { path?: unknown } | null)?.path;
    if (typeof path !== 'string') {
      throw new Error('Bad ref in test');
    }
    return Promise.resolve(snap(path, map[path] ?? null));
  };
}

const TID = 't1';

beforeEach(() => {
  // The loader calls `doc(db, '<full firestore path>')`. The mock
  // simply forwards the full path so mockGetDocImpl can dispatch on it.
  mockDocImpl = (...args: unknown[]) => ({
    path: args.slice(1).map(String).join('/'),
  });
  // Default getDoc throws so a test that forgets setupDocMap fails
  // loudly rather than silently resolving to "doc missing".
  mockGetDocImpl = () => {
    throw new Error('getDoc not configured — call setupDocMap() in your test');
  };
  getDocCallCount = 0;
});

// ===================================================================
// loadCascadeChain — national hierarchy (parent + child)
// ===================================================================

describe('loadCascadeChain — national hierarchy', () => {
  it('builds [parent_account, child_account, jo] with correct levelTypes', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'child1',
        jobTitle: 'Forklift Operator',
        staffInstructions: { uniform: { text: 'JO uniform note' } },
      },
      [`tenants/${TID}/accounts/child1`]: {
        accountType: 'child',
        parentAccountId: 'parent1',
        name: 'Acme Texas',
        orderDefaults: {
          staffInstructions: { parking: { text: 'Child parking' } },
        },
      },
      [`tenants/${TID}/accounts/parent1`]: {
        accountType: 'national',
        name: 'Acme National',
        orderDefaults: {
          staffInstructions: {
            firstDay: { text: 'Acme first day' },
            parking: { text: 'Acme parking (overridden)' },
          },
        },
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });

    expect(chain.map((l) => l.levelType)).toEqual(['account', 'child', 'jo']);
    expect(chain.map((l) => l.levelId)).toEqual(['parent1', 'child1', 'jo1']);
    expect(chain[0].levelLabel).toBe('Acme National');
    expect(chain[1].levelLabel).toBe('Acme Texas');
    expect(chain[2].levelLabel).toBe('Forklift Operator');
  });

  it('extracts staffInstructions from orderDefaults on accounts and top-level on JO', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'child1',
        staffInstructions: { uniform: { text: 'JO uniform' } },
      },
      [`tenants/${TID}/accounts/child1`]: {
        accountType: 'child',
        parentAccountId: 'parent1',
        orderDefaults: {
          staffInstructions: { parking: { text: 'Child parking' } },
        },
      },
      [`tenants/${TID}/accounts/parent1`]: {
        accountType: 'national',
        orderDefaults: {
          staffInstructions: { firstDay: { text: 'Parent first day' } },
        },
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });

    // Loader normalised paths so the engine sees flat `deltas[field]`.
    expect(chain[0].deltas).toEqual({
      staffInstructions: { firstDay: { text: 'Parent first day' } },
    });
    expect(chain[1].deltas).toEqual({
      staffInstructions: { parking: { text: 'Child parking' } },
    });
    expect(chain[2].deltas).toEqual({
      staffInstructions: { uniform: { text: 'JO uniform' } },
    });
  });

  it('end-to-end: chain feeds resolveCascadedField with merge_deep semantics', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'child1',
        staffInstructions: { uniform: { text: 'JO uniform' } },
      },
      [`tenants/${TID}/accounts/child1`]: {
        accountType: 'child',
        parentAccountId: 'parent1',
        orderDefaults: {
          staffInstructions: { parking: { text: 'Child parking' } },
        },
      },
      [`tenants/${TID}/accounts/parent1`]: {
        accountType: 'national',
        orderDefaults: {
          staffInstructions: {
            firstDay: { text: 'Parent first day' },
            parking: { text: 'Parent parking (gets overridden)' },
          },
        },
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });
    const { value } = resolveCascadedField('staffInstructions', chain);

    expect(value).toEqual({
      firstDay: { text: 'Parent first day' },
      parking: { text: 'Child parking' }, // child won
      uniform: { text: 'JO uniform' },
    });
  });
});

// ===================================================================
// loadCascadeChain — standalone hierarchy (account + location)
// ===================================================================

describe('loadCascadeChain — standalone hierarchy', () => {
  it('builds [standalone_account, location, jo] when JO has companyId+worksiteId', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'sa1',
        companyId: 'cmpA',
        worksiteId: 'wsA',
        jobTitle: 'Loader',
      },
      [`tenants/${TID}/accounts/sa1`]: {
        accountType: 'standalone',
        name: 'Standalone Co',
        orderDefaults: {
          staffInstructions: { firstDay: { text: 'SA first day' } },
        },
      },
      [`tenants/${TID}/accounts/sa1/location_defaults/cmpA_wsA`]: {
        orderDefaults: {
          staffInstructions: { parking: { text: 'Worksite parking' } },
        },
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });

    expect(chain.map((l) => l.levelType)).toEqual(['account', 'location', 'jo']);
    expect(chain[1].levelId).toBe('cmpA_wsA');
    expect(chain[1].deltas).toEqual({
      staffInstructions: { parking: { text: 'Worksite parking' } },
    });
  });

  it('omits the location level when no location_defaults doc exists', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'sa1',
        companyId: 'cmpA',
        worksiteId: 'wsA',
      },
      [`tenants/${TID}/accounts/sa1`]: {
        accountType: 'standalone',
        orderDefaults: { staffInstructions: { firstDay: { text: 'SA fd' } } },
      },
      // location_defaults doc intentionally missing
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });

    expect(chain.map((l) => l.levelType)).toEqual(['account', 'jo']);
  });
});

// ===================================================================
// loadCascadeChain — shift level
// ===================================================================

describe('loadCascadeChain — shift level', () => {
  it('appends a shift level when shiftId is supplied', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'child1',
        staffInstructions: { uniform: { text: 'JO uniform' } },
      },
      [`tenants/${TID}/accounts/child1`]: {
        accountType: 'standalone',
        orderDefaults: { staffInstructions: { firstDay: { text: 'Acct fd' } } },
      },
      [`tenants/${TID}/job_orders/jo1/shifts/sh1`]: {
        name: 'Mon AM',
        staffInstructions: { uniform: { text: 'Shift uniform override' } },
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, {
      tenantId: TID,
      jobOrderId: 'jo1',
      shiftId: 'sh1',
    });

    expect(chain.map((l) => l.levelType)).toEqual(['account', 'jo', 'shift']);
    expect(chain[2].deltas).toEqual({
      staffInstructions: { uniform: { text: 'Shift uniform override' } },
    });

    // Confirm the engine sees the shift override winning.
    const { value } = resolveCascadedField('staffInstructions', chain);
    expect((value as Record<string, { text: string }>).uniform.text).toBe(
      'Shift uniform override',
    );
  });

  it('emits an empty shift level when the shift doc is missing (Reset-to-inherited UX)', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'sa1',
        staffInstructions: { uniform: { text: 'JO uniform' } },
      },
      [`tenants/${TID}/accounts/sa1`]: {
        accountType: 'standalone',
        orderDefaults: {},
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, {
      tenantId: TID,
      jobOrderId: 'jo1',
      shiftId: 'missing-shift',
    });

    const shift = chain.find((l) => l.levelType === 'shift');
    expect(shift).toBeDefined();
    expect(shift!.deltas).toEqual({});

    // Engine should fall back to JO since shift contributed nothing.
    const { value } = resolveCascadedField('staffInstructions', chain);
    expect((value as Record<string, { text: string }>).uniform.text).toBe('JO uniform');
  });
});

// ===================================================================
// loadCascadeChain — edge cases
// ===================================================================

describe('loadCascadeChain — edge cases', () => {
  it('returns [] when the JO doc is missing', async () => {
    setupDocMap({});
    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'gone' });
    expect(chain).toEqual([]);
  });

  it('falls back to crmCompanyId / locationId when companyId / worksiteId are absent', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'sa1',
        crmCompanyId: 'cmpZ',
        locationId: 'wsZ',
      },
      [`tenants/${TID}/accounts/sa1`]: {
        accountType: 'standalone',
        orderDefaults: {},
      },
      [`tenants/${TID}/accounts/sa1/location_defaults/cmpZ_wsZ`]: {
        orderDefaults: { staffInstructions: { parking: { text: 'Loc parking' } } },
      },
    });

    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });
    expect(chain.map((l) => l.levelType)).toEqual(['account', 'location', 'jo']);
  });

  it('skips the account chain entirely when JO has no recruiterAccountId', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        // no recruiterAccountId
        staffInstructions: { firstDay: { text: 'JO only' } },
      },
    });
    const ctx = createLoaderContext();
    const chain = await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });
    expect(chain.map((l) => l.levelType)).toEqual(['jo']);
  });

  it('throws on missing tenantId or jobOrderId', async () => {
    const ctx = createLoaderContext();
    await expect(
      loadCascadeChain(ctx, { tenantId: '', jobOrderId: 'jo1' }),
    ).rejects.toThrow(/tenantId and jobOrderId are required/);
    await expect(
      loadCascadeChain(ctx, { tenantId: TID, jobOrderId: '' }),
    ).rejects.toThrow(/tenantId and jobOrderId are required/);
  });
});

// ===================================================================
// LoaderContext — per-request memoization
// ===================================================================

describe('LoaderContext memoization', () => {
  it('dedupes getDoc calls across repeated chain loads in one context', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: {
        recruiterAccountId: 'child1',
      },
      [`tenants/${TID}/accounts/child1`]: {
        accountType: 'child',
        parentAccountId: 'parent1',
        orderDefaults: {},
      },
      [`tenants/${TID}/accounts/parent1`]: {
        accountType: 'national',
        orderDefaults: {},
      },
    });

    const ctx = createLoaderContext();
    await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });
    const callsAfterFirst = getDocCallCount;
    expect(callsAfterFirst).toBe(3); // jo + child + parent

    // Second load — same context — should serve from cache.
    await loadCascadeChain(ctx, { tenantId: TID, jobOrderId: 'jo1' });
    expect(getDocCallCount).toBe(callsAfterFirst);
  });

  it('a fresh LoaderContext refetches', async () => {
    setupDocMap({
      [`tenants/${TID}/job_orders/jo1`]: { recruiterAccountId: null },
    });
    const ctxA = createLoaderContext();
    const ctxB = createLoaderContext();
    await loadCascadeChain(ctxA, { tenantId: TID, jobOrderId: 'jo1' });
    await loadCascadeChain(ctxB, { tenantId: TID, jobOrderId: 'jo1' });
    expect(getDocCallCount).toBe(2);
  });
});

// ===================================================================
// Internal: field-path map sanity
// ===================================================================

describe('FIELD_PATHS_BY_LEVEL', () => {
  it('covers the five level types', () => {
    expect(Object.keys(__INTERNAL_FIELD_PATHS_BY_LEVEL).sort()).toEqual([
      'account',
      'child',
      'jo',
      'location',
      'shift',
    ]);
  });

  it('account, child, location all read staffInstructions out of orderDefaults', () => {
    expect(__INTERNAL_FIELD_PATHS_BY_LEVEL.account.staffInstructions).toBe(
      'orderDefaults.staffInstructions',
    );
    expect(__INTERNAL_FIELD_PATHS_BY_LEVEL.child.staffInstructions).toBe(
      'orderDefaults.staffInstructions',
    );
    expect(__INTERNAL_FIELD_PATHS_BY_LEVEL.location.staffInstructions).toBe(
      'orderDefaults.staffInstructions',
    );
  });

  it('jo and shift read staffInstructions at top level', () => {
    expect(__INTERNAL_FIELD_PATHS_BY_LEVEL.jo.staffInstructions).toBe(
      'staffInstructions',
    );
    expect(__INTERNAL_FIELD_PATHS_BY_LEVEL.shift.staffInstructions).toBe(
      'staffInstructions',
    );
  });
});
