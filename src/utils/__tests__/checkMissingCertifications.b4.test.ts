/**
 * Phase B.4 smoke tests for `checkMissingCertificationsWithEngine`.
 *
 * The function delegates the heavy lifting to the cert engine helpers (which
 * have their own deeper tests). These tests pin the behavioral contract that
 * matters at the apply-flow boundary:
 *
 *   - Empty / no `requiredCerts` → returns empty (no engine call).
 *   - Engine returns labels → those labels are returned.
 *   - Engine returns empty BUT `unmappedStrings` are present → unmapped
 *     strings surface as missing (B.4 conservative behavior).
 *   - The legacy `REACT_APP_CERT_ENGINE_READINESS` flag is no longer
 *     consulted on this surface.
 *
 * @see src/utils/checkMissingCertifications.ts
 */

import { checkMissingCertificationsWithEngine } from '../checkMissingCertifications';

// Mock the engine helpers — we're testing the orchestration, not the engine.
jest.mock('../certifications/evaluateCertificationsForLegacyRequirementStrings', () => ({
  __esModule: true,
  computeEngineGapForPhase1Requirements: jest.fn(),
  computeEngineGapLabelsForLegacyJobStrings: jest.fn(),
}));

jest.mock('../certifications/buildCertificationRequirementsFromJobPosting', () => ({
  __esModule: true,
  buildCertificationRequirementsFromJobPosting: jest.fn(),
}));

import {
  computeEngineGapForPhase1Requirements,
  computeEngineGapLabelsForLegacyJobStrings,
} from '../certifications/evaluateCertificationsForLegacyRequirementStrings';
import { buildCertificationRequirementsFromJobPosting } from '../certifications/buildCertificationRequirementsFromJobPosting';

const mockedLegacyStrings = computeEngineGapLabelsForLegacyJobStrings as jest.MockedFunction<
  typeof computeEngineGapLabelsForLegacyJobStrings
>;
const mockedPhase1 = computeEngineGapForPhase1Requirements as jest.MockedFunction<
  typeof computeEngineGapForPhase1Requirements
>;
const mockedBuild = buildCertificationRequirementsFromJobPosting as jest.MockedFunction<
  typeof buildCertificationRequirementsFromJobPosting
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkMissingCertificationsWithEngine — short-circuit', () => {
  it('returns empty array when requiredCerts is undefined (no engine call)', async () => {
    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: undefined,
      userCerts: [],
      workerUid: 'w1',
    });
    expect(result).toEqual([]);
    expect(mockedLegacyStrings).not.toHaveBeenCalled();
    expect(mockedPhase1).not.toHaveBeenCalled();
  });

  it('returns empty array when requiredCerts is empty', async () => {
    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: [],
      userCerts: [],
      workerUid: 'w1',
    });
    expect(result).toEqual([]);
  });
});

describe('checkMissingCertificationsWithEngine — no jobPosting (legacy strings path)', () => {
  it('returns engine labels for the legacy-string path when no jobPosting is given', async () => {
    mockedLegacyStrings.mockResolvedValueOnce({
      labels: ['Forklift'],
      rows: [],
      unmappedStrings: [],
    } as Awaited<ReturnType<typeof computeEngineGapLabelsForLegacyJobStrings>>);

    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: ['Forklift'],
      userCerts: [],
      workerUid: 'w1',
    });

    expect(result).toEqual(['Forklift']);
    expect(mockedLegacyStrings).toHaveBeenCalledTimes(1);
  });

  it('surfaces unmappedStrings as missing when engine returns no labels', async () => {
    mockedLegacyStrings.mockResolvedValueOnce({
      labels: [],
      rows: [],
      unmappedStrings: ["Frobnicator Operator's License"],
    } as Awaited<ReturnType<typeof computeEngineGapLabelsForLegacyJobStrings>>);

    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: ["Frobnicator Operator's License"],
      userCerts: [],
      workerUid: 'w1',
    });

    expect(result).toEqual(["Frobnicator Operator's License"]);
  });

  it('merges engine labels + unmappedStrings without duplicates', async () => {
    mockedLegacyStrings.mockResolvedValueOnce({
      labels: ['Forklift'],
      rows: [],
      unmappedStrings: ['Forklift', 'Mystery Cert'], // Forklift duplicate intentional
    } as Awaited<ReturnType<typeof computeEngineGapLabelsForLegacyJobStrings>>);

    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: ['Forklift', 'Mystery Cert'],
      userCerts: [],
      workerUid: 'w1',
    });

    expect(result.sort()).toEqual(['Forklift', 'Mystery Cert']);
  });
});

describe('checkMissingCertificationsWithEngine — jobPosting path', () => {
  it('uses Phase1 path when jobPosting yields structured requirements', async () => {
    mockedBuild.mockReturnValueOnce({
      requirements: [{ catalogEntryId: 'forklift_basic' } as unknown as ReturnType<typeof mockedBuild>['requirements'][number]],
      unmappedStrings: [],
    } as ReturnType<typeof mockedBuild>);

    mockedPhase1.mockResolvedValueOnce({
      labels: ['Forklift'],
      rows: [],
    } as Awaited<ReturnType<typeof mockedPhase1>>);

    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: ['Forklift'],
      userCerts: [],
      workerUid: 'w1',
      jobPosting: { id: 'jp1' } as Parameters<typeof checkMissingCertificationsWithEngine>[0]['jobPosting'],
    });

    expect(result).toEqual(['Forklift']);
    expect(mockedPhase1).toHaveBeenCalledTimes(1);
    expect(mockedLegacyStrings).not.toHaveBeenCalled();
  });

  it('falls through to legacy-strings path when jobPosting yields no structured requirements', async () => {
    mockedBuild.mockReturnValueOnce({
      requirements: [],
      unmappedStrings: ['Mystery'],
    } as ReturnType<typeof mockedBuild>);

    mockedLegacyStrings.mockResolvedValueOnce({
      labels: [],
      rows: [],
      unmappedStrings: ['Mystery'],
    } as Awaited<ReturnType<typeof mockedLegacyStrings>>);

    const result = await checkMissingCertificationsWithEngine({
      requiredCerts: ['Mystery'],
      userCerts: [],
      workerUid: 'w1',
      jobPosting: { id: 'jp1' } as Parameters<typeof checkMissingCertificationsWithEngine>[0]['jobPosting'],
    });

    // B.4 short-circuit: skip the structured-engine call when the posting
    // yields zero structured requirements (it would have done nothing).
    expect(mockedPhase1).not.toHaveBeenCalled();
    expect(mockedLegacyStrings).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['Mystery']);
  });
});

describe('checkMissingCertificationsWithEngine — flag independence', () => {
  it('does not consult REACT_APP_CERT_ENGINE_READINESS (engine always on)', async () => {
    // Set the flag to false to prove it has no effect on this surface.
    const original = process.env.REACT_APP_CERT_ENGINE_READINESS;
    process.env.REACT_APP_CERT_ENGINE_READINESS = 'false';
    try {
      mockedLegacyStrings.mockResolvedValueOnce({
        labels: ['Forklift'],
        rows: [],
        unmappedStrings: [],
      } as Awaited<ReturnType<typeof mockedLegacyStrings>>);

      const result = await checkMissingCertificationsWithEngine({
        requiredCerts: ['Forklift'],
        userCerts: [],
        workerUid: 'w1',
      });

      // Engine ran despite flag=false. Legacy fuzzy path is gone.
      expect(result).toEqual(['Forklift']);
      expect(mockedLegacyStrings).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) delete process.env.REACT_APP_CERT_ENGINE_READINESS;
      else process.env.REACT_APP_CERT_ENGINE_READINESS = original;
    }
  });
});

describe('checkMissingCertificationsWithEngine — legacy fn removed', () => {
  it('the legacy fuzzy checkMissingCertifications export is gone', async () => {
    // Late dynamic import so this test can introspect what's exported now.
    const mod = await import('../checkMissingCertifications');
    expect((mod as Record<string, unknown>).checkMissingCertifications).toBeUndefined();
    expect(mod.checkMissingCertificationsWithEngine).toBeDefined();
  });
});
