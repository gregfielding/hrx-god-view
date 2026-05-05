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
  resolveCompanyLocationFromChildAccount,
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
    screeningPackageName: 'CORT Basic',
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
    // 2026-05-05 — `accountOrderDetails` / `attachmentFiles` extend the
    // resolved cascade so the builder can flow account-level Compliance
    // Defaults + file uploads onto the JO. Default fixture stays empty so
    // existing tests still assert "no compliance defaults set" semantics
    // and the new fields don't leak into unrelated assertions.
    attachmentFiles: [],
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
    // F.4 chain (CC.B 2026-05-05): cascade-resolved description lands on
    // `jobDescriptionFromClient` (the prompt-input field), not
    // `jobDescription` (the AI-generated public-facing copy, which the
    // recruiter generates via "Generate Job Description" on the Jobs Board
    // tab and stays empty on auto-create).
    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal('Furniture handling at events');

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
    expect(jobOrderData.screeningPackageName).to.equal('CORT Basic');
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

  it('overlays position orderDetails + screening package onto cascade defaults', () => {
    const { jobOrderData } = buildGigJobOrderFromChildAccount(
      makeInput({
        cascade: {
          ...w2Cascade(),
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
              orderDetails: {
                additionalScreenings: ['extra_screen'],
                licensesCerts: ['CDL'],
                skillsRequired: ['Lift 50 lbs'],
              },
              screeningPackageId: 'PKG_POSITION',
              screeningPackageName: 'Position Package',
            },
          ],
        },
      }),
    );
    expect(jobOrderData.screeningPackageId).to.equal('PKG_POSITION');
    expect(jobOrderData.screeningPackageName).to.equal('Position Package');
    expect(jobOrderData.additionalScreenings).to.deep.equal(['extra_screen']);
    expect(jobOrderData.licensesCerts).to.deep.equal(['CDL']);
    expect(jobOrderData.skillsRequired).to.deep.equal(['Lift 50 lbs']);
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

  it('F.4 — parent.defaultGigJobDescription wins over position text', () => {
    const input = makeInput({
      parentAccount: {
        ...fullCascadeParent(),
        defaultGigJobTitle: 'Warehouse Associate',
        defaultGigJobDescription: 'Greg seed copy for CORT gig JOs.',
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.jobTitle).to.equal('Warehouse Associate');
    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal('Greg seed copy for CORT gig JOs.');
  });

  it('F.4 — only National title set: description falls back to position', () => {
    const input = makeInput({
      parentAccount: {
        ...fullCascadeParent(),
        defaultGigJobTitle: 'Warehouse Associate',
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.jobTitle).to.equal('Warehouse Associate');
    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal('Furniture handling at events');
  });

  it('F.4 — neither National default nor usable position description → empty string', () => {
    const input = makeInput({
      cascade: {
        ...w2Cascade(),
        positions: [
          {
            positionId: 'p_event',
            jobTitle: 'Event Worker',
            // Intentionally omit jobDescription — builder should land on ''.
            payRate: 18,
            billRate: 24.84,
            markupPercentage: 38,
            workersCompCode: '8015',
            workersCompRate: 9.15,
          },
        ],
      },
    });
    const { jobOrderData } = buildGigJobOrderFromChildAccount(input);
    expect(jobOrderData.jobTitle).to.equal('Event Worker');
    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal('');
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
    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal('');
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
      makeInput({
        cascade: { ...w2Cascade(), screeningPackageId: null, screeningPackageName: null },
      }),
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

// ─────────────────────────────────────────────────────────────────────
// 2026-05-05 — account-level Compliance Defaults + attachments propagation
// ─────────────────────────────────────────────────────────────────────
//
// Pre-fix, the auto-JO only read compliance arrays from the lead position's
// `orderDetails`, so anything the National (or child) typed into the
// Cascading Data → Compliance Defaults section never reached the JO. These
// tests pin the new layering: position OD overlays account-level merged OD,
// which overlays the engine-resolved `additionalScreenings`. They also
// exercise the widened `jobDescription` fallback chain Greg's CORT setup
// surfaced (description on the position row's `jobDescriptionFromClient`).

describe('buildGigJobOrderFromChildAccount — account compliance + attachments', () => {
  it('writes account-level compliance arrays onto the JO when no position override is set', () => {
    const { jobOrderData } = buildGigJobOrderFromChildAccount(
      makeInput({
        cascade: {
          ...w2Cascade(),
          accountOrderDetails: {
            physicalRequirements: ['Lifting 50 lbs', 'Standing'],
            skillsRequired: ['Forklift'],
            languagesRequired: ['English'],
            ppeRequirements: ['Steel-Toe Boots'],
            ppeProvidedBy: 'worker',
            licensesCerts: ['OSHA 10'],
            educationRequired: 'High school diploma',
            experienceRequired: '1+ year warehouse',
            customUniformRequirements: 'Red CORT shirt provided onsite',
            requirementPackId: 'pack_warehouse_default',
            dressCode: ['Casual'],
          },
          attachmentFiles: [
            { name: 'CORT Worker FAQ.pdf', label: 'Worker FAQ', url: 'https://...', uploadedAt: 1715000000000 },
          ],
        },
      }),
    );

    expect(jobOrderData.physicalRequirements).to.deep.equal(['Lifting 50 lbs', 'Standing']);
    expect(jobOrderData.skillsRequired).to.deep.equal(['Forklift']);
    expect(jobOrderData.languagesRequired).to.deep.equal(['English']);
    expect(jobOrderData.ppeRequirements).to.deep.equal(['Steel-Toe Boots']);
    expect(jobOrderData.ppeProvidedBy).to.equal('worker');
    expect(jobOrderData.licensesCerts).to.deep.equal(['OSHA 10']);
    // requiredCertifications mirrors licensesCerts so legacy readers see the same list.
    expect(jobOrderData.requiredCertifications).to.deep.equal(['OSHA 10']);
    expect(jobOrderData.educationRequired).to.equal('High school diploma');
    expect(jobOrderData.experienceRequired).to.equal('1+ year warehouse');
    expect(jobOrderData.customUniformRequirements).to.equal('Red CORT shirt provided onsite');
    expect(jobOrderData.requirementPackId).to.equal('pack_warehouse_default');
    expect(jobOrderData.dressCode).to.deep.equal(['Casual']);
    expect(jobOrderData.attachments).to.deep.equal({
      files: [
        { name: 'CORT Worker FAQ.pdf', label: 'Worker FAQ', url: 'https://...', uploadedAt: 1715000000000 },
      ],
    });
  });

  it('position orderDetails wins over account-level for the same field', () => {
    const { jobOrderData } = buildGigJobOrderFromChildAccount(
      makeInput({
        cascade: {
          ...w2Cascade(),
          accountOrderDetails: {
            physicalRequirements: ['Lifting 50 lbs'],
            skillsRequired: ['Forklift'],
          },
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
              orderDetails: {
                physicalRequirements: ['Lifting 75 lbs'],
                // skillsRequired intentionally omitted — account value should still win through.
              },
            },
          ],
        },
      }),
    );

    expect(jobOrderData.physicalRequirements).to.deep.equal(['Lifting 75 lbs']);
    expect(jobOrderData.skillsRequired).to.deep.equal(['Forklift']);
  });

  it('falls back to position.jobDescriptionFromClient when nothing earlier in the chain has a value', () => {
    const { jobOrderData } = buildGigJobOrderFromChildAccount(
      makeInput({
        parentAccount: {
          ...fullCascadeParent(),
          // no defaultGigJobDescription
        },
        cascade: {
          ...w2Cascade(),
          positions: [
            {
              positionId: 'p_event',
              jobTitle: 'Event Worker',
              // no jobDescription
              jobDescriptionFromClient:
                'Client-pasted description from the National pricing row.',
              payRate: 18,
              billRate: 24.84,
              markupPercentage: 38,
            } as ResolvedPosition & { jobDescriptionFromClient?: string },
          ],
        },
      }),
    );

    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal(
      'Client-pasted description from the National pricing row.',
    );
  });

  it('falls back to childAccount.defaultGigJobDescription when the National had none', () => {
    const { jobOrderData } = buildGigJobOrderFromChildAccount(
      makeInput({
        parentAccount: { ...fullCascadeParent() },
        childAccount: {
          ...fullCascadeChild(),
          defaultGigJobDescription: 'Child-level seed description.',
        } as AccountDoc & { id: string; defaultGigJobDescription?: string },
        cascade: {
          ...w2Cascade(),
          positions: [
            {
              positionId: 'p_event',
              jobTitle: 'Event Worker',
              // no jobDescription, no jobDescriptionFromClient
              payRate: 18,
              billRate: 24.84,
              markupPercentage: 38,
            },
          ],
        },
      }),
    );

    expect(jobOrderData.jobDescription).to.equal('');
    expect(jobOrderData.jobDescriptionFromClient).to.equal('Child-level seed description.');
  });

  it('writes empty `attachments.files: []` when neither account has attachments', () => {
    const { jobOrderData } = buildGigJobOrderFromChildAccount(makeInput());
    expect(jobOrderData.attachments).to.deep.equal({ files: [] });
  });
});

describe('resolveCompanyLocationFromChildAccount', () => {
  it('prefers top-level companyId + companyLocationId when both set', () => {
    const r = resolveCompanyLocationFromChildAccount({
      companyId: 'c_top',
      companyLocationId: 'loc_top',
      associations: { locations: [{ companyId: 'c_other', locationId: 'loc_other' }] },
    });
    expect(r).to.deep.equal({ companyId: 'c_top', locationId: 'loc_top' });
  });

  it('falls back to associations.locations[0] when top-level pair incomplete', () => {
    const r = resolveCompanyLocationFromChildAccount({
      associations: {
        locations: [{ companyId: 'crm_co', locationId: 'loc_from_assoc' }],
      },
    });
    expect(r).to.deep.equal({ companyId: 'crm_co', locationId: 'loc_from_assoc' });
  });

  it('returns null when no company/location refs exist', () => {
    expect(resolveCompanyLocationFromChildAccount({ name: 'orphan' })).to.equal(null);
  });
});

// Quiet "unused import" warnings from TS — `admin` is declared at file
// scope so the FieldValue stubs install correctly.
void admin;
