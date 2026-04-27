/**
 * Admin-SDK loader twin tests (§16.1 Phase 2).
 *
 * Mirrors the CRA-side `src/shared/cascade/__tests__/loaders.test.ts`
 * cases against the admin loader, with two notable flavour shifts:
 *
 *   - We inject a fake Firestore via `LoaderContext.db`, rather than
 *     stubbing the modular `firebase/firestore` module the CRA test
 *     uses. The shape only needs `db.doc(path).get()` returning a
 *     thenable with `{ exists, data() }`.
 *
 *   - The admin SDK exposes `snap.exists` as a getter (no parens),
 *     where the modular SDK uses `snap.exists()` as a function. The
 *     loader handles the difference.
 *
 * The CI guard `scripts/check-cascade-mirror.sh` enforces the
 * field-path map stays byte-identical between the two loaders, so
 * these tests focus on chain-shape and per-level extraction
 * behaviour rather than re-asserting field paths.
 *
 * Mocha + Chai per `functions/package.json` test script.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md L4
 */

import { expect } from 'chai';

import {
  __INTERNAL_FIELD_PATHS_BY_LEVEL,
  type LoaderContext,
  loadCascadeChain,
} from '../../shared/cascade/loaders';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — minimal interface the loader uses
// ─────────────────────────────────────────────────────────────────────

interface FakeDocStore {
  /** Map<fullPath, data | null>. `null` represents a non-existent doc. */
  [path: string]: Record<string, unknown> | null;
}

interface FakeFirestoreState {
  store: FakeDocStore;
  /** Path of every `.get()` call made through the fake. */
  reads: string[];
}

/**
 * Build a fake Firestore handle compatible with the admin loader's
 * `LoaderContext.db.doc(path).get()` access pattern. Records every
 * read into `state.reads` so tests can assert call counts (used for
 * memoization assertions).
 */
function makeFakeFirestore(state: FakeFirestoreState): unknown {
  return {
    doc(path: string) {
      return {
        async get() {
          state.reads.push(path);
          const data = state.store[path];
          if (data === undefined || data === null) {
            return {
              exists: false,
              data: () => undefined,
            };
          }
          return {
            exists: true,
            data: () => data,
          };
        },
      };
    },
  };
}

function makeCtx(state: FakeFirestoreState): LoaderContext {
  return {
    db: makeFakeFirestore(state) as LoaderContext['db'],
    cache: new Map(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Field-path map parity (the engine has its own dedicated tests; we
// just cover the surface that proves the admin map matches the CRA
// map's *shape* — fields per level, not exact paths). The exact
// strings are diffed by the mirror-check CI script.
// ─────────────────────────────────────────────────────────────────────

describe('FIELD_PATHS_BY_LEVEL — shape parity with CRA loader', () => {
  it('exposes every level type', () => {
    const levels = Object.keys(__INTERNAL_FIELD_PATHS_BY_LEVEL).sort();
    expect(levels).to.deep.equal(['account', 'child', 'jo', 'location', 'shift'].sort());
  });

  it('account level registers the §16.1 snapshot fields', () => {
    const acct = __INTERNAL_FIELD_PATHS_BY_LEVEL.account;
    expect(acct).to.have.property('hiringEntityId');
    expect(acct).to.have.property('eVerifyRequired');
    expect(acct).to.have.property('workersCompCode');
    expect(acct).to.have.property('screeningPackageId');
    expect(acct).to.have.property('additionalScreenings');
  });

  it('jo level exposes selectedPositionIds (the only place the cascade reads it)', () => {
    expect(__INTERNAL_FIELD_PATHS_BY_LEVEL.jo).to.have.property('selectedPositionIds');
  });

  it('location level deliberately omits hiringEntity / eVerify / workersCompCode (no override tier)', () => {
    const loc = __INTERNAL_FIELD_PATHS_BY_LEVEL.location;
    expect(loc).to.not.have.property('hiringEntityId');
    expect(loc).to.not.have.property('eVerifyRequired');
    expect(loc).to.not.have.property('workersCompCode');
  });

  it('shift level only carries instructions/uniform — no pricing or screening', () => {
    const shift = __INTERNAL_FIELD_PATHS_BY_LEVEL.shift;
    expect(shift).to.not.have.property('payRate');
    expect(shift).to.not.have.property('screeningPackageId');
    expect(shift).to.have.property('staffInstructions');
    expect(shift).to.have.property('uniformRequirements');
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCascadeChain — argument validation
// ─────────────────────────────────────────────────────────────────────

describe('loadCascadeChain — argument validation', () => {
  it('throws when tenantId is empty', async () => {
    const ctx = makeCtx({ store: {}, reads: [] });
    let err: unknown;
    try {
      await loadCascadeChain(ctx, { tenantId: '', jobOrderId: 'jo1' });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an('error');
    expect((err as Error).message).to.match(/tenantId and jobOrderId are required/);
  });

  it('throws when jobOrderId is empty', async () => {
    const ctx = makeCtx({ store: {}, reads: [] });
    let err: unknown;
    try {
      await loadCascadeChain(ctx, { tenantId: 't1', jobOrderId: '' });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an('error');
  });

  it('returns empty chain when JO does not exist (no preloaded data)', async () => {
    const ctx = makeCtx({ store: {}, reads: [] });
    const chain = await loadCascadeChain(ctx, { tenantId: 't1', jobOrderId: 'missing' });
    expect(chain).to.deep.equal([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCascadeChain — chain shape (national hierarchy)
// ─────────────────────────────────────────────────────────────────────

describe('loadCascadeChain — national hierarchy', () => {
  it('emits [parent_account, child, jo] for a child account JO', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_child',
          jobTitle: 'Forklift Operator',
        },
        'tenants/t1/accounts/acc_child': {
          accountType: 'child',
          parentAccountId: 'acc_parent',
          name: 'Atlanta Warehouse',
          orderDefaults: {
            screeningPackageId: 'PKG_CHILD',
          },
        },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'national',
          name: 'CORT National',
          workersCompCode: '8810',
          orderDefaults: {
            screeningPackageId: 'PKG_PARENT',
            hiringEntityId: 'entity_42',
          },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });

    expect(chain.map((l) => l.levelType)).to.deep.equal(['account', 'child', 'jo']);

    const parent = chain[0];
    expect(parent.levelId).to.equal('acc_parent');
    expect(parent.levelLabel).to.equal('CORT National');
    expect(parent.deltas).to.include({
      screeningPackageId: 'PKG_PARENT',
      hiringEntityId: 'entity_42',
      workersCompCode: '8810',
    });

    const child = chain[1];
    expect(child.levelId).to.equal('acc_child');
    expect(child.deltas).to.include({ screeningPackageId: 'PKG_CHILD' });

    const jo = chain[2];
    expect(jo.levelId).to.equal('jo1');
    expect(jo.levelLabel).to.equal('Forklift Operator');
  });

  it('skips the parent level when the child account has no parentAccountId (orphaned national)', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_x',
        },
        'tenants/t1/accounts/acc_x': {
          accountType: 'child',
          name: 'Orphan Child',
          // no parentAccountId
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    // Falls through to the standalone branch since parentId is null.
    expect(chain.map((l) => l.levelType)).to.deep.equal(['account', 'jo']);
  });

  it('skips the parent level when the parent doc is missing', async () => {
    // National parent referenced by parentAccountId but the doc was
    // deleted. Loader should still emit the child + JO.
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_child',
        },
        'tenants/t1/accounts/acc_child': {
          accountType: 'child',
          parentAccountId: 'acc_missing',
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    expect(chain.map((l) => l.levelType)).to.deep.equal(['child', 'jo']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCascadeChain — standalone hierarchy + location overrides
// ─────────────────────────────────────────────────────────────────────

describe('loadCascadeChain — standalone hierarchy', () => {
  it('emits [account, jo] for a standalone account with no location override', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_solo',
          companyId: 'co_x',
          worksiteId: 'ws_y',
        },
        'tenants/t1/accounts/acc_solo': {
          accountType: 'standalone',
          name: 'Solo Acct',
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    expect(chain.map((l) => l.levelType)).to.deep.equal(['account', 'jo']);
  });

  it('appends a location level when a worksite-specific override doc exists', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_solo',
          companyId: 'co_x',
          worksiteId: 'ws_y',
        },
        'tenants/t1/accounts/acc_solo': {
          accountType: 'standalone',
        },
        'tenants/t1/accounts/acc_solo/location_defaults/co_x_ws_y': {
          name: 'Worksite Y',
          orderDefaults: { screeningPackageId: 'PKG_LOC' },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    expect(chain.map((l) => l.levelType)).to.deep.equal(['account', 'location', 'jo']);
    const loc = chain[1];
    expect(loc.levelLabel).to.equal('Worksite Y');
    expect(loc.deltas).to.deep.equal({ screeningPackageId: 'PKG_LOC' });
  });

  it('does not look up a location override when companyId or worksiteId is missing', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_solo',
          // no companyId / worksiteId
        },
        'tenants/t1/accounts/acc_solo': {
          accountType: 'standalone',
        },
      },
      reads: [],
    };
    await loadCascadeChain(makeCtx(state), { tenantId: 't1', jobOrderId: 'jo1' });
    expect(state.reads.some((p) => p.includes('location_defaults'))).to.equal(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCascadeChain — orphan JO (no recruiterAccountId)
// ─────────────────────────────────────────────────────────────────────

describe('loadCascadeChain — orphaned JO', () => {
  it('emits [jo] only when the JO has no recruiterAccountId', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          jobTitle: 'Direct JO',
          // no recruiterAccountId / companyId / worksiteId
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    expect(chain.map((l) => l.levelType)).to.deep.equal(['jo']);
  });

  it('uses "Job Order" as the fallback label when neither jobTitle nor title is set', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {},
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    expect(chain[0].levelLabel).to.equal('Job Order');
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCascadeChain — shift extension
// ─────────────────────────────────────────────────────────────────────

describe('loadCascadeChain — shift level', () => {
  it('appends a shift level when shiftId is provided and the doc exists', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_solo',
        },
        'tenants/t1/accounts/acc_solo': { accountType: 'standalone' },
        'tenants/t1/job_orders/jo1/shifts/shift_a': {
          name: 'Sat Day Shift',
          staffInstructions: 'Wear hi-vis',
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
      shiftId: 'shift_a',
    });
    expect(chain.map((l) => l.levelType)).to.deep.equal(['account', 'jo', 'shift']);
    const shift = chain[2];
    expect(shift.levelLabel).to.equal('Sat Day Shift');
    expect(shift.deltas).to.deep.equal({ staffInstructions: 'Wear hi-vis' });
  });

  it('emits an empty-deltas shift level when the shift doc is missing', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_solo' },
        'tenants/t1/accounts/acc_solo': { accountType: 'standalone' },
        // shift doc absent
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
      shiftId: 'shift_missing',
    });
    expect(chain[chain.length - 1]).to.deep.include({
      levelType: 'shift',
      levelId: 'shift_missing',
      deltas: {},
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// loadCascadeChain — preloadedJoData fast path (snapshot-trigger
// optimization)
// ─────────────────────────────────────────────────────────────────────

describe('loadCascadeChain — preloadedJoData', () => {
  it('skips the JO doc fetch when preloadedJoData is supplied', async () => {
    const state: FakeFirestoreState = {
      store: {
        // Note: no JO doc in the store. The preload covers it.
        'tenants/t1/accounts/acc_solo': { accountType: 'standalone', name: 'A' },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_solo',
        jobTitle: 'Preloaded',
      },
    });
    expect(chain.map((l) => l.levelType)).to.deep.equal(['account', 'jo']);
    expect(state.reads).to.not.include('tenants/t1/job_orders/jo1');
    const jo = chain[chain.length - 1];
    expect(jo.levelLabel).to.equal('Preloaded');
  });
});

// ─────────────────────────────────────────────────────────────────────
// LoaderContext — per-request memoization
// ─────────────────────────────────────────────────────────────────────

describe('LoaderContext memoization', () => {
  it('reads each Firestore doc at most once across multiple loadCascadeChain calls', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_x' },
        'tenants/t1/accounts/acc_x': { accountType: 'standalone' },
      },
      reads: [],
    };
    const ctx = makeCtx(state);

    await loadCascadeChain(ctx, { tenantId: 't1', jobOrderId: 'jo1' });
    await loadCascadeChain(ctx, { tenantId: 't1', jobOrderId: 'jo1' });
    await loadCascadeChain(ctx, { tenantId: 't1', jobOrderId: 'jo1' });

    const joReads = state.reads.filter((p) => p === 'tenants/t1/job_orders/jo1').length;
    const accReads = state.reads.filter((p) => p === 'tenants/t1/accounts/acc_x').length;
    expect(joReads).to.equal(1);
    expect(accReads).to.equal(1);
  });

  it('does not share its cache across context instances', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_x' },
        'tenants/t1/accounts/acc_x': { accountType: 'standalone' },
      },
      reads: [],
    };
    await loadCascadeChain(makeCtx(state), { tenantId: 't1', jobOrderId: 'jo1' });
    await loadCascadeChain(makeCtx(state), { tenantId: 't1', jobOrderId: 'jo1' });
    const joReads = state.reads.filter((p) => p === 'tenants/t1/job_orders/jo1').length;
    expect(joReads).to.equal(2);
  });
});
