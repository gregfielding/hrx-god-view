/**
 * **R.4.2-F3 (2026-04-29)** — assignment status-spelling normalizer tests.
 *
 * Three layers under test:
 *   1. `shouldNormalizeAssignmentStatus` — pure filter logic.
 *      Confirms the normalizer matches ONLY the exact `'canceled'`
 *      literal and leaves every other variant alone (including the
 *      already-canonical `'cancelled'`, casing variants, and unrelated
 *      statuses).
 *   2. `runNormalizeAssignmentStatusSpellingPage` — page driver.
 *      Confirms idempotency (re-run reports `written: 0`,
 *      `skipped_already_canonical: scanned`), audit emission per
 *      rewrite, and dry-run no-write contract.
 *   3. Audit action — every rewrite writes a `'normalize_status_spelling'`
 *      row to `tenants/{tid}/cascadeAuditLog` with the before/after
 *      strings populated.
 *
 * Mocha + Chai. Run via:
 *   cd functions && npm test -- --grep 'R.4.2-F3'
 *
 * @see docs/R4_2_FOLLOWUPS.md §R.4.2-F3
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  runNormalizeAssignmentStatusSpellingPage,
  shouldNormalizeAssignmentStatus,
  STATUS_SPELLING_SOURCE,
  STATUS_SPELLING_TARGET,
} from '../../jobOrders/normalizeAssignmentStatusSpellingCallable';

// ─────────────────────────────────────────────────────────────────────
// Fake Firestore — minimal subset needed for the page driver:
// orderBy(documentId).limit().get(), single doc set({...}, {merge}),
// and `add()` on the cascadeAuditLog collection.
// ─────────────────────────────────────────────────────────────────────

interface FakeState {
  store: Map<string, Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  autoIdSeq: number;
}

function newState(): FakeState {
  return { store: new Map(), audits: [], autoIdSeq: 0 };
}

function makeFakeFirestore(state: FakeState): unknown {
  const FieldPath = { documentId: () => '__name__' };
  const FieldValue = { serverTimestamp: () => ({ __ts: true }) };

  function makeDocRef(path: string): unknown {
    return {
      id: path.split('/').pop(),
      path,
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
        const existing = state.store.get(path) ?? {};
        if (opts?.merge) state.store.set(path, { ...existing, ...data });
        else state.store.set(path, { ...data });
      },
      async get(): Promise<unknown> {
        const data = state.store.get(path);
        return {
          exists: data !== undefined,
          id: path.split('/').pop(),
          ref: makeDocRef(path),
          data: () => data,
        };
      },
    };
  }

  function makeQueryRef(
    collectionPath: string,
    opts: { startAfter?: string; limit?: number } = {},
  ): unknown {
    const ref = {
      orderBy(_field: string) {
        // Documents are stored under `${collectionPath}/${id}`; we
        // sort by the trailing id segment.
        return ref;
      },
      limit(n: number) {
        return makeQueryRef(collectionPath, { ...opts, limit: n });
      },
      startAfter(token: string) {
        return makeQueryRef(collectionPath, { ...opts, startAfter: token });
      },
      async get(): Promise<unknown> {
        const prefix = `${collectionPath}/`;
        const docs = Array.from(state.store.entries())
          .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        let filtered = docs;
        if (opts.startAfter) {
          filtered = docs.filter(
            ([k]) => k.slice(prefix.length) > (opts.startAfter as string),
          );
        }
        if (opts.limit !== undefined) filtered = filtered.slice(0, opts.limit);
        return {
          size: filtered.length,
          empty: filtered.length === 0,
          docs: filtered.map(([k, data]) => ({
            id: k.slice(prefix.length),
            ref: makeDocRef(k),
            data: () => data,
          })),
        };
      },
    };
    return ref;
  }

  function makeCollectionRef(collectionPath: string): unknown {
    return {
      doc(id: string) {
        return makeDocRef(`${collectionPath}/${id}`);
      },
      orderBy(_field: string) {
        return makeQueryRef(collectionPath);
      },
      where() {
        return makeQueryRef(collectionPath);
      },
      async add(data: Record<string, unknown>): Promise<unknown> {
        state.autoIdSeq += 1;
        const id = `auto_${state.autoIdSeq}`;
        const path = `${collectionPath}/${id}`;
        state.store.set(path, { ...data });
        if (collectionPath.endsWith('/cascadeAuditLog')) {
          state.audits.push({ ...data });
        }
        return makeDocRef(path);
      },
    };
  }

  return {
    collection(p: string) {
      return makeCollectionRef(p);
    },
    doc(p: string) {
      return makeDocRef(p);
    },
    FieldPath,
    FieldValue,
  };
}

// Stub firebase-admin's static `FieldPath.documentId()` /
// `FieldValue.serverTimestamp()` so the callable's references resolve
// against the fake.
(admin.firestore as unknown as Record<string, unknown>).FieldPath = {
  documentId: () => '__name__',
};
(admin.firestore as unknown as Record<string, unknown>).FieldValue = {
  serverTimestamp: () => ({ __ts: true }),
};

// ─────────────────────────────────────────────────────────────────────
// 1. shouldNormalizeAssignmentStatus — pure classifier.
// ─────────────────────────────────────────────────────────────────────

describe('R.4.2-F3 — shouldNormalizeAssignmentStatus filter logic', () => {
  it('matches the exact source literal', () => {
    expect(shouldNormalizeAssignmentStatus('canceled')).to.deep.equal({
      rewrite: true,
      before: 'canceled',
    });
  });

  it('leaves the canonical target alone (idempotency)', () => {
    expect(shouldNormalizeAssignmentStatus('cancelled')).to.deep.equal({
      rewrite: false,
      before: 'cancelled',
    });
  });

  it('does NOT match casing variants (separate hygiene issue)', () => {
    for (const v of ['Canceled', 'CANCELED', 'cAnCeLeD']) {
      expect(shouldNormalizeAssignmentStatus(v).rewrite).to.equal(
        false,
        `expected ${v} to be left untouched`,
      );
    }
  });

  it('does NOT match similar-looking strings', () => {
    for (const v of ['cancellation_pending', 'cancelled_by_worker', 'cancel', 'canceledd']) {
      expect(shouldNormalizeAssignmentStatus(v).rewrite).to.equal(
        false,
        `expected ${v} to be left untouched`,
      );
    }
  });

  it('does NOT match unrelated statuses', () => {
    for (const v of ['confirmed', 'proposed', 'declined', 'pending', 'completed', 'active']) {
      expect(shouldNormalizeAssignmentStatus(v).rewrite).to.equal(false);
    }
  });

  it('handles non-string inputs gracefully', () => {
    expect(shouldNormalizeAssignmentStatus(undefined)).to.deep.equal({
      rewrite: false,
      before: null,
    });
    expect(shouldNormalizeAssignmentStatus(null)).to.deep.equal({
      rewrite: false,
      before: null,
    });
    expect(shouldNormalizeAssignmentStatus(42)).to.deep.equal({
      rewrite: false,
      before: null,
    });
    expect(shouldNormalizeAssignmentStatus({})).to.deep.equal({
      rewrite: false,
      before: null,
    });
  });

  it('exports the canonical source/target literals', () => {
    expect(STATUS_SPELLING_SOURCE).to.equal('canceled');
    expect(STATUS_SPELLING_TARGET).to.equal('cancelled');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. runNormalizeAssignmentStatusSpellingPage — page driver.
// ─────────────────────────────────────────────────────────────────────

describe('R.4.2-F3 — runNormalizeAssignmentStatusSpellingPage', () => {
  const tid = 't_xform';

  it('dry-run reports candidates but writes nothing', async () => {
    const state = newState();
    state.store.set(`tenants/${tid}/assignments/a1`, { status: 'canceled' });
    state.store.set(`tenants/${tid}/assignments/a2`, { status: 'cancelled' });
    state.store.set(`tenants/${tid}/assignments/a3`, { status: 'confirmed' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: true,
      limit: 100,
      pageToken: null,
      fdb,
    });

    expect(report.scanned).to.equal(3);
    expect(report.candidates).to.equal(1);
    expect(report.wouldWrite).to.equal(1);
    expect(report.written).to.equal(0);
    expect(report.skipped_already_canonical).to.equal(2);
    expect(report.errors).to.have.lengthOf(0);
    expect(report.rewritten.map((r) => r.assignmentId)).to.deep.equal(['a1']);
    // Dry-run never modifies the store and never audits.
    expect(state.store.get(`tenants/${tid}/assignments/a1`)).to.deep.equal({
      status: 'canceled',
    });
    expect(state.audits).to.have.lengthOf(0);
  });

  it('write rewrites only the matching docs and emits audits', async () => {
    const state = newState();
    state.store.set(`tenants/${tid}/assignments/a1`, { status: 'canceled', other: 'keep' });
    state.store.set(`tenants/${tid}/assignments/a2`, { status: 'cancelled' });
    state.store.set(`tenants/${tid}/assignments/a3`, { status: 'confirmed' });
    state.store.set(`tenants/${tid}/assignments/a4`, { status: 'canceled' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: false,
      limit: 100,
      pageToken: null,
      fdb,
    });

    expect(report.candidates).to.equal(2);
    expect(report.written).to.equal(2);
    expect(report.wouldWrite).to.equal(0);
    expect(report.skipped_already_canonical).to.equal(2);
    expect(report.errors).to.have.lengthOf(0);
    // Rewrites land merge-style — `other` survives.
    const a1 = state.store.get(`tenants/${tid}/assignments/a1`);
    expect(a1?.status).to.equal('cancelled');
    expect(a1?.other).to.equal('keep');
    expect(a1?.updatedBy).to.equal('system');
    // Untouched docs stay untouched.
    expect(state.store.get(`tenants/${tid}/assignments/a3`)?.status).to.equal('confirmed');
    // Audit row per rewrite.
    expect(state.audits).to.have.lengthOf(2);
    for (const a of state.audits) {
      expect(a.action).to.equal('normalize_status_spelling');
      expect(a.tenantId).to.equal(tid);
      expect(a.beforeAssignmentStatus).to.equal('canceled');
      expect(a.afterAssignmentStatus).to.equal('cancelled');
      expect(a.context).to.match(/r4_2-f3/i);
    }
  });

  it('idempotent — second --no-dry-run after a successful write writes zero', async () => {
    const state = newState();
    state.store.set(`tenants/${tid}/assignments/a1`, { status: 'canceled' });
    state.store.set(`tenants/${tid}/assignments/a2`, { status: 'canceled' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const first = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: false,
      limit: 100,
      pageToken: null,
      fdb,
    });
    expect(first.written).to.equal(2);
    expect(state.audits).to.have.lengthOf(2);

    const second = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: false,
      limit: 100,
      pageToken: null,
      fdb,
    });
    expect(second.scanned).to.equal(2);
    expect(second.candidates).to.equal(0);
    expect(second.written).to.equal(0);
    expect(second.skipped_already_canonical).to.equal(2);
    // No new audit rows on the no-op pass.
    expect(state.audits).to.have.lengthOf(2);
  });

  it('reports truncated + nextPageToken when the page is full', async () => {
    const state = newState();
    state.store.set(`tenants/${tid}/assignments/a1`, { status: 'canceled' });
    state.store.set(`tenants/${tid}/assignments/a2`, { status: 'cancelled' });
    state.store.set(`tenants/${tid}/assignments/a3`, { status: 'canceled' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const report = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: true,
      limit: 2,
      pageToken: null,
      fdb,
    });
    expect(report.scanned).to.equal(2);
    expect(report.truncated).to.equal(true);
    expect(report.nextPageToken).to.equal('a2');

    const next = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: true,
      limit: 2,
      pageToken: report.nextPageToken,
      fdb,
    });
    expect(next.scanned).to.equal(1);
    expect(next.candidates).to.equal(1);
    expect(next.truncated).to.equal(false);
    expect(next.nextPageToken).to.equal(null);
  });

  it('handles a tenant with zero assignments cleanly', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;
    const report = await runNormalizeAssignmentStatusSpellingPage({
      tenantId: tid,
      dryRun: false,
      limit: 100,
      pageToken: null,
      fdb,
    });
    expect(report).to.include({
      scanned: 0,
      candidates: 0,
      written: 0,
      wouldWrite: 0,
      skipped_already_canonical: 0,
      truncated: false,
    });
    expect(report.errors).to.have.lengthOf(0);
  });
});
