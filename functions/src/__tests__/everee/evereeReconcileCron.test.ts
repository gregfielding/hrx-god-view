/**
 * E.2 — Cron sweep skip-vs-reconcile decision tests.
 *
 * `runEvereeReconcileSweep` is the inner implementation of the
 * scheduled function — exported specifically so we can stub Firestore
 * + the reconcile helper and pin the per-worker skip rules without
 * making outbound HTTP calls. These tests are the regression guard for:
 *
 *   - Terminated workers (lifecycleStatus === 'TERMINATED') are
 *     skipped — their state shouldn't change.
 *   - Workers reconciled within the recent-sync window (< 30 min by
 *     default) are skipped to avoid hammering Everee API.
 *   - Workers without resolvable identity (no entityId / userId /
 *     evereeWorkerId) are counted under `workersSkippedMissingIdentity`
 *     so we can spot drift in the audit log.
 *   - Workers whose entity is no longer Everee-enabled return
 *     `not_enabled` from the helper and are counted but not flagged
 *     as a failure.
 *   - Other workers are reconciled and counted under
 *     `workersReconciled`.
 *   - Per-worker exceptions don't stop the sweep — they're caught and
 *     counted under `workersFailed`.
 *   - The hard cap (`maxWorkersPerSweep`) terminates the sweep early
 *     and logs `sweep_capped` (we just assert the count).
 */

import * as admin from 'firebase-admin';
import * as sinon from 'sinon';
import { expect } from 'chai';

import {
  runEvereeReconcileSweep,
  type EvereeReconcileSweepSummary,
} from '../../integrations/everee/evereeReconcileCron';
import type {
  ReconcileWorkerInput,
  ReconcileWorkerResult,
} from '../../integrations/everee/evereeReconcileWorker';

import '../setup';

// ─────────────────────────────────────────────────────────────────────────
// Test harness — fakes the minimum Firestore surface the sweep touches.
// ─────────────────────────────────────────────────────────────────────────

interface FakeWorkerDoc {
  id: string;
  data: Record<string, unknown>;
}

interface FakeTenant {
  id: string;
  workers: FakeWorkerDoc[];
}

function installFirestoreFake(sandbox: sinon.SinonSandbox, tenants: FakeTenant[]) {
  const firestoreStub = {
    collection: (path: string) => {
      // We only handle two paths: 'tenants' and the per-tenant
      // everee_workers collection. Anything else is a test bug.
      if (path === 'tenants') {
        return {
          get: async () => ({
            size: tenants.length,
            docs: tenants.map((t) => ({ id: t.id })),
          }),
        };
      }
      const m = /^tenants\/([^/]+)\/everee_workers$/.exec(path);
      if (m) {
        const tenant = tenants.find((t) => t.id === m[1]);
        const docs = tenant ? tenant.workers : [];
        return {
          get: async () => ({
            size: docs.length,
            docs: docs.map((d) => ({
              id: d.id,
              data: () => d.data,
            })),
          }),
        };
      }
      throw new Error(`Unexpected Firestore collection path in test: ${path}`);
    },
  };

  sandbox.stub(admin, 'firestore').get(() => () => firestoreStub as never);
}

function buildWorkerDoc(overrides: Partial<FakeWorkerDoc & { dataOverrides: Record<string, unknown> }> = {}): FakeWorkerDoc {
  const base: FakeWorkerDoc = {
    id: overrides.id ?? 'entA__userA',
    data: {
      entityId: 'entA',
      userId: 'userA',
      evereeWorkerId: 'wkr-1',
      readinessMirror: {
        lifecycleStatus: 'ACTIVE',
      },
      ...((overrides as { dataOverrides?: Record<string, unknown> }).dataOverrides ?? {}),
    },
  };
  return base;
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('E.2 — runEvereeReconcileSweep', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it('reconciles a healthy active worker', async () => {
    installFirestoreFake(sandbox, [
      { id: 'tenant-1', workers: [buildWorkerDoc()] },
    ]);

    const calls: ReconcileWorkerInput[] = [];
    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => {
      calls.push(input);
      return { ok: true, reason: 'wrote', syncSource: input.syncSource };
    };

    const summary = await runEvereeReconcileSweep({ reconcileFn });

    expect(calls).to.have.length(1);
    expect(calls[0]).to.deep.equal({
      tenantId: 'tenant-1',
      entityId: 'entA',
      userId: 'userA',
      evereeWorkerId: 'wkr-1',
      syncSource: 'cron',
    });
    expect(summary.workersReconciled).to.equal(1);
    expect(summary.workersSkippedTerminated).to.equal(0);
    expect(summary.workersSkippedRecentSync).to.equal(0);
    expect(summary.workersFailed).to.equal(0);
  });

  it('skips terminated workers (lifecycleStatus === TERMINATED)', async () => {
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({
            dataOverrides: {
              readinessMirror: { lifecycleStatus: 'TERMINATED' },
            },
          } as never),
        ],
      },
    ]);

    const reconcileFn = sandbox.stub<[ReconcileWorkerInput], Promise<ReconcileWorkerResult>>();

    const summary = await runEvereeReconcileSweep({ reconcileFn });

    expect(reconcileFn.callCount).to.equal(0);
    expect(summary.workersSkippedTerminated).to.equal(1);
    expect(summary.workersReconciled).to.equal(0);
  });

  it('skips workers reconciled inside the recent-sync window (default 30 min)', async () => {
    const nowMs = Date.parse('2026-04-30T10:00:00Z');
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({
            dataOverrides: {
              // 5 minutes ago — well inside the default 30-min window.
              lastEvereeReconcileAt: admin.firestore.Timestamp.fromMillis(nowMs - 5 * 60 * 1000),
              readinessMirror: { lifecycleStatus: 'ACTIVE' },
            },
          } as never),
        ],
      },
    ]);

    const reconcileFn = sandbox.stub<[ReconcileWorkerInput], Promise<ReconcileWorkerResult>>();

    const summary = await runEvereeReconcileSweep({ reconcileFn, nowMs });

    expect(reconcileFn.callCount).to.equal(0);
    expect(summary.workersSkippedRecentSync).to.equal(1);
  });

  it('reconciles workers whose recent sync is OLDER than the window', async () => {
    const nowMs = Date.parse('2026-04-30T10:00:00Z');
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({
            dataOverrides: {
              // 2 hours ago — outside the 30-min window.
              lastEvereeReconcileAt: admin.firestore.Timestamp.fromMillis(nowMs - 2 * 60 * 60 * 1000),
              readinessMirror: { lifecycleStatus: 'ACTIVE' },
            },
          } as never),
        ],
      },
    ]);

    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => ({
      ok: true,
      reason: 'wrote',
      syncSource: input.syncSource,
    });

    const summary = await runEvereeReconcileSweep({ reconcileFn, nowMs });

    expect(summary.workersReconciled).to.equal(1);
    expect(summary.workersSkippedRecentSync).to.equal(0);
  });

  it('skips workers missing required identity fields', async () => {
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({
            id: 'broken__doc',
            dataOverrides: {
              entityId: '',
              userId: '',
              evereeWorkerId: '',
              readinessMirror: { lifecycleStatus: 'ACTIVE' },
            },
          } as never),
        ],
      },
    ]);

    const reconcileFn = sandbox.stub<[ReconcileWorkerInput], Promise<ReconcileWorkerResult>>();

    const summary = await runEvereeReconcileSweep({ reconcileFn });

    expect(reconcileFn.callCount).to.equal(0);
    expect(summary.workersSkippedMissingIdentity).to.equal(1);
  });

  it('falls back to externalWorkerId when evereeWorkerId is missing (legacy linkage rows)', async () => {
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({
            dataOverrides: {
              evereeWorkerId: undefined,
              externalWorkerId: 'legacy-wkr-99',
              readinessMirror: { lifecycleStatus: 'ACTIVE' },
            },
          } as never),
        ],
      },
    ]);

    const calls: ReconcileWorkerInput[] = [];
    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => {
      calls.push(input);
      return { ok: true, reason: 'wrote', syncSource: input.syncSource };
    };

    await runEvereeReconcileSweep({ reconcileFn });

    expect(calls).to.have.length(1);
    expect(calls[0].evereeWorkerId).to.equal('legacy-wkr-99');
  });

  it('counts not_enabled responses as a separate skip bucket (no failure)', async () => {
    installFirestoreFake(sandbox, [
      { id: 'tenant-1', workers: [buildWorkerDoc()] },
    ]);

    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => ({
      ok: false,
      reason: 'not_enabled',
      syncSource: input.syncSource,
    });

    const summary = await runEvereeReconcileSweep({ reconcileFn });

    expect(summary.workersSkippedNotEnabled).to.equal(1);
    expect(summary.workersFailed).to.equal(0);
    expect(summary.workersReconciled).to.equal(0);
  });

  it('continues sweeping when one worker reconcile fails (per-worker isolation)', async () => {
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({ id: 'good__1', dataOverrides: { entityId: 'ent1', userId: 'u1', evereeWorkerId: 'w1' } } as never),
          buildWorkerDoc({ id: 'bad__2', dataOverrides: { entityId: 'ent2', userId: 'u2', evereeWorkerId: 'w2' } } as never),
          buildWorkerDoc({ id: 'good__3', dataOverrides: { entityId: 'ent3', userId: 'u3', evereeWorkerId: 'w3' } } as never),
        ],
      },
    ]);

    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => {
      if (input.userId === 'u2') {
        // Simulate the helper throwing despite its "never throws" doc
        // contract — the cron's belt-and-suspenders catch must contain
        // it so the rest of the sweep continues.
        throw new Error('simulated upstream blow-up');
      }
      return { ok: true, reason: 'wrote', syncSource: input.syncSource };
    };

    const summary = await runEvereeReconcileSweep({ reconcileFn });

    expect(summary.workersReconciled).to.equal(2);
    expect(summary.workersFailed).to.equal(1);
    expect(summary.failureSamples).to.deep.equal([
      { tenantId: 'tenant-1', workerDocId: 'bad__2', reason: 'threw' },
    ]);
  });

  it('halts the sweep once maxWorkersPerSweep is reached', async () => {
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({ id: 'a', dataOverrides: { entityId: 'eA', userId: 'uA', evereeWorkerId: 'wA' } } as never),
          buildWorkerDoc({ id: 'b', dataOverrides: { entityId: 'eB', userId: 'uB', evereeWorkerId: 'wB' } } as never),
          buildWorkerDoc({ id: 'c', dataOverrides: { entityId: 'eC', userId: 'uC', evereeWorkerId: 'wC' } } as never),
        ],
      },
    ]);

    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => ({
      ok: true,
      reason: 'wrote',
      syncSource: input.syncSource,
    });

    const summary: EvereeReconcileSweepSummary = await runEvereeReconcileSweep({
      reconcileFn,
      maxWorkersPerSweep: 2,
    });

    expect(summary.workersReconciled).to.equal(2);
  });

  it('iterates multiple tenants and aggregates per-tenant counts', async () => {
    installFirestoreFake(sandbox, [
      {
        id: 'tenant-1',
        workers: [
          buildWorkerDoc({ id: 'a', dataOverrides: { entityId: 'eA', userId: 'uA', evereeWorkerId: 'wA' } } as never),
        ],
      },
      {
        id: 'tenant-2',
        workers: [
          buildWorkerDoc({
            id: 'b',
            dataOverrides: {
              entityId: 'eB',
              userId: 'uB',
              evereeWorkerId: 'wB',
              readinessMirror: { lifecycleStatus: 'TERMINATED' },
            },
          } as never),
        ],
      },
    ]);

    const reconcileFn = async (input: ReconcileWorkerInput): Promise<ReconcileWorkerResult> => ({
      ok: true,
      reason: 'wrote',
      syncSource: input.syncSource,
    });

    const summary = await runEvereeReconcileSweep({ reconcileFn });

    expect(summary.tenantsScanned).to.equal(2);
    expect(summary.workersReconciled).to.equal(1);
    expect(summary.workersSkippedTerminated).to.equal(1);
  });
});
