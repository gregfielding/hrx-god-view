import { buildAssignmentReadiness } from '../buildAssignmentReadiness';
import {
  certLabelMatchesJobOrderRequirement,
  mergeJobOrderSyntheticCertificationDemands,
  stableCertRequiredSlug,
} from '../../shared/jobOrderSyntheticCertificationDemands';

describe('stableCertRequiredSlug', () => {
  it('lowercases and replaces non-alphanumeric', () => {
    expect(stableCertRequiredSlug('CPR / BLS')).toBe('cpr_bls');
  });
});

describe('certLabelMatchesJobOrderRequirement', () => {
  it('matches exact normalized', () => {
    expect(certLabelMatchesJobOrderRequirement('  CPR  ', 'cpr')).toBe(true);
  });
  it('matches substring when requirement token length >= 4', () => {
    expect(certLabelMatchesJobOrderRequirement('State of CA RN License', 'RN License')).toBe(true);
  });
});

describe('mergeJobOrderSyntheticCertificationDemands', () => {
  it('adds synthetic when id required and no compliance row', () => {
    const out = mergeJobOrderSyntheticCertificationDemands(
      { requiredCertificationComplianceIds: ['docAbc'] },
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].key.startsWith('required_')).toBe(true);
    expect(out[0].label).toBe('docAbc');
    expect(out[0].complete).toBe(false);
  });

  it('skips synthetic when id matches compliance row', () => {
    const out = mergeJobOrderSyntheticCertificationDemands(
      { requiredCertificationComplianceIds: ['docAbc'] },
      [{ key: 'docAbc', label: 'CPR', complete: false }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('docAbc');
  });

  it('adds synthetic for string requirement with no label match', () => {
    const out = mergeJobOrderSyntheticCertificationDemands(
      { requiredCertifications: ['Forklift'] },
      [{ key: 'x', label: 'Unrelated', complete: false }],
    );
    expect(out.some((c) => c.label === 'Forklift' && !c.complete)).toBe(true);
  });

  it('skips string synthetic when label matches', () => {
    const out = mergeJobOrderSyntheticCertificationDemands(
      { requiredCertifications: ['Forklift'] },
      [{ key: 'x', label: 'Forklift Operator', complete: false }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('x');
  });
});

describe('buildAssignmentReadiness synthetic cert keys', () => {
  it('emits cert_required_* requirement keys', () => {
    const merged = mergeJobOrderSyntheticCertificationDemands(
      { requiredCertifications: ['Scissor Lift'] },
      [],
    );
    const r = buildAssignmentReadiness({
      user: { workAuthorization: true },
      employment: {
        i9Complete: true,
        payrollInviteSent: true,
        directDepositComplete: true,
        taxFormComplete: true,
        handbookSigned: true,
        policiesSigned: true,
      },
      assignment: { id: 'a1', requiresBackgroundCheck: false, requiresDrugScreen: false },
      screening: {},
      certifications: merged,
    });
    const certReqs = r.requirements.filter((x) => x.key.startsWith('cert_'));
    expect(certReqs.some((x) => x.key.startsWith('cert_required_'))).toBe(true);
  });
});
