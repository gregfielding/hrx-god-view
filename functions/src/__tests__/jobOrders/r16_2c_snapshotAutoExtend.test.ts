/**
 * **R.16.2c Phase 3** — Snapshot trigger + backfill auto-extend
 * verification.
 *
 * The R.16.1 snapshot trigger derives its set of captured fields
 * directly from the registry (`SNAPSHOT_POLICY_FIELDS = Object.entries(
 * CASCADE_REGISTRY).filter(...)`). With the 5 new fields registered
 * with `propagation: 'snapshot-on-activation'` in Phase 1, those
 * fields should be picked up automatically — both by the activation
 * trigger and the backfill (which calls into the same
 * `runSnapshotPassForJo` orchestrator).
 *
 * These tests prove that contract end-to-end:
 *   1. `SNAPSHOT_POLICY_FIELDS` includes each new field.
 *   2. `resolveSnapshotEnvelope` captures every new field's value
 *      from the parent account's Firestore paths into the envelope.
 *   3. `fieldsCaptured` lists each new field by name.
 *   4. Child-level overrides flow through correctly (verifies the
 *      cascade engine + the new loader paths interact properly).
 *
 * Mocha + Chai. Run via:
 *   ./node_modules/mocha/bin/mocha.js -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/r16_2c_snapshotAutoExtend.test.ts'
 *
 * @see docs/CASCADE_R16.2c_HANDOFF.md Phase 3
 */

import * as admin from 'firebase-admin';
import { expect } from 'chai';

import {
  SNAPSHOT_POLICY_FIELDS,
  resolveSnapshotEnvelope,
} from '../../jobOrders/onJobOrderStatusTransitionSnapshot';
import { createLoaderContext } from '../../shared/cascade/loaders';

// Stub serverTimestamp like the existing snapshot tests (envelope resolution
// doesn't use it, but the import path is shared with downstream callers
// and we want to avoid surprises if ts-node hoists side-effects).
(admin.firestore.FieldValue as unknown as { serverTimestamp: () => unknown }).serverTimestamp =
  (() => '<<server_ts>>') as unknown as typeof admin.firestore.FieldValue.serverTimestamp;

// ─────────────────────────────────────────────────────────────────────
// Minimal in-memory Firestore (just doc reads — envelope resolution
// is pure read-side; no writes / transactions / batches needed).
// ─────────────────────────────────────────────────────────────────────

interface MiniState {
  store: Map<string, Record<string, unknown>>;
  reads: string[];
}

function newState(): MiniState {
  return { store: new Map(), reads: [] };
}

function makeFakeFirestore(state: MiniState): admin.firestore.Firestore {
  function makeDocRef(path: string) {
    return {
      path,
      async get() {
        state.reads.push(path);
        const data = state.store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
    };
  }
  return {
    doc: (path: string) => makeDocRef(path),
  } as unknown as admin.firestore.Firestore;
}

// ─────────────────────────────────────────────────────────────────────
// 1. Registry derivation — new fields surface in SNAPSHOT_POLICY_FIELDS
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — SNAPSHOT_POLICY_FIELDS auto-extends from registry', () => {
  const newFields = [
    'scheduler',
    'pricingFlatMarkupPercent',
    'physicalRequirements',
    'customUniformRequirements',
    'attachments',
  ];

  newFields.forEach((field) => {
    it(`includes "${field}" (registry-derived, no engine code change required)`, () => {
      expect((SNAPSHOT_POLICY_FIELDS as readonly string[]).includes(field)).to.equal(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. resolveSnapshotEnvelope captures each new field at activation
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2c — resolveSnapshotEnvelope captures new fields from parent account', () => {
  it('captures all 5 new fields from a standalone account in one pass', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      name: 'CORT National',
      roles: { schedulerIds: ['uid_donna', 'uid_mike'] },
      pricing: {
        subAccountsManageOwnPricing: false,
        flatMarkupPercent: 38,
      },
      orderDefaults: {
        orderDetails: {
          physicalRequirements: ['lifting_50_lbs', 'standing'],
          customUniformRequirements: 'Black slacks, white shirt',
        },
        staffInstructions: {
          attachments: {
            files: [
              { label: 'Worker FAQ', name: 'CORT-Worker-FAQ.pdf', url: 'gs://x/y.pdf' },
            ],
          },
        },
      },
    });

    const ctx = createLoaderContext({ db: makeFakeFirestore(state) });
    const { envelope, fieldsCaptured } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: { recruiterAccountId: 'acc_solo' },
      loaderCtx: ctx,
    });

    expect(envelope.scheduler).to.deep.equal(['uid_donna', 'uid_mike']);
    expect(envelope.pricingFlatMarkupPercent).to.equal(38);
    expect(envelope.physicalRequirements).to.deep.equal(['lifting_50_lbs', 'standing']);
    expect(envelope.customUniformRequirements).to.equal('Black slacks, white shirt');
    expect(Array.isArray(envelope.attachments)).to.equal(true);
    expect((envelope.attachments as Array<Record<string, unknown>>)[0]).to.include({
      label: 'Worker FAQ',
    });

    expect(fieldsCaptured).to.include('scheduler');
    expect(fieldsCaptured).to.include('pricingFlatMarkupPercent');
    expect(fieldsCaptured).to.include('physicalRequirements');
    expect(fieldsCaptured).to.include('customUniformRequirements');
    expect(fieldsCaptured).to.include('attachments');
  });

  it('child override of physicalRequirements wins over parent (snapshot freezes the resolved value)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      orderDefaults: {
        orderDetails: { physicalRequirements: ['lifting_50_lbs'] },
      },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      accountType: 'child',
      parentAccountId: 'acc_parent',
      orderDefaults: {
        orderDetails: { physicalRequirements: ['lifting_75_lbs', 'standing'] },
      },
    });

    const ctx = createLoaderContext({ db: makeFakeFirestore(state) });
    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: { recruiterAccountId: 'acc_child' },
      loaderCtx: ctx,
    });

    expect(envelope.physicalRequirements).to.deep.equal(['lifting_75_lbs', 'standing']);
  });

  it('JO override of customUniformRequirements wins over child + parent', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      orderDefaults: { orderDetails: { customUniformRequirements: 'Parent text' } },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      accountType: 'child',
      parentAccountId: 'acc_parent',
      orderDefaults: { orderDetails: { customUniformRequirements: 'Child text' } },
    });

    const ctx = createLoaderContext({ db: makeFakeFirestore(state) });
    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_child',
        customUniformRequirements: 'JO override text',
      },
      loaderCtx: ctx,
    });

    expect(envelope.customUniformRequirements).to.equal('JO override text');
  });

  it('parent-only scheduler propagates when child has none (single-level cascade)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      roles: { schedulerIds: ['uid_donna'] },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      accountType: 'child',
      parentAccountId: 'acc_parent',
      // child has no roles at all.
    });

    const ctx = createLoaderContext({ db: makeFakeFirestore(state) });
    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: { recruiterAccountId: 'acc_child' },
      loaderCtx: ctx,
    });

    expect(envelope.scheduler).to.deep.equal(['uid_donna']);
  });

  it('omits new fields from envelope when account has none of them defined', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      // No roles, no pricing, no orderDefaults.orderDetails, no
      // staffInstructions. The trigger should not surface the new
      // keys in the envelope (drop-undefined behavior).
    });

    const ctx = createLoaderContext({ db: makeFakeFirestore(state) });
    const { envelope, fieldsCaptured } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: { recruiterAccountId: 'acc_solo' },
      loaderCtx: ctx,
    });

    expect(envelope).to.not.have.property('scheduler');
    expect(envelope).to.not.have.property('pricingFlatMarkupPercent');
    expect(envelope).to.not.have.property('physicalRequirements');
    expect(envelope).to.not.have.property('customUniformRequirements');
    expect(envelope).to.not.have.property('attachments');

    expect(fieldsCaptured).to.not.include('scheduler');
    expect(fieldsCaptured).to.not.include('pricingFlatMarkupPercent');
  });
});
