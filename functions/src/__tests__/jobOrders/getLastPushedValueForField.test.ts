/**
 * **R.16.3 (interim — Path 1 / Option B)** — Unit tests for the
 * "Sync to active" lookup callable.
 *
 * Covers:
 *   1. `validateLookupArgs` — input gating (mirrors `validatePushArgs`
 *      gating but relaxed: no `selectedJoIds` / `reason` / `newValue`).
 *   2. `lookupLastPushedValue` — audit-log scan semantics:
 *        - Returns `hasHistory: false` on empty log.
 *        - Picks the most recent matching `push_to_active_summary` row
 *          (ordering trusted from Firestore).
 *        - Filters by `(accountId, fieldKey, positionId)` — top-level
 *          lookups don't match per-position rows and vice versa.
 *        - Normalizes missing `pushedField.positionId` (top-level
 *          summaries) to `null`.
 *        - Falls back to `data.newValue` when `pushedField.value` is
 *          absent (defensive — older summary writes).
 *        - Returns `previousValue: null` when the matched row stored
 *          a `null` push (e.g. clearing a screening package).
 *
 * Mocha + Chai. Run via:
 *   ./node_modules/.bin/mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/getLastPushedValueForField.test.ts'
 *
 * Why no end-to-end callable test (auth + onCall wrapper):
 *   - The auth gate is exercised by the existing
 *     `pushToActive.test.ts` callable suite via the shared
 *     `gatePushCallable` (now exported). Re-running it here would
 *     duplicate without adding signal.
 *   - The onCall wrapper is a thin adapter; the validation +
 *     business logic are covered through the pure helpers.
 *
 * @see docs/CASCADE_R16.3_HANDOFF.md (Path 1 notes)
 */

import { expect } from 'chai';

import {
  lookupLastPushedValue,
  validateLookupArgs,
  type ValidatedLookupArgs,
} from '../../jobOrders/getLastPushedValueForField';

const TENANT = 't1';
const ACCOUNT = 'acct_1';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — minimal `where` + `orderBy` + `limit` query builder
// that walks an in-memory array. Used only by `lookupLastPushedValue`,
// which calls `.collection().where().where().orderBy().limit().get()`.
// ─────────────────────────────────────────────────────────────────────

interface AuditRow {
  action?: string;
  accountId?: string;
  pushedField?: { fieldKey?: string; positionId?: string | null; value?: unknown } | null;
  newValue?: unknown;
  timestamp?: Date | { toDate: () => Date };
  reason?: string;
}

interface FakeFs {
  collection: (path: string) => unknown;
}

function makeFakeFirestore(rows: AuditRow[]): FakeFs {
  function makeQuery(filters: Array<{ field: string; op: '=='; value: unknown }>, order?: { field: string; dir: 'desc' }, lim?: number) {
    return {
      where(field: string, op: '==', value: unknown) {
        return makeQuery([...filters, { field, op, value }], order, lim);
      },
      orderBy(field: string, dir: 'desc') {
        return makeQuery(filters, { field, dir }, lim);
      },
      limit(n: number) {
        return makeQuery(filters, order, n);
      },
      async get() {
        let matched = rows.filter((r) => {
          return filters.every((f) => (r as unknown as Record<string, unknown>)[f.field] === f.value);
        });
        if (order) {
          matched = [...matched].sort((a, b) => {
            const av = (a as unknown as Record<string, unknown>)[order.field];
            const bv = (b as unknown as Record<string, unknown>)[order.field];
            const ad = av instanceof Date ? av.getTime() : 0;
            const bd = bv instanceof Date ? bv.getTime() : 0;
            return order.dir === 'desc' ? bd - ad : ad - bd;
          });
        }
        if (lim !== undefined) matched = matched.slice(0, lim);
        const docs = matched.map((r) => ({ data: () => r }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }

  return {
    collection(_path: string) {
      return makeQuery([]);
    },
  };
}

const baseValidated = (overrides: Partial<ValidatedLookupArgs> = {}): ValidatedLookupArgs => ({
  tenantId: TENANT,
  accountId: ACCOUNT,
  fieldKey: 'screeningPackageId',
  positionId: null,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────
// 1. validateLookupArgs
// ─────────────────────────────────────────────────────────────────────

describe('validateLookupArgs — input gating', () => {
  const baseInput = {
    tenantId: TENANT,
    accountId: ACCOUNT,
    fieldKey: 'screeningPackageId',
    positionId: null,
  };

  it('accepts a top-level field with positionId omitted', () => {
    const out = validateLookupArgs(baseInput);
    expect(out.fieldKey).to.equal('screeningPackageId');
    expect(out.positionId).to.equal(null);
  });

  it('accepts a per-position field with positionId set', () => {
    const out = validateLookupArgs({
      ...baseInput,
      fieldKey: 'payRate',
      positionId: 'p1',
    });
    expect(out.fieldKey).to.equal('payRate');
    expect(out.positionId).to.equal('p1');
  });

  it('rejects empty tenantId', () => {
    expect(() => validateLookupArgs({ ...baseInput, tenantId: '' })).to.throw(/tenantId/);
  });

  it('rejects empty accountId', () => {
    expect(() => validateLookupArgs({ ...baseInput, accountId: '' })).to.throw(/accountId/);
  });

  it('rejects unknown fieldKey', () => {
    // R.16.2c promoted `physicalRequirements` (and 4 other fields) to
    // the push surface; pick a key that is not any registered policy
    // field as the "definitely unknown" sample.
    expect(() =>
      validateLookupArgs({ ...baseInput, fieldKey: 'totallyMadeUpField_xyz' }),
    ).to.throw(/not push-eligible/);
  });

  it('rejects per-position field without positionId', () => {
    expect(() =>
      validateLookupArgs({ ...baseInput, fieldKey: 'payRate' }),
    ).to.throw(/positionId is required/);
  });

  it('rejects top-level field with positionId set', () => {
    expect(() =>
      validateLookupArgs({
        ...baseInput,
        fieldKey: 'hiringEntityId',
        positionId: 'p1',
      }),
    ).to.throw(/positionId must be omitted/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. lookupLastPushedValue — audit-log scan
// ─────────────────────────────────────────────────────────────────────

describe('lookupLastPushedValue — audit-log scan', () => {
  it('returns hasHistory:false when no audit rows exist', async () => {
    const fdb = makeFakeFirestore([]);
    const result = await lookupLastPushedValue({
      validated: baseValidated(),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result).to.deep.equal({
      previousValue: null,
      lastPushedAt: null,
      hasHistory: false,
    });
  });

  it('picks the most-recent matching summary row', async () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-04-01T00:00:00Z');
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'screeningPackageId', positionId: null, value: 'PKG_OLD' },
        timestamp: older,
      },
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'screeningPackageId', positionId: null, value: 'PKG_NEWER' },
        timestamp: newer,
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated(),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result.hasHistory).to.equal(true);
    expect(result.previousValue).to.equal('PKG_NEWER');
    expect(result.lastPushedAt).to.equal(newer.toISOString());
  });

  it('filters by fieldKey — wrong field returns no history', async () => {
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'hiringEntityId', positionId: null, value: 'HE_X' },
        timestamp: new Date('2026-04-01T00:00:00Z'),
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated({ fieldKey: 'screeningPackageId' }),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result.hasHistory).to.equal(false);
  });

  it('filters by positionId — top-level lookup ignores per-position rows', async () => {
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'payRate', positionId: 'p1', value: 22 },
        timestamp: new Date('2026-04-01T00:00:00Z'),
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated({ fieldKey: 'screeningPackageId' }),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    // No match for screeningPackageId / null positionId.
    expect(result.hasHistory).to.equal(false);
  });

  it('filters by positionId — per-position lookup ignores top-level rows', async () => {
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'payRate', positionId: null, value: 22 },
        timestamp: new Date('2026-04-01T00:00:00Z'),
      },
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'payRate', positionId: 'p2', value: 25 },
        timestamp: new Date('2026-04-02T00:00:00Z'),
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated({ fieldKey: 'payRate', positionId: 'p2' }),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result.hasHistory).to.equal(true);
    expect(result.previousValue).to.equal(25);
  });

  it('normalizes missing pushedField.positionId to null for top-level matches', async () => {
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        // Note: positionId omitted entirely (older writes pre-R.16.1.1
        // may have stored top-level rows without an explicit `null`).
        pushedField: { fieldKey: 'hiringEntityId', value: 'HE_42' },
        timestamp: new Date('2026-04-01T00:00:00Z'),
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated({ fieldKey: 'hiringEntityId' }),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result.hasHistory).to.equal(true);
    expect(result.previousValue).to.equal('HE_42');
  });

  it('falls back to data.newValue when pushedField.value is absent', async () => {
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'screeningPackageId', positionId: null },
        newValue: 'PKG_FALLBACK',
        timestamp: new Date('2026-04-01T00:00:00Z'),
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated(),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result.hasHistory).to.equal(true);
    expect(result.previousValue).to.equal('PKG_FALLBACK');
  });

  it('returns previousValue:null when the matched row stored a null push', async () => {
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        // Operator deliberately cleared the screening package on the
        // last push. `previousValue: null` is the right "old value"
        // for the next sync — not the absence of history.
        pushedField: { fieldKey: 'screeningPackageId', positionId: null, value: null },
        timestamp: new Date('2026-04-01T00:00:00Z'),
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated(),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    expect(result.hasHistory).to.equal(true);
    expect(result.previousValue).to.equal(null);
  });

  it('serializes Firestore Timestamp via .toDate() into ISO string', async () => {
    const date = new Date('2026-03-15T12:00:00Z');
    const tsLike = { toDate: () => date };
    const fdb = makeFakeFirestore([
      {
        action: 'push_to_active_summary',
        accountId: ACCOUNT,
        pushedField: { fieldKey: 'screeningPackageId', positionId: null, value: 'PKG_T' },
        timestamp: tsLike,
      },
    ]);
    const result = await lookupLastPushedValue({
      validated: baseValidated(),
      fdb: fdb as unknown as import('firebase-admin').firestore.Firestore,
    });
    // Note: the fake doesn't sort by toDate-style timestamps (only Date),
    // but for a single-row fixture the sort is a no-op and the
    // ISO serialization still goes through the .toDate() branch.
    expect(result.hasHistory).to.equal(true);
    expect(result.lastPushedAt).to.equal(date.toISOString());
  });
});
