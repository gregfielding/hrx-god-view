import { mapCertificationEvaluationsToActionItems } from '../mapCertificationEvaluationsToActionItems';
import certificationCatalogManifest from '../../../shared/data/certificationCatalogManifest.v1.json';

const manifest = certificationCatalogManifest;

function row(requirement, result) {
  return { requirement, result };
}

const reqRequired = {
  requirementId: 'forklift',
  catalogEntryId: 'forklift-certification',
  scope: 'required',
  evidencePolicy: 'upload_required',
  reviewPolicy: 'must_be_approved',
  expirationPolicy: 'must_be_valid',
};

const reqPreferred = {
  requirementId: 'food-handler',
  catalogEntryId: 'food-handler-card',
  scope: 'preferred',
  evidencePolicy: 'either',
  reviewPolicy: 'pending_ok_for_apply',
  expirationPolicy: 'must_be_valid',
};

describe('mapCertificationEvaluationsToActionItems', () => {
  it('maps missing required to worker upload action', () => {
    const items = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqRequired, {
          status: 'missing',
          passesHardRequirement: false,
          passesSoftRequirement: false,
          blocking: true,
          severity: 'blocking',
          reason: 'no record',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('missing_certification');
    expect(items[0].actor).toBe('worker');
    expect(items[0].blocking).toBe('hard');
    expect(items[0].certificationRef && items[0].certificationRef.requirementId).toBe('forklift');
  });

  it('maps pending_review to recruiter action', () => {
    const items = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqRequired, {
          status: 'pending_review',
          passesHardRequirement: false,
          passesSoftRequirement: true,
          blocking: true,
          severity: 'blocking',
          reason: 'submitted',
          certificationRecordId: 'rec1',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(items[0].type).toBe('certification_pending_review');
    expect(items[0].actor).toBe('recruiter');
  });

  it('maps rejected and expired', () => {
    const r1 = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqRequired, {
          status: 'rejected',
          passesHardRequirement: false,
          passesSoftRequirement: false,
          blocking: true,
          severity: 'blocking',
          reason: 'bad scan',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(r1[0].type).toBe('certification_rejected');

    const r2 = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqRequired, {
          status: 'expired',
          passesHardRequirement: false,
          passesSoftRequirement: false,
          blocking: true,
          severity: 'blocking',
          reason: 'past date',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(r2[0].type).toBe('certification_expired');
  });

  it('maps expiring_soon as non-blocking informational', () => {
    const items = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqRequired, {
          status: 'expiring_soon',
          passesHardRequirement: true,
          passesSoftRequirement: true,
          blocking: false,
          severity: 'warning',
          reason: 'within window',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(items[0].type).toBe('certification_expiring_soon');
    expect(items[0].blocking).toBe('informational');
  });

  it('preferred_unmet emits informational item, not hard blocking', () => {
    const items = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqPreferred, {
          status: 'preferred_unmet',
          passesHardRequirement: true,
          passesSoftRequirement: false,
          blocking: false,
          severity: 'none',
          reason: 'optional gap',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(items[0].type).toBe('certification_preferred_unmet');
    expect(items[0].blocking).not.toBe('hard');
  });

  it('skips approved', () => {
    const items = mapCertificationEvaluationsToActionItems({
      rows: [
        row(reqRequired, {
          status: 'approved',
          passesHardRequirement: true,
          passesSoftRequirement: true,
          blocking: false,
          severity: 'none',
          reason: '',
          confidence: 'high',
        }),
      ],
      manifest,
      surface: 'profile',
      userId: 'u1',
    });
    expect(items).toHaveLength(0);
  });
});
