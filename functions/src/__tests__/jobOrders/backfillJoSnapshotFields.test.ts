/**
 * **R.16.1 Phase 4** — Backfill callable tests.
 *
 * Three layers under test:
 *   1. `classifyJoForBackfill` — pure bucket decision (status +
 *      snapshot state + dryRun + force).
 *   2. `processOneJoForBackfill` — single-JO orchestrator that drives
 *      the audit-trail emission for skipped JOs and forwards to
 *      `runSnapshotPassForJo` for actual writes.
 *   3. `runBackfillPage` — page driver covering pagination, error
 *      isolation, and end-to-end idempotency.
 *
 * Mocha + Chai. Run via:
 *   npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/backfillJoSnapshotFields.test.ts'
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L7, §L10, Phase 4.
 */

import { expect } from 'chai';

import {
  classifyJoForBackfill,
  processOneJoForBackfill,
  runBackfillPage,
} from '../../jobOrders/backfillJoSnapshotFieldsCallable';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — adapted from the snapshot-trigger test fake.
// Adds collection-group queries (`.orderBy('__name__')`) plus
// FieldPath.documentId() since the backfill page driver uses them.
// ─────────────────────────────────────────────────────────────────────

interface FakeState {
  store: Map<string, Record<string, unknown>>;
  autoIdSeq: number;
  reads: string[];
  writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }>;
  audits: Array<Record<string, unknown>>;
}

function newState(): FakeState {
  return { store: new Map(), autoIdSeq: 0, reads: [], writes: [], audits: [] };
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

interface FakeFs {
  doc: (path: string) => unknown;
  collection: (path: string) => unknown;
  runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
}

function makeFakeFirestore(state: FakeState): FakeFs {
  function makeDocRef(path: string) {
    return {
      path,
      id: path.split('/').pop() ?? '',
      async get() {
        state.reads.push(path);
        const data = state.store.get(path);
        return { exists: data !== undefined, data: () => data, id: path.split('/').pop() ?? '' };
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
    let limit = Number.POSITIVE_INFINITY;
    let startAfterId: string | null = null;

    const ref = {
      _path: path,
      orderBy() {
        return ref;
      },
      limit(n: number) {
        limit = n;
        return ref;
      },
      startAfter(idOrSnap: string | { id?: string }) {
        startAfterId =
          typeof idOrSnap === 'string'
            ? idOrSnap
            : (idOrSnap?.id ?? null);
        return ref;
      },
      async get() {
        const prefix = `${path}/`;
        const matchingPaths: string[] = [];
        for (const key of state.store.keys()) {
          if (
            key.startsWith(prefix) &&
            !key.slice(prefix.length).includes('/')
          ) {
            matchingPaths.push(key);
          }
        }
        matchingPaths.sort();

        let docs = matchingPaths.map((p) => ({
          id: p.slice(prefix.length),
          ref: makeDocRef(p),
          data: () => state.store.get(p),
          exists: true,
        }));

        if (startAfterId !== null) {
          const idx = docs.findIndex((d) => d.id === startAfterId);
          docs = idx === -1 ? [] : docs.slice(idx + 1);
        }
        if (Number.isFinite(limit)) docs = docs.slice(0, limit);

        return { size: docs.length, docs, empty: docs.length === 0 };
      },
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
    return ref;
  }

  function makeTxn() {
    const pending: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = [];
    return {
      tx: {
        async get(ref: { path: string; id?: string }) {
          state.reads.push(`${ref.path}#tx`);
          const data = state.store.get(ref.path);
          return { exists: data !== undefined, data: () => data, id: ref.id ?? '' };
        },
        set(
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) {
          pending.push({ path: ref.path, data, merge: options?.merge ?? false });
        },
      },
      commit() {
        for (const w of pending) {
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
      const t = makeTxn();
      const result = await fn(t.tx);
      t.commit();
      return result;
    },
  };
}

// Stub `admin.firestore.FieldValue.serverTimestamp()` and
// `admin.firestore.FieldPath.documentId()`. The fake firestore's
// orderBy is a no-op (sort-by-key is implicit in our key listing),
// so we just need the FieldPath function to return *something*
// callable.
import * as admin from 'firebase-admin';
(admin.firestore.FieldValue as unknown as { serverTimestamp: () => unknown }).serverTimestamp =
  (() => '<<server_ts>>') as unknown as typeof admin.firestore.FieldValue.serverTimestamp;
(admin.firestore as unknown as { FieldPath: unknown }).FieldPath = {
  documentId: () => '__name__',
} as unknown;

// ─────────────────────────────────────────────────────────────────────
// 1. classifyJoForBackfill — pure
// ─────────────────────────────────────────────────────────────────────

describe('classifyJoForBackfill — pure bucket decision', () => {
  it('skipped_status when status is "draft"', () => {
    expect(
      classifyJoForBackfill({
        joData: { status: 'draft' },
        dryRun: true,
        force: false,
      }),
    ).to.equal('skipped_status');
  });

  it('skipped_status when status is "cancelled"', () => {
    expect(
      classifyJoForBackfill({
        joData: { status: 'cancelled' },
        dryRun: false,
        force: true,
      }),
    ).to.equal('skipped_status');
  });

  it('skipped_status when joData is null or status is empty', () => {
    expect(
      classifyJoForBackfill({ joData: null, dryRun: true, force: false }),
    ).to.equal('skipped_status');
    expect(
      classifyJoForBackfill({ joData: {}, dryRun: true, force: false }),
    ).to.equal('skipped_status');
  });

  it('would_snapshot for an active JO with no snapshot in dry-run', () => {
    expect(
      classifyJoForBackfill({
        joData: { status: 'open' },
        dryRun: true,
        force: false,
      }),
    ).to.equal('would_snapshot');
  });

  it('skipped_already_snapshotted when capturedAt exists and force=false', () => {
    expect(
      classifyJoForBackfill({
        joData: {
          status: 'open',
          snapshot: { capturedAt: '<<ts>>', screeningPackageId: 'PKG_A' },
        },
        dryRun: true,
        force: false,
      }),
    ).to.equal('skipped_already_snapshotted');
  });

  it('would_snapshot_forced when frozen JO + force=true in dry-run', () => {
    expect(
      classifyJoForBackfill({
        joData: {
          status: 'open',
          snapshot: { capturedAt: '<<ts>>', screeningPackageId: 'PKG_A' },
        },
        dryRun: true,
        force: true,
      }),
    ).to.equal('would_snapshot_forced');
  });

  it('snapshotted when active JO + no snapshot + write mode', () => {
    expect(
      classifyJoForBackfill({
        joData: { status: 'open' },
        dryRun: false,
        force: false,
      }),
    ).to.equal('snapshotted');
  });

  it('snapshotted_forced when frozen JO + force=true + write mode', () => {
    expect(
      classifyJoForBackfill({
        joData: {
          status: 'open',
          snapshot: { capturedAt: '<<ts>>' },
        },
        dryRun: false,
        force: true,
      }),
    ).to.equal('snapshotted_forced');
  });

  it('still buckets `on_hold` / `filled` / `completed` as active (snapshot-eligible)', () => {
    for (const status of ['on_hold', 'filled', 'completed']) {
      expect(
        classifyJoForBackfill({
          joData: { status },
          dryRun: true,
          force: false,
        }),
        `status=${status}`,
      ).to.equal('would_snapshot');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. processOneJoForBackfill — orchestrator
// ─────────────────────────────────────────────────────────────────────

describe('processOneJoForBackfill — single-JO orchestrator', () => {
  it('writes a snapshot + audit row for an active unfrozen JO', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_A' },
    });
    state.store.set('tenants/t1/job_orders/jo1', {
      status: 'open',
      recruiterAccountId: 'acc_solo',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const out = await processOneJoForBackfill({
      tenantId: 't1',
      jobOrderId: 'jo1',
      joData: state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>,
      dryRun: false,
      force: false,
      fdb,
    });

    expect(out.bucket).to.equal('snapshotted');
    const jo = state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>;
    expect((jo.snapshot as Record<string, unknown>).capturedBy).to.equal('backfill');
    expect(state.audits[0].action).to.equal('snapshot_via_backfill');
    expect(state.audits[0].triggeredBy).to.equal('backfill');
  });

  it('writes a snapshot_skipped audit row for already-snapshotted JOs (no-force path)', async () => {
    const state = newState();
    state.store.set('tenants/t1/job_orders/jo_frozen', {
      status: 'open',
      snapshot: { capturedAt: '<<ts>>', screeningPackageId: 'PKG_FROZEN' },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const out = await processOneJoForBackfill({
      tenantId: 't1',
      jobOrderId: 'jo_frozen',
      joData: state.store.get('tenants/t1/job_orders/jo_frozen') as Record<string, unknown>,
      dryRun: false,
      force: false,
      fdb,
    });

    expect(out.bucket).to.equal('skipped_already_snapshotted');
    expect(state.audits).to.have.lengthOf(1);
    expect(state.audits[0].action).to.equal('snapshot_skipped');
    expect(state.audits[0].skipKind).to.equal('skip_already_snapshotted');
    expect(state.audits[0].triggeredBy).to.equal('backfill');
    // The JO doc must NOT have been rewritten.
    const jo = state.store.get('tenants/t1/job_orders/jo_frozen') as Record<string, unknown>;
    expect((jo.snapshot as Record<string, unknown>).screeningPackageId).to.equal('PKG_FROZEN');
  });

  it('does NOT write or audit when the JO is status-skipped (draft / cancelled)', async () => {
    const state = newState();
    state.store.set('tenants/t1/job_orders/jo_draft', { status: 'draft' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const out = await processOneJoForBackfill({
      tenantId: 't1',
      jobOrderId: 'jo_draft',
      joData: state.store.get('tenants/t1/job_orders/jo_draft') as Record<string, unknown>,
      dryRun: false,
      force: false,
      fdb,
    });

    expect(out.bucket).to.equal('skipped_status');
    expect(state.audits).to.have.lengthOf(0);
    expect(state.writes.filter((w) => w.path === 'tenants/t1/job_orders/jo_draft')).to.have.lengthOf(
      0,
    );
  });

  it('re-snapshots a frozen JO when force=true + non-dry-run, audit context tagged "(forced)"', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_FRESH' },
    });
    state.store.set('tenants/t1/job_orders/jo_frozen', {
      status: 'open',
      recruiterAccountId: 'acc_solo',
      snapshot: { capturedAt: '<<old_ts>>', screeningPackageId: 'PKG_OLD' },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const out = await processOneJoForBackfill({
      tenantId: 't1',
      jobOrderId: 'jo_frozen',
      joData: state.store.get('tenants/t1/job_orders/jo_frozen') as Record<string, unknown>,
      dryRun: false,
      force: true,
      fdb,
    });

    expect(out.bucket).to.equal('snapshotted_forced');
    const jo = state.store.get('tenants/t1/job_orders/jo_frozen') as Record<string, unknown>;
    expect((jo.snapshot as Record<string, unknown>).screeningPackageId).to.equal('PKG_FRESH');
    const last = state.audits[state.audits.length - 1];
    expect(last.action).to.equal('snapshot_via_backfill');
    expect(String(last.context)).to.match(/\(forced\)/);
  });

  it('dry-run does not write the JO snapshot but still classifies', async () => {
    const state = newState();
    state.store.set('tenants/t1/job_orders/jo1', { status: 'open' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const out = await processOneJoForBackfill({
      tenantId: 't1',
      jobOrderId: 'jo1',
      joData: state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>,
      dryRun: true,
      force: false,
      fdb,
    });

    expect(out.bucket).to.equal('would_snapshot');
    const jo = state.store.get('tenants/t1/job_orders/jo1') as Record<string, unknown>;
    expect(jo.snapshot).to.equal(undefined);
    // Dry-run for a unfrozen-active JO doesn't write an audit row
    // either — those only get emitted on actual snapshot writes or
    // explicit-skip audits.
    expect(state.audits).to.have.lengthOf(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. runBackfillPage — end-to-end pagination + idempotency
// ─────────────────────────────────────────────────────────────────────

describe('runBackfillPage — page driver', () => {
  it('produces a per-bucket count over a mixed page (dry-run accuracy)', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_A' },
    });
    // 2 active unfrozen JOs (would_snapshot)
    state.store.set('tenants/t1/job_orders/a1', {
      status: 'open',
      recruiterAccountId: 'acc_solo',
    });
    state.store.set('tenants/t1/job_orders/a2', {
      status: 'on_hold',
      recruiterAccountId: 'acc_solo',
    });
    // 1 active frozen JO (skipped_already_snapshotted)
    state.store.set('tenants/t1/job_orders/b1', {
      status: 'open',
      recruiterAccountId: 'acc_solo',
      snapshot: { capturedAt: '<<ts>>' },
    });
    // 2 status-skipped (1 draft, 1 cancelled)
    state.store.set('tenants/t1/job_orders/c1', { status: 'draft' });
    state.store.set('tenants/t1/job_orders/c2', { status: 'cancelled' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runBackfillPage({
      tenantId: 't1',
      dryRun: true,
      limit: 100,
      pageToken: null,
      force: false,
      fdb,
    });

    expect(report.scanned).to.equal(5);
    expect(report.buckets.would_snapshot).to.equal(2);
    expect(report.buckets.skipped_already_snapshotted).to.equal(1);
    expect(report.buckets.skipped_status).to.equal(2);
    expect(report.buckets.snapshotted).to.equal(0);
    expect(report.errors).to.deep.equal([]);
    expect(report.truncated).to.equal(false);
  });

  it('idempotency: a second non-dry-run pass yields snapshotted=0 and skipped_already_snapshotted bumped', async () => {
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_solo', {
      accountType: 'standalone',
      orderDefaults: { screeningPackageId: 'PKG_A' },
    });
    state.store.set('tenants/t1/job_orders/a1', {
      status: 'open',
      recruiterAccountId: 'acc_solo',
    });
    state.store.set('tenants/t1/job_orders/a2', {
      status: 'open',
      recruiterAccountId: 'acc_solo',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const first = await runBackfillPage({
      tenantId: 't1',
      dryRun: false,
      limit: 100,
      pageToken: null,
      force: false,
      fdb,
    });
    expect(first.buckets.snapshotted).to.equal(2);

    const second = await runBackfillPage({
      tenantId: 't1',
      dryRun: false,
      limit: 100,
      pageToken: null,
      force: false,
      fdb,
    });
    expect(second.buckets.snapshotted).to.equal(0);
    expect(second.buckets.skipped_already_snapshotted).to.equal(2);
    // No fresh `snapshot_via_backfill` rows on the second pass —
    // only `snapshot_skipped` rows.
    const secondPassAuditActions = state.audits.slice(2).map((a) => a.action);
    expect(secondPassAuditActions).to.deep.equal([
      'snapshot_skipped',
      'snapshot_skipped',
    ]);
  });

  it('truncates and returns nextPageToken when scanned == limit', async () => {
    const state = newState();
    for (const id of ['j_a', 'j_b', 'j_c', 'j_d']) {
      state.store.set(`tenants/t1/job_orders/${id}`, { status: 'open' });
    }
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runBackfillPage({
      tenantId: 't1',
      dryRun: true,
      limit: 2,
      pageToken: null,
      force: false,
      fdb,
    });

    expect(report.scanned).to.equal(2);
    expect(report.truncated).to.equal(true);
    // Sorted ascending — page 1 ends at j_b.
    expect(report.nextPageToken).to.equal('j_b');
  });

  it('continues from pageToken on the second page', async () => {
    const state = newState();
    for (const id of ['j_a', 'j_b', 'j_c', 'j_d']) {
      state.store.set(`tenants/t1/job_orders/${id}`, { status: 'open' });
    }
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runBackfillPage({
      tenantId: 't1',
      dryRun: true,
      limit: 2,
      pageToken: 'j_b',
      force: false,
      fdb,
    });

    expect(report.scanned).to.equal(2);
    expect(report.truncated).to.equal(true);
    expect(report.nextPageToken).to.equal('j_d');
    expect(report.buckets.would_snapshot).to.equal(2);
  });
});
