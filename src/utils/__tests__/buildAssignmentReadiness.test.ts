import { buildAssignmentReadiness } from '../buildAssignmentReadiness';

describe('buildAssignmentReadiness', () => {
  it('returns PENDING_INITIALIZATION without assignment id', () => {
    const r = buildAssignmentReadiness({
      user: { workAuthorization: true },
      employment: { i9Complete: true },
      assignment: null,
      screening: {},
    });
    expect(r.readiness).toBe('PENDING_INITIALIZATION');
    expect(r.requirements).toEqual([]);
  });

  it('BLOCKED when identity hard blocks missing', () => {
    const r = buildAssignmentReadiness({
      user: { workAuthorization: false },
      employment: { i9Complete: false },
      assignment: { id: 'a1', requiresBackgroundCheck: false, requiresDrugScreen: false },
      screening: {},
    });
    expect(r.readiness).toBe('BLOCKED');
    expect(r.summary.blockers).toBeGreaterThan(0);
  });

  it('READY when identity complete and no warnings', () => {
    const r = buildAssignmentReadiness({
      user: { workAuthorization: true },
      employment: {
        i9Complete: true,
        payrollInviteSent: false,
        directDepositComplete: true,
        taxFormComplete: true,
        handbookSigned: true,
        policiesSigned: true,
      },
      assignment: { id: 'a1', requiresBackgroundCheck: false, requiresDrugScreen: false },
      screening: {},
    });
    expect(r.readiness).toBe('READY');
  });

  it('READY_WITH_WARNINGS when employment incomplete', () => {
    const r = buildAssignmentReadiness({
      user: { workAuthorization: true },
      employment: {
        i9Complete: true,
        taxFormComplete: false,
        handbookSigned: true,
        policiesSigned: true,
        directDepositComplete: true,
      },
      assignment: { id: 'a1', requiresBackgroundCheck: false, requiresDrugScreen: false },
      screening: {},
    });
    expect(r.readiness).toBe('READY_WITH_WARNINGS');
    expect(r.summary.warnings).toBeGreaterThan(0);
  });
});
