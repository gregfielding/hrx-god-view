/**
 * Tests for the National → Children + JOs hiring entity sync.
 *
 * Two layers:
 *   1. `decideHiringEntitySyncForDoc` — pure rule (fill empties only,
 *      no overwrites, distinguish "same" from "different" for clean
 *      audit-log buckets).
 *   2. `runSyncHiringEntityFromNationalAccount` — full per-tenant pass:
 *      validates the National, walks children, then JOs per child +
 *      direct under the National, with per-doc audit entries.
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  decideHiringEntitySyncForDoc,
  runSyncHiringEntityFromNationalAccount,
} from '../../jobOrders/syncHiringEntityFromNationalAccount';
import {
  type FakeState,
  installFieldValueStubs,
  makeFakeFirestore,
  newState,
} from './_fakeFirestore';

installFieldValueStubs();

// ─────────────────────────────────────────────────────────────────────
// 1. Pure decision
// ─────────────────────────────────────────────────────────────────────

describe('decideHiringEntitySyncForDoc', () => {
  const NAT = 'entity_select';

  it('updates when current value is null', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: null,
      nationalHiringEntityId: NAT,
    });
    expect(result).to.deep.equal({ kind: 'update', previous: null });
  });

  it('updates when current value is undefined', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: undefined,
      nationalHiringEntityId: NAT,
    });
    expect(result).to.deep.equal({ kind: 'update', previous: null });
  });

  it('updates when current value is empty string', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: '',
      nationalHiringEntityId: NAT,
    });
    expect(result).to.deep.equal({ kind: 'update', previous: null });
  });

  it('updates when current value is whitespace (defensive)', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: '   ',
      nationalHiringEntityId: NAT,
    });
    expect(result).to.deep.equal({ kind: 'update', previous: null });
  });

  it('skips with "same value" bucket when value already matches', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: NAT,
      nationalHiringEntityId: NAT,
    });
    expect(result).to.deep.equal({
      kind: 'skip_same_value',
      previous: NAT,
    });
  });

  it('skips with "existing" bucket when value differs (preserve manual override)', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: 'entity_events_llc',
      nationalHiringEntityId: NAT,
    });
    expect(result).to.deep.equal({
      kind: 'skip_existing',
      previous: 'entity_events_llc',
    });
  });

  it('trims whitespace before comparison', () => {
    const result = decideHiringEntitySyncForDoc({
      currentValue: `  ${NAT}  `,
      nationalHiringEntityId: NAT,
    });
    expect(result.kind).to.equal('skip_same_value');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Runner — full sweep
// ─────────────────────────────────────────────────────────────────────

interface Seeds {
  national?: { hiringEntityId?: string | null; accountType?: string };
  children?: Array<{
    id: string;
    name?: string;
    hiringEntityId?: string | null;
  }>;
  jobOrders?: Array<{
    id: string;
    recruiterAccountId: string;
    hiringEntityId?: string | null;
    jobOrderName?: string;
  }>;
}

function seed(state: FakeState, seeds: Seeds = {}): {
  tenantId: string;
  nationalAccountId: string;
} {
  const tenantId = 't1';
  const nationalAccountId = 'acc_parent';

  // Default the entity to `'entity_select'` ONLY when the seed didn't
  // explicitly provide a value. We use the `'hiringEntityId' in n` check
  // (rather than `?? 'entity_select'`) so a deliberate `null` is honored
  // — the "national without an entity" failure-precondition test needs it.
  const n = seeds.national ?? {};
  const explicitEntity = 'hiringEntityId' in n;
  state.store.set(`tenants/${tenantId}/accounts/${nationalAccountId}`, {
    name: 'CORT',
    accountType: n.accountType ?? 'national',
    hiringEntityId: explicitEntity ? n.hiringEntityId : 'entity_select',
  });

  for (const c of seeds.children ?? []) {
    state.store.set(`tenants/${tenantId}/accounts/${c.id}`, {
      name: c.name ?? c.id,
      accountType: 'child',
      parentAccountId: nationalAccountId,
      hiringEntityId: c.hiringEntityId ?? null,
    });
  }

  for (const jo of seeds.jobOrders ?? []) {
    state.store.set(`tenants/${tenantId}/job_orders/${jo.id}`, {
      jobOrderName: jo.jobOrderName ?? jo.id,
      recruiterAccountId: jo.recruiterAccountId,
      hiringEntityId: jo.hiringEntityId ?? null,
    });
  }

  return { tenantId, nationalAccountId };
}

describe('runSyncHiringEntityFromNationalAccount', () => {
  it('updates children + JOs that have no hiringEntityId', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      children: [{ id: 'acc_a' }, { id: 'acc_b' }],
      jobOrders: [
        { id: 'jo1', recruiterAccountId: 'acc_a' },
        { id: 'jo2', recruiterAccountId: 'acc_b' },
        // Direct under national (`seed()` pins this id to 'acc_parent'):
        { id: 'jo3', recruiterAccountId: 'acc_parent' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSyncHiringEntityFromNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.nationalHiringEntityId).to.equal('entity_select');
    expect(result.summary.childAccountsScanned).to.equal(2);
    expect(result.summary.childAccountsUpdated).to.equal(2);
    expect(result.summary.childAccountsSkipped).to.equal(0);
    expect(result.summary.jobOrdersScanned).to.equal(3);
    expect(result.summary.jobOrdersUpdated).to.equal(3);

    // All five docs now have entity_select.
    for (const id of ['acc_a', 'acc_b']) {
      const doc = state.store.get(`tenants/t1/accounts/${id}`) as {
        hiringEntityId: string;
      };
      expect(doc.hiringEntityId).to.equal('entity_select');
    }
    for (const id of ['jo1', 'jo2', 'jo3']) {
      const doc = state.store.get(`tenants/t1/job_orders/${id}`) as {
        hiringEntityId: string;
      };
      expect(doc.hiringEntityId).to.equal('entity_select');
    }
  });

  it('preserves children + JOs with custom hiring entity (fill-empty)', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      children: [
        { id: 'acc_a' }, // empty → updated
        { id: 'acc_b', hiringEntityId: 'entity_events_llc' }, // custom → preserved
      ],
      jobOrders: [
        { id: 'jo1', recruiterAccountId: 'acc_a' }, // empty → updated
        {
          id: 'jo2',
          recruiterAccountId: 'acc_b',
          hiringEntityId: 'entity_workforce',
        }, // custom → preserved
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSyncHiringEntityFromNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.childAccountsUpdated).to.equal(1);
    expect(result.summary.childAccountsSkipped).to.equal(1);
    expect(result.summary.jobOrdersUpdated).to.equal(1);
    expect(result.summary.jobOrdersSkipped).to.equal(1);

    // Custom values untouched.
    expect(
      (state.store.get('tenants/t1/accounts/acc_b') as { hiringEntityId: string })
        .hiringEntityId,
    ).to.equal('entity_events_llc');
    expect(
      (state.store.get('tenants/t1/job_orders/jo2') as { hiringEntityId: string })
        .hiringEntityId,
    ).to.equal('entity_workforce');

    // Empty values filled.
    expect(
      (state.store.get('tenants/t1/accounts/acc_a') as { hiringEntityId: string })
        .hiringEntityId,
    ).to.equal('entity_select');
    expect(
      (state.store.get('tenants/t1/job_orders/jo1') as { hiringEntityId: string })
        .hiringEntityId,
    ).to.equal('entity_select');
  });

  it('counts already-matching docs as skipped (and does not re-write them)', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      children: [
        { id: 'acc_a', hiringEntityId: 'entity_select' }, // already matches
      ],
      jobOrders: [
        {
          id: 'jo1',
          recruiterAccountId: 'acc_a',
          hiringEntityId: 'entity_select',
        }, // already matches
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSyncHiringEntityFromNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.childAccountsUpdated).to.equal(0);
    expect(result.summary.childAccountsSkipped).to.equal(1);
    expect(result.summary.jobOrdersUpdated).to.equal(0);
    expect(result.summary.jobOrdersSkipped).to.equal(1);

    // No update writes happened (state.updates only tracks `.update()` calls).
    const updateWrites = state.updates.filter(
      (u) =>
        u.path === 'tenants/t1/accounts/acc_a' ||
        u.path === 'tenants/t1/job_orders/jo1',
    );
    expect(updateWrites).to.have.lengthOf(0);

    // Audit entries record the bucket so the UI can show "X already matched".
    const childAudit = result.audit.find(
      (a) => a.kind === 'child_account' && a.docId === 'acc_a',
    );
    expect(childAudit?.action).to.equal('skipped_same_value');
    expect(childAudit?.reason).to.equal('already_matches_national');
  });

  it('handles a national with no children + no JOs (no-op pass)', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSyncHiringEntityFromNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.childAccountsScanned).to.equal(0);
    expect(result.summary.jobOrdersScanned).to.equal(0);
    expect(result.audit).to.have.lengthOf(0);
  });

  it('throws not-found when the national account doc is missing', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    let caught: Error | null = null;
    try {
      await runSyncHiringEntityFromNationalAccount({
        db: fdb,
        tenantId: 't1',
        nationalAccountId: 'acc_missing',
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).to.match(/not found/i);
  });

  it('throws failed-precondition when account is not a National', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      national: { accountType: 'standalone' },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    let caught: Error | null = null;
    try {
      await runSyncHiringEntityFromNationalAccount({
        db: fdb,
        tenantId,
        nationalAccountId,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).to.match(/National Account/);
  });

  it('throws failed-precondition when National has no hiring entity set', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      national: { hiringEntityId: null },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    let caught: Error | null = null;
    try {
      await runSyncHiringEntityFromNationalAccount({
        db: fdb,
        tenantId,
        nationalAccountId,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).to.match(/no hiring entity/i);
  });

  it('writes an audit entry for each scanned doc', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      children: [
        { id: 'acc_a' },
        { id: 'acc_b', hiringEntityId: 'entity_events_llc' },
      ],
      jobOrders: [{ id: 'jo1', recruiterAccountId: 'acc_a' }],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSyncHiringEntityFromNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.audit).to.have.lengthOf(3);
    const byKind = result.audit.reduce(
      (acc, e) => {
        acc[e.kind] = (acc[e.kind] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(byKind).to.deep.equal({ child_account: 2, job_order: 1 });
  });

  it('finds JOs directly under the National (not just under children)', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seed(state, {
      children: [],
      jobOrders: [
        { id: 'jo_direct', recruiterAccountId: 'acc_parent' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runSyncHiringEntityFromNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.jobOrdersScanned).to.equal(1);
    expect(result.summary.jobOrdersUpdated).to.equal(1);
    expect(
      (state.store.get('tenants/t1/job_orders/jo_direct') as {
        hiringEntityId: string;
      }).hiringEntityId,
    ).to.equal('entity_select');
  });
});
