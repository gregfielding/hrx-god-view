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
  type WorkerCertRecordsIndex,
  type WorkerForMatching,
} from '../../readiness/jobRequirementMatcherHelpers';
import type { ScreeningEvalResult } from '../../shared/jobRequirementMatchers/matchScreeningPackage';
import type { LicenseRecordV1 } from '../../shared/licenseRecord';
import type { CertificationRecordV1 } from '../../shared/certifications/certificationRecord';

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
  workerAttestations: null,
};

function buildSpecs(
  jo: Record<string, unknown>,
  worker: Partial<WorkerForMatching> = {},
  screeningEval: ScreeningEvalResult | null = null,
  workerCertRecords?: WorkerCertRecordsIndex,
) {
  return buildPhaseBMatchSpecs({
    jo,
    worker: { ...blankWorker, ...worker },
    screeningEval,
    workerCertRecords,
    todayISO: TODAY_ISO,
    todayMs: TODAY_MS,
  });
}

/** Build a minimal `WorkerCertRecordsIndex` from a list of {catalogEntryId, record} pairs. */
function certIndex(
  entries: Array<{ catalogEntryId: string; record: CertificationRecordV1; recordId?: string }>,
): WorkerCertRecordsIndex {
  const map: WorkerCertRecordsIndex = new Map();
  for (const e of entries) {
    map.set(e.catalogEntryId, {
      record: e.record,
      certificationRecordId: e.recordId ?? `rec_${e.catalogEntryId}`,
    });
  }
  return map;
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

describe('buildPhaseBMatchSpecs — cert_match (B.5.1 engine-driven)', () => {
  // 'OSHA-30' normalizes via the catalog manifest to catalogEntryId 'osha-30'.
  // 'OSHA 10' → 'osha-10'. 'Forklift' (bare word) does NOT match the manifest's
  // 'Forklift Certification (Class I–VII)' entry — it surfaces as unmapped, so
  // we use it intentionally below to exercise the unmapped-string path.
  const OSHA_30_ID = 'osha-30';
  const OSHA_10_ID = 'osha-10';

  /** Build a `CertificationRecordV1` with sensible defaults; override fields per test. */
  function rec(overrides: Partial<CertificationRecordV1> & { catalogEntryId: string }): CertificationRecordV1 {
    return {
      schemaVersion: 1,
      catalogEntryId: overrides.catalogEntryId,
      expirationDate: '2030-01-01',
      review: { status: 'approved' },
      recordStatus: 'active',
      source: 'worker_upload',
      evidenceFileRefs: [{ storageUrl: 'https://example.com/file.pdf' }],
      ...overrides,
    };
  }

  it('emits one cert_match per resolved requirement; missing record → incomplete', () => {
    const specs = buildSpecs({ requiredCertifications: ['OSHA-30', 'OSHA 10'] });
    const certSpecs = specs.filter((s) => s.requirementType === 'cert_match');
    expect(certSpecs).to.have.length(2);
    for (const s of certSpecs) {
      expect(s.status).to.equal('incomplete');
    }
    // customKey is the slugified catalogEntryId (canonical) — not the raw JO string.
    expect(certSpecs.map((s) => s.customKey).sort()).to.deep.equal(['osha_10', 'osha_30']);
    // requirementLabel preserves the original JO string for display continuity.
    expect(certSpecs.map((s) => s.requirementLabel).sort()).to.deep.equal(['OSHA 10', 'OSHA-30']);
  });

  it('approved active record → complete_pass', () => {
    const specs = buildSpecs(
      { requiredCertifications: ['OSHA-30'] },
      {},
      null,
      certIndex([{ catalogEntryId: OSHA_30_ID, record: rec({ catalogEntryId: OSHA_30_ID }) }]),
    );
    const cert = specs.find((s) => s.requirementType === 'cert_match');
    expect(cert!.status).to.equal('complete_pass');
  });

  it('expired record → complete_fail', () => {
    const specs = buildSpecs(
      { requiredCertifications: ['OSHA-30'] },
      {},
      null,
      certIndex([
        {
          catalogEntryId: OSHA_30_ID,
          record: rec({ catalogEntryId: OSHA_30_ID, expirationDate: '2020-01-01' }),
        },
      ]),
    );
    const cert = specs.find((s) => s.requirementType === 'cert_match');
    expect(cert!.status).to.equal('complete_fail');
  });

  it('rejected record → complete_fail', () => {
    const specs = buildSpecs(
      { requiredCertifications: ['OSHA-30'] },
      {},
      null,
      certIndex([
        {
          catalogEntryId: OSHA_30_ID,
          record: rec({
            catalogEntryId: OSHA_30_ID,
            recordStatus: 'rejected',
            review: { status: 'rejected', rejectionReason: 'unreadable' },
          }),
        },
      ]),
    );
    const cert = specs.find((s) => s.requirementType === 'cert_match');
    expect(cert!.status).to.equal('complete_fail');
  });

  it('pending review record → needs_review', () => {
    const specs = buildSpecs(
      { requiredCertifications: ['OSHA-30'] },
      {},
      null,
      certIndex([
        {
          catalogEntryId: OSHA_30_ID,
          record: rec({
            catalogEntryId: OSHA_30_ID,
            recordStatus: 'pending_review',
            review: { status: 'submitted' },
          }),
        },
      ]),
    );
    const cert = specs.find((s) => s.requirementType === 'cert_match');
    expect(cert!.status).to.equal('needs_review');
  });

  it('unmapped JO string → emits a needs_review cert_match (so a CSA notices)', () => {
    // 'Forklift' (bare) doesn't match the manifest entry's lookup key.
    const specs = buildSpecs({ requiredCertifications: ['Forklift'] });
    const cert = specs.find((s) => s.requirementType === 'cert_match');
    expect(cert, 'unmapped string still produces a cert_match item').to.exist;
    expect(cert!.status).to.equal('needs_review');
    expect(cert!.requirementLabel).to.equal('Forklift');
    expect(cert!.customKey).to.equal('Forklift');
  });

  it('mixed mapped + unmapped + missing → one item per JO string', () => {
    const specs = buildSpecs(
      { requiredCertifications: ['OSHA-30', 'OSHA 10', 'Forklift'] },
      {},
      null,
      certIndex([{ catalogEntryId: OSHA_30_ID, record: rec({ catalogEntryId: OSHA_30_ID }) }]),
    );
    const certSpecs = specs.filter((s) => s.requirementType === 'cert_match');
    expect(certSpecs).to.have.length(3);
    const byKey = new Map(certSpecs.map((s) => [s.customKey, s.status]));
    expect(byKey.get('osha_30')).to.equal('complete_pass');
    expect(byKey.get('osha_10')).to.equal('incomplete');
    expect(byKey.get('Forklift')).to.equal('needs_review');
  });

  it('skips empty / whitespace-only cert entries', () => {
    const specs = buildSpecs({ requiredCertifications: ['', '   ', 'OSHA-30'] });
    expect(specs.filter((s) => s.requirementType === 'cert_match')).to.have.length(1);
  });

  it('deduplicates JO strings that resolve to the same catalogEntryId', () => {
    // Both 'OSHA-30' and 'osha 30' normalize to the same catalog id; the
    // engine's mapper deduplicates → one cert_match emitted.
    const specs = buildSpecs({ requiredCertifications: ['OSHA-30', 'osha 30'] });
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
    // Cert path: 'OSHA-30' maps → catalog id 'osha-30'; 'OSHA 10' maps → 'osha-10'.
    // Both resolve cleanly → 2 cert_match items, both 'incomplete' (no records supplied).
    const specs = buildSpecs(
      {
        educationLevelRequiredV2: 'bachelor',
        languagesRequiredV2: [{ language: 'Spanish', minLevel: 'fluent' }],
        skillsRequired: ['forklift', 'pallet jack'],
        requiredCertifications: ['OSHA-30', 'OSHA 10'],
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
      // R.2 — `language_willingness` co-seeds with `language_match` whenever
      // `languagesRequiredV2` is populated (gate-only; no `worker.workerAttestations`
      // here so the spec stamps `'incomplete'` + `'self_attest'`).
      language_willingness: 1,
      skill_match: 2,
      cert_match: 2,
      license_match: 1,
      screening_package_match: 1,
    });
  });
});
