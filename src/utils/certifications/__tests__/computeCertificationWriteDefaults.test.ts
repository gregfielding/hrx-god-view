import { computeCertificationWriteDefaults } from '../computeCertificationWriteDefaults';

describe('computeCertificationWriteDefaults', () => {
  it('admin_manual → approved / active', () => {
    expect(
      computeCertificationWriteDefaults({
        source: 'admin_manual',
        hasEvidenceFile: false,
        catalogAllowsSelfAttestation: false,
      }),
    ).toEqual({ reviewStatus: 'approved', recordStatus: 'active' });
  });

  it('worker with file → submitted / pending_review', () => {
    expect(
      computeCertificationWriteDefaults({
        source: 'worker_upload',
        hasEvidenceFile: true,
        catalogAllowsSelfAttestation: false,
      }),
    ).toEqual({ reviewStatus: 'submitted', recordStatus: 'pending_review' });
  });

  it('worker attestation only + catalog allows → not_required / active', () => {
    expect(
      computeCertificationWriteDefaults({
        source: 'worker_attestation',
        hasEvidenceFile: false,
        catalogAllowsSelfAttestation: true,
      }),
    ).toEqual({ reviewStatus: 'not_required', recordStatus: 'active' });
  });

  it('worker attestation + catalog disallows → submitted / pending_review', () => {
    expect(
      computeCertificationWriteDefaults({
        source: 'worker_attestation',
        hasEvidenceFile: false,
        catalogAllowsSelfAttestation: false,
      }),
    ).toEqual({ reviewStatus: 'submitted', recordStatus: 'pending_review' });
  });
});
