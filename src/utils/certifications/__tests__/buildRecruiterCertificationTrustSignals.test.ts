import {
  buildRecruiterCertificationTrustSignals,
  certificationOperationalSummaryCounts,
} from '../buildRecruiterCertificationTrustSignals';
import type { CertificationCatalogManifestV1 } from '../../../shared/certifications/certificationCatalogManifest';
import certificationCatalogManifest from '../../../shared/data/certificationCatalogManifest.v1.json';

const manifest = certificationCatalogManifest as CertificationCatalogManifestV1;

function r(req, result) {
  return { requirement: req, result };
}

const reqA = {
  requirementId: 'a',
  catalogEntryId: 'forklift-certification',
  scope: 'required',
  evidencePolicy: 'upload_required',
  reviewPolicy: 'must_be_approved',
  expirationPolicy: 'must_be_valid',
};

const reqB = {
  requirementId: 'b',
  catalogEntryId: 'food-handler-card',
  scope: 'required',
  evidencePolicy: 'either',
  reviewPolicy: 'pending_ok_for_apply',
  expirationPolicy: 'must_be_valid',
};

describe('buildRecruiterCertificationTrustSignals', () => {
  it('counts required approved and blocking issues deterministically', () => {
    const rows = [
      r(reqA, {
        status: 'approved',
        passesHardRequirement: true,
        passesSoftRequirement: true,
        blocking: false,
        severity: 'none',
        reason: '',
        confidence: 'high',
      }),
      r(reqB, {
        status: 'pending_review',
        passesHardRequirement: false,
        passesSoftRequirement: true,
        blocking: true,
        severity: 'blocking',
        reason: 'wait',
        confidence: 'high',
      }),
    ];
    const pack = buildRecruiterCertificationTrustSignals(rows, manifest);
    expect(pack.requiredApproved).toBe(1);
    expect(pack.requiredTotal).toBe(2);
    expect(pack.blockingCertIssues).toBe(1);
    expect(pack.explanationBullets.length).toBe(2);
    const b0 = pack.explanationBullets[0];
    const b1 = pack.explanationBullets[1];
    expect(b0.localeCompare(b1)).toBeLessThan(0);
  });

  it('certificationOperationalSummaryCounts', () => {
    const counts = certificationOperationalSummaryCounts([
      r(reqA, {
        status: 'approved',
        passesHardRequirement: true,
        passesSoftRequirement: true,
        blocking: false,
        severity: 'none',
        reason: '',
        confidence: 'high',
      }),
      r(reqB, {
        status: 'expiring_soon',
        passesHardRequirement: true,
        passesSoftRequirement: true,
        blocking: false,
        severity: 'warning',
        reason: 'soon',
        confidence: 'high',
      }),
    ]);
    expect(counts.approved).toBe(1);
    expect(counts.expiringSoon).toBe(1);
    expect(counts.pending).toBe(0);
    expect(counts.missingRequired).toBe(0);
  });
});
