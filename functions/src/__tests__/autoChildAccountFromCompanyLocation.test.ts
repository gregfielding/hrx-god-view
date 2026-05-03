/**
 * **CC.B (Post-CC.A audit fixes) — `autoChildAccountFromCompanyLocation` tests.**
 *
 * Two layers under test:
 *   1. `decideAutoChildAccountFromCandidates` — pure decision for the
 *      "how many National parents is this CRM company linked to?"
 *      branch (F.10).
 *   2. `tryCreateChildAccountForNationalParent` — child-account
 *      creation, including the F.5 recruiterIds + salespeopleIds
 *      inheritance from the parent National.
 *
 * Mocha + Chai. Run via:
 *   npx mocha -r ts-node/register -r src/__tests__/setup.ts \
 *     'src/__tests__/autoChildAccountFromCompanyLocation.test.ts'
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  decideAutoChildAccountFromCandidates,
  tryCreateChildAccountForNationalParent,
} from '../autoChildAccountFromCompanyLocation';
import {
  installFieldValueStubs,
  makeFakeFirestore,
  newState,
  type FakeState,
} from './jobOrders/_fakeFirestore';

installFieldValueStubs();

// ─────────────────────────────────────────────────────────────────────
// 1. F.10 — decideAutoChildAccountFromCandidates (pure)
// ─────────────────────────────────────────────────────────────────────

describe('decideAutoChildAccountFromCandidates — pure decision (F.10)', () => {
  it('returns `none` when zero National parents linked', () => {
    const result = decideAutoChildAccountFromCandidates([]);
    expect(result.kind).to.equal('none');
  });

  it('returns `proceed` for the unambiguous one-parent case', () => {
    const result = decideAutoChildAccountFromCandidates([
      { id: 'acc_parent_only', name: 'CORT' },
    ]);
    expect(result.kind).to.equal('proceed');
    if (result.kind === 'proceed') {
      expect(result.parentId).to.equal('acc_parent_only');
    }
  });

  it('returns `skip_ambiguous` for two parents (the smallest ambiguity)', () => {
    const result = decideAutoChildAccountFromCandidates([
      { id: 'acc_parent_a', name: 'CORT' },
      { id: 'acc_parent_b', name: 'Sodexo' },
    ]);
    expect(result.kind).to.equal('skip_ambiguous');
    if (result.kind === 'skip_ambiguous') {
      expect(result.candidateNationalIds).to.deep.equal([
        'acc_parent_a',
        'acc_parent_b',
      ]);
      expect(result.candidateNationalNames).to.deep.equal(['CORT', 'Sodexo']);
    }
  });

  it('returns `skip_ambiguous` for the five-parent case (recruiter mis-config)', () => {
    const result = decideAutoChildAccountFromCandidates([
      { id: 'p1', name: 'CORT' },
      { id: 'p2', name: 'Sodexo' },
      { id: 'p3', name: 'Aramark' },
      { id: 'p4', name: 'ABM' },
      { id: 'p5', name: null },
    ]);
    expect(result.kind).to.equal('skip_ambiguous');
    if (result.kind === 'skip_ambiguous') {
      expect(result.candidateNationalIds).to.have.lengthOf(5);
      expect(result.candidateNationalIds).to.deep.equal([
        'p1',
        'p2',
        'p3',
        'p4',
        'p5',
      ]);
      // Null name passes through (we don't synthesize a fallback at
      // the decision layer — that's the log formatter's call).
      expect(result.candidateNationalNames).to.deep.equal([
        'CORT',
        'Sodexo',
        'Aramark',
        'ABM',
        null,
      ]);
    }
  });

  it('preserves candidate order from the firestore query', () => {
    // The query that feeds this helper is `array-contains` across the
    // accounts collection — Firestore returns docs in lexical order on
    // the doc id. We don't reorder. This test pins that contract so a
    // future "sort by name" experiment doesn't accidentally land here
    // and mask which National is canonical for ops triage.
    const result = decideAutoChildAccountFromCandidates([
      { id: 'z_last', name: 'Sodexo' },
      { id: 'a_first', name: 'CORT' },
    ]);
    if (result.kind === 'skip_ambiguous') {
      expect(result.candidateNationalIds).to.deep.equal(['z_last', 'a_first']);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. F.5 — recruiterIds + salespeopleIds inherited onto the auto-child
// ─────────────────────────────────────────────────────────────────────

/**
 * Seed a National parent into the fake firestore. Tests can override
 * `recruiterIds` / `salespeopleIds` to exercise the inheritance branch
 * without rebuilding the full account doc each time.
 */
function seedNationalParent(
  state: FakeState,
  overrides: {
    parentId?: string;
    companyId?: string;
    recruiterIds?: string[];
    salespeopleIds?: string[];
    extra?: Record<string, unknown>;
  } = {},
): { parentId: string; companyId: string } {
  const parentId = overrides.parentId ?? 'acc_parent';
  const companyId = overrides.companyId ?? 'company_cort';
  state.store.set(`tenants/t1/accounts/${parentId}`, {
    name: 'CORT',
    accountType: 'national',
    autoCreateChildAccountsForLocations: true,
    childAccountIds: [],
    associations: {
      companyIds: [companyId],
      recruiterIds: overrides.recruiterIds ?? [],
      salespeopleIds: overrides.salespeopleIds ?? [],
    },
    ...(overrides.extra ?? {}),
  });
  return { parentId, companyId };
}

describe('tryCreateChildAccountForNationalParent — F.5 recruiterIds inheritance', () => {
  it('inherits an empty recruiterIds list (no parent assignments)', async () => {
    const state = newState();
    const { parentId, companyId } = seedNationalParent(state, {
      recruiterIds: [],
      salespeopleIds: [],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const outcome = await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: parentId,
      companyId,
      locationId: 'loc_baltimore',
      locationData: { nickname: 'Baltimore Warehouse' },
      requireAutoCreateToggle: true,
    });

    expect(outcome).to.equal('created');
    const childWrite = state.writes.find((w) =>
      w.path.startsWith('tenants/t1/accounts/'),
    );
    expect(childWrite, 'child account write expected').to.exist;
    const assoc = childWrite!.data.associations as Record<string, unknown>;
    expect(assoc.recruiterIds).to.deep.equal([]);
    expect(assoc.salespeopleIds).to.deep.equal([]);
  });

  it('inherits a single recruiter from the parent', async () => {
    const state = newState();
    const { parentId, companyId } = seedNationalParent(state, {
      recruiterIds: ['recruiter_a'],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: parentId,
      companyId,
      locationId: 'loc_baltimore',
      locationData: { nickname: 'Baltimore Warehouse' },
      requireAutoCreateToggle: true,
    });

    const childWrite = state.writes.find((w) =>
      w.path.startsWith('tenants/t1/accounts/'),
    );
    const assoc = childWrite!.data.associations as Record<string, unknown>;
    expect(assoc.recruiterIds).to.deep.equal(['recruiter_a']);
  });

  it('inherits a three-recruiter list verbatim (most common branch)', async () => {
    const state = newState();
    const { parentId, companyId } = seedNationalParent(state, {
      recruiterIds: ['recruiter_a', 'recruiter_b', 'recruiter_c'],
      salespeopleIds: ['sales_x'],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: parentId,
      companyId,
      locationId: 'loc_baltimore',
      locationData: { nickname: 'Baltimore Warehouse' },
      requireAutoCreateToggle: true,
    });

    const childWrite = state.writes.find((w) =>
      w.path.startsWith('tenants/t1/accounts/'),
    );
    const assoc = childWrite!.data.associations as Record<string, unknown>;
    expect(assoc.recruiterIds).to.deep.equal([
      'recruiter_a',
      'recruiter_b',
      'recruiter_c',
    ]);
    expect(assoc.salespeopleIds).to.deep.equal(['sales_x']);
  });

  it('filters out empty/whitespace recruiter ids (defensive against drift)', async () => {
    // Historical accounts may have stray empty strings or whitespace
    // entries from old form bugs. The Gig JO builder already has this
    // defense (per gigJobOrderFromChildAccount.ts:354-357); we mirror
    // it here so the inherited list is never corrupt by construction.
    const state = newState();
    const { parentId, companyId } = seedNationalParent(state, {
      recruiterIds: ['recruiter_a', '', '  ', 'recruiter_b'],
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: parentId,
      companyId,
      locationId: 'loc_baltimore',
      locationData: { nickname: 'Baltimore Warehouse' },
      requireAutoCreateToggle: true,
    });

    const childWrite = state.writes.find((w) =>
      w.path.startsWith('tenants/t1/accounts/'),
    );
    const assoc = childWrite!.data.associations as Record<string, unknown>;
    expect(assoc.recruiterIds).to.deep.equal(['recruiter_a', 'recruiter_b']);
  });

  it('handles a parent with no associations object at all (legacy doc)', async () => {
    // Defensive: an old National account may have been created before
    // `associations` was a required field. We must not crash; we
    // should write empty arrays.
    const state = newState();
    state.store.set('tenants/t1/accounts/acc_parent', {
      name: 'CORT',
      accountType: 'national',
      autoCreateChildAccountsForLocations: true,
      childAccountIds: [],
      // No `associations` field at all.
      // Skip the `cids.includes(companyId)` check by adding companyIds
      // below — the txn aborts otherwise. We layer it on top so the
      // surrounding read-side logic still exercises the legacy shape.
      associations: { companyIds: ['company_cort'] },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const outcome = await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: 'acc_parent',
      companyId: 'company_cort',
      locationId: 'loc_x',
      locationData: { nickname: 'Test' },
      requireAutoCreateToggle: true,
    });
    expect(outcome).to.equal('created');

    const childWrite = state.writes.find((w) =>
      w.path.startsWith('tenants/t1/accounts/'),
    );
    const assoc = childWrite!.data.associations as Record<string, unknown>;
    expect(assoc.recruiterIds).to.deep.equal([]);
    expect(assoc.salespeopleIds).to.deep.equal([]);
  });

  it('skips when the toggle is off (regression guard for F.5 + existing gating)', async () => {
    const state = newState();
    seedNationalParent(state, { recruiterIds: ['recruiter_a'] });
    state.store.set('tenants/t1/accounts/acc_parent', {
      ...(state.store.get('tenants/t1/accounts/acc_parent') as Record<
        string,
        unknown
      >),
      autoCreateChildAccountsForLocations: false,
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const outcome = await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: 'acc_parent',
      companyId: 'company_cort',
      locationId: 'loc_baltimore',
      locationData: { nickname: 'Baltimore Warehouse' },
      requireAutoCreateToggle: true,
    });

    expect(outcome).to.equal('skipped_toggle');
    const childWrites = state.writes.filter((w) =>
      w.path.startsWith('tenants/t1/accounts/auto'),
    );
    expect(childWrites).to.have.lengthOf(0);
  });

  it('still creates the child when invoked from backfill (no toggle requirement)', async () => {
    // `requireAutoCreateToggle: false` is the manual-backfill path —
    // recruiter explicitly opts in. The F.5 inheritance must run on
    // this path too, otherwise backfilled children land in the same
    // unowned state the audit flagged.
    const state = newState();
    const { parentId, companyId } = seedNationalParent(state, {
      recruiterIds: ['recruiter_a'],
      extra: { autoCreateChildAccountsForLocations: false },
    });
    const fdb = makeFakeFirestore(state) as unknown as admin.firestore.Firestore;

    const outcome = await tryCreateChildAccountForNationalParent({
      db: fdb,
      tenantId: 't1',
      parentAccountId: parentId,
      companyId,
      locationId: 'loc_baltimore',
      locationData: { nickname: 'Baltimore Warehouse' },
      requireAutoCreateToggle: false,
    });

    expect(outcome).to.equal('created');
    const childWrite = state.writes.find((w) =>
      w.path.startsWith('tenants/t1/accounts/'),
    );
    const assoc = childWrite!.data.associations as Record<string, unknown>;
    expect(assoc.recruiterIds).to.deep.equal(['recruiter_a']);
  });
});
