/**
 * Phase C.1a unit tests for `stampExpiryOnSpecs`.
 *
 * Covers the seed-time expiration metadata stamping for license_match and
 * screening_package_match items. Other types must NOT be stamped.
 *
 * Mocha + Chai per `functions/package.json` test script.
 */

import { expect } from 'chai';
import { stampExpiryOnSpecs } from '../../readiness/assignmentMatchExpiryHelpers';
import type { SeedAssignmentReadinessRequirementSpec } from '../../shared/seedAssignmentReadinessItems';
import type { LicenseRecordV1, RequiredLicenseV1 } from '../../shared/licenseRecord';
import type { ScreeningEvalResult } from '../../shared/jobRequirementMatchers/matchScreeningPackage';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 3, 25);

const cdlA: LicenseRecordV1 = {
  schemaVersion: 1,
  licenseClass: 'CDL Class A',
  endorsements: ['H'],
  expirationDate: '2028-06-15',
};

const reqCdlA: RequiredLicenseV1 = { licenseClass: 'CDL Class A', requiredEndorsements: ['H'] };

const passingScreening: ScreeningEvalResult = {
  satisfied: true,
  equivalencyKey: 'id:CORT_PLUS',
  expiresAtMs: NOW + 30 * 24 * HOUR,
  decisionDetail: 'Satisfied',
};

function spec(
  requirementType: SeedAssignmentReadinessRequirementSpec['requirementType'],
  status: SeedAssignmentReadinessRequirementSpec['status'],
  customKey?: string,
): SeedAssignmentReadinessRequirementSpec {
  const s: SeedAssignmentReadinessRequirementSpec = { requirementType, status };
  if (customKey) s.customKey = customKey;
  return s;
}

describe('stampExpiryOnSpecs — license_match', () => {
  it('stamps expiresAtMs at start-of-day-after expirationDate (matches matchLicenses semantics)', () => {
    // expirationDate '2028-06-15' → license valid through end of June 15 →
    // expiresAtMs = midnight UTC June 16. Reconciler's `< nowMs` then aligns
    // with matchLicenses' `expirationDate < todayISO` failure condition.
    const specs = [spec('license_match', 'complete_pass', 'CDL_Class_A')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: [cdlA],
      requiredLicensesV2: [reqCdlA],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.equal(Date.UTC(2028, 5, 16));
  });

  it('does NOT stamp when status is not complete_pass', () => {
    const specs = [spec('license_match', 'complete_fail', 'CDL_Class_A')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: [cdlA],
      requiredLicensesV2: [reqCdlA],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });

  it('does NOT stamp when matched license has no expirationDate', () => {
    const noExp: LicenseRecordV1 = { schemaVersion: 1, licenseClass: 'Forklift' };
    const specs = [spec('license_match', 'complete_pass', 'Forklift')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: [noExp],
      requiredLicensesV2: [{ licenseClass: 'Forklift' }],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });

  it('does NOT stamp when worker has no licenses', () => {
    const specs = [spec('license_match', 'complete_pass', 'CDL_Class_A')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: null,
      requiredLicensesV2: [reqCdlA],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });

  it('rejects non-ISO date strings (defensive — no garbage in)', () => {
    const bad: LicenseRecordV1 = {
      schemaVersion: 1,
      licenseClass: 'Forklift',
      expirationDate: 'next year',
    };
    const specs = [spec('license_match', 'complete_pass', 'Forklift')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: [bad],
      requiredLicensesV2: [{ licenseClass: 'Forklift' }],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });

  it('matches license class case-insensitively when finding worker license', () => {
    const lowerCase: LicenseRecordV1 = {
      schemaVersion: 1,
      licenseClass: 'cdl class a',
      expirationDate: '2030-01-01',
    };
    const specs = [spec('license_match', 'complete_pass', 'CDL_Class_A')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: [lowerCase],
      requiredLicensesV2: [reqCdlA],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.equal(Date.UTC(2030, 0, 2));
  });
});

describe('stampExpiryOnSpecs — screening_package_match', () => {
  it('stamps expiresAtMs from the screening eval result', () => {
    const specs = [spec('screening_package_match', 'complete_pass')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: null,
      requiredLicensesV2: [],
      screeningEval: passingScreening,
    });
    expect(specs[0].expiresAtMs).to.equal(passingScreening.expiresAtMs);
  });

  it('does NOT stamp when status is not complete_pass', () => {
    const specs = [spec('screening_package_match', 'complete_fail')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: null,
      requiredLicensesV2: [],
      screeningEval: passingScreening,
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });

  it('does NOT stamp when eval result is null', () => {
    const specs = [spec('screening_package_match', 'complete_pass')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: null,
      requiredLicensesV2: [],
      screeningEval: null,
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });

  it('does NOT stamp when eval result has null expiresAtMs', () => {
    const specs = [spec('screening_package_match', 'complete_pass')];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: null,
      requiredLicensesV2: [],
      screeningEval: { ...passingScreening, expiresAtMs: null },
    });
    expect(specs[0].expiresAtMs).to.be.undefined;
  });
});

describe('stampExpiryOnSpecs — non-expiring types', () => {
  it.each = undefined; // mocha doesn't support .each by default; use a forEach loop
  const types: SeedAssignmentReadinessRequirementSpec['requirementType'][] = [
    'cert_match',
    'skill_match',
    'education_match',
    'language_match',
    'shift_confirmation',
    'background_check',
    'orientation',
    'ppe_acknowledgement',
  ];
  for (const t of types) {
    it(`does NOT stamp expiresAtMs on ${t}`, () => {
      const specs = [spec(t, 'complete_pass', 'k')];
      stampExpiryOnSpecs({
        specs,
        workerLicenses: [cdlA],
        requiredLicensesV2: [reqCdlA],
        screeningEval: passingScreening,
      });
      expect(specs[0].expiresAtMs).to.be.undefined;
    });
  }
});

describe('stampExpiryOnSpecs — composite', () => {
  it('stamps the right specs in a mixed batch and leaves others alone', () => {
    const specs: SeedAssignmentReadinessRequirementSpec[] = [
      spec('license_match', 'complete_pass', 'CDL_Class_A'),
      spec('skill_match', 'complete_pass', 'forklift'),
      spec('screening_package_match', 'complete_pass'),
      spec('education_match', 'complete_pass'),
      spec('cert_match', 'incomplete', 'osha'),
    ];
    stampExpiryOnSpecs({
      specs,
      workerLicenses: [cdlA],
      requiredLicensesV2: [reqCdlA],
      screeningEval: passingScreening,
    });
    expect(specs[0].expiresAtMs).to.equal(Date.UTC(2028, 5, 16)); // license (start of day after expirationDate)
    expect(specs[1].expiresAtMs).to.be.undefined; // skill
    expect(specs[2].expiresAtMs).to.equal(passingScreening.expiresAtMs); // screening
    expect(specs[3].expiresAtMs).to.be.undefined; // education
    expect(specs[4].expiresAtMs).to.be.undefined; // cert (incomplete status)
  });

  it('returns the same array reference (mutation, for ergonomic chaining)', () => {
    const specs: SeedAssignmentReadinessRequirementSpec[] = [];
    const result = stampExpiryOnSpecs({
      specs,
      workerLicenses: null,
      requiredLicensesV2: [],
      screeningEval: null,
    });
    expect(result).to.equal(specs);
  });
});
