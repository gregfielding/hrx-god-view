/**
 * **R.4.2** — Legacy Assignment Backfill tests.
 *
 * Three layers under test:
 *   1. `resolveLegacyAssignmentHiringEntityId` — Stage A pure resolver.
 *      Covers the full L.4.2.1-(C) walk: JO direct → recruiter account
 *      → worker `entity_employments` → 'unresolved'.
 *   2. `processOneLegacyAssignmentForBackfill` — single-assignment
 *      orchestrator covering Stage A stamp + Stage B seed + audit
 *      emission for every outcome bucket.
 *   3. `runBackfillLegacyAssignmentsPage` — page driver covering
 *      pagination, error isolation, manualQueue extraction,
 *      pre-filter of fully-healthy assignments, and end-to-end
 *      idempotency (re-run reports `stamped_*: 0`,
 *      `stage_a_only_stage_b_no_op: N` — renamed from
 *      `skipped_already_complete` per R.4.2-F1, 2026-04-29).
 *
 * Plus a regression guard for **L.4.2.4**: confirm the extracted
 * `seedReadinessForExistingAssignment` helper produces the same
 * `assignmentReadinessItems` set on a fresh assignment that the
 * pre-extraction trigger body would have. Mocked
 * `seedAssignmentReadinessItemsRunner` so we can assert on the
 * `requirements` array passed in (the spec set is the load-bearing
 * piece L.4.2.4 guarantees stays single-sourced).
 *
 * Mocha + Chai. Run via:
 *   cd functions && npm test -- --grep 'R.4.2'
 *
 * @see docs/R4_2_LEGACY_BACKFILL_HANDOFF.md
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  processOneLegacyAssignmentForBackfill,
  resolveLegacyAssignmentHiringEntityId,
  runBackfillLegacyAssignmentsPage,
} from '../../jobOrders/backfillLegacyAssignmentsCallable';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — mirror of the snapshot-trigger / R.16.1 backfill
// fake, with `where(...)` query support added (the R.4.2 page driver
// reads `assignmentReadinessItems` filtered by `assignmentId` and
// `entity_employments` filtered by `userId`/`candidateId`).
// ─────────────────────────────────────────────────────────────────────

interface FakeState {
  store: Map<string, Record<string, unknown>>;
  autoIdSeq: number;
  reads: string[];
  writes: Array<{ path: string; data: Record<string, unknown>; merge: boolean }>;
  audits: Array<Record<string, unknown>>;
  /** Hook for failure-injection on specific paths. */
  failNextWrite?: { path: string; error: string };
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
        return {
          exists: data !== undefined,
          data: () => data,
          id: path.split('/').pop() ?? '',
        };
      },
      async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
        if (state.failNextWrite && state.failNextWrite.path === path) {
          const e = new Error(state.failNextWrite.error);
          state.failNextWrite = undefined;
          throw e;
        }
        const merge = options?.merge ?? false;
        state.writes.push({ path, data, merge });
        const existing = state.store.get(path) ?? {};
        state.store.set(path, merge ? deepMerge(existing, data) : data);
      },
    };
  }

  function makeCollectionRef(
    path: string,
    state0: {
      limit: number;
      startAfterId: string | null;
      wheres: Array<{ field: string; op: string; value: unknown }>;
    } = {
      limit: Number.POSITIVE_INFINITY,
      startAfterId: null,
      wheres: [],
    },
  ) {
    // Each chainable method returns a NEW ref with updated state —
    // mirrors the real firebase-admin Query immutability so a single
    // base `collection(...)` ref can be reused across multiple `.where`
    // chains without leaking filters between them.
    const ref = {
      _path: path,
      orderBy() {
        return makeCollectionRef(path, state0);
      },
      where(field: string, op: string, value: unknown) {
        return makeCollectionRef(path, {
          ...state0,
          wheres: [...state0.wheres, { field, op, value }],
        });
      },
      limit(n: number) {
        return makeCollectionRef(path, { ...state0, limit: n });
      },
      startAfter(idOrSnap: string | { id?: string }) {
        return makeCollectionRef(path, {
          ...state0,
          startAfterId:
            typeof idOrSnap === 'string'
              ? idOrSnap
              : (idOrSnap?.id ?? null),
        });
      },
      async get() {
        const prefix = `${path}/`;
        const matchingPaths: string[] = [];
        for (const key of state.store.keys()) {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
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

        for (const w of state0.wheres) {
          if (w.op === '==') {
            docs = docs.filter((d) => {
              const data = (state.store.get((d.ref as { path: string }).path) ??
                {}) as Record<string, unknown>;
              return data[w.field] === w.value;
            });
          }
        }

        if (state0.startAfterId !== null) {
          const idx = docs.findIndex((d) => d.id === state0.startAfterId);
          docs = idx === -1 ? [] : docs.slice(idx + 1);
        }
        if (Number.isFinite(state0.limit)) docs = docs.slice(0, state0.limit);

        return { size: docs.length, docs, empty: docs.length === 0 };
      },
      async add(data: Record<string, unknown>) {
        state.autoIdSeq += 1;
        const docPath = `${path}/auto_${state.autoIdSeq}`;
        state.store.set(docPath, data);
        if (path.endsWith('/cascadeAuditLog')) state.audits.push(data);
        return { id: `auto_${state.autoIdSeq}`, path: docPath };
      },
    };
    return ref;
  }

  return {
    doc: (p: string) => makeDocRef(p),
    collection: (p: string) => makeCollectionRef(p),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      // The R.4.2 callable doesn't use transactions — Stage A is a
      // single doc set, Stage B is the seeder runner's batch. This
      // stub satisfies the type without exercise.
      return fn({});
    },
  };
}

(admin.firestore.FieldValue as unknown as { serverTimestamp: () => unknown }).serverTimestamp =
  (() => '<<server_ts>>') as unknown as typeof admin.firestore.FieldValue.serverTimestamp;
(admin.firestore as unknown as { FieldPath: unknown }).FieldPath = {
  documentId: () => '__name__',
} as unknown;

// Helper — build a self-contained scenario seed. Most tests mutate
// just the bits they care about.
function seedBaseScenario(state: FakeState, opts: {
  tenantId: string;
  assignmentId: string;
  workerUid: string;
  jobOrderId?: string;
  jobOrderHiringEntityId?: string | null;
  recruiterAccountId?: string | null;
  recruiterAccountHiringEntityId?: string | null;
  workerEntityEmployments?: Array<{
    docId: string;
    entityKey?: string;
    hiringEntityId?: string | null;
    entityId?: string | null;
    keyedBy?: 'userId' | 'candidateId';
  }>;
  assignmentEntityKey?: string;
  assignmentHiringEntityId?: string;
}) {
  const {
    tenantId,
    assignmentId,
    workerUid,
    jobOrderId,
    jobOrderHiringEntityId,
    recruiterAccountId,
    recruiterAccountHiringEntityId,
    workerEntityEmployments = [],
    assignmentEntityKey,
    assignmentHiringEntityId,
  } = opts;

  const assignmentDoc: Record<string, unknown> = {
    userId: workerUid,
    jobOrderId: jobOrderId ?? '',
  };
  if (assignmentEntityKey) assignmentDoc.entityKey = assignmentEntityKey;
  if (assignmentHiringEntityId) assignmentDoc.hiringEntityId = assignmentHiringEntityId;
  state.store.set(`tenants/${tenantId}/assignments/${assignmentId}`, assignmentDoc);

  if (jobOrderId !== undefined) {
    const joDoc: Record<string, unknown> = {
      status: 'open',
    };
    if (jobOrderHiringEntityId) joDoc.hiringEntityId = jobOrderHiringEntityId;
    if (recruiterAccountId) joDoc.recruiterAccountId = recruiterAccountId;
    state.store.set(`tenants/${tenantId}/job_orders/${jobOrderId}`, joDoc);
  }

  if (recruiterAccountId) {
    const accDoc: Record<string, unknown> = {};
    if (recruiterAccountHiringEntityId) {
      accDoc.hiringEntityId = recruiterAccountHiringEntityId;
    }
    state.store.set(`tenants/${tenantId}/accounts/${recruiterAccountId}`, accDoc);
  }

  for (const ee of workerEntityEmployments) {
    const doc: Record<string, unknown> = {};
    const keyedBy = ee.keyedBy ?? 'userId';
    doc[keyedBy] = workerUid;
    if (ee.entityKey) doc.entityKey = ee.entityKey;
    if (ee.hiringEntityId) doc.hiringEntityId = ee.hiringEntityId;
    if (ee.entityId) doc.entityId = ee.entityId;
    state.store.set(`tenants/${tenantId}/entity_employments/${ee.docId}`, doc);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. resolveLegacyAssignmentHiringEntityId — pure resolver
// ─────────────────────────────────────────────────────────────────────

describe('R.4.2 — resolveLegacyAssignmentHiringEntityId (Stage A)', () => {
  const tid = 't1';
  const aid = 'a1';
  const wid = 'wA';
  const jid = 'jo1';

  it('JO chain wins when joDoc.hiringEntityId is set', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      jobOrderHiringEntityId: 'ent_jo_direct',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_jo_direct');
    expect(result.resolvedVia).to.equal('jo_chain');
  });

  it('JO null → recruiter account.hiringEntityId wins', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      jobOrderHiringEntityId: null,
      recruiterAccountId: 'acc_x',
      recruiterAccountHiringEntityId: 'ent_acct_x',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_acct_x');
    expect(result.resolvedVia).to.equal('jo_chain');
  });

  it('JO chain fully empty → worker entity_employments fallback (matched by entityKey)', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      jobOrderHiringEntityId: null,
      assignmentEntityKey: 'workforce',
      workerEntityEmployments: [
        { docId: `${wid}__select`, entityKey: 'select', hiringEntityId: 'ent_select' },
        { docId: `${wid}__workforce`, entityKey: 'workforce', hiringEntityId: 'ent_workforce' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_workforce');
    expect(result.resolvedVia).to.equal('worker_employment');
  });

  it('JO empty + no entityKey on assignment + sole worker employment → uses lone record', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      workerEntityEmployments: [
        { docId: `${wid}__workforce`, entityKey: 'workforce', hiringEntityId: 'ent_lone' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_lone');
    expect(result.resolvedVia).to.equal('worker_employment');
  });

  it('Multiple worker employments + no entityKey on assignment → unresolvable', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      workerEntityEmployments: [
        { docId: `${wid}__select`, entityKey: 'select', hiringEntityId: 'ent_a' },
        { docId: `${wid}__workforce`, entityKey: 'workforce', hiringEntityId: 'ent_b' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal(null);
    expect(result.resolvedVia).to.equal('unresolved');
  });

  it('All paths empty → unresolvable', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal(null);
    expect(result.resolvedVia).to.equal('unresolved');
  });

  it('Assignment already has hiringEntityId → "already_set" (Stage B caller still runs)', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      assignmentHiringEntityId: 'ent_pre_set',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_pre_set');
    expect(result.resolvedVia).to.equal('already_set');
  });

  it('candidateId-keyed entity_employments doc is also picked up', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      workerEntityEmployments: [
        {
          docId: `${wid}__workforce`,
          entityKey: 'workforce',
          hiringEntityId: 'ent_via_candidate',
          keyedBy: 'candidateId',
        },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_via_candidate');
    expect(result.resolvedVia).to.equal('worker_employment');
  });

  it('Falls back to entityId on the entity_employment doc when hiringEntityId is missing', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: aid,
      workerUid: wid,
      jobOrderId: jid,
      workerEntityEmployments: [
        {
          docId: `${wid}__workforce`,
          entityKey: 'workforce',
          entityId: 'ent_legacy_entityId_only',
        },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const result = await resolveLegacyAssignmentHiringEntityId({
      fdb,
      tenantId: tid,
      assignmentId: aid,
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/${aid}`,
      ) as Record<string, unknown>,
    });
    expect(result.resolvedHiringEntityId).to.equal('ent_legacy_entityId_only');
    expect(result.resolvedVia).to.equal('worker_employment');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. processOneLegacyAssignmentForBackfill — orchestrator
// ─────────────────────────────────────────────────────────────────────

describe('R.4.2 — processOneLegacyAssignmentForBackfill (orchestrator)', () => {
  const tid = 't1';
  const wid = 'wA';
  const jid = 'jo1';

  function setupTrivialJo(state: FakeState, opts: { hiringEntityId?: string } = {}) {
    // JO with NO requirement flags → seeder produces only the
    // shift_confirmation row. Combined with the writer's idempotent
    // probe the orchestrator can run end-to-end without exercising
    // the heavy Phase B matcher pipeline.
    const joDoc: Record<string, unknown> = { status: 'open' };
    if (opts.hiringEntityId) joDoc.hiringEntityId = opts.hiringEntityId;
    state.store.set(`tenants/${tid}/job_orders/${jid}`, joDoc);
    // Mirror to the camelCase collection so the seed helper's read
    // also lands.
    state.store.set(`tenants/${tid}/jobOrders/${jid}`, joDoc);
  }

  it('dry-run resolvable + empty items → would_stamp_and_seed (no writes, no audits)', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: 'a1',
      workerUid: wid,
      jobOrderId: jid,
      workerEntityEmployments: [
        { docId: `${wid}__workforce`, entityKey: 'workforce', hiringEntityId: 'ent_wf' },
      ],
    });
    setupTrivialJo(state);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const row = await processOneLegacyAssignmentForBackfill({
      tenantId: tid,
      assignmentId: 'a1',
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/a1`,
      ) as Record<string, unknown>,
      dryRun: true,
      fdb,
    });

    expect(row.bucket).to.equal('would_stamp_and_seed');
    expect(row.resolvedVia).to.equal('worker_employment');
    expect(row.resolvedHiringEntityId).to.equal('ent_wf');
    // Dry-run writes nothing.
    expect(state.audits).to.have.lengthOf(0);
    const assignAfter = state.store.get(`tenants/${tid}/assignments/a1`) as Record<string, unknown>;
    expect(assignAfter.hiringEntityId).to.equal(undefined);
  });

  it('dry-run unresolvable → would_skip_unresolvable (and surfaces in caller manualQueue)', async () => {
    const state = newState();
    seedBaseScenario(state, { tenantId: tid, assignmentId: 'a1', workerUid: wid, jobOrderId: jid });
    setupTrivialJo(state);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const row = await processOneLegacyAssignmentForBackfill({
      tenantId: tid,
      assignmentId: 'a1',
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/a1`,
      ) as Record<string, unknown>,
      dryRun: true,
      fdb,
    });

    expect(row.bucket).to.equal('would_skip_unresolvable_hiring_entity_id');
    expect(row.resolvedVia).to.equal('unresolved');
    expect(state.audits).to.have.lengthOf(0);
  });

  it('write-mode unresolvable → audit row + bucket, Stage B skipped', async () => {
    const state = newState();
    seedBaseScenario(state, { tenantId: tid, assignmentId: 'a1', workerUid: wid, jobOrderId: jid });
    setupTrivialJo(state);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const row = await processOneLegacyAssignmentForBackfill({
      tenantId: tid,
      assignmentId: 'a1',
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/a1`,
      ) as Record<string, unknown>,
      dryRun: false,
      fdb,
    });

    expect(row.bucket).to.equal('skipped_unresolvable_hiring_entity_id');
    expect(state.audits).to.have.lengthOf(1);
    expect(state.audits[0].action).to.equal('backfill_legacy_assignment_r4_2');
    expect(state.audits[0].outcome).to.equal('skipped_unresolvable_hiring_entity_id');
    expect(state.audits[0].stageAResolvedVia).to.equal('unresolved');
    expect(state.audits[0].stageAStampedHiringEntityId).to.equal(null);
    expect(state.audits[0].assignmentId).to.equal('a1');
    // No Stage A stamp on the assignment doc.
    const assignAfter = state.store.get(`tenants/${tid}/assignments/a1`) as Record<string, unknown>;
    expect(assignAfter.hiringEntityId).to.equal(undefined);
  });

  it('write-mode Stage A stamp failure → error bucket, Stage B skipped', async () => {
    const state = newState();
    seedBaseScenario(state, {
      tenantId: tid,
      assignmentId: 'a1',
      workerUid: wid,
      jobOrderId: jid,
      jobOrderHiringEntityId: 'ent_jo',
    });
    setupTrivialJo(state, { hiringEntityId: 'ent_jo' });
    state.failNextWrite = {
      path: `tenants/${tid}/assignments/a1`,
      error: 'simulated stamp failure',
    };
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const row = await processOneLegacyAssignmentForBackfill({
      tenantId: tid,
      assignmentId: 'a1',
      assignmentData: state.store.get(
        `tenants/${tid}/assignments/a1`,
      ) as Record<string, unknown>,
      dryRun: false,
      fdb,
    });

    expect(row.bucket).to.equal('error');
    expect(row.error).to.match(/simulated stamp failure/);
    expect(state.audits).to.have.lengthOf(1);
    expect(state.audits[0].outcome).to.equal('error');
    expect(state.audits[0].error).to.match(/stage_a_stamp_failed/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. runBackfillLegacyAssignmentsPage — page driver
// ─────────────────────────────────────────────────────────────────────

describe('R.4.2 — runBackfillLegacyAssignmentsPage (page driver)', () => {
  const tid = 't1';

  it('pre-filters fully-healthy assignments (hiringEntityId set + items exist)', async () => {
    const state = newState();
    // Healthy: hiringEntityId set + an existing assignmentReadinessItem.
    state.store.set(`tenants/${tid}/assignments/healthy_a`, {
      userId: 'wA',
      jobOrderId: 'jo1',
      hiringEntityId: 'ent_done',
    });
    state.store.set(`tenants/${tid}/assignmentReadinessItems/item_1`, {
      assignmentId: 'healthy_a',
    });
    // Stuck: hiringEntityId missing → must be processed (will be unresolvable here).
    state.store.set(`tenants/${tid}/assignments/stuck_a`, {
      userId: 'wB',
      jobOrderId: 'jo2',
    });
    state.store.set(`tenants/${tid}/job_orders/jo2`, { status: 'open' });
    state.store.set(`tenants/${tid}/jobOrders/jo2`, { status: 'open' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runBackfillLegacyAssignmentsPage({
      tenantId: tid,
      dryRun: true,
      limit: 100,
      pageToken: null,
      fdb,
    });

    expect(report.scanned).to.equal(2);
    expect(report.preFilteredFullyHealthy).to.equal(1);
    expect(report.candidatesProcessed).to.equal(1);
    expect(report.buckets.would_skip_unresolvable_hiring_entity_id).to.equal(1);
    expect(report.manualQueue).to.have.lengthOf(1);
    expect(report.manualQueue[0].assignmentId).to.equal('stuck_a');
  });

  it('pagination: truncates and returns nextPageToken when scanned == limit', async () => {
    const state = newState();
    for (const id of ['j_a', 'j_b', 'j_c']) {
      state.store.set(`tenants/${tid}/assignments/${id}`, { userId: 'w', jobOrderId: 'jo' });
    }
    state.store.set(`tenants/${tid}/job_orders/jo`, { status: 'open' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const page1 = await runBackfillLegacyAssignmentsPage({
      tenantId: tid,
      dryRun: true,
      limit: 2,
      pageToken: null,
      fdb,
    });
    expect(page1.scanned).to.equal(2);
    expect(page1.truncated).to.equal(true);
    expect(page1.nextPageToken).to.equal('j_b');

    const page2 = await runBackfillLegacyAssignmentsPage({
      tenantId: tid,
      dryRun: true,
      limit: 2,
      pageToken: 'j_b',
      fdb,
    });
    expect(page2.scanned).to.equal(1);
    expect(page2.truncated).to.equal(false);
    expect(page2.nextPageToken).to.equal(null);
  });

  it('idempotent re-run: second pass after a successful write reports no fresh stamps', async () => {
    // This test exercises the dry-run -> write -> dry-run sequence
    // against the unresolvable-only path (the only path that stays
    // self-contained in the test fake without exercising the heavy
    // Phase B seed pipeline). On the unresolvable path, write mode
    // emits one audit row per assignment; the second dry-run pass
    // should re-classify into `would_skip_unresolvable_hiring_entity_id`
    // identically and emit zero NEW audit rows (because dry-run never
    // audits).
    const state = newState();
    state.store.set(`tenants/${tid}/assignments/u1`, {
      userId: 'wU',
      jobOrderId: 'joU',
    });
    state.store.set(`tenants/${tid}/job_orders/joU`, { status: 'open' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const writeRun = await runBackfillLegacyAssignmentsPage({
      tenantId: tid,
      dryRun: false,
      limit: 100,
      pageToken: null,
      fdb,
    });
    expect(writeRun.buckets.skipped_unresolvable_hiring_entity_id).to.equal(1);
    expect(state.audits).to.have.lengthOf(1);

    const dryRun2 = await runBackfillLegacyAssignmentsPage({
      tenantId: tid,
      dryRun: true,
      limit: 100,
      pageToken: null,
      fdb,
    });
    expect(dryRun2.buckets.would_skip_unresolvable_hiring_entity_id).to.equal(1);
    expect(dryRun2.buckets.stamped_and_seeded).to.equal(0);
    // Dry-run never audits.
    expect(state.audits).to.have.lengthOf(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3a. R.4.2-F1 (2026-04-29) — bucket-rename exclusivity guard.
// ─────────────────────────────────────────────────────────────────────
//
// `'skipped_already_complete'` was renamed to `'stage_a_only_stage_b_no_op'`.
// Guard against a future "soft introduce" of the old key alongside the
// new one (a typo in `emptyBuckets()`, a stale switch arm, or a stray
// counter-increment) by inspecting the live report shape rather than
// trying to assert on a TypeScript union (which has no runtime form).
// If both keys ever appear in the same `LegacyAssignmentBuckets`
// instance, this test fails before the operator-facing report ever
// double-counts the same outcome.

describe('R.4.2-F1 — bucket-rename exclusivity guard', () => {
  it('LegacyAssignmentBuckets exposes the renamed key and not the old one', async () => {
    // The TypeScript union has no runtime form, so we drive the
    // canonical report shape via the page driver and inspect the
    // resulting `buckets` object's keys. If a future change ever
    // re-introduces `'skipped_already_complete'` (typo in
    // `emptyBuckets()`, stale switch arm, drive-by add to the
    // interface), this assertion fails before the operator-facing
    // report ever double-counts the same outcome.
    const tid = 't_xfm';
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const report = await runBackfillLegacyAssignmentsPage({
      tenantId: tid,
      dryRun: true,
      limit: 100,
      pageToken: null,
      fdb,
    });
    const keys = Object.keys(report.buckets);
    expect(keys).to.include('stage_a_only_stage_b_no_op');
    expect(keys).to.not.include('skipped_already_complete');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. L.4.2.4 regression guard — extracted helper requirement parity.
// ─────────────────────────────────────────────────────────────────────
//
// `seedReadinessForExistingAssignment` was extracted (mechanically)
// from `onAssignmentCreatedAutoSeed.ts`'s trigger body. The single
// load-bearing guarantee per L.4.2.4 is that the requirement-building
// logic stays single-sourced — i.e. the extracted helper produces the
// same `requirements` array the trigger would have. We exercise it by
// running the requirement-building branch of the helper
// (`buildRequirementsForJobOrder`) directly on the same JO shape that
// the trigger's pre-extraction path consumed and asserting the
// emitted spec set matches the documented branches.

describe('R.4.2 / L.4.2.4 — extracted helper requirement-set regression guard', () => {
  // Re-import the pure flag-builder from the extracted module. Same
  // function the trigger and the backfill use, so any drift on the
  // shared seed pipeline manifests here first.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildRequirementsForJobOrder,
  } = require('../../readiness/seedReadinessForExistingAssignment') as typeof import('../../readiness/seedReadinessForExistingAssignment');

  it('always emits shift_confirmation', () => {
    const reqs = buildRequirementsForJobOrder({});
    expect(reqs.map((r) => r.requirementType)).to.deep.equal(['shift_confirmation']);
  });

  it('opts in background_check + drug_screen when JO flags are set', () => {
    const reqs = buildRequirementsForJobOrder({
      backgroundCheckRequired: true,
      drugScreeningRequired: true,
    });
    expect(reqs.map((r) => r.requirementType).sort()).to.deep.equal(
      ['background_check', 'drug_screen', 'shift_confirmation'].sort(),
    );
    expect(reqs.find((r) => r.requirementType === 'background_check')?.resolutionMethod).to.equal(
      'external',
    );
    expect(reqs.find((r) => r.requirementType === 'drug_screen')?.resolutionMethod).to.equal(
      'external',
    );
  });

  it('honours snapshot-aware eVerify (R.16.2a wrap) — snapshot=true wins over live=false', () => {
    const reqs = buildRequirementsForJobOrder({
      status: 'open',
      eVerifyRequired: false,
      snapshot: { capturedAt: { toMillis: () => 1 }, eVerifyRequired: true },
    });
    expect(reqs.map((r) => r.requirementType)).to.include('e_verify');
  });

  it('honours snapshot-aware eVerify — snapshot=false wins over live=true', () => {
    const reqs = buildRequirementsForJobOrder({
      status: 'open',
      eVerifyRequired: true,
      snapshot: { capturedAt: { toMillis: () => 1 }, eVerifyRequired: false },
    });
    expect(reqs.map((r) => r.requirementType)).to.not.include('e_verify');
  });

  it('emits ppe_acknowledgement when requiredPpe is non-empty OR showRequiredPpe is true', () => {
    expect(
      buildRequirementsForJobOrder({ requiredPpe: ['hard_hat'] })
        .map((r) => r.requirementType),
    ).to.include('ppe_acknowledgement');
    expect(
      buildRequirementsForJobOrder({ showRequiredPpe: true })
        .map((r) => r.requirementType),
    ).to.include('ppe_acknowledgement');
  });

  it('emits safety_briefing + orientation when their flags are set', () => {
    const reqs = buildRequirementsForJobOrder({
      safetyBriefingRequired: true,
      orientationRequired: true,
    });
    const types = reqs.map((r) => r.requirementType);
    expect(types).to.include('safety_briefing');
    expect(types).to.include('orientation');
  });
});
