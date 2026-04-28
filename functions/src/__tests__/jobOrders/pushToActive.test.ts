/**
 * **R.16.1 Phase 5** — Push-to-Active callable tests.
 *
 * Three layers under test:
 *   1. `validatePushArgs` / `valuesEqual` / `readCurrentSnapshotValue`
 *      — pure helpers (field-key locking, type-shape validation,
 *      reason length, snapshot lookup).
 *   2. `runPreviewPushToActive` — read-only preview that walks the
 *      account's JOs and produces an `AffectedJoSummary[]`.
 *   3. `writePushToActiveOne` + `runPushToActivePage` — the write
 *      path including transactional re-reads, dotted-path updates,
 *      preview re-validation, and audit-trail emission (per-JO +
 *      summary).
 *
 * Mocha + Chai. Run via:
 *   npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/pushToActive.test.ts'
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L9, §L10, Phase 5.
 */

import { expect } from 'chai';

import {
  PUSH_POSITION_FIELDS,
  PUSH_TOP_LEVEL_FIELDS,
  chunkIds,
  isPushPositionField,
  isPushTopLevelField,
  readCurrentSnapshotValue,
  resolveAccountFanoutIds,
  runPreviewPushToActive,
  runPushToActivePage,
  validatePushArgs,
  valuesEqual,
  writePushToActiveOne,
  type ValidatedPushArgs,
} from '../../jobOrders/pushToActive';

/**
 * Test helper — builds a fully-typed `ValidatedPushArgs`. Centralizes
 * default field population (notably `previousValue` /
 * `hasPreviousValue` introduced in R.16.1.1) so the legacy fixtures
 * keep producing legacy semantics without per-test boilerplate.
 */
function makeValidated(
  partial: Omit<ValidatedPushArgs, 'previousValue' | 'hasPreviousValue'> &
    Partial<Pick<ValidatedPushArgs, 'previousValue' | 'hasPreviousValue'>>,
): ValidatedPushArgs {
  return {
    previousValue: undefined,
    hasPreviousValue: false,
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — supports `where('recruiterAccountId','==',acc)`
// queries on collections, dotted-path `tx.update`, and `add` for
// audit logs. Reused shape from the backfill test fake; adds query
// + update semantics needed by Push-to-Active.
// ─────────────────────────────────────────────────────────────────────

interface FakeState {
  store: Map<string, Record<string, unknown>>;
  reads: string[];
  writes: Array<{ path: string; updates: Record<string, unknown> }>;
  audits: Array<Record<string, unknown>>;
  autoIdSeq: number;
}

function newState(): FakeState {
  return { store: new Map(), reads: [], writes: [], audits: [], autoIdSeq: 0 };
}

interface WhereClause {
  field: string;
  op: '==' | 'in';
  value: unknown;
}

function whereMatches(clause: WhereClause, fieldVal: unknown): boolean {
  if (clause.op === '==') return fieldVal === clause.value;
  if (clause.op === 'in') {
    return Array.isArray(clause.value) && (clause.value as unknown[]).includes(fieldVal);
  }
  return false;
}

/**
 * Apply a Firestore-update payload (which may contain dotted paths
 * like `"snapshot.lastPushedAt"`) onto a doc. Mirrors the admin SDK
 * dotted-path semantics: a key with `.`s walks/creates nested
 * objects; a plain key replaces the whole field.
 */
function applyDottedUpdates(
  base: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  for (const [pathKey, val] of Object.entries(updates)) {
    if (!pathKey.includes('.')) {
      out[pathKey] = val;
      continue;
    }
    const segs = pathKey.split('.');
    let cur: Record<string, unknown> = out;
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i];
      const next = cur[seg];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        cur[seg] = {};
      }
      cur = cur[seg] as Record<string, unknown>;
    }
    cur[segs[segs.length - 1]] = val;
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
    };
  }

  /**
   * Build a collection/query ref. The real admin SDK returns a new
   * immutable `Query` from each `where()` call so chaining is safe.
   * The fake mirrors that — `wheres` is captured in the closure and
   * each `where()` returns a new ref with the appended clause —
   * otherwise repeated `.where()` calls on a shared ref would
   * silently OR/AND across unrelated query calls.
   */
  function makeQueryRef(path: string, wheres: WhereClause[]) {
    return {
      _path: path,
      where(field: string, op: '==' | 'in', value: unknown) {
        return makeQueryRef(path, [...wheres, { field, op, value }]);
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

        const docs = matchingPaths
          .map((p) => ({
            id: p.slice(prefix.length),
            ref: makeDocRef(p),
            data: () => state.store.get(p),
            exists: true,
          }))
          .filter((d) => {
            const data = d.data() as Record<string, unknown>;
            return wheres.every((w) => whereMatches(w, data[w.field]));
          });

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
  }

  function makeCollectionRef(path: string) {
    return makeQueryRef(path, []);
  }

  function makeTxn() {
    const pending: Array<{ path: string; updates: Record<string, unknown> }> = [];
    return {
      tx: {
        async get(ref: { path: string; id?: string }) {
          state.reads.push(`${ref.path}#tx`);
          const data = state.store.get(ref.path);
          return { exists: data !== undefined, data: () => data, id: ref.id ?? '' };
        },
        update(ref: { path: string }, updates: Record<string, unknown>) {
          pending.push({ path: ref.path, updates });
        },
      },
      commit() {
        for (const w of pending) {
          state.writes.push(w);
          const existing = state.store.get(w.path) ?? {};
          state.store.set(w.path, applyDottedUpdates(existing, w.updates));
        }
      },
    };
  }

  return {
    doc: (p: string) => makeDocRef(p),
    collection: (p: string) => makeCollectionRef(p),
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const t = makeTxn();
      const result = await fn(t.tx);
      t.commit();
      return result;
    },
  };
}

// Stub server timestamp to a sentinel string so write assertions are
// deterministic. The push code only uses
// `admin.firestore.FieldValue.serverTimestamp()`.
import * as admin from 'firebase-admin';
(admin.firestore.FieldValue as unknown as { serverTimestamp: () => unknown }).serverTimestamp =
  (() => '<<server_ts>>') as unknown as typeof admin.firestore.FieldValue.serverTimestamp;

const TENANT = 't1';
const ACCOUNT = 'acct_1';

function seedJo(
  state: FakeState,
  joId: string,
  jo: {
    status: string;
    recruiterAccountId?: string;
    snapshot?: Record<string, unknown> | null;
  },
): void {
  state.store.set(`tenants/${TENANT}/job_orders/${joId}`, {
    recruiterAccountId: ACCOUNT,
    ...jo,
  });
}

const baseSnap = (overrides: Record<string, unknown> = {}) => ({
  capturedAt: '<<server_ts>>',
  capturedBy: 'trigger',
  lastPushedAt: null,
  hiringEntityId: 'HE_OLD',
  eVerifyRequired: false,
  workersCompCode: '7777',
  screeningPackageId: 'PKG_OLD',
  additionalScreenings: ['drug'],
  selectedPositionIds: ['p1', 'p2'],
  positions: [
    {
      positionId: 'p1',
      jobTitle: 'Forklift',
      payRate: 18,
      billRate: 27,
      futa: 0.6,
      suta: 1.2,
      workersCompRate: 4.5,
      markupPercentage: 50,
      rateMode: 'hourly',
      jobDescription: 'lift things',
    },
    {
      positionId: 'p2',
      jobTitle: 'Loader',
      payRate: 17,
      billRate: 25,
      futa: 0.6,
      suta: 1.2,
      workersCompRate: 4.5,
      markupPercentage: 47,
      rateMode: 'hourly',
      jobDescription: 'load things',
    },
  ],
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────
// 1. Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('PUSH field surface — locked V1', () => {
  it('top-level + per-position sets are disjoint', () => {
    const overlap = (PUSH_TOP_LEVEL_FIELDS as readonly string[]).filter((k) =>
      (PUSH_POSITION_FIELDS as readonly string[]).includes(k),
    );
    expect(overlap).to.deep.equal([]);
  });
  it('isPushTopLevelField + isPushPositionField narrow correctly', () => {
    expect(isPushTopLevelField('hiringEntityId')).to.equal(true);
    expect(isPushTopLevelField('payRate')).to.equal(false);
    expect(isPushPositionField('payRate')).to.equal(true);
    expect(isPushPositionField('selectedPositionIds')).to.equal(false);
  });
});

describe('valuesEqual — comparison semantics', () => {
  it('treats undefined and null as equal (no-snapshot ↔ no-parent)', () => {
    expect(valuesEqual(undefined, null)).to.equal(true);
    expect(valuesEqual(null, undefined)).to.equal(true);
  });
  it('treats reordered arrays as equal (additionalScreenings)', () => {
    expect(valuesEqual(['drug', 'mvr'], ['mvr', 'drug'])).to.equal(true);
  });
  it('different array contents are not equal', () => {
    expect(valuesEqual(['drug'], ['drug', 'mvr'])).to.equal(false);
  });
  it('primitive equality holds', () => {
    expect(valuesEqual(42, 42)).to.equal(true);
    expect(valuesEqual('a', 'b')).to.equal(false);
  });
});

describe('validatePushArgs — input gating', () => {
  const baseInput = {
    tenantId: TENANT,
    accountId: ACCOUNT,
    fieldKey: 'eVerifyRequired',
    positionId: null,
    newValue: true,
    isWrite: false,
  };

  it('accepts a top-level preview call', () => {
    const out = validatePushArgs(baseInput);
    expect(out.fieldKey).to.equal('eVerifyRequired');
    expect(out.positionId).to.equal(null);
  });

  it('rejects unknown fieldKey', () => {
    expect(() =>
      validatePushArgs({ ...baseInput, fieldKey: 'jobTitle_nope' }),
    ).to.throw(/not push-eligible/);
  });

  it('rejects per-position field without positionId', () => {
    expect(() =>
      validatePushArgs({ ...baseInput, fieldKey: 'payRate', newValue: 20 }),
    ).to.throw(/positionId is required/);
  });

  it('rejects top-level field with positionId set', () => {
    expect(() =>
      validatePushArgs({
        ...baseInput,
        positionId: 'p1',
      }),
    ).to.throw(/must be omitted/);
  });

  it('accepts per-position with positionId', () => {
    const out = validatePushArgs({
      ...baseInput,
      fieldKey: 'payRate',
      positionId: 'p1',
      newValue: 22,
    });
    expect(out.fieldKey).to.equal('payRate');
    expect(out.positionId).to.equal('p1');
  });

  it('rejects non-boolean newValue for eVerifyRequired', () => {
    expect(() =>
      validatePushArgs({ ...baseInput, newValue: 'yes' }),
    ).to.throw(/must be a boolean or null/);
  });

  it('rejects non-finite newValue for payRate', () => {
    expect(() =>
      validatePushArgs({
        ...baseInput,
        fieldKey: 'payRate',
        positionId: 'p1',
        newValue: Number.NaN,
      }),
    ).to.throw(/finite number or null/);
  });

  it('accepts null for any field (deliberate clear)', () => {
    expect(() =>
      validatePushArgs({ ...baseInput, fieldKey: 'screeningPackageId', newValue: null }),
    ).to.not.throw();
  });

  it('write mode requires non-empty selectedJoIds', () => {
    expect(() =>
      validatePushArgs({
        ...baseInput,
        isWrite: true,
        selectedJoIds: [],
        reason: 'r',
      }),
    ).to.throw(/at least one JO ID/);
  });

  it('write mode requires non-empty trimmed reason', () => {
    expect(() =>
      validatePushArgs({
        ...baseInput,
        isWrite: true,
        selectedJoIds: ['jo1'],
        reason: '   ',
      }),
    ).to.throw(/cannot be empty/);
  });

  it('write mode rejects reason longer than 2000 chars', () => {
    expect(() =>
      validatePushArgs({
        ...baseInput,
        isWrite: true,
        selectedJoIds: ['jo1'],
        reason: 'r'.repeat(2001),
      }),
    ).to.throw(/exceeds maximum length/);
  });

  it('write mode caps selectedJoIds at 200', () => {
    const big = Array.from({ length: 201 }, (_, i) => `jo_${i}`);
    expect(() =>
      validatePushArgs({
        ...baseInput,
        isWrite: true,
        selectedJoIds: big,
        reason: 'r',
      }),
    ).to.throw(/exceeds maximum/);
  });
});

describe('readCurrentSnapshotValue — snapshot lookups', () => {
  it('returns no_snapshot for a JO with no snapshot', () => {
    expect(
      readCurrentSnapshotValue({ id: 'j1', status: 'open', snapshot: null }, 'eVerifyRequired', null),
    ).to.deep.equal({ value: undefined, reason: 'no_snapshot' });
  });

  it('returns no_snapshot for a JO whose snapshot has no capturedAt', () => {
    expect(
      readCurrentSnapshotValue(
        { id: 'j1', status: 'open', snapshot: { eVerifyRequired: true } },
        'eVerifyRequired',
        null,
      ),
    ).to.deep.equal({ value: undefined, reason: 'no_snapshot' });
  });

  it('returns the snapshot value for a top-level field', () => {
    const out = readCurrentSnapshotValue(
      { id: 'j1', status: 'open', snapshot: baseSnap() },
      'screeningPackageId',
      null,
    );
    expect(out).to.deep.equal({ value: 'PKG_OLD', reason: 'snapshot' });
  });

  it('returns the per-position sub-field value', () => {
    const out = readCurrentSnapshotValue(
      { id: 'j1', status: 'open', snapshot: baseSnap() },
      'payRate',
      'p1',
    );
    expect(out).to.deep.equal({ value: 18, reason: 'snapshot' });
  });

  it('returns no_position when positionId not in snapshot.positions', () => {
    const out = readCurrentSnapshotValue(
      { id: 'j1', status: 'open', snapshot: baseSnap() },
      'payRate',
      'p_missing',
    );
    expect(out.reason).to.equal('no_position');
  });

  it('returns no_position when positions is missing', () => {
    const out = readCurrentSnapshotValue(
      {
        id: 'j1',
        status: 'open',
        snapshot: baseSnap({ positions: undefined }),
      },
      'payRate',
      'p1',
    );
    expect(out.reason).to.equal('no_position');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. runPreviewPushToActive
// ─────────────────────────────────────────────────────────────────────

describe('runPreviewPushToActive — read-only diff preview', () => {
  function setupPreview(extraJos: Array<[string, Record<string, unknown>]> = []) {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo_active_diff', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: false }),
    });
    seedJo(state, 'jo_active_match', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: true }),
    });
    seedJo(state, 'jo_draft_excluded', {
      status: 'draft',
      snapshot: baseSnap(),
    });
    seedJo(state, 'jo_no_snapshot', {
      status: 'open',
      snapshot: null,
    });
    seedJo(state, 'jo_other_account', {
      status: 'open',
      recruiterAccountId: 'someone_else',
      snapshot: baseSnap(),
    });
    for (const [id, jo] of extraJos) {
      state.store.set(`tenants/${TENANT}/job_orders/${id}`, jo);
    }
    return { state, fdb };
  }

  it('produces wouldChange/alreadyMatching/missingSnapshot totals', async () => {
    const { fdb } = setupPreview();
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    // totalScanned counts every JO under the account that came back
    // from the `where('recruiterAccountId','==',accountId)` query,
    // before the active-status filter is applied. Draft JOs are
    // counted here but silently dropped from `affectedJobOrders`.
    expect(report.totals.totalScanned).to.equal(4);
    expect(report.totals.eligible).to.equal(2);
    expect(report.totals.wouldChange).to.equal(1);
    expect(report.totals.alreadyMatching).to.equal(1);
    expect(report.totals.missingSnapshot).to.equal(1);
  });

  it('excludes other accounts from the scan', async () => {
    const { fdb } = setupPreview();
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    const ids = report.affectedJobOrders.map((r) => r.jobOrderId).sort();
    expect(ids).to.not.include('jo_other_account');
  });

  it('reports per-position diffs and ineligibility', async () => {
    const { fdb } = setupPreview();
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'payRate',
      positionId: 'p1',
      newValue: 22,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    const diff = report.affectedJobOrders.find((r) => r.jobOrderId === 'jo_active_diff');
    expect(diff?.wouldChange).to.equal(true);
    expect(diff?.currentValue).to.equal(18);
    const noSnap = report.affectedJobOrders.find((r) => r.jobOrderId === 'jo_no_snapshot');
    expect(noSnap?.ineligibleReason).to.equal('no_snapshot');
  });

  it('reports no_position when positionId missing in snapshot', async () => {
    const { fdb } = setupPreview([
      [
        'jo_only_p2',
        {
          recruiterAccountId: ACCOUNT,
          status: 'open',
          snapshot: baseSnap({
            selectedPositionIds: ['p2'],
            positions: baseSnap()
              .positions!.filter((p) => p.positionId === 'p2'),
          }),
        },
      ],
    ]);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'payRate',
      positionId: 'p1',
      newValue: 22,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    const row = report.affectedJobOrders.find((r) => r.jobOrderId === 'jo_only_p2');
    expect(row?.ineligibleReason).to.equal('no_position');
    expect(report.totals.missingPosition).to.equal(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. writePushToActiveOne — single-JO transactional write
// ─────────────────────────────────────────────────────────────────────

describe('writePushToActiveOne — transactional single-JO write', () => {
  it('writes top-level snapshot field via dotted path + bumps lastPushedAt', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: false }),
    });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo1',
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      fdb,
    });
    expect(out.kind).to.equal('pushed');
    if (out.kind === 'pushed') {
      expect(out.oldValue).to.equal(false);
    }
    const stored = state.store.get(`tenants/${TENANT}/job_orders/jo1`) as Record<
      string,
      unknown
    >;
    const snap = stored.snapshot as Record<string, unknown>;
    expect(snap.eVerifyRequired).to.equal(true);
    expect(snap.lastPushedAt).to.equal('<<server_ts>>');
    expect(snap.workersCompCode).to.equal('7777');
  });

  it('writes per-position by replacing only the matching positions[i].field', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', { status: 'open', snapshot: baseSnap() });
    await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo1',
      fieldKey: 'payRate',
      positionId: 'p1',
      newValue: 22,
      fdb,
    });
    const stored = state.store.get(`tenants/${TENANT}/job_orders/jo1`) as Record<
      string,
      unknown
    >;
    const positions = (stored.snapshot as Record<string, unknown>).positions as Array<
      Record<string, unknown>
    >;
    expect(positions.find((p) => p.positionId === 'p1')!.payRate).to.equal(22);
    expect(positions.find((p) => p.positionId === 'p2')!.payRate).to.equal(17);
  });

  it('skips when value already matches (no-op write)', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: true }),
    });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo1',
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      fdb,
    });
    expect(out.kind).to.equal('skipped_no_change');
    expect(state.writes.length).to.equal(0);
  });

  it('skips when JO status flipped away from active in the txn re-read', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', {
      status: 'cancelled',
      snapshot: baseSnap(),
    });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo1',
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      fdb,
    });
    expect(out.kind).to.equal('skipped_status_changed');
  });

  it('skips when JO was deleted between preview and write', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo_missing',
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      fdb,
    });
    expect(out.kind).to.equal('skipped_status_changed');
  });

  it('skips when snapshot missing on a per-position write', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', { status: 'open', snapshot: null });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo1',
      fieldKey: 'payRate',
      positionId: 'p1',
      newValue: 22,
      fdb,
    });
    expect(out.kind).to.equal('skipped_not_eligible');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. runPushToActivePage — orchestrator (preview re-run + audit)
// ─────────────────────────────────────────────────────────────────────

describe('runPushToActivePage — orchestrator end-to-end', () => {
  function seedAccountFleet(state: FakeState): void {
    seedJo(state, 'jo_a_diff', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: false }),
    });
    seedJo(state, 'jo_a_match', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: true }),
    });
    seedJo(state, 'jo_a_no_snap', {
      status: 'open',
      snapshot: null,
    });
    seedJo(state, 'jo_a_draft', {
      status: 'draft',
      snapshot: baseSnap(),
    });
  }

  it('writes only the JOs that wouldChange per the preview re-run', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedAccountFleet(state);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo_a_diff', 'jo_a_match', 'jo_a_no_snap'],
      reason: 'CORT compliance update',
    };
    const report = await runPushToActivePage({
      validated,
      triggeredBy: 'admin_uid',
      fdb,
    });
    expect(report.updatedCount).to.equal(1);
    expect(report.skippedCount).to.equal(2);
    const diff = report.perJobOrder.find((r) => r.jobOrderId === 'jo_a_diff');
    expect(diff?.outcome).to.equal('pushed');
    const match = report.perJobOrder.find((r) => r.jobOrderId === 'jo_a_match');
    expect(match?.outcome).to.equal('skipped_no_change');
    const noSnap = report.perJobOrder.find((r) => r.jobOrderId === 'jo_a_no_snap');
    expect(noSnap?.outcome).to.equal('skipped_not_eligible');
    expect(noSnap?.skipReason).to.equal('no_snapshot');
  });

  it('emits one audit row per pushed JO + one summary row', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedAccountFleet(state);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo_a_diff', 'jo_a_match'],
      reason: 'CORT compliance update',
    };
    await runPushToActivePage({ validated, triggeredBy: 'admin_uid', fdb });
    const perJoAudits = state.audits.filter((a) => a.action === 'push_to_active');
    const summaryAudits = state.audits.filter(
      (a) => a.action === 'push_to_active_summary',
    );
    expect(perJoAudits.length).to.equal(1);
    expect(summaryAudits.length).to.equal(1);
    expect((perJoAudits[0] as { reason?: unknown }).reason).to.equal(
      'CORT compliance update',
    );
    expect((perJoAudits[0] as { oldValue?: unknown }).oldValue).to.equal(false);
    expect((perJoAudits[0] as { newValue?: unknown }).newValue).to.equal(true);
    const summary = summaryAudits[0] as Record<string, unknown>;
    expect(summary.affectedJoIds).to.deep.equal(['jo_a_diff', 'jo_a_match']);
    expect(summary.updatedCount).to.equal(1);
    expect(summary.skippedCount).to.equal(1);
    expect(summary.jobOrderId).to.equal(undefined);
  });

  it('refuses to write JOs absent from the server-side preview (preview_excluded)', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedAccountFleet(state);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo_a_diff', 'jo_made_up'],
      reason: 'r',
    };
    const report = await runPushToActivePage({
      validated,
      triggeredBy: 'admin_uid',
      fdb,
    });
    const fake = report.perJobOrder.find((r) => r.jobOrderId === 'jo_made_up');
    expect(fake?.outcome).to.equal('skipped_not_eligible');
    expect(fake?.skipReason).to.equal('preview_excluded');
  });

  it('idempotency: a repeat push leaves no further writes (already-matching)', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedAccountFleet(state);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo_a_diff'],
      reason: 'first run',
    };
    const r1 = await runPushToActivePage({ validated, triggeredBy: 'u', fdb });
    expect(r1.updatedCount).to.equal(1);

    // Reset write log; doc is now in the post-push state.
    state.writes = [];
    state.audits = [];
    const r2 = await runPushToActivePage({
      validated: { ...validated, reason: 'second run' },
      triggeredBy: 'u',
      fdb,
    });
    expect(r2.updatedCount).to.equal(0);
    expect(r2.skippedCount).to.equal(1);
    const perJoAudits = state.audits.filter((a) => a.action === 'push_to_active');
    expect(perJoAudits.length).to.equal(0);
    const summaryAudits = state.audits.filter(
      (a) => a.action === 'push_to_active_summary',
    );
    expect(summaryAudits.length).to.equal(1);
  });

  it('preserves capturedAt + capturedBy + sibling fields on top-level pushes', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', {
      status: 'open',
      snapshot: baseSnap({ workersCompCode: '7777', eVerifyRequired: false }),
    });
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo1'],
      reason: 'flip flag',
    };
    await runPushToActivePage({ validated, triggeredBy: 'u', fdb });
    const stored = state.store.get(`tenants/${TENANT}/job_orders/jo1`) as Record<
      string,
      unknown
    >;
    const snap = stored.snapshot as Record<string, unknown>;
    expect(snap.capturedBy).to.equal('trigger');
    expect(snap.workersCompCode).to.equal('7777');
    expect(snap.eVerifyRequired).to.equal(true);
    expect(snap.lastPushedAt).to.equal('<<server_ts>>');
  });

  it('per-position push leaves other positions intact', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo1', { status: 'open', snapshot: baseSnap() });
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'markupPercentage',
      positionId: 'p1',
      newValue: 60,
      selectedJoIds: ['jo1'],
      reason: 'reprice',
    };
    await runPushToActivePage({ validated, triggeredBy: 'u', fdb });
    const stored = state.store.get(`tenants/${TENANT}/job_orders/jo1`) as Record<
      string,
      unknown
    >;
    const positions = (stored.snapshot as Record<string, unknown>).positions as Array<
      Record<string, unknown>
    >;
    expect(positions.find((p) => p.positionId === 'p1')!.markupPercentage).to.equal(60);
    expect(positions.find((p) => p.positionId === 'p2')!.markupPercentage).to.equal(47);
  });

  it('summary row emits even when no JO actually changed', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedAccountFleet(state);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo_a_match'],
      reason: 'no-op push',
    };
    await runPushToActivePage({ validated, triggeredBy: 'u', fdb });
    const summaryAudits = state.audits.filter(
      (a) => a.action === 'push_to_active_summary',
    );
    expect(summaryAudits.length).to.equal(1);
    const summary = summaryAudits[0] as Record<string, unknown>;
    expect(summary.updatedCount).to.equal(0);
    expect(summary.skippedCount).to.equal(1);
  });

  it('preview re-run + write: a JO that flipped to cancelled mid-flight is skipped', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo_will_cancel', {
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: false }),
    });

    // Wrap the fdb so that on the *second* read of jo_will_cancel
    // (i.e. inside the txn) the store reflects a cancelled status.
    let txReadCount = 0;
    const origRunTxn = fdb.runTransaction.bind(fdb);
    (fdb as unknown as { runTransaction: typeof origRunTxn }).runTransaction = async (
      fn,
    ) => {
      txReadCount += 1;
      if (txReadCount === 1) {
        // Mid-flight cancel.
        const stored = state.store.get(
          `tenants/${TENANT}/job_orders/jo_will_cancel`,
        ) as Record<string, unknown>;
        state.store.set(`tenants/${TENANT}/job_orders/jo_will_cancel`, {
          ...stored,
          status: 'cancelled',
        });
      }
      return origRunTxn(fn);
    };

    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: ['jo_will_cancel'],
      reason: 'race',
    };
    const report = await runPushToActivePage({
      validated,
      triggeredBy: 'u',
      fdb,
    });
    expect(report.updatedCount).to.equal(0);
    expect(report.skippedCount).to.equal(1);
    expect(report.perJobOrder[0].outcome).to.equal('skipped_status_changed');
  });
});

// ─────────────────────────────────────────────────────────────────────
// **R.16.1.1** — National-Account fanout + previousValue filter.
//
// Two new behaviors under test:
//   1. `runPreviewPushToActive` walks `recruiterAccountId ∈
//      [accountId, ...childAccountIds]`, chunked at 30 per
//      Firestore `in`-clause cap. National's own JOs + every child
//      account's JOs land in one report.
//   2. When the caller supplies `previousValue`, only JOs whose
//      snapshot matches it are eligible to push. JOs whose snapshot
//      diverges (likely a child-level override or already-pushed)
//      are flagged `previous_value_mismatch` and disabled in the
//      dialog. Defense-in-depth gate also lives in
//      `writePushToActiveOne`.
// ─────────────────────────────────────────────────────────────────────

describe('chunkIds — Firestore `in` cap helper', () => {
  it('returns empty list for empty input', () => {
    expect(chunkIds([])).to.deep.equal([]);
  });
  it('packs ≤size into a single chunk', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const chunks = chunkIds(ids, 30);
    expect(chunks.length).to.equal(1);
    expect(chunks[0].length).to.equal(30);
  });
  it('boundary at exact multiple', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const chunks = chunkIds(ids, 30);
    expect(chunks.length).to.equal(2);
    expect(chunks[0].length).to.equal(30);
    expect(chunks[1].length).to.equal(30);
  });
  it('splits >size into chunks of size + remainder', () => {
    const ids = Array.from({ length: 31 }, (_, i) => `c${i}`);
    const chunks = chunkIds(ids, 30);
    expect(chunks.length).to.equal(2);
    expect(chunks[0].length).to.equal(30);
    expect(chunks[1].length).to.equal(1);
  });
  it('rejects size <= 0', () => {
    expect(() => chunkIds([1, 2, 3], 0)).to.throw(/chunk size/);
  });
});

describe('resolveAccountFanoutIds — National fanout walker', () => {
  it('returns [accountId] when the account doc is missing', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ids = await resolveAccountFanoutIds(fdb, TENANT, ACCOUNT);
    expect(ids).to.deep.equal([ACCOUNT]);
  });

  it('returns [accountId] when childAccountIds is missing/empty', async () => {
    const state = newState();
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      name: 'Solo Acct',
      childAccountIds: [],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ids = await resolveAccountFanoutIds(fdb, TENANT, ACCOUNT);
    expect(ids).to.deep.equal([ACCOUNT]);
  });

  it('returns parent + children, deduped + sorted', async () => {
    const state = newState();
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      name: 'National',
      childAccountIds: ['c2', 'c1', 'c1'],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ids = await resolveAccountFanoutIds(fdb, TENANT, ACCOUNT);
    expect(ids).to.deep.equal([ACCOUNT, 'c1', 'c2'].sort());
  });

  it('drops non-string and empty entries', async () => {
    const state = newState();
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      name: 'National',
      childAccountIds: ['c1', '', null, 42, 'c2'],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const ids = await resolveAccountFanoutIds(fdb, TENANT, ACCOUNT);
    expect(ids.sort()).to.deep.equal([ACCOUNT, 'c1', 'c2'].sort());
  });
});

describe('runPreviewPushToActive — National fanout (R.16.1.1)', () => {
  /**
   * Build a fake Firestore with one National + N child accounts and
   * one open JO under each (parent + every child). Each JO's
   * snapshot starts at `eVerifyRequired = false` so a push to
   * `true` would change them all.
   */
  function setupFanout(numChildren: number) {
    const state = newState();
    const childIds = Array.from({ length: numChildren }, (_, i) => `child_${i + 1}`);
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      name: 'National',
      childAccountIds: childIds,
    });
    // Parent JO
    state.store.set(`tenants/${TENANT}/job_orders/jo_parent`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: false }),
    });
    // One JO per child
    for (const cid of childIds) {
      state.store.set(`tenants/${TENANT}/job_orders/jo_${cid}`, {
        recruiterAccountId: cid,
        status: 'open',
        snapshot: baseSnap({ eVerifyRequired: false }),
      });
    }
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    return { state, fdb, childIds };
  }

  it('single-child National: 1 parent JO + 1 child JO both surface', async () => {
    const { fdb } = setupFanout(1);
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    expect(report.totals.totalScanned).to.equal(2);
    expect(report.totals.eligible).to.equal(2);
    expect(report.totals.wouldChange).to.equal(2);
    const ids = report.affectedJobOrders.map((r) => r.jobOrderId).sort();
    expect(ids).to.deep.equal(['jo_child_1', 'jo_parent']);
  });

  it('30-child boundary: single chunk handles all 31 JOs', async () => {
    const { fdb } = setupFanout(29); // 1 parent + 29 children = 30 ids — exactly one chunk
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    expect(report.totals.totalScanned).to.equal(30);
    expect(report.totals.wouldChange).to.equal(30);
  });

  it('31-child case: chunked into two queries, both batches included', async () => {
    const { fdb } = setupFanout(30); // 1 parent + 30 children = 31 ids — two chunks
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    // 1 parent + 30 children = 31 JOs total.
    expect(report.totals.totalScanned).to.equal(31);
    expect(report.totals.wouldChange).to.equal(31);
    // Make sure no JO is double-counted from chunk overlap.
    const idSet = new Set(report.affectedJobOrders.map((r) => r.jobOrderId));
    expect(idSet.size).to.equal(31);
  });

  it('does not pull JOs from accounts NOT in the National’s child set', async () => {
    const { state, fdb } = setupFanout(2);
    // An unrelated account's JO that should never appear.
    state.store.set(`tenants/${TENANT}/job_orders/jo_outsider`, {
      recruiterAccountId: 'unrelated_acct',
      status: 'open',
      snapshot: baseSnap({ eVerifyRequired: false }),
    });
    const validated: ValidatedPushArgs = {
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'eVerifyRequired',
      positionId: null,
      newValue: true,
      selectedJoIds: [],
      reason: '',
    };
    const report = await runPreviewPushToActive({ validated, fdb });
    const ids = report.affectedJobOrders.map((r) => r.jobOrderId);
    expect(ids).to.not.include('jo_outsider');
    expect(report.totals.totalScanned).to.equal(3);
  });
});

describe('runPreviewPushToActive — previousValue filter (R.16.1.1)', () => {
  /**
   * Three JOs under one National Account, all `open`. Their
   * snapshots vary so the previousValue filter has something to
   * decide on:
   *   - jo_inherited:  snapshot value = OLD  (matches previousValue)
   *   - jo_overridden: snapshot value = WEIRD (doesn't match anything)
   *   - jo_already:    snapshot value = NEW  (already on the new value)
   */
  function setupPrevValue() {
    const state = newState();
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      name: 'National',
      childAccountIds: [],
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_inherited`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_OLD' }),
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_overridden`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_CHILD_OVERRIDE' }),
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_already`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_NEW' }),
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    return { state, fdb };
  }

  it('without previousValue: legacy V1 behavior — every diff is a wouldChange', async () => {
    const { fdb } = setupPrevValue();
    const validated = makeValidated({
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      selectedJoIds: [],
      reason: '',
    });
    const report = await runPreviewPushToActive({ validated, fdb });
    // jo_inherited (OLD→NEW) and jo_overridden (WEIRD→NEW) both
    // would change; jo_already (NEW→NEW) matches. No previousValue
    // filter, so the override is included.
    expect(report.totals.wouldChange).to.equal(2);
    expect(report.totals.alreadyMatching).to.equal(1);
    expect(report.totals.previousValueMismatch).to.equal(0);
  });

  it('with previousValue: only inheriting JOs are eligible; overrides are flagged', async () => {
    const { fdb } = setupPrevValue();
    const validated = makeValidated({
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      previousValue: 'PKG_OLD',
      hasPreviousValue: true,
      selectedJoIds: [],
      reason: '',
    });
    const report = await runPreviewPushToActive({ validated, fdb });
    expect(report.totals.wouldChange).to.equal(1); // jo_inherited only
    expect(report.totals.alreadyMatching).to.equal(1); // jo_already
    expect(report.totals.previousValueMismatch).to.equal(1); // jo_overridden
    const overridden = report.affectedJobOrders.find(
      (r) => r.jobOrderId === 'jo_overridden',
    );
    expect(overridden?.wouldChange).to.equal(false);
    expect(overridden?.ineligibleReason).to.equal('previous_value_mismatch');
  });

  it('does NOT flag already-matching as previous_value_mismatch', async () => {
    const { fdb } = setupPrevValue();
    const validated = makeValidated({
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      previousValue: 'PKG_OLD',
      hasPreviousValue: true,
      selectedJoIds: [],
      reason: '',
    });
    const report = await runPreviewPushToActive({ validated, fdb });
    const already = report.affectedJobOrders.find((r) => r.jobOrderId === 'jo_already');
    expect(already?.wouldChange).to.equal(false);
    expect(already?.ineligibleReason).to.equal(undefined); // NOT flagged
  });

  it('treats null previousValue as a real value (cleared field push)', async () => {
    const state = newState();
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      childAccountIds: [],
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_was_null`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: null }),
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_was_set`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_OLD' }),
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const validated = makeValidated({
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      previousValue: null, // Account-level used to be cleared
      hasPreviousValue: true,
      selectedJoIds: [],
      reason: '',
    });
    const report = await runPreviewPushToActive({ validated, fdb });
    // jo_was_null inherited the null → eligible; jo_was_set has a
    // pre-existing override → flagged.
    const wasNull = report.affectedJobOrders.find(
      (r) => r.jobOrderId === 'jo_was_null',
    );
    const wasSet = report.affectedJobOrders.find((r) => r.jobOrderId === 'jo_was_set');
    expect(wasNull?.wouldChange).to.equal(true);
    expect(wasSet?.ineligibleReason).to.equal('previous_value_mismatch');
  });
});

describe('writePushToActiveOne — previousValue defense-in-depth (R.16.1.1)', () => {
  it('aborts the txn write when snapshot diverged from previousValue mid-flight', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo_raced', {
      status: 'open',
      // Snapshot is now PKG_CHILD_OVERRIDE (someone overrode it).
      snapshot: baseSnap({ screeningPackageId: 'PKG_CHILD_OVERRIDE' }),
    });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo_raced',
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      previousValue: 'PKG_OLD', // expected the snapshot to be PKG_OLD
      hasPreviousValue: true,
      fdb,
    });
    expect(out.kind).to.equal('skipped_not_eligible');
    if (out.kind === 'skipped_not_eligible') {
      expect(out.reason).to.equal('previous_value_mismatch');
    }
    expect(state.writes.length).to.equal(0);
  });

  it('writes when snapshot matches previousValue', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo_clean', {
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_OLD' }),
    });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo_clean',
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      previousValue: 'PKG_OLD',
      hasPreviousValue: true,
      fdb,
    });
    expect(out.kind).to.equal('pushed');
  });

  it('legacy callers (no previousValue) keep V1 behavior', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    seedJo(state, 'jo_legacy', {
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_RANDOM' }),
    });
    const out = await writePushToActiveOne({
      tenantId: TENANT,
      jobOrderId: 'jo_legacy',
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      // No previousValue / hasPreviousValue — legacy call shape.
      fdb,
    });
    expect(out.kind).to.equal('pushed');
  });
});

describe('runPushToActivePage — fanout + previousValue end-to-end (R.16.1.1)', () => {
  it('writes only inheriting child JOs; overrides remain untouched', async () => {
    const state = newState();
    state.store.set(`tenants/${TENANT}/accounts/${ACCOUNT}`, {
      childAccountIds: ['c1', 'c2'],
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_parent`, {
      recruiterAccountId: ACCOUNT,
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_OLD' }),
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_c1`, {
      recruiterAccountId: 'c1',
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_OLD' }),
    });
    state.store.set(`tenants/${TENANT}/job_orders/jo_c2_overridden`, {
      recruiterAccountId: 'c2',
      status: 'open',
      snapshot: baseSnap({ screeningPackageId: 'PKG_C2_OVERRIDE' }),
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const validated = makeValidated({
      tenantId: TENANT,
      accountId: ACCOUNT,
      fieldKey: 'screeningPackageId',
      positionId: null,
      newValue: 'PKG_NEW',
      previousValue: 'PKG_OLD',
      hasPreviousValue: true,
      selectedJoIds: ['jo_parent', 'jo_c1', 'jo_c2_overridden'],
      reason: 'CORT screening update',
    });
    const report = await runPushToActivePage({
      validated,
      triggeredBy: 'admin_uid',
      fdb,
    });
    expect(report.updatedCount).to.equal(2);
    expect(report.skippedCount).to.equal(1);
    const overriddenRow = report.perJobOrder.find(
      (r) => r.jobOrderId === 'jo_c2_overridden',
    );
    expect(overriddenRow?.outcome).to.equal('skipped_not_eligible');
    expect(overriddenRow?.skipReason).to.equal('previous_value_mismatch');
    // The child override doc is NOT mutated.
    const overriddenSnap = (
      state.store.get(`tenants/${TENANT}/job_orders/jo_c2_overridden`) as Record<
        string,
        unknown
      >
    ).snapshot as Record<string, unknown>;
    expect(overriddenSnap.screeningPackageId).to.equal('PKG_C2_OVERRIDE');
  });
});
