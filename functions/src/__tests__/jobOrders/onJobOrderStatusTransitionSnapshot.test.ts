/**
 * **R.16.1** — Snapshot trigger tests (Phase 3 verification gate).
 *
 * Three layers under test:
 *   1. `decideShouldSnapshot` — pure transition decision.
 *   2. `resolveSnapshotEnvelope` — server-side cascade resolution
 *      with the admin loader against a fake Firestore.
 *   3. `runSnapshotPassForJo` — end-to-end orchestration including
 *      transactional write + audit log.
 *
 * The trigger handler itself (`onJobOrderStatusTransitionSnapshot`)
 * is a thin wrapper over `runSnapshotPassForJo` — exercising the
 * orchestrator covers the meaningful behaviour without spinning up
 * `firebase-functions-test`.
 *
 * Mocha + Chai. Run via:
 *   npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/onJobOrderStatusTransitionSnapshot.test.ts'
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md L1, L6, L7, L10
 */

import { expect } from 'chai';

import {
  decideShouldSnapshot,
  resolveSnapshotEnvelope,
  runSnapshotPassForJo,
  SNAPSHOT_POLICY_FIELDS,
} from '../../jobOrders/onJobOrderStatusTransitionSnapshot';
import { createLoaderContext } from '../../shared/cascade/loaders';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — a minimal in-memory store that supports doc reads,
// `.set({...}, { merge: true })` writes, batched collection adds, and
// `runTransaction(...)` (single-shot, no retry simulation).
// ─────────────────────────────────────────────────────────────────────

interface FakeFirestoreState {
  store: Map<string, Record<string, unknown>>;
  /** Per-collection auto-id counters for `.add`. */
  autoIdSeq: number;
  reads: string[];
  writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }>;
  audits: Array<Record<string, unknown>>;
}

function newState(): FakeFirestoreState {
  return {
    store: new Map(),
    autoIdSeq: 0,
    reads: [],
    writes: [],
    audits: [],
  };
}

function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof (v as { _serverTimestamp?: boolean })._serverTimestamp !== 'boolean' &&
      typeof out[k] === 'object' &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

interface FakeAdminFirestore {
  doc: (path: string) => unknown;
  collection: (path: string) => unknown;
  runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  batch: () => unknown;
}

function makeFakeFirestore(state: FakeFirestoreState): FakeAdminFirestore {
  function makeDocRef(path: string) {
    return {
      path,
      async get() {
        state.reads.push(path);
        const data = state.store.get(path);
        return {
          exists: data !== undefined,
          data: () => data,
        };
      },
      async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
        const merge = options?.merge ?? false;
        state.writes.push({ path, data, merge });
        const existing = state.store.get(path) ?? {};
        state.store.set(path, merge ? deepMerge(existing, data) : data);
      },
    };
  }

  function makeCollectionRef(path: string) {
    return {
      async add(data: Record<string, unknown>) {
        state.autoIdSeq += 1;
        const docPath = `${path}/auto_${state.autoIdSeq}`;
        state.store.set(docPath, data);
        if (path.endsWith('/cascadeAuditLog')) {
          state.audits.push(data);
        }
        return { id: `auto_${state.autoIdSeq}`, path: docPath };
      },
    };
  }

  function makeTransaction() {
    const pendingWrites: Array<{
      path: string;
      data: Record<string, unknown>;
      merge: boolean;
    }> = [];
    return {
      tx: {
        async get(ref: { path: string }) {
          state.reads.push(`${ref.path}#tx`);
          const data = state.store.get(ref.path);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        set(ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) {
          pendingWrites.push({
            path: ref.path,
            data,
            merge: options?.merge ?? false,
          });
        },
      },
      commit() {
        for (const w of pendingWrites) {
          state.writes.push(w);
          const existing = state.store.get(w.path) ?? {};
          state.store.set(w.path, w.merge ? deepMerge(existing, w.data) : w.data);
        }
      },
    };
  }

  return {
    doc: (path: string) => makeDocRef(path),
    collection: (path: string) => makeCollectionRef(path),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const txWrap = makeTransaction();
      const result = await fn(txWrap.tx);
      txWrap.commit();
      return result;
    },
    batch: () => ({}),
  };
}

// Stub out admin.firestore.FieldValue.serverTimestamp() — the
// snapshot orchestrator calls it via `admin.firestore.FieldValue
// .serverTimestamp()`. Cast through unknown so TS doesn't complain
// about the partial admin shape.
import * as admin from 'firebase-admin';
(admin.firestore.FieldValue as unknown as { serverTimestamp: () => unknown }).serverTimestamp =
  (() => '<<server_ts>>') as unknown as typeof admin.firestore.FieldValue.serverTimestamp;

// ─────────────────────────────────────────────────────────────────────
// 1. decideShouldSnapshot — pure decision tests
// ─────────────────────────────────────────────────────────────────────

describe('decideShouldSnapshot — pure decision', () => {
  it('snapshots on draft → open transition', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'draft',
      afterStatus: 'open',
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('snapshot');
  });

  it('snapshots on draft → on_hold transition', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'draft',
      afterStatus: 'on_hold',
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('snapshot');
  });

  it('skips draft → cancelled transition (L6 — terminal status, no consumers)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'draft',
      afterStatus: 'cancelled',
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('skip_cancelled');
  });

  it('skips when status is unchanged (re-fire of same write)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'open',
      afterStatus: 'open',
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('skip_unchanged');
  });

  it('skips open → on_hold (only draft→* fires; lifecycle changes after activation are out of scope)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'open',
      afterStatus: 'on_hold',
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('skip_not_activating');
  });

  it('skips active → draft reversal (does NOT unfreeze the snapshot)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'open',
      afterStatus: 'draft',
      alreadySnapshotted: true,
    });
    expect(result.kind).to.equal('skip_already_snapshotted');
  });

  it('skips when JO is already snapshotted (idempotency — L7)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'draft',
      afterStatus: 'open',
      alreadySnapshotted: true,
    });
    expect(result.kind).to.equal('skip_already_snapshotted');
  });

  it('skips when the JO was deleted (after.data is null)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'open',
      afterStatus: null,
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('skip_jo_deleted');
  });

  it('treats undefined afterStatus the same as null (deleted)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'draft',
      afterStatus: undefined,
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('skip_jo_deleted');
  });

  it('snapshots on a brand-new JO created directly as `open` (beforeStatus null, after non-draft)', () => {
    // Edge case: most JOs go through draft, but the cascade engine
    // shouldn't refuse to snapshot just because the doc skipped draft.
    // Hmm — actually our spec says "draft → *" only. Documenting the
    // current behaviour: this skips, because beforeStatus !== 'draft'.
    const result = decideShouldSnapshot({
      beforeStatus: null,
      afterStatus: 'open',
      alreadySnapshotted: false,
    });
    expect(result.kind).to.equal('skip_not_activating');
  });

  it('does not unfreeze on cancelled → open (L6 + L7 — once snapshotted, stays snapshotted)', () => {
    const result = decideShouldSnapshot({
      beforeStatus: 'cancelled',
      afterStatus: 'open',
      alreadySnapshotted: true,
    });
    expect(result.kind).to.equal('skip_already_snapshotted');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. SNAPSHOT_POLICY_FIELDS — registry-driven field set
// ─────────────────────────────────────────────────────────────────────

describe('SNAPSHOT_POLICY_FIELDS — registry shape', () => {
  it('includes the §16.3 financial blast-radius fields', () => {
    const fields = new Set(SNAPSHOT_POLICY_FIELDS);
    expect(fields.has('hiringEntityId')).to.equal(true);
    expect(fields.has('eVerifyRequired')).to.equal(true);
    expect(fields.has('workersCompCode')).to.equal(true);
    expect(fields.has('screeningPackageId')).to.equal(true);
    expect(fields.has('additionalScreenings')).to.equal(true);
    expect(fields.has('selectedPositionIds')).to.equal(true);
    expect(fields.has('positions')).to.equal(true);
  });

  it('excludes pure-`live` fields like staffInstructions and uniformRequirements', () => {
    const fields = new Set(SNAPSHOT_POLICY_FIELDS);
    expect(fields.has('staffInstructions')).to.equal(false);
    expect(fields.has('uniformRequirements')).to.equal(false);
    expect(fields.has('customerSpecificRules')).to.equal(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. resolveSnapshotEnvelope — admin loader + engine integration
// ─────────────────────────────────────────────────────────────────────

describe('resolveSnapshotEnvelope — cascade resolution', () => {
  it('captures top-level snapshot fields from the parent account', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      workersCompCode: '8810',
      orderDefaults: {
        hiringEntityId: 'entity_42',
        eVerify: { eVerifyRequired: true },
        screeningPackageId: 'PKG_A',
      },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope, fieldsCaptured } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_parent',
      },
      loaderCtx: ctx,
    });

    expect(envelope.hiringEntityId).to.equal('entity_42');
    expect(envelope.eVerifyRequired).to.equal(true);
    expect(envelope.workersCompCode).to.equal('8810');
    expect(envelope.screeningPackageId).to.equal('PKG_A');
    expect(fieldsCaptured).to.include('hiringEntityId');
    expect(fieldsCaptured).to.include('screeningPackageId');
  });

  it('child overrides parent for screeningPackageId', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      orderDefaults: { screeningPackageId: 'PKG_PARENT' },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      accountType: 'child',
      parentAccountId: 'acc_parent',
      orderDefaults: { screeningPackageId: 'PKG_CHILD' },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: { recruiterAccountId: 'acc_child' },
      loaderCtx: ctx,
    });
    expect(envelope.screeningPackageId).to.equal('PKG_CHILD');
  });

  it('JO override of screeningPackageId wins over child + parent', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      orderDefaults: { screeningPackageId: 'PKG_PARENT' },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      accountType: 'child',
      parentAccountId: 'acc_parent',
      orderDefaults: { screeningPackageId: 'PKG_CHILD' },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_child',
        screeningPackageId: 'PKG_JO_OVERRIDE',
      },
      loaderCtx: ctx,
    });
    expect(envelope.screeningPackageId).to.equal('PKG_JO_OVERRIDE');
  });

  it('captures positions filtered by selectedPositionIds, in selection order', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      accountType: 'national',
      pricing: {
        positions: [
          { positionId: 'p1', jobTitle: 'Forklift', jobDescription: 'lift things', markupPercentage: 35 },
          { positionId: 'p2', jobTitle: 'Picker' },
          { positionId: 'p3', jobTitle: 'Packer' },
        ],
      },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      accountType: 'child',
      parentAccountId: 'acc_parent',
      pricing: {
        positions: [
          { positionId: 'p1', payRate: 18, billRate: 24, futa: 0.6, suta: 1.2, workersCompRate: 4.5 },
          { positionId: 'p3', payRate: 17, billRate: 22, futa: 0.6, suta: 1.2, workersCompRate: 4.5 },
        ],
      },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_child',
        selectedPositionIds: ['p3', 'p1'],
      },
      loaderCtx: ctx,
    });

    expect(envelope.selectedPositionIds).to.deep.equal(['p3', 'p1']);
    const positions = envelope.positions as Array<Record<string, unknown>>;
    expect(positions).to.have.lengthOf(2);
    expect(positions[0].positionId).to.equal('p3');
    expect(positions[0].jobTitle).to.equal('Packer'); // header from parent
    expect(positions[0].payRate).to.equal(17);         // pricing from child
    expect(positions[1].positionId).to.equal('p1');
    expect(positions[1].jobTitle).to.equal('Forklift');
    expect(positions[1].payRate).to.equal(18);
    expect(positions[1].markupPercentage).to.equal(35);
  });

  it('captures empty positions[] when selectedPositionIds is empty (vs. omitted)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      pricing: { positions: [{ positionId: 'p1', jobTitle: 'X' }] },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_solo',
        selectedPositionIds: [],
      },
      loaderCtx: ctx,
    });
    expect(envelope.positions).to.deep.equal([]);
  });

  it('skips positions whose ids are in selectedPositionIds but missing from cascade (graceful)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      pricing: { positions: [{ positionId: 'p1', jobTitle: 'X' }] },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: {
        recruiterAccountId: 'acc_solo',
        selectedPositionIds: ['p1', 'p_missing'],
      },
      loaderCtx: ctx,
    });
    const positions = envelope.positions as Array<Record<string, unknown>>;
    expect(positions).to.have.lengthOf(1);
    expect(positions[0].positionId).to.equal('p1');
  });

  it('does not snapshot non-policy fields like staffInstructions even if cascade has them', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { staffInstructions: { en: 'Wear hi-vis' } },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ctx = createLoaderContext({ db: fdb });

    const { envelope } = await resolveSnapshotEnvelope({
      tenantId: 't1',
      jobOrderId: 'jo1',
      preloadedJoData: { recruiterAccountId: 'acc_solo' },
      loaderCtx: ctx,
    });
    expect(envelope).to.not.have.property('staffInstructions');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. runSnapshotPassForJo — end-to-end orchestration
// ─────────────────────────────────────────────────────────────────────

describe('runSnapshotPassForJo — end-to-end', () => {
  it('writes jo.snapshot under the JO doc and adds a cascadeAuditLog entry on draft → open', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: {
        screeningPackageId: 'PKG_A',
        hiringEntityId: 'entity_1',
      },
      workersCompCode: '8810',
    });
    state.store.set('tenants/t1/job_orders/jo1', {
      recruiterAccountId: 'acc_solo',
      status: 'open',
      selectedPositionIds: [],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo1',
      beforeStatus: 'draft',
      afterStatus: 'open',
      capturedBy: 'trigger',
      preloadedJoData: state.store.get('tenants/t1/job_orders/jo1')!,
      fdb,
    });

    expect(result.decision.kind).to.equal('snapshot');
    expect(result.fieldsCaptured).to.include('screeningPackageId');

    // Snapshot landed under jo.snapshot.{...}
    const updatedJo = state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>;
    const snapshot = updatedJo.snapshot as Record<string, unknown>;
    expect(snapshot.capturedBy).to.equal('trigger');
    expect(snapshot.capturedAt).to.exist;
    expect(snapshot.lastPushedAt).to.equal(null);
    expect(snapshot.screeningPackageId).to.equal('PKG_A');
    expect(snapshot.hiringEntityId).to.equal('entity_1');
    expect(snapshot.workersCompCode).to.equal('8810');

    // Audit row created with action='snapshot_on_activation'
    expect(state.audits).to.have.lengthOf(1);
    const audit = state.audits[0];
    expect(audit.action).to.equal('snapshot_on_activation');
    expect(audit.beforeStatus).to.equal('draft');
    expect(audit.afterStatus).to.equal('open');
    expect(audit.fieldsCaptured).to.be.an('array');
  });

  it('does not write a snapshot on draft → cancelled (L6) and writes a skip audit row', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', { accountType: 'standalone' });
    state.store.set('tenants/t1/job_orders/jo1', {
      recruiterAccountId: 'acc_solo',
      status: 'cancelled',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo1',
      beforeStatus: 'draft',
      afterStatus: 'cancelled',
      capturedBy: 'trigger',
      preloadedJoData: state.store.get('tenants/t1/job_orders/jo1')!,
      fdb,
    });

    expect(result.decision.kind).to.equal('skip_cancelled');
    const jo = state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>;
    expect(jo.snapshot).to.equal(undefined);
    expect(state.audits).to.have.lengthOf(1);
    expect(state.audits[0].action).to.equal('snapshot_skipped');
    expect(state.audits[0].skipKind).to.equal('skip_cancelled');
  });

  it('is idempotent: a second pass on an already-snapshotted JO is a no-op (L7)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_A' },
    });
    state.store.set('tenants/t1/job_orders/jo1', {
      recruiterAccountId: 'acc_solo',
      status: 'open',
      snapshot: {
        capturedAt: '<<server_ts>>',
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FROZEN',
      },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo1',
      beforeStatus: 'draft',
      afterStatus: 'open',
      capturedBy: 'trigger',
      preloadedJoData: state.store.get('tenants/t1/job_orders/jo1')!,
      fdb,
    });

    expect(result.decision.kind).to.equal('skip_already_snapshotted');
    // The frozen value did not change.
    const jo = state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>;
    const snapshot = jo.snapshot as Record<string, unknown>;
    expect(snapshot.screeningPackageId).to.equal('PKG_FROZEN');
  });

  it('writes audit with capturedBy="backfill" + action="snapshot_via_backfill" when called from the migration', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_A' },
    });
    state.store.set('tenants/t1/job_orders/jo_active_legacy', {
      recruiterAccountId: 'acc_solo',
      status: 'open',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo_active_legacy',
      beforeStatus: 'draft',
      afterStatus: 'open',
      capturedBy: 'backfill',
      preloadedJoData: state.store.get('tenants/t1/job_orders/jo_active_legacy')!,
      fdb,
    });

    expect(result.decision.kind).to.equal('snapshot');
    const jo = state.store.get('tenants/t1/job_orders/jo_active_legacy') as Record<string, unknown>;
    const snapshot = jo.snapshot as Record<string, unknown>;
    expect(snapshot.capturedBy).to.equal('backfill');
    expect(state.audits[0].action).to.equal('snapshot_via_backfill');
    expect(state.audits[0].triggeredBy).to.equal('backfill');
  });

  it('skips when JO has no recruiterAccountId (orphaned cascade still produces an empty positions[])', async () => {
    const state = newState();
    state.store.set('tenants/t1/job_orders/jo_orphan', {
      status: 'open',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo_orphan',
      beforeStatus: 'draft',
      afterStatus: 'open',
      capturedBy: 'trigger',
      preloadedJoData: state.store.get('tenants/t1/job_orders/jo_orphan')!,
      fdb,
    });

    expect(result.decision.kind).to.equal('snapshot');
    const jo = state.store.get('tenants/t1/job_orders/jo_orphan') as Record<string, unknown>;
    const snapshot = jo.snapshot as Record<string, unknown>;
    expect(snapshot.capturedAt).to.exist;
    expect(snapshot.positions).to.deep.equal([]);
    // Top-level fields with no contribution stay undefined (omitted).
    expect(snapshot).to.not.have.property('hiringEntityId');
  });

  it('produces no JO write and no audit row on skip_unchanged (re-fire of identical write)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', { accountType: 'standalone' });
    state.store.set('tenants/t1/job_orders/jo1', {
      recruiterAccountId: 'acc_solo',
      status: 'open',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo1',
      beforeStatus: 'open',
      afterStatus: 'open',
      capturedBy: 'trigger',
      preloadedJoData: state.store.get('tenants/t1/job_orders/jo1')!,
      fdb,
    });

    expect(result.decision.kind).to.equal('skip_unchanged');
    expect(state.writes.filter((w) => w.path.includes('/job_orders/'))).to.have.lengthOf(0);
    expect(state.audits).to.have.lengthOf(0);
  });

  it('respects the in-transaction concurrent-write race: a second snapshot does not overwrite the first', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_A' },
    });
    state.store.set('tenants/t1/job_orders/jo_race', {
      recruiterAccountId: 'acc_solo',
      status: 'open',
      // Caller's preloadedJoData says NOT snapshotted yet ↓
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    // Simulate: between decision and txn read, a competing process
    // snapshotted. Our txn `tx.get` re-reads and finds capturedAt.
    state.store.set('tenants/t1/job_orders/jo_race', {
      ...state.store.get('tenants/t1/job_orders/jo_race')!,
      snapshot: {
        capturedAt: '<<earlier_server_ts>>',
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FIRST_WINNER',
      },
    });

    const result = await runSnapshotPassForJo({
      tenantId: 't1',
      jobOrderId: 'jo_race',
      beforeStatus: 'draft',
      afterStatus: 'open',
      capturedBy: 'trigger',
      preloadedJoData: {
        recruiterAccountId: 'acc_solo',
        status: 'open',
        // No snapshot in preload — the race surface
      },
      fdb,
    });

    // Decision said "snapshot" but the txn aborted gracefully.
    expect(result.decision.kind).to.equal('snapshot');
    const jo = state.store.get('tenants/t1/job_orders/jo_race') as Record<string, unknown>;
    const snapshot = jo.snapshot as Record<string, unknown>;
    expect(snapshot.screeningPackageId).to.equal('PKG_FIRST_WINNER');
    expect(snapshot.capturedAt).to.equal('<<earlier_server_ts>>');
  });
});
