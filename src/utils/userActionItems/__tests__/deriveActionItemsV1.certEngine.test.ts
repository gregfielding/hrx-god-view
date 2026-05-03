import type { RequirementEvaluationRow } from '../../certifications/evaluateCertificationsForRequirements';
import { deriveActionItemsV1 } from '../deriveActionItemsV1';

const baseInput = {
  uid: 'u1',
  enabled: true,
  phoneVerified: true,
  phone: '555',
  hasInterview: true,
  workAuthorized: true,
  scoreSummary: undefined,
  riskProfileRaw: null,
  entityItems: [],
  entitySignals: [],
  backgroundCheckOrders: [],
  certifications: [
    {
      name: 'Test Cert',
      required: true,
      isRequired: true,
    },
  ],
  actionSignalsReady: true,
};

const requirement = {
  requirementId: 'forklift',
  catalogEntryId: 'forklift-certification',
  scope: 'required' as const,
  evidencePolicy: 'upload_required' as const,
  reviewPolicy: 'must_be_approved' as const,
  expirationPolicy: 'must_be_valid' as const,
};

const evalRow: RequirementEvaluationRow = {
  requirement,
  result: {
    status: 'missing',
    passesHardRequirement: false,
    passesSoftRequirement: false,
    blocking: true,
    severity: 'blocking',
    reason: 'no record',
    confidence: 'high',
  },
};

describe('deriveActionItemsV1 certification engine flag', () => {
  it('flag OFF — legacy cert_required_missing from user-doc certifications', () => {
    const items = deriveActionItemsV1({
      ...baseInput,
      certEngineActionItemsEnabled: false,
    });
    const legacy = items.filter((i) => i.type === 'cert_required_missing');
    expect(legacy.length).toBeGreaterThanOrEqual(1);
    const engine = items.filter((i) => i.type === 'missing_certification');
    expect(engine.length).toBe(0);
  });

  it('flag ON with rows — certification items from engine, legacy cert loop skipped', () => {
    const items = deriveActionItemsV1({
      ...baseInput,
      certEngineActionItemsEnabled: true,
      certificationEvaluationRows: [evalRow],
    });
    const legacy = items.filter((i) => i.type === 'cert_required_missing');
    expect(legacy.length).toBe(0);
    const engine = items.filter((i) => i.type === 'missing_certification');
    expect(engine.length).toBe(1);
    const first = engine[0];
    expect(first && first.certificationRef && first.certificationRef.requirementId).toBe('forklift');
  });
});
