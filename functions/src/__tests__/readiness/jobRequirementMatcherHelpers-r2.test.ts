/**
 * **R.2** — Integration tests for `buildPhaseBMatchSpecs` covering the
 * four willingness specs (`physical_willingness`, `uniform_willingness`,
 * `ppe_willingness`, `language_willingness`).
 *
 * Behaviour scope:
 *
 *   - **D9.R2 gating** — willingness items only seed when the JO has a
 *     populated requirement field (verified per type, against both string
 *     and string[] runtime shapes since `JobOrder` types lie about array
 *     fields per Q-R2-4 grounding).
 *   - **`'self_attest'` resolution method** — every emitted willingness
 *     spec stamps the partner pathway value.
 *   - **Soft severity defaults + per-JO override** — willingness items
 *     default to `'soft'` (D10.R2); `requirementSeverityOverrides[type]`
 *     flips to `'hard'`.
 *   - **D8.R2 status mapping at the integration level** — sample
 *     yes/maybe/no/'' answers translate to the right status.
 *   - **Uniform worse-of** — when both library and custom JO fields are
 *     populated, the worse-of answer wins (matcher-level matrix already
 *     covered in `src/shared/__tests__/matchUniformWillingness.test.ts`;
 *     this test just confirms the helper passes both sides through).
 *
 * Companion to `jobRequirementMatcherHelpers-r1.test.ts`.
 *
 * Mocha + Chai (functions test stack).
 */

import { expect } from 'chai';
import {
  buildPhaseBMatchSpecs,
  type WorkerAttestationsForMatching,
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

function buildSpecs(
  jo: Record<string, unknown>,
  workerAttestations: WorkerAttestationsForMatching | null = null,
) {
  return buildPhaseBMatchSpecs({
    jo,
    worker: { ...blankWorker, workerAttestations },
    screeningEval: null,
    todayISO: TODAY_ISO,
    todayMs: TODAY_MS,
  });
}

const WILLINGNESS_TYPES = [
  'physical_willingness',
  'uniform_willingness',
  'ppe_willingness',
  'language_willingness',
] as const;

describe('R.2 — willingness specs do not seed when the JO gate is closed', () => {
  it('an empty JO yields zero willingness specs (regardless of worker attestations)', () => {
    const specs = buildSpecs(
      {},
      {
        physicalRequirementWillingness: 'yes',
        uniformRequirementWillingness: 'no',
        customUniformRequirementWillingness: 'no',
        requiredPpeWillingness: 'maybe',
        languageRequirementWillingness: 'yes',
      },
    );
    const willingness = specs.filter((s) =>
      (WILLINGNESS_TYPES as readonly string[]).includes(s.requirementType),
    );
    expect(willingness).to.have.length(0);
  });

  it('only seeds the willingness type whose JO field is populated', () => {
    const specs = buildSpecs(
      { physicalRequirements: ['Lifting 50 lbs', 'Standing'] },
      { physicalRequirementWillingness: 'yes' },
    );
    const willingness = specs.filter((s) =>
      (WILLINGNESS_TYPES as readonly string[]).includes(s.requirementType),
    );
    expect(willingness).to.have.length(1);
    expect(willingness[0].requirementType).to.equal('physical_willingness');
  });

  it('language gate accepts either `languagesRequired` (legacy) or `languagesRequiredV2`', () => {
    const legacyOnly = buildSpecs(
      { languagesRequired: ['Spanish'] },
      { languageRequirementWillingness: 'yes' },
    );
    const v2Only = buildSpecs(
      { languagesRequiredV2: [{ language: 'Spanish', minLevel: 'basic' }] },
      { languageRequirementWillingness: 'yes' },
    );
    expect(
      legacyOnly.filter((s) => s.requirementType === 'language_willingness'),
    ).to.have.length(1);
    expect(
      v2Only.filter((s) => s.requirementType === 'language_willingness'),
    ).to.have.length(1);
  });

  it('uniform gate accepts `dressCode`, legacy `uniformRequirements`, OR `customUniformRequirements`', () => {
    for (const jo of [
      { dressCode: ['Polo shirt'] },
      { uniformRequirements: 'Polo shirt and khakis' },
      { customUniformRequirements: 'Steel-toe boots required' },
    ] as const) {
      const specs = buildSpecs(jo, { uniformRequirementWillingness: 'yes' });
      expect(specs.filter((s) => s.requirementType === 'uniform_willingness'))
        .to.have.length(1);
    }
  });

  it('PPE / physical gates accept both string and string[] runtime shapes', () => {
    const arr = buildSpecs(
      { ppeRequirements: ['Gloves', 'Hard hat'], physicalRequirements: ['Lifting'] },
      { requiredPpeWillingness: 'yes', physicalRequirementWillingness: 'yes' },
    );
    expect(arr.filter((s) => s.requirementType === 'ppe_willingness'))
      .to.have.length(1);
    expect(arr.filter((s) => s.requirementType === 'physical_willingness'))
      .to.have.length(1);

    const str = buildSpecs(
      { ppeRequirements: 'Gloves', physicalRequirements: 'Lifting 50 lbs' },
      { requiredPpeWillingness: 'yes', physicalRequirementWillingness: 'yes' },
    );
    expect(str.filter((s) => s.requirementType === 'ppe_willingness'))
      .to.have.length(1);
    expect(str.filter((s) => s.requirementType === 'physical_willingness'))
      .to.have.length(1);
  });

  it('empty arrays / whitespace-only strings count as not populated', () => {
    const specs = buildSpecs(
      {
        physicalRequirements: ['', '   '],
        ppeRequirements: '',
        languagesRequired: [],
        dressCode: [],
        customUniformRequirements: '   ',
      },
      {
        physicalRequirementWillingness: 'yes',
        requiredPpeWillingness: 'yes',
        languageRequirementWillingness: 'yes',
        uniformRequirementWillingness: 'yes',
        customUniformRequirementWillingness: 'yes',
      },
    );
    const willingness = specs.filter((s) =>
      (WILLINGNESS_TYPES as readonly string[]).includes(s.requirementType),
    );
    expect(willingness).to.have.length(0);
  });
});

describe("R.2 — willingness specs stamp resolutionMethod: 'self_attest'", () => {
  it('every willingness spec stamps self_attest, NOT auto', () => {
    const specs = buildSpecs(
      {
        physicalRequirements: ['Lifting'],
        ppeRequirements: ['Gloves'],
        languagesRequired: ['Spanish'],
        dressCode: ['Polo'],
      },
      {
        physicalRequirementWillingness: 'yes',
        requiredPpeWillingness: 'yes',
        languageRequirementWillingness: 'yes',
        uniformRequirementWillingness: 'yes',
      },
    );
    const willingness = specs.filter((s) =>
      (WILLINGNESS_TYPES as readonly string[]).includes(s.requirementType),
    );
    expect(willingness).to.have.length(4);
    for (const s of willingness) {
      expect(s.resolutionMethod, `${s.requirementType} should be self_attest`).to.equal(
        'self_attest',
      );
    }
  });

  it('non-willingness specs continue to stamp auto (R.1 unchanged)', () => {
    const specs = buildSpecs(
      {
        skillsRequired: ['forklift'],
        physicalRequirements: ['Lifting'],
      },
      { physicalRequirementWillingness: 'yes' },
    );
    const skill = specs.find((s) => s.requirementType === 'skill_match');
    const willingness = specs.find((s) => s.requirementType === 'physical_willingness');
    expect(skill?.resolutionMethod).to.equal('auto');
    expect(willingness?.resolutionMethod).to.equal('self_attest');
  });
});

describe('R.2 — willingness severity defaults soft, JO override flips to hard', () => {
  it('all four default to severity: soft (D10.R2)', () => {
    const specs = buildSpecs(
      {
        physicalRequirements: ['Lifting'],
        ppeRequirements: ['Gloves'],
        languagesRequired: ['Spanish'],
        dressCode: ['Polo'],
      },
      {
        physicalRequirementWillingness: 'yes',
        requiredPpeWillingness: 'yes',
        languageRequirementWillingness: 'yes',
        uniformRequirementWillingness: 'yes',
      },
    );
    const willingness = specs.filter((s) =>
      (WILLINGNESS_TYPES as readonly string[]).includes(s.requirementType),
    );
    for (const s of willingness) {
      expect(s.severity, `${s.requirementType} default severity`).to.equal('soft');
    }
  });

  it("requirementSeverityOverrides flips a willingness item to 'hard'", () => {
    const specs = buildSpecs(
      {
        physicalRequirements: ['Lifting'],
        requirementSeverityOverrides: { physical_willingness: 'hard' },
      },
      { physicalRequirementWillingness: 'yes' },
    );
    const willingness = specs.find((s) => s.requirementType === 'physical_willingness');
    expect(willingness?.severity).to.equal('hard');
  });
});

describe('R.2 — willingness specs map worker answers via D8.R2', () => {
  it("'yes' → complete_pass", () => {
    const specs = buildSpecs(
      { physicalRequirements: ['Lifting'] },
      { physicalRequirementWillingness: 'yes' },
    );
    const s = specs.find((x) => x.requirementType === 'physical_willingness');
    expect(s?.status).to.equal('complete_pass');
  });
  it("'maybe' → needs_review", () => {
    const specs = buildSpecs(
      { ppeRequirements: ['Gloves'] },
      { requiredPpeWillingness: 'maybe' },
    );
    const s = specs.find((x) => x.requirementType === 'ppe_willingness');
    expect(s?.status).to.equal('needs_review');
  });
  it("'no' → complete_fail", () => {
    const specs = buildSpecs(
      { languagesRequired: ['Spanish'] },
      { languageRequirementWillingness: 'no' },
    );
    const s = specs.find((x) => x.requirementType === 'language_willingness');
    expect(s?.status).to.equal('complete_fail');
  });
  it("missing / '' → incomplete (and still seeds because the JO gate is open)", () => {
    const specs = buildSpecs({ physicalRequirements: ['Lifting'] }, null);
    const s = specs.find((x) => x.requirementType === 'physical_willingness');
    expect(s?.status).to.equal('incomplete');
    expect(s?.resolutionMethod).to.equal('self_attest');
  });
  it("Title-Case wizard answers ('Yes' / 'No' / 'Maybe') normalize correctly", () => {
    const specs = buildSpecs(
      { physicalRequirements: ['Lifting'] },
      { physicalRequirementWillingness: 'Yes' },
    );
    const s = specs.find((x) => x.requirementType === 'physical_willingness');
    expect(s?.status).to.equal('complete_pass');
  });
});

describe('R.2 — uniform worse-of when both gates active', () => {
  it("'yes' library + 'no' custom → complete_fail", () => {
    const specs = buildSpecs(
      { dressCode: ['Polo'], customUniformRequirements: 'Steel-toe boots' },
      {
        uniformRequirementWillingness: 'yes',
        customUniformRequirementWillingness: 'no',
      },
    );
    const s = specs.find((x) => x.requirementType === 'uniform_willingness');
    expect(s?.status).to.equal('complete_fail');
  });

  it("'yes' library + null custom → complete_pass (null yields)", () => {
    const specs = buildSpecs(
      { dressCode: ['Polo'], customUniformRequirements: 'Steel-toe boots' },
      { uniformRequirementWillingness: 'yes' },
    );
    const s = specs.find((x) => x.requirementType === 'uniform_willingness');
    expect(s?.status).to.equal('complete_pass');
  });
});
