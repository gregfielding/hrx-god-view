/**
 * **§14b — Backfill gig job orders callable tests.**
 *
 * Covers the core runner (`runBackfillGigJobOrdersForNationalAccount`)
 * which the callable wraps with auth gating. The auth gating itself is
 * a thin trampoline over the same `assertTenantStaff` helper used by
 * `backfillNationalAccountChildAccountsCallable` — no per-callable
 * tests needed.
 *
 * Tests cover:
 *   - Happy path: parent + N children with no existing JOs → N created
 *   - Idempotency: re-running creates 0, counts existing as `alreadyHad`
 *   - Mixed: some children have existing auto-JOs, others don't
 *   - Permission preconditions: missing parent / wrong type
 *   - Manual-child inclusion: the backfill includes manually-created
 *     children even though the trigger skips them (different intent)
 *   - Per-row failure isolation: one child throws, the rest still run
 *   - Audit list shape
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import { runBackfillGigJobOrdersForNationalAccount } from '../../jobOrders/backfillGigJobOrdersForNationalAccount';
import {
  type FakeState,
  installFieldValueStubs,
  makeFakeFirestore,
  newState,
} from './_fakeFirestore';

installFieldValueStubs();

// ─────────────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────────────

function seedTenantWithChildren(
  state: FakeState,
  args: {
    tenantId?: string;
    nationalAccountId?: string;
    children?: Array<{
      id: string;
      name?: string;
      autoCreatedFromCompanyLocation?: boolean;
      hasExistingAutoJo?: boolean;
    }>;
    accountTypeOverride?: string;
  } = {},
): { tenantId: string; nationalAccountId: string } {
  const tenantId = args.tenantId ?? 't1';
  const nationalAccountId = args.nationalAccountId ?? 'acc_parent';

  state.store.set(`tenants/${tenantId}/accounts/${nationalAccountId}`, {
    name: 'CORT',
    accountType: args.accountTypeOverride ?? 'national',
    hiringEntityId: 'entity_select',
    eVerifyRequired: true,
    workersCompCode: '8015',
    autoCreateGigJobOrders: true,
    orderDefaults: {
      screeningPackageId: 'PKG_CORT_BASIC',
      orderDetails: { additionalScreenings: ['mvr_check'] },
    },
    pricing: {
      positions: [
        {
          positionId: 'p_event',
          jobTitle: 'Event Worker',
          markupPercentage: 38,
        },
      ],
    },
    associations: { recruiterIds: ['recruiter_a'] },
  });

  const children = args.children ?? [];
  for (const c of children) {
    state.store.set(`tenants/${tenantId}/accounts/${c.id}`, {
      name: c.name ?? c.id,
      accountType: 'child',
      parentAccountId: nationalAccountId,
      autoCreatedFromCompanyLocation: c.autoCreatedFromCompanyLocation ?? true,
      companyId: 'company_cort',
      // no companyLocationId — placeholder JO; keeps the test focused
      // on the orchestrator's loop logic and not on worksite hydration.
      pricing: {
        positions: [
          {
            positionId: 'p_event',
            payRate: 18,
            billRate: 24.84,
            workersCompCode: '8015',
            workersCompRate: 9.15,
          },
        ],
      },
    });

    if (c.hasExistingAutoJo) {
      state.store.set(`tenants/${tenantId}/job_orders/jo_existing_${c.id}`, {
        jobOrderName: 'Pre-existing Auto JO',
        recruiterAccountId: c.id,
        autoCreatedFrom: 'autoCreateGigJobOrders',
        status: 'on_hold',
      });
    }
  }

  return { tenantId, nationalAccountId };
}

// ─────────────────────────────────────────────────────────────────────
// Happy path + idempotency
// ─────────────────────────────────────────────────────────────────────

describe('runBackfillGigJobOrdersForNationalAccount — happy path', () => {
  it('creates one gig JO per child account that doesn\'t have one yet', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [
        { id: 'acc_child_a', name: 'CORT Baltimore' },
        { id: 'acc_child_b', name: 'CORT Atlanta' },
        { id: 'acc_child_c', name: 'CORT Phoenix' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.totalChildAccounts).to.equal(3);
    expect(result.summary.created).to.equal(3);
    expect(result.summary.alreadyHad).to.equal(0);
    expect(result.summary.skipped).to.equal(0);

    // 3 new JO docs in store. (Plus the counter doc.)
    const newJoCount = Array.from(state.store.keys()).filter(
      (k) => k.startsWith(`tenants/${tenantId}/job_orders/`) && !k.includes('jo_existing_'),
    ).length;
    expect(newJoCount).to.equal(3);

    // Audit has one entry per child, all `created`, in deterministic order.
    expect(result.audit).to.have.lengthOf(3);
    for (const entry of result.audit) {
      expect(entry.action).to.equal('created');
      expect(entry.jobOrderId).to.be.a('string');
      expect(entry.jobOrderNumber).to.match(/^\d{4}$/);
    }
  });

  it('produces JOs marked with source: backfill', async () => {
    // The shared builder stamps `autoCreatedSource: 'backfill'` so the
    // audit trail can distinguish a JO created by automation from one
    // created by a manual backfill click. (Useful for triaging
    // `which-button-do-I-blame` questions.)
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [{ id: 'acc_child_a' }],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    const joWrites = state.writes.filter((w) =>
      w.path.startsWith(`tenants/${tenantId}/job_orders/`),
    );
    expect(joWrites).to.have.lengthOf(1);
    expect(joWrites[0].data.autoCreatedSource).to.equal('backfill');
    expect(joWrites[0].data.autoCreatedFrom).to.equal('autoCreateGigJobOrders');
  });

  it('is idempotent — re-running produces 0 new JOs', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [
        { id: 'acc_child_a', hasExistingAutoJo: true },
        { id: 'acc_child_b', hasExistingAutoJo: true },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.created).to.equal(0);
    expect(result.summary.alreadyHad).to.equal(2);
    expect(result.summary.skipped).to.equal(0);

    // No new JO docs added beyond the pre-existing ones.
    const joCount = Array.from(state.store.keys()).filter((k) =>
      k.startsWith(`tenants/${tenantId}/job_orders/`),
    ).length;
    expect(joCount).to.equal(2);

    for (const entry of result.audit) {
      expect(entry.action).to.equal('skipped_existing');
      expect(entry.reason).to.equal('auto_jo_already_present');
    }
  });

  it('handles a mixed batch — creates only for children without existing JOs', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [
        { id: 'acc_child_a', hasExistingAutoJo: false },
        { id: 'acc_child_b', hasExistingAutoJo: true },
        { id: 'acc_child_c', hasExistingAutoJo: false },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.totalChildAccounts).to.equal(3);
    expect(result.summary.created).to.equal(2);
    expect(result.summary.alreadyHad).to.equal(1);
    expect(result.summary.skipped).to.equal(0);

    const actions = result.audit.map((a) => `${a.childAccountId}:${a.action}`).sort();
    expect(actions).to.deep.equal([
      'acc_child_a:created',
      'acc_child_b:skipped_existing',
      'acc_child_c:created',
    ]);
  });

  it('includes manually-created children too (different from the trigger)', async () => {
    // Per spec: backfill scans ALL child accounts under the national,
    // including manually-created ones. Recovers organizations where
    // children were imported before the toggle existed.
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [
        { id: 'acc_child_auto', autoCreatedFromCompanyLocation: true },
        { id: 'acc_child_manual', autoCreatedFromCompanyLocation: false },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });

    expect(result.summary.created).to.equal(2);
    const ids = result.audit
      .filter((a) => a.action === 'created')
      .map((a) => a.childAccountId)
      .sort();
    expect(ids).to.deep.equal(['acc_child_auto', 'acc_child_manual']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Preconditions + error isolation
// ─────────────────────────────────────────────────────────────────────

describe('runBackfillGigJobOrdersForNationalAccount — guards', () => {
  it('throws not-found when the parent account doc is missing', async () => {
    const state = newState();
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    let caught: Error | null = null;
    try {
      await runBackfillGigJobOrdersForNationalAccount({
        db: fdb,
        tenantId: 't1',
        nationalAccountId: 'acc_missing',
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught, 'should throw').to.not.equal(null);
    expect(caught?.message).to.match(/not found/i);
  });

  it('throws failed-precondition when the account is not a National Account', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      accountTypeOverride: 'standalone',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    let caught: Error | null = null;
    try {
      await runBackfillGigJobOrdersForNationalAccount({
        db: fdb,
        tenantId,
        nationalAccountId,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught, 'should throw').to.not.equal(null);
    expect(caught?.message).to.match(/National Account/);
  });

  it('isolates per-row failures — one child throws, the rest still run', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [
        { id: 'acc_child_a' },
        { id: 'acc_child_BAD' },
        { id: 'acc_child_c' },
      ],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    // Inject a fake `createForChild` that throws for the bad row.
    let calls = 0;
    const result = await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
      createForChild: async (args: {
        childAccountId: string;
      }): Promise<{
        jobOrderId: string;
        jobOrderNumber: string;
        jobOrderSeq: number;
        assignedRecruiterUids: string[];
        childAccountName: string;
      } | null> => {
        calls += 1;
        if (args.childAccountId === 'acc_child_BAD') {
          throw new Error('synthetic failure');
        }
        return {
          jobOrderId: `jo_${args.childAccountId}`,
          jobOrderNumber: '0001',
          jobOrderSeq: 1,
          assignedRecruiterUids: [],
          childAccountName: args.childAccountId,
        };
      },
    });

    expect(calls).to.equal(3, 'all 3 children attempted');
    expect(result.summary.created).to.equal(2);
    expect(result.summary.skipped).to.equal(1);
    expect(result.summary.alreadyHad).to.equal(0);

    const failed = result.audit.find((a) => a.action === 'failed');
    expect(failed?.childAccountId).to.equal('acc_child_BAD');
    expect(failed?.reason).to.equal('synthetic failure');
  });

  it('surfaces an empty-children case as zero work', async () => {
    const state = newState();
    const { tenantId, nationalAccountId } = seedTenantWithChildren(state, {
      children: [],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await runBackfillGigJobOrdersForNationalAccount({
      db: fdb,
      tenantId,
      nationalAccountId,
    });
    expect(result.summary.totalChildAccounts).to.equal(0);
    expect(result.summary.created).to.equal(0);
    expect(result.audit).to.have.lengthOf(0);
  });
});
