/**
 * Phase B.5 unit tests for `jobRequirementMatcherHelpers`.
 *
 * Covers `buildPhaseBMatchSpecs` (the pure spec generator that fans the
 * matchers over a JO + worker projection) and the `slugify` helper.
 *
 * Skips the I/O-heavy loaders (`loadWorkerForMatching`,
 * `loadScreeningEvalForJobOrder`) — those are exercised end-to-end at trigger
 * fire time; mocking the admin SDK here would obscure more than it asserts.
 *
 * Mocha + Chai (functions test stack), per `functions/package.json` "test".
 */

import { expect } from 'chai';
import {
  buildPhaseBMatchSpecs,
  slugify,
  type WorkerForMatching,
} from '../../readiness/jobRequirementMatcherHelpers';
import type { ScreeningEvalResult } from '../../shared/jobRequirementMatchers/matchScreeningPackage';
import type { LicenseRecordV1 } from '../../shared/licenseRecord';

const TODAY_ISO = '2026-04-25';
const TODAY_MS = Date.UTC(2026, 3, 25);

const blankWorker: WorkerForMatching = {
  uid: 'w1',
  educationLevelV2: null,
  legacyEducationLevel: null,
  languagesV2: null,
  legacyLanguages: null,
  skills: null,
  licenses: null,
};

function buildSpecs(jo: Record<string, unknown>, worker: Partial<WorkerForMatching> = {}, screeningEval: ScreeningEvalResult | null = null) {
  return buildPhaseBMatchSpecs({
    jo,
    worker: { ...blankWorker, ...worker },
    screeningEval,
    todayISO: TODAY_ISO,
    todayMs: TODAY_MS,
  });
}

describe('slugify', () => {
  it('replaces non-alphanumerics with single underscores', () => {
    expect(slugify('CDL Class A')).to.equal('CDL_Class_A');
    expect(slugify('OSHA-30 General/Industry!')).to.equal('OSHA_30_General_Industry');
  });

  it('strips leading and trailing underscores', () => {
    expect(slugify('   forklift   ')).to.equal('forklift');
    expect(slugify('!!hello!!')).to.equal('hello');
  });

  it('passes through clean strings unchanged', () => {
    expect(slugify('forklift_basic')).to.equal('forklift_basic');
  });
});

describe('buildPhaseBMatchSpecs — empty JO', () => {
  it('returns no specs when JO has no Phase B requirements', () => {
    const specs = buildSpecs({});
    expect(specs).to.have.length(0);
  });
});

describe('buildPhaseBMatchSpecs — education_match', () => {
  it('emits a spec when JO requires educationLevelRequiredV2', () => {
    const specs = buildSpecs({ educationLevelRequiredV2: 'high_school' });
    expect(specs).to.have.length(1);
    expect(specs[0].requirementType).to.equal('education_match');
    // No worker level → matcher returns 'incomplete'
    expect(specs[0].status).to.equal('incomplete');
  });

  it('skips when JO requirement is "none" (not_applicable from matcher)', () => {
    const specs = buildSpecs({ educationLevelRequiredV2: 'none' });
    expect(specs).to.have.length(0);
  });

  it('uses worker V2 level to compute pass', () => {
    const specs = buildSpecs(
      { educationLevelRequiredV2: 'high_school' },
      { educationLevelV2: 'bachelor' },
    );
    expect(specs[0].status).to.equal('complete_pass');
  });

  it('falls back to legacy education level', () => {
    const specs = buildSpecs(
      { educationLevelRequiredV2: 'high_school' },
      { legacyEducationLevel: 'highschool' },
    );
    expect(specs[0].status).to.equal('complete_pass');
  });
});

describe('buildPhaseBMatchSpecs — language_match', () => {
  it('emits one spec per language requirement', () => {
    const specs = buildSpecs({
      languagesRequiredV2: [
        { language: 'Spanish', minLevel: 'conversational' },
        { language: 'French', minLevel: 'basic' },
      ],
    });
    const langSpecs = specs.filter((s) => s.requirementType === 'language_match');
    expect(langSpecs).to.have.length(2);
    expect(langSpecs[0].customKey).to.equal('Spanish');
    expect(langSpecs[1].customKey).to.equal('French');
  });

  it('computes pass/fail using worker V2 languages', () => {
    const specs = buildSpecs(
      {
        languagesRequiredV2: [
          { language: 'Spanish', minLevel: 'fluent' },
          { language: 'French', minLevel: 'basic' },
        ],
      },
      {
        languagesV2: [
          { language: 'Spanish', level: 'native' },
          { language: 'German', level: 'basic' },
        ],
      },
    );
    expect(specs[0].status).to.equal('complete_pass'); // Spanish native >= fluent
    expect(specs[1].status).to.equal('incomplete');     // French not on profile
  });

  it('ignores malformed entries (invalid level / missing language)', () => {
    const specs = buildSpecs({
      languagesRequiredV2: [
        { language: 'Spanish', minLevel: 'fluent' },
        { language: '', minLevel: 'basic' },                  // empty
        { language: 'French', minLevel: 'expert' as never },  // invalid level
        { foo: 'bar' },                                        // bogus shape
      ],
    });
    expect(specs.filter((s) => s.requirementType === 'language_match')).to.have.length(1);
  });
});

describe('buildPhaseBMatchSpecs — skill_match', () => {
  it('emits one spec per skill in JO.skillsRequired (defaults to tokenized strictness)', () => {
    const specs = buildSpecs(
      { skillsRequired: ['forklift', 'pallet jack'] },
      { skills: ['Certified Forklift Operator'] },
    );
    const skillSpecs = specs.filter((s) => s.requirementType === 'skill_match');
    expect(skillSpecs).to.have.length(2);
    expect(skillSpecs[0].status).to.equal('complete_pass');
    expect(skillSpecs[1].status).to.equal('complete_fail');
  });

  it('skips empty / whitespace-only skill entries', () => {
    const specs = buildSpecs({ skillsRequired: ['', '   ', 'forklift'] });
    expect(specs.filter((s) => s.requirementType === 'skill_match')).to.have.length(1);
  });
});

describe('buildPhaseBMatchSpecs — license_match', () => {
  const cdlA: LicenseRecordV1 = {
    schemaVersion: 1,
    licenseClass: 'CDL Class A',
    endorsements: ['H', 'T'],
    expirationDate: '2030-01-01',
  };

  it('emits a spec per requiredLicensesV2 entry', () => {
    const specs = buildSpecs(
      {
        requiredLicensesV2: [
          { licenseClass: 'CDL Class A', requiredEndorsements: ['H'] },
          { licenseClass: 'Forklift' },
        ],
      },
      { licenses: [cdlA] },
    );
    const licSpecs = specs.filter((s) => s.requirementType === 'license_match');
    expect(licSpecs).to.have.length(2);
    expect(licSpecs[0].status).to.equal('complete_pass'); // CDL A held with H
    expect(licSpecs[1].status).to.equal('complete_fail'); // Forklift not held
  });

  it('uses customKey/label derived from licenseClass', () => {
    const specs = buildSpecs(
      { requiredLicensesV2: [{ licenseClass: 'CDL Class A' }] },
      { licenses: [] },
    );
    expect(specs[0].customKey).to.equal('CDL_Class_A');
    expect(specs[0].requirementLabel).to.equal('CDL Class A');
  });
});

describe('buildPhaseBMatchSpecs — cert_match (B.5 shells)', () => {
  it('seeds N cert_match items, one per requiredCertifications entry, all incomplete', () => {
    const specs = buildSpecs({ requiredCertifications: ['Forklift', 'OSHA-30'] });
    const certSpecs = specs.filter((s) => s.requirementType === 'cert_match');
    expect(certSpecs).to.have.length(2);
    for (const s of certSpecs) {
      // Status omitted → seed runner defaults to 'incomplete' (B.5.1 wires engine)
      expect(s.status).to.be.undefined;
    }
    expect(certSpecs[0].customKey).to.equal('Forklift');
    expect(certSpecs[1].customKey).to.equal('OSHA_30');
  });

  it('skips empty / whitespace-only cert entries', () => {
    const specs = buildSpecs({ requiredCertifications: ['', 'Forklift'] });
    expect(specs.filter((s) => s.requirementType === 'cert_match')).to.have.length(1);
  });
});

describe('buildPhaseBMatchSpecs — screening_package_match', () => {
  it('emits a spec when JO has screeningPackageId, status from matchScreeningPackage', () => {
    const specs = buildSpecs(
      { screeningPackageId: 'CORT_PLUS' },
      {},
      {
        satisfied: true,
        equivalencyKey: 'id:CORT_PLUS',
        expiresAtMs: TODAY_MS + 30 * 86_400_000,
        decisionDetail: 'ok',
      },
    );
    const sp = specs.find((s) => s.requirementType === 'screening_package_match');
    expect(sp, 'screening spec present').to.exist;
    expect(sp!.status).to.equal('complete_pass');
  });

  it('emits incomplete when no screening eval result (worker has no record)', () => {
    const specs = buildSpecs({ screeningPackageId: 'CORT_PLUS' }, {}, null);
    const sp = specs.find((s) => s.requirementType === 'screening_package_match');
    expect(sp!.status).to.equal('incomplete');
  });

  it('skips entirely when JO has no screening package', () => {
    const specs = buildSpecs({});
    expect(specs.filter((s) => s.requirementType === 'screening_package_match')).to.have.length(0);
  });
});

describe('buildPhaseBMatchSpecs — composite JO', () => {
  it('emits the right cardinality across all requirement categories', () => {
    const specs = buildSpecs(
      {
        educationLevelRequiredV2: 'bachelor',
        languagesRequiredV2: [{ language: 'Spanish', minLevel: 'fluent' }],
        skillsRequired: ['forklift', 'pallet jack'],
        requiredCertifications: ['Forklift', 'OSHA-30'],
        requiredLicensesV2: [{ licenseClass: 'Forklift' }],
        screeningPackageId: 'CORT_PLUS',
      },
      {
        educationLevelV2: 'master',
        languagesV2: [{ language: 'Spanish', level: 'native' }],
        skills: ['Certified Forklift Operator', 'Pallet Jack Pro'],
        licenses: [{ schemaVersion: 1, licenseClass: 'Forklift' }],
      },
      null,
    );
    const byType: Record<string, number> = {};
    for (const s of specs) byType[s.requirementType] = (byType[s.requirementType] ?? 0) + 1;
    expect(byType).to.deep.equal({
      education_match: 1,
      language_match: 1,
      skill_match: 2,
      cert_match: 2,
      license_match: 1,
      screening_package_match: 1,
    });
  });
});
