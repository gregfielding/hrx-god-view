/**
 * **R.16.2c Phase 1** — Field-path verification for the 5 new
 * snapshot-policy fields.
 *
 * Covers:
 *   1. `__INTERNAL_FIELD_PATHS_BY_LEVEL` exposes each new field at the
 *      expected levels (account/child + selective location/jo per the
 *      brief Phase 1 design).
 *   2. `loadCascadeChain` extracts each field's value from the right
 *      Firestore path on the account doc — proving the dotted-path
 *      reads work end-to-end through the existing engine.
 *   3. Negative checks: `scheduler` / `pricingFlatMarkupPercent` /
 *      `attachments` deliberately omit the JO-level path per L2 + the
 *      Phase 1 design comment in the loader.
 *
 * Why these tests live in a separate file:
 *   - The existing `loaders.test.ts` is structured around §16.1's
 *     locked field surface; bolting R.16.2c additions inline would
 *     muddy that file's "shape parity with CRA loader" framing.
 *   - Greg's review pattern (per-PR doc → tests → impl) benefits
 *     from a clean per-PR test file we can point at in the
 *     R.16.2c handoff.
 *
 * Mocha + Chai. Run via:
 *   ./node_modules/mocha/bin/mocha.js -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/cascade/r16_2c_loaders.test.ts'
 *
 * @see docs/CASCADE_R16.2c_HANDOFF.md Phase 1
 */

import { expect } from 'chai';

import {
  __INTERNAL_FIELD_PATHS_BY_LEVEL,
  type LoaderContext,
  loadCascadeChain,
} from '../../shared/cascade/loaders';

interface FakeFirestoreState {
  store: { [path: string]: Record<string, unknown> | null };
  reads: string[];
}

function makeFakeFirestore(state: FakeFirestoreState): unknown {
  return {
    doc(path: string) {
      return {
        async get() {
          state.reads.push(path);
          const data = state.store[path];
          if (data === undefined || data === null) {
            return { exists: false, data: () => undefined };
          }
          return { exists: true, data: () => data };
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
// 1. FIELD_PATHS_BY_LEVEL — surface check for the 5 new fields
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — FIELD_PATHS_BY_LEVEL surface check', () => {
  it('account level registers all 5 new field keys', () => {
    const acct = __INTERNAL_FIELD_PATHS_BY_LEVEL.account;
    expect(acct).to.have.property('scheduler');
    expect(acct).to.have.property('pricingFlatMarkupPercent');
    expect(acct).to.have.property('physicalRequirements');
    expect(acct).to.have.property('customUniformRequirements');
    expect(acct).to.have.property('attachments');
  });

  it('child level mirrors the account surface (same Firestore layout)', () => {
    const child = __INTERNAL_FIELD_PATHS_BY_LEVEL.child;
    expect(child).to.have.property('scheduler');
    expect(child).to.have.property('pricingFlatMarkupPercent');
    expect(child).to.have.property('physicalRequirements');
    expect(child).to.have.property('customUniformRequirements');
    expect(child).to.have.property('attachments');
  });

  it('location level only carries fields editable at the location form (physical + custom uniform)', () => {
    const loc = __INTERNAL_FIELD_PATHS_BY_LEVEL.location;
    expect(loc).to.have.property('physicalRequirements');
    expect(loc).to.have.property('customUniformRequirements');
    // Per Phase 1 design: location form doesn't surface scheduler /
    // flat-markup / attachments — those are National/Child-level concerns.
    expect(loc).to.not.have.property('scheduler');
    expect(loc).to.not.have.property('pricingFlatMarkupPercent');
    expect(loc).to.not.have.property('attachments');
  });

  it('jo level allows override only for physical + custom uniform', () => {
    const jo = __INTERNAL_FIELD_PATHS_BY_LEVEL.jo;
    expect(jo).to.have.property('physicalRequirements');
    expect(jo).to.have.property('customUniformRequirements');
    // Per Phase 1 design comment + L2: JO has `schedulerUid` (single-uid
    // stamp), not a per-JO `schedulerIds` array; flat-markup is a
    // National concept (JOs use per-position markups via the positions
    // blob); attachments aren't stored at this path on the JO doc.
    expect(jo).to.not.have.property('scheduler');
    expect(jo).to.not.have.property('pricingFlatMarkupPercent');
    expect(jo).to.not.have.property('attachments');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. loadCascadeChain — end-to-end extraction from the right paths
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — loadCascadeChain extracts new fields from the correct paths', () => {
  it('reads scheduler from account.roles.schedulerIds (string[])', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': {
          recruiterAccountId: 'acc_parent',
        },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'standalone',
          name: 'CORT National',
          roles: { schedulerIds: ['uid_donna', 'uid_mike'] },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    const accountLevel = chain.find((l) => l.levelType === 'account');
    expect(accountLevel?.deltas).to.have.property('scheduler');
    expect((accountLevel?.deltas as Record<string, unknown>).scheduler).to.deep.equal([
      'uid_donna',
      'uid_mike',
    ]);
  });

  it('reads pricingFlatMarkupPercent from account.pricing.flatMarkupPercent (number)', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_parent' },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'standalone',
          name: 'CORT National',
          pricing: {
            subAccountsManageOwnPricing: false,
            flatMarkupPercent: 38,
          },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    const accountLevel = chain.find((l) => l.levelType === 'account');
    expect((accountLevel?.deltas as Record<string, unknown>).pricingFlatMarkupPercent).to.equal(
      38,
    );
  });

  it('reads physicalRequirements from account.orderDefaults.orderDetails.physicalRequirements (string[])', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_parent' },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'standalone',
          name: 'CORT National',
          orderDefaults: {
            orderDetails: {
              physicalRequirements: ['Lifting 50 lbs', 'Standing'],
            },
          },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    const accountLevel = chain.find((l) => l.levelType === 'account');
    expect((accountLevel?.deltas as Record<string, unknown>).physicalRequirements).to.deep.equal([
      'Lifting 50 lbs',
      'Standing',
    ]);
  });

  it('reads customUniformRequirements from account.orderDefaults.orderDetails.customUniformRequirements (string)', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_parent' },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'standalone',
          name: 'CORT National',
          orderDefaults: {
            orderDetails: {
              customUniformRequirements: 'Black slacks, white shirt, closed-toe shoes',
            },
          },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    const accountLevel = chain.find((l) => l.levelType === 'account');
    expect((accountLevel?.deltas as Record<string, unknown>).customUniformRequirements).to.equal(
      'Black slacks, white shirt, closed-toe shoes',
    );
  });

  it('reads attachments from account.orderDefaults.staffInstructions.attachments.files (Array<{...}>)', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_parent' },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'standalone',
          name: 'CORT National',
          orderDefaults: {
            staffInstructions: {
              attachments: {
                files: [
                  { label: 'Worker FAQ', name: 'CORT-Worker-FAQ.pdf', url: 'gs://x/y.pdf' },
                ],
              },
            },
          },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    const accountLevel = chain.find((l) => l.levelType === 'account');
    const attachments = (accountLevel?.deltas as Record<string, unknown>).attachments;
    expect(Array.isArray(attachments)).to.equal(true);
    expect((attachments as Array<Record<string, unknown>>)[0]).to.include({
      label: 'Worker FAQ',
      name: 'CORT-Worker-FAQ.pdf',
    });
  });

  it('child override of physicalRequirements wins over parent (replace strategy)', async () => {
    const state: FakeFirestoreState = {
      store: {
        'tenants/t1/job_orders/jo1': { recruiterAccountId: 'acc_child' },
        'tenants/t1/accounts/acc_child': {
          accountType: 'child',
          parentAccountId: 'acc_parent',
          name: 'CORT Atlanta',
          orderDefaults: {
            orderDetails: {
              physicalRequirements: ['Lifting 75 lbs'],
            },
          },
        },
        'tenants/t1/accounts/acc_parent': {
          accountType: 'national',
          name: 'CORT National',
          orderDefaults: {
            orderDetails: {
              physicalRequirements: ['Lifting 50 lbs'],
            },
          },
        },
      },
      reads: [],
    };
    const chain = await loadCascadeChain(makeCtx(state), {
      tenantId: 't1',
      jobOrderId: 'jo1',
    });
    const childLevel = chain.find((l) => l.levelType === 'child');
    expect(
      (childLevel?.deltas as Record<string, unknown>).physicalRequirements,
    ).to.deep.equal(['Lifting 75 lbs']);
  });
});
