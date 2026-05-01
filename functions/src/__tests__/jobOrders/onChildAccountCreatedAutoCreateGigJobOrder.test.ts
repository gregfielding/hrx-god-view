/**
 * **§14 / #45** — Auto-Create Gig Job Orders trigger tests.
 *
 * Two layers under test:
 *   1. `decideShouldCreateGigJobOrder` — pure gating decision.
 *   2. `createGigJobOrderForChildAccount` — end-to-end with a fake
 *      Firestore (cascade chain → JO write → idempotency).
 *
 * The trigger handler itself is a thin wrapper over (1) + (2), so
 * exercising both gives us coverage of every meaningful code path
 * without spinning up `firebase-functions-test`.
 *
 * Mocha + Chai. Run via:
 *   npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/jobOrders/onChildAccountCreatedAutoCreateGigJobOrder.test.ts'
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  createGigJobOrderForChildAccount,
  decideShouldCreateGigJobOrder,
} from '../../jobOrders/onChildAccountCreatedAutoCreateGigJobOrder';
import {
  type FakeState,
  installFieldValueStubs,
  makeFakeFirestore,
  newState,
} from './_fakeFirestore';

// Stub the `FieldValue` static surface once at module load — the
// pure-function tests don't need it but the write-path tests do.
installFieldValueStubs();

// ─────────────────────────────────────────────────────────────────────
// 1. decideShouldCreateGigJobOrder — pure decision tests
// ─────────────────────────────────────────────────────────────────────

describe('decideShouldCreateGigJobOrder — pure decision', () => {
  const happyChild = {
    accountType: 'child' as const,
    parentAccountId: 'acc_parent',
    autoCreatedFromCompanyLocation: true,
  };
  const happyParent = {
    accountType: 'national' as const,
    autoCreateGigJobOrders: true,
  };

  it('returns `create` for the happy-path national → auto-child flow', () => {
    const result = decideShouldCreateGigJobOrder({
      child: happyChild,
      parent: happyParent,
    });
    expect(result.kind).to.equal('create');
  });

  it('skips when child doc data is missing', () => {
    const result = decideShouldCreateGigJobOrder({ child: null, parent: null });
    expect(result.kind).to.equal('skip_no_data');
  });

  it('skips when account is standalone (not a child)', () => {
    const result = decideShouldCreateGigJobOrder({
      child: { ...happyChild, accountType: 'standalone' },
      parent: happyParent,
    });
    expect(result.kind).to.equal('skip_not_child');
  });

  it('skips when account is national (parent itself, not a child)', () => {
    const result = decideShouldCreateGigJobOrder({
      child: { ...happyChild, accountType: 'national' },
      parent: happyParent,
    });
    expect(result.kind).to.equal('skip_not_child');
  });

  it('skips when child has no parent linkage', () => {
    const result = decideShouldCreateGigJobOrder({
      child: { ...happyChild, parentAccountId: '' },
      parent: happyParent,
    });
    expect(result.kind).to.equal('skip_no_parent');
  });

  it('skips manually-created children (toggle has auto-only semantics)', () => {
    const result = decideShouldCreateGigJobOrder({
      child: { ...happyChild, autoCreatedFromCompanyLocation: false },
      parent: happyParent,
    });
    expect(result.kind).to.equal('skip_manual_child');
  });

  it('treats missing autoCreatedFromCompanyLocation as `manual` (defensive)', () => {
    // Older child docs may not carry the field. We require explicit
    // `true` to opt in — anything else is "manual" by default.
    const result = decideShouldCreateGigJobOrder({
      child: {
        accountType: 'child',
        parentAccountId: 'acc_parent',
      },
      parent: happyParent,
    });
    expect(result.kind).to.equal('skip_manual_child');
  });

  it('skips when parent doc was deleted between events', () => {
    const result = decideShouldCreateGigJobOrder({
      child: happyChild,
      parent: null,
    });
    expect(result.kind).to.equal('skip_parent_missing');
  });

  it('skips when parent toggle is OFF (the whole feature gate)', () => {
    const result = decideShouldCreateGigJobOrder({
      child: happyChild,
      parent: { ...happyParent, autoCreateGigJobOrders: false },
    });
    expect(result.kind).to.equal('skip_toggle_off');
  });

  it('skips when parent toggle is undefined (treats as off — opt-in)', () => {
    const result = decideShouldCreateGigJobOrder({
      child: happyChild,
      parent: { accountType: 'national' },
    });
    expect(result.kind).to.equal('skip_toggle_off');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. createGigJobOrderForChildAccount — happy path + idempotency
// ─────────────────────────────────────────────────────────────────────

describe('createGigJobOrderForChildAccount — write path', () => {
  function seedNationalChain(state: FakeState) {
    state.store.set('tenants/t1/accounts/acc_parent', {
      name: 'CORT',
      accountType: 'national',
      hiringEntityId: 'entity_select',
      eVerifyRequired: true,
      // workersCompCode is a top-level cascade field per registry —
      // `FIELD_PATHS_BY_LEVEL` reads it from `account.workersCompCode`.
      workersCompCode: '8015',
      autoCreateGigJobOrders: true,
      orderDefaults: {
        screeningPackageId: 'PKG_CORT_BASIC',
        // The cascade loader reads additionalScreenings from
        // `orderDefaults.orderDetails.additionalScreenings` per
        // `FIELD_PATHS_BY_LEVEL` in `functions/src/shared/cascade/loaders.ts`.
        // Seeding at the loader-canonical path so the test exercises the
        // same code path production data goes through.
        orderDetails: {
          additionalScreenings: ['mvr_check'],
        },
      },
      pricing: {
        positions: [
          {
            positionId: 'p_event',
            jobTitle: 'Event Worker',
            jobDescription: 'Furniture handling at events',
            markupPercentage: 38,
          },
        ],
      },
      associations: { recruiterIds: ['recruiter_a'] },
    });
    state.store.set('tenants/t1/accounts/acc_child', {
      name: 'CORT Baltimore Warehouse',
      accountType: 'child',
      parentAccountId: 'acc_parent',
      autoCreatedFromCompanyLocation: true,
      companyId: 'company_cort',
      companyLocationId: 'loc_baltimore',
      pricing: {
        positions: [
          {
            positionId: 'p_event',
            payRate: 18,
            billRate: 24.84,
            workersCompCode: '8015',
            workersCompRate: 9.15,
            futa: 1.8,
            suta: 3.4,
          },
        ],
      },
    });
    state.store.set('crm_companies/company_cort/locations/loc_baltimore', {
      nickname: 'Maryland Warehouse',
      name: 'Baltimore Warehouse',
      address: {
        street: '7466 Candlewood Road',
        city: 'Hanover',
        state: 'MD',
        zipCode: '21076',
        country: 'US',
      },
    });
  }

  it('writes a draft Gig JO with cascade-resolved hiringEntity, eVerify, screening, and pricing', async () => {
    const state = newState();
    seedNationalChain(state);
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    expect(result, 'helper should return a result on first call').to.not.equal(null);
    expect(result!.jobOrderSeq).to.equal(1);
    expect(result!.jobOrderNumber).to.equal('0001');
    expect(result!.assignedRecruiterUids).to.deep.equal(['recruiter_a']);
    expect(result!.childAccountName).to.equal('CORT Baltimore Warehouse');

    // The JO doc lives at tenants/t1/job_orders/{auto_id}.
    const joWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/job_orders/'),
    );
    expect(joWrites, 'one JO write expected').to.have.lengthOf(1);
    const jo = joWrites[0].data;

    // ── Marker / scaffolding ─────────────────────────────────────
    expect(jo.autoCreatedFrom).to.equal('autoCreateGigJobOrders');
    expect(jo.autoCreatedFromChildAccountId).to.equal('acc_child');
    // §14b spec: initial status `'on_hold'` — the cron flips it to
    // `'open'` once an active upcoming shift exists.
    expect(jo.status).to.equal('on_hold');
    expect(jo.jobType).to.equal('gig');
    expect(jo.tenantId).to.equal('t1');
    expect(jo.recruiterAccountId).to.equal('acc_child');
    expect(jo.parentAccountId).to.equal('acc_parent');
    expect(jo.parentAccountName).to.equal('CORT');
    // §14b spec: name format `<child name> - Gig Work`.
    expect(jo.jobOrderName).to.equal('CORT Baltimore Warehouse - Gig Work');
    expect(jo.autoCreatedSource).to.equal('auto_create_trigger');

    // ── Cascade-resolved compliance fields (the whole point) ─────
    expect(jo.hiringEntityId).to.equal('entity_select');
    expect(jo.eVerifyRequired).to.equal(true);
    expect(jo.screeningPackageId).to.equal('PKG_CORT_BASIC');
    expect(jo.additionalScreenings).to.deep.equal(['mvr_check']);
    expect(jo.backgroundCheckRequired).to.equal(true); // derived from screeningPackageId

    // ── Cascade-resolved pricing (Account header + Child rates) ──
    expect(jo.jobTitle).to.equal('Event Worker');
    expect(jo.payRate).to.equal(18);
    expect(jo.billRate).to.equal(24.84);
    expect(jo.workersCompCode).to.equal('8015');
    expect(jo.workersCompRate).to.equal(9.15);

    // ── Worksite hydrated from CRM location ─────────────────────
    expect(jo.worksiteId).to.equal('loc_baltimore');
    expect(jo.worksiteName).to.equal('Maryland Warehouse'); // nickname wins
    const addr = jo.worksiteAddress as Record<string, string>;
    expect(addr.city).to.equal('Hanover');
    expect(addr.state).to.equal('MD');
    expect(addr.zipCode).to.equal('21076');
  });

  it('inherits parent recruiter list when child has none of its own', async () => {
    const state = newState();
    seedNationalChain(state);
    // Strip child recruiter assignments — defaults should fall through
    // to the parent's `associations.recruiterIds`.
    const child = state.store.get('tenants/t1/accounts/acc_child')!;
    state.store.set('tenants/t1/accounts/acc_child', {
      ...child,
      associations: { recruiterIds: [] },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    expect(result!.assignedRecruiterUids).to.deep.equal(['recruiter_a']);
    const joWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/job_orders/'),
    );
    expect(joWrites[0].data.assignedRecruiters).to.deep.equal(['recruiter_a']);
  });

  it('produces a 1099-shaped JO when the cascade resolves to a 1099 hiring entity (no hardcoded W-2)', async () => {
    // Spec: "JO is a passive consumer of cascade values" — same code
    // path, different cascade-resolved values produces a different
    // employment shape. Here the National is configured for C1 Events
    // LLC + E-Verify off; the auto-spawned JO must inherit that
    // verbatim, NOT get overwritten with a default.
    const state = newState();
    seedNationalChain(state);
    state.store.set('tenants/t1/accounts/acc_parent', {
      ...state.store.get('tenants/t1/accounts/acc_parent')!,
      hiringEntityId: 'entity_events_llc',
      eVerifyRequired: false,
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    const joWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/job_orders/'),
    );
    const jo = joWrites[0].data;
    expect(jo.hiringEntityId).to.equal('entity_events_llc');
    expect(jo.eVerifyRequired).to.equal(false);
  });

  it('uses parent.defaultGigJobTitle when set, else falls back to position title', async () => {
    const state = newState();
    seedNationalChain(state);
    const parent = state.store.get('tenants/t1/accounts/acc_parent')!;
    state.store.set('tenants/t1/accounts/acc_parent', {
      ...parent,
      defaultGigJobTitle: 'CORT Crew Member',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    const joWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/job_orders/'),
    );
    expect(joWrites[0].data.jobTitle).to.equal('CORT Crew Member');
  });

  it('returns null on idempotent re-fire (existing auto-JO already present)', async () => {
    const state = newState();
    seedNationalChain(state);
    // Pre-existing JO for this child with the auto-create marker.
    state.store.set('tenants/t1/job_orders/jo_existing', {
      recruiterAccountId: 'acc_child',
      autoCreatedFrom: 'autoCreateGigJobOrders',
      status: 'draft',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    expect(result).to.equal(null);
    // No second JO written.
    const joWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/job_orders/'),
    );
    expect(joWrites).to.have.lengthOf(0);
  });

  it('writes a placeholder JO (no worksite) when the child has no companyLocationId', async () => {
    const state = newState();
    seedNationalChain(state);
    const child = state.store.get('tenants/t1/accounts/acc_child')!;
    state.store.set('tenants/t1/accounts/acc_child', {
      ...child,
      companyLocationId: '',
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    const joWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/job_orders/'),
    );
    const jo = joWrites[0].data;
    expect(jo.worksiteId).to.equal('');
    expect(jo.worksiteName).to.equal('');
    // Address shape is still present so downstream consumers don't NPE.
    const addr = jo.worksiteAddress as Record<string, string>;
    expect(addr.country).to.equal('US');
    expect(addr.city).to.equal('');
  });

  it('seeds the JO counter from existing JOs when the counter doc is missing', async () => {
    const state = newState();
    seedNationalChain(state);
    // Two pre-existing JOs (manually created in a pre-counter era).
    state.store.set('tenants/t1/job_orders/jo_old_1', { recruiterAccountId: 'acc_other' });
    state.store.set('tenants/t1/job_orders/jo_old_2', { recruiterAccountId: 'acc_other' });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const result = await createGigJobOrderForChildAccount({
      tenantId: 't1',
      childAccountId: 'acc_child',
      childAccount: state.store.get('tenants/t1/accounts/acc_child')!,
      parentAccount: state.store.get('tenants/t1/accounts/acc_parent')!,
      source: 'auto_create_trigger',
      db: fdb,
    });

    // 2 existing → seed `next` to 3, return 3 as our seq.
    expect(result!.jobOrderSeq).to.equal(3);
    expect(result!.jobOrderNumber).to.equal('0003');

    // Counter doc was created with `next: 4` (3 + 1 for the next caller).
    const counter = state.store.get('tenants/t1/counters/jobOrderNumber');
    expect(counter, 'counter doc should be seeded').to.not.equal(undefined);
    expect((counter as { next: number }).next).to.equal(4);
  });
});
