/**
 * **§14b — `buildGigJobOrderFromChildAccount` pure-function tests.**
 *
 * The pure builder is the field-mapping single source of truth used by
 * both the auto-create trigger and the backfill callable. These tests
 * exercise the mapping rules in isolation — no Firestore, no cascade
 * engine, no counter allocator. Each test feeds explicit cascade-
 * resolved values and asserts the JO doc shape.
 *
 * If you find yourself adding a Firestore mock to test something here,
 * the function under test has slipped from "pure builder" — push the
 * IO to the orchestrator (`createGigJobOrderForChildAccount`) and
 * leave this file as the spec doc for the mapping.
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';

import {
  AUTO_CREATED_FROM_MARKER,
  buildGigJobOrderFromChildAccount,
  DEFAULT_GIG_JOB_TITLE,
  pickDefaultPosition,
  type AccountDoc,
  type BuildGigJobOrderInput,
  type ResolvedCascadeValues,
  type ResolvedPosition,
  type WorksiteHydration,
} from '../../jobOrders/gigJobOrderFromChildAccount';
import { installFieldValueStubs } from './_fakeFirestore';

// The pure builder calls `FieldValue.serverTimestamp()` for createdAt /
// updatedAt — stub it once so we don't need a live Firestore client.
installFieldValueStubs();

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

function fullCascadeChild(): AccountDoc & { id: string } {
  return {
    id: 'acc_child',
    name: 'CORT Baltimore Warehouse',
    accountType: 'child',
    parentAccountId: 'acc_parent',
    autoCreatedFromCompanyLocation: true,
    companyId: 'company_cort',
    companyLocationId: 'loc_baltimore',
    associations: { recruiterIds: ['recruiter_child'] },
  };
}

function fullCascadeParent(): AccountDoc & { id: string } {
  return {
    id: 'acc_parent',
    name: 'CORT',
    accountType: 'national',
    autoCreateGigJobOrders: true,
    associations: { recruiterIds: ['recruiter_parent_a', 'recruiter_parent_b'] },
  };
}

function w2Cascade(): ResolvedCascadeValues {
  return {
    hiringEntityId: 'entity_select',
    eVerifyRequired: true,
    screeningPackageId: 'PKG_CORT_BASIC',
    additionalScreenings: ['mvr_check', 'drug_panel'],
    selectedPositionIds: ['p_event'],
    positions: [
      {
        positionId: 'p_event',
        jobTitle: 'Event Worker',
        jobDescription: 'Furniture handling at events',
        payRate: 18,
        billRate: 24.84,
        markupPercentage: 38,
        workersCompCode: '8015',
        workersCompRate: 9.15,
      },
    ],
    workersCompCode: '8015',
    flatMarkupPercent: 38,
  };
}

function fullWorksite(): WorksiteHydration {
  return {
    worksiteId: 'loc_baltimore',
    worksiteName: 'Maryland Warehouse',
    worksiteAddress: {
      street: '7466 Candlewood Road',
      city: 'Hanover',
      state: 'MD',
      zipCode: '21076',
      country: 'US',
    },
  };
}

function makeInput(
  overrides: Partial<BuildGigJobOrderInput> = {},
): BuildGigJobOrderInput {
  return {
    tenantId: 't1',
    childAccount: fullCascadeChild(),
    parentAccount: fullCascadeParent(),
    cascade: w2Cascade(),
    worksite: fullWorksite(),
    jobOrderSeq: 42,
    jobOrderNumber: '0042',
    source: 'auto_create_trigger',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// pickDefaultPosition — pure helper
// ─────────────────────────────────────────────────────────────────────

describe('pickDefaultPosition — pure helper', () => {
  const positions: ResolvedPosition[] = [
    { positionId: 'p1', jobTitle: 'Event Worker' },
    { positionId: 'p2', jobTitle: 'Driver' },
    { positionId: 'p3', jobTitle: '' }, // untitled — should not be picked first
  ];

  it('returns the first position matching `selectedIds` order', () => {
    const result = pickDefaultPosition(['p2', 'p1'], positions);
    expect(result?.positionId).to.equal('p2');
  });

  it('skips an untitled selectedId match and falls through to the next', () => {
    const result = pickDefaultPosition(['p3', 'p1'], positions);
    expect(result?.positionId).to.equal('p1');
  });

  it('falls back to the first titled position when selectedIds is empty', () => {
    const result = pickDefaultPosition([], positions);
    expect(result?.positionId).to.equal('p1');
  });

  it('returns the first position even if untitled when none have titles', () => {
    const untitledOnly: ResolvedPosition[] = [{ positionId: 'p1', jobTitle: '' }];
    const result = pickDefaultPosition([], untitledOnly);
    expect(result?.positionId).to.equal('p1');
  });

  it('returns null when there are zero positions', () => {
    expect(pickDefaultPosition([], [])).to.equal(null);
    expect(pickDefaultPosition(['p_xyz'], [])).to.equal(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildGigJobOrderFromChildAccount — happy path
// ─────────────────────────────────────────────────────────────────────

describe('buildGigJobOrderFromChildAccount — happy path', () => {
  it('produces all the fields the §14b spec lists', () => {
    const { jobOrderData, assignedRecruiterUids, childAccountName } =
      buildGigJobOrderFromChildAccount(makeInput());

    // Naming
    expect(jobOrderData.jobOrderName).to.equal(
      'CORT Baltimore Warehouse - Gig Work',
    );
    expect(childAccountName).to.equal('CORT Baltimore Warehouse');
    expect(jobOrderData.jobTitle).to.equal('Event Worker');

    // Status / type / marker
    expect(jobOrderData.status).to.equal('on_hold');
    expect(jobOrderData.jobType).to.equal('gig');
    expect(jobOrderData.autoCreatedFrom).to.equal(AUTO_CREATED_FROM_MARKER);
    expect(jobOrderData.autoCreatedFromChildAccountId).to.equal('acc_child');
    expect(jobOrderData.autoCreatedSource).to.equal('auto_create_trigger');

    // Lookups / denorm
    expect(jobOrderData.tenantId).to.equal('t1');
    expect(jobOrderData.jobOrderSeq).to.equal(42);
    expect(jobOrderData.jobOrderNumber).to.equal('0042');
    expect(jobOrderData.recruiterAccountId).to.equal('acc_child');
    expect(jobOrderData.accountId).to.equal('acc_child');
    expect(jobOrderData.accountName).to.equal('CORT Baltimore Warehouse');
    expect(jobOrderData.parentAccountId).to.equal('acc_parent');
    expect(jobOrderData.parentAccountName).to.equal('CORT');
    expect(jobOrderData.companyId).to.equal('company_cort');
    expect(jobOrderData.companyName).to.equal('CORT');

    // Worksite
    expect(jobOrderData.worksiteId).to.equal('loc_baltimore');
    expect(jobOrderData.worksiteName).to.equal('Maryland Warehouse');
    const addr = jobOrderData.worksiteAddress as Record<string, string>;
    expect(addr.city).to.equal('Hanover');
    expect(addr.state).to.equal('MD');
    expect(addr.zipCode).to.equal('21076');

    // Compliance — straight from cascade, not hardcoded.
    expect(jobOrderData.hiringEntityId).to.equal('entity_select');
    expect(jobOrderData.eVerifyRequired).to.equal(true);
    expect(jobOrderData.screeningPackageId).to.equal('PKG_CORT_BASIC');
    expect(jobOrderData.additionalScreenings).to.deep.equal([
      'mvr_check',
      'drug_panel',
    ]);
    expect(jobOrderData.backgroundCheckRequired).to.equal(true);

    // Pricing — position values, with derived bill rate when explicit.
    expect(jobOrderData.payRate).to.equal(18);
    expect(jobOrderData.billRate).to.equal(24.84);
    expect(jobOrderData.workersCompCode).to.equal('8015');
    expect(jobOrderData.workersCompRate).to.equal(9.15);

    // Recruiters — child wins over parent.
    expect(jobOrderData.assignedRecruiters).to.deep.equal(['recruiter_child']);
    expect(assignedRecruiterUids).to.deep.equal(['recruiter_child']);

    // Empty defaults — recruiter fills in on activation.
    expect(jobOrderData.requiredLicenses).to.deep.equal([]);
    expect(jobOrderData.requiredCertifications).to.deep.equal([]);
    expect(jobOrderData.skillsRequired).to.deep.equal([]);
    expect(jobOrderData.dressCode).to.deep.equal([]);
  });

  it('inherits parent recruiters when child has none of its own', () => {
    const input = makeInput({
      childAccount: { ...fullCascadeChild(), associations: { recruiterIds: [] } },
    });
    const { jobOrderData, assignedRecruiterUids } =
      buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.assignedRecruiters).to.deep.equal([
      'recruiter_parent_a',
      'recruiter_parent_b',
    ]);
    expect(assignedRecruiterUids).to.deep.equal([
      'recruiter_parent_a',
      'recruiter_parent_b',
    ]);
  });

  it('uses parent.defaultGigJobTitle when set (overrides the position title)', () => {
    const input = makeInput({
      parentAccount: {
        ...fullCascadeParent(),
        defaultGigJobTitle: 'CORT Crew Member',
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.jobTitle).to.equal('CORT Crew Member');
  });

  it('source field tracks which path produced the JO', () => {
    const trig = buildGigJobOrderFromChildAccount(makeInput()).jobOrderData;
    expect(trig.autoCreatedSource).to.equal('auto_create_trigger');
    const back = buildGigJobOrderFromChildAccount(
      makeInput({ source: 'backfill' }),
    ).jobOrderData;
    expect(back.autoCreatedSource).to.equal('backfill');
  });

  it('passes the source-flag through but otherwise produces byte-identical JO docs', () => {
    // Both code paths must produce shapes a recruiter can't tell apart
    // (modulo `autoCreatedSource`, which is dev-only audit). This test
    // is the contract guaranteeing that.
    const trigJo = buildGigJobOrderFromChildAccount(makeInput()).jobOrderData;
    const backJo = buildGigJobOrderFromChildAccount(
      makeInput({ source: 'backfill' }),
    ).jobOrderData;

    const stripVarying = (j: Record<string, unknown>) => {
      const copy = { ...j };
      delete copy.autoCreatedSource;
      return copy;
    };
    expect(stripVarying(backJo)).to.deep.equal(stripVarying(trigJo));
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildGigJobOrderFromChildAccount — edge cases
// ─────────────────────────────────────────────────────────────────────

describe('buildGigJobOrderFromChildAccount — edge cases', () => {
  it('handles empty cascade positions (placeholder JO with default title)', () => {
    const input = makeInput({
      cascade: {
        ...w2Cascade(),
        positions: [],
        selectedPositionIds: [],
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.jobTitle).to.equal(DEFAULT_GIG_JOB_TITLE);
    expect(jobOrderData.payRate).to.equal(0);
    // No explicit bill rate, no markup, no pay → bill rate falls to 0.
    expect(jobOrderData.billRate).to.equal(0);
  });

  it('derives billRate from payRate * markup when position has only pay', () => {
    const input = makeInput({
      cascade: {
        ...w2Cascade(),
        positions: [
          {
            positionId: 'p_event',
            jobTitle: 'Event Worker',
            payRate: 20,
            // no billRate, no markupPercent → fall back to flatMarkupPercent
          },
        ],
        flatMarkupPercent: 40,
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.payRate).to.equal(20);
    // 20 * 1.40 = 28.00
    expect(jobOrderData.billRate).to.equal(28);
  });

  it('handles missing worksite (placeholder JO that recruiter wires up later)', () => {
    const input = makeInput({ worksite: null });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.worksiteId).to.equal('');
    expect(jobOrderData.worksiteName).to.equal('');
    const addr = jobOrderData.worksiteAddress as Record<string, string>;
    expect(addr.street).to.equal('');
    expect(addr.country).to.equal('US');
  });

  it('produces a 1099-shaped JO when cascade resolves to a 1099 hiring entity (no hardcoded W-2)', () => {
    // The whole point of "passive consumer of cascade" — feed the
    // builder different cascade values and the same code path produces
    // a different employment shape. No hardcoded `entity_select` /
    // `eVerifyRequired: false` defaults.
    const input = makeInput({
      cascade: {
        ...w2Cascade(),
        hiringEntityId: 'entity_events_llc',
        eVerifyRequired: false,
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.hiringEntityId).to.equal('entity_events_llc');
    expect(jobOrderData.eVerifyRequired).to.equal(false);
  });

  it('passes through `null` hiringEntityId — the recruiter sees "missing" and fills in', () => {
    const input = makeInput({
      cascade: { ...w2Cascade(), hiringEntityId: null },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.hiringEntityId).to.equal(null);
  });

  it('uses the unnamed-child fallback when childAccount.name is empty', () => {
    const input = makeInput({
      childAccount: { ...fullCascadeChild(), name: '' },
    });
    const { jobOrderData, childAccountName } =
      buildGigJobOrderFromChildAccount(input);
    expect(childAccountName).to.equal('Child Account');
    expect(jobOrderData.jobOrderName).to.equal('Child Account - Gig Work');
  });

  it('uses childName as companyName when parent has no name (defensive)', () => {
    const input = makeInput({
      parentAccount: { ...fullCascadeParent(), name: '' },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.companyName).to.equal('CORT Baltimore Warehouse');
  });

  it('derives backgroundCheckRequired from screeningPackageId presence', () => {
    const withPkg = buildGigJobOrderFromChildAccount(makeInput()).jobOrderData;
    expect(withPkg.backgroundCheckRequired).to.equal(true);

    const noPkg = buildGigJobOrderFromChildAccount(
      makeInput({ cascade: { ...w2Cascade(), screeningPackageId: null } }),
    ).jobOrderData;
    expect(noPkg.backgroundCheckRequired).to.equal(false);
  });

  it('falls back to account-level workersCompCode when position has none', () => {
    const input = makeInput({
      cascade: {
        ...w2Cascade(),
        positions: [
          { positionId: 'p_event', jobTitle: 'Event Worker', payRate: 18 },
        ],
        // workersCompCode set at top level; position has none.
        workersCompCode: '7777',
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.workersCompCode).to.equal('7777');
  });

  it('preserves position WC code when present (more specific than account-level)', () => {
    const input = makeInput({
      cascade: {
        ...w2Cascade(),
        positions: [
          {
            positionId: 'p_event',
            jobTitle: 'Event Worker',
            payRate: 18,
            workersCompCode: 'POSITION_WIN',
          },
        ],
        workersCompCode: '7777',
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.workersCompCode).to.equal('POSITION_WIN');
  });
});

// Quiet "unused import" warnings from TS — `admin` is declared at file
// scope so the FieldValue stubs install correctly.
void admin;
