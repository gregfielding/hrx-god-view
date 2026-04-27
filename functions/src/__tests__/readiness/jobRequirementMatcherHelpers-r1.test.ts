/**
 * R.1 unit tests for `buildPhaseBMatchSpecs` — covers the new
 * `severity` + `resolutionMethod` stamping and the three-insertion-point
 * resolution chain (D4.R1):
 *
 *   per-instance > parallel-skill-map > requirementSeverityOverrides[type] > DEFAULT_REQUIREMENT_SEVERITY[type]
 *
 * Companion to `jobRequirementMatcherHelpers.test.ts` (status / shape) and
 * `seedAssignmentReadinessItems-r1.test.ts` (seed-time derivation).
 *
 * Mocha + Chai (functions test stack), per `functions/package.json` "test".
 */

import { expect } from 'chai';
import {
  buildPhaseBMatchSpecs,
  type WorkerForMatching,
} from '../../readiness/jobRequirementMatcherHelpers';

const TODAY_ISO = '2026-04-26';
const TODAY_MS = Date.UTC(2026, 3, 26);

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

function buildSpecs(jo: Record<string, unknown>, worker: Partial<WorkerForMatching> = {}) {
  return buildPhaseBMatchSpecs({
    jo,
    worker: { ...blankWorker, ...worker },
    screeningEval: null,
    todayISO: TODAY_ISO,
    todayMs: TODAY_MS,
  });
}

describe('R.1 — resolutionMethod stamping on Phase B specs', () => {
  it("stamps every applicable auto-resolvable spec with resolutionMethod: 'auto'", () => {
    const specs = buildSpecs(
      {
        educationLevelRequiredV2: 'high_school',
        skillsRequired: ['forklift'],
        languagesRequiredV2: [{ language: 'Spanish', minLevel: 'basic' }],
        requiredLicensesV2: [{ licenseClass: 'CDL Class A' }],
      },
      { skills: ['forklift'] },
    );
    // R.2 — `language_willingness` is also seeded against `languagesRequiredV2`
    // and stamps `'self_attest'` per design (D7.R2). Filter to the auto-pathway
    // specs for this R.1 assertion; the self-attest stamp is verified in
    // `jobRequirementMatcherHelpers-r2.test.ts`.
    const autoSpecs = specs.filter((s) => s.requirementType !== 'language_willingness');
    expect(autoSpecs.length).to.be.greaterThan(0);
    for (const s of autoSpecs) {
      expect(s.resolutionMethod).to.equal('auto');
    }
  });

  it("stamps unmapped cert-string fallback specs with resolutionMethod: 'auto'", () => {
    // 'Forklift' is intentionally bare — does not map to the catalog entry
    // 'Forklift Certification (Class I–VII)'. Surfaces as needs_review but
    // still flows through the matcher pathway.
    const specs = buildSpecs({ requiredCertifications: ['Forklift'] });
    const cert = specs.find((s) => s.requirementType === 'cert_match');
    expect(cert).to.exist;
    expect(cert!.status).to.equal('needs_review');
    expect(cert!.resolutionMethod).to.equal('auto');
  });

  it('does not emit specs for not_applicable matcher results', () => {
    const specs = buildSpecs({ educationLevelRequiredV2: 'none' });
    expect(specs).to.have.length(0);
  });
});

describe('R.1 — severity resolution chain (D4.R1)', () => {
  it('falls through to DEFAULT_REQUIREMENT_SEVERITY when no override', () => {
    const specs = buildSpecs(
      {
        educationLevelRequiredV2: 'high_school',
        skillsRequired: ['forklift'],
      },
      {},
    );
    const edu = specs.find((s) => s.requirementType === 'education_match');
    const skill = specs.find((s) => s.requirementType === 'skill_match');
    // Both are 'soft' by default per DEFAULT_REQUIREMENT_SEVERITY.
    expect(edu!.severity).to.equal('soft');
    expect(skill!.severity).to.equal('soft');
  });

  it('applies requirementSeverityOverrides per type (overrides table default)', () => {
    const specs = buildSpecs({
      educationLevelRequiredV2: 'high_school',
      skillsRequired: ['forklift'],
      requirementSeverityOverrides: {
        // JO declares education is critical for this gig.
        education_match: 'hard',
      },
    });
    const edu = specs.find((s) => s.requirementType === 'education_match');
    const skill = specs.find((s) => s.requirementType === 'skill_match');
    expect(edu!.severity).to.equal('hard');
    // skill_match keeps its default 'soft' — only education was overridden.
    expect(skill!.severity).to.equal('soft');
  });

  it('applies skillsRequiredSeverityOverrides keyed by slug (parallel skill map)', () => {
    const specs = buildSpecs({
      skillsRequired: ['forklift', 'pallet jack'],
      // Same slug used by the seeder/matcher: slugify(skill).
      skillsRequiredSeverityOverrides: {
        forklift: 'hard',
        // 'pallet jack' → slug 'pallet_jack'; intentionally not overridden.
      },
    });
    const skills = specs.filter((s) => s.requirementType === 'skill_match');
    const fork = skills.find((s) => s.customKey === 'forklift');
    const pallet = skills.find((s) => s.customKey === 'pallet_jack');
    expect(fork!.severity).to.equal('hard');
    expect(pallet!.severity).to.equal('soft');
  });

  it('per-instance RequiredLicenseV1.severity beats requirementSeverityOverrides', () => {
    const specs = buildSpecs(
      {
        requiredLicensesV2: [
          { licenseClass: 'CDL Class A', severity: 'soft' },
          { licenseClass: 'Forklift' },
        ],
        requirementSeverityOverrides: {
          // JO-level override says all licenses are hard, but the per-instance
          // soft on CDL Class A wins.
          license_match: 'hard',
        },
      },
      {},
    );
    const cdl = specs.find((s) => s.customKey === 'CDL_Class_A');
    const fork = specs.find((s) => s.customKey === 'Forklift');
    expect(cdl!.severity).to.equal('soft');
    // No per-instance value on Forklift → JO override wins → hard.
    expect(fork!.severity).to.equal('hard');
  });

  it('per-instance RequiredLanguageV1.severity beats type override', () => {
    const specs = buildSpecs({
      languagesRequiredV2: [
        { language: 'Spanish', minLevel: 'fluent', severity: 'hard' },
        { language: 'French', minLevel: 'basic' },
      ],
      requirementSeverityOverrides: { language_match: 'hard' },
    });
    const es = specs.find((s) => s.customKey === 'Spanish');
    const fr = specs.find((s) => s.customKey === 'French');
    expect(es!.severity).to.equal('hard');
    // No per-instance on French → JO override wins → hard.
    expect(fr!.severity).to.equal('hard');
  });

  it('skillsRequiredSeverityOverrides[slug] beats requirementSeverityOverrides.skill_match', () => {
    const specs = buildSpecs({
      skillsRequired: ['forklift', 'pallet jack'],
      skillsRequiredSeverityOverrides: { forklift: 'soft' },
      // Type-level override says all skills are hard; the parallel-map entry
      // for 'forklift' overrides that to soft for that one skill.
      requirementSeverityOverrides: { skill_match: 'hard' },
    });
    const fork = specs.find((s) => s.customKey === 'forklift');
    const pallet = specs.find((s) => s.customKey === 'pallet_jack');
    expect(fork!.severity).to.equal('soft');
    // 'pallet jack' has no parallel-map entry → falls to type override 'hard'.
    expect(pallet!.severity).to.equal('hard');
  });

  it('ignores malformed values in the override maps (defensive)', () => {
    const specs = buildSpecs({
      skillsRequired: ['forklift'],
      skillsRequiredSeverityOverrides: { forklift: 'bogus' as never },
      requirementSeverityOverrides: { skill_match: 'also_bogus' as never },
    });
    const skill = specs.find((s) => s.requirementType === 'skill_match');
    // Both override slots are malformed → falls through to table default.
    expect(skill!.severity).to.equal('soft');
  });
});
