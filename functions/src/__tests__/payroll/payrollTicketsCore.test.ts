/**
 * Pure helpers of the payroll help desk (audit hardening 2026-08-24).
 * Firestore-bound paths (create/reply/status) are exercised in prod smoke
 * tests; these cover the logic that has already bitten us once
 * (timesheet field names) plus the tenant-membership gate.
 */
import { expect } from 'chai';
import { formatTimesheetLine, isTenantMemberData } from '../../payroll/payrollTicketsCore';

describe('payrollTicketsCore — formatTimesheetLine', () => {
  it('reads workDate (the real field), not date', () => {
    const line = formatTimesheetLine({
      workDate: '2026-06-09',
      status: 'draft',
      totalRegularHours: 8,
      totalOTHours: 1.5,
    });
    expect(line).to.equal('- 2026-06-09: status=draft, reg=8h, ot=1.5h');
  });

  it('falls back to legacy date, then "undated"', () => {
    expect(formatTimesheetLine({ date: '2026-01-02', status: 'paid' })).to.contain('- 2026-01-02:');
    expect(formatTimesheetLine({ status: 'draft' })).to.contain('- undated:');
  });

  it('includes double-time hours only when non-zero', () => {
    expect(
      formatTimesheetLine({ workDate: '2026-06-09', status: 'sent', totalDoubleTimeHours: 2 }),
    ).to.contain('dt=2h');
    expect(
      formatTimesheetLine({ workDate: '2026-06-09', status: 'sent', totalDoubleTimeHours: 0 }),
    ).to.not.contain('dt=');
  });
});

describe('payrollTicketsCore — isTenantMemberData', () => {
  const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';

  it('accepts activeTenantId, legacy tenantId, and tenantIds map membership', () => {
    expect(isTenantMemberData({ activeTenantId: TENANT }, TENANT)).to.equal(true);
    expect(isTenantMemberData({ tenantId: TENANT }, TENANT)).to.equal(true);
    expect(isTenantMemberData({ tenantIds: { [TENANT]: { securityLevel: '0' } } }, TENANT)).to.equal(true);
  });

  it('rejects non-members and empty tenant ids', () => {
    expect(isTenantMemberData({ activeTenantId: 'other' }, TENANT)).to.equal(false);
    expect(isTenantMemberData({}, TENANT)).to.equal(false);
    expect(isTenantMemberData({ activeTenantId: TENANT }, '')).to.equal(false);
    expect(isTenantMemberData({ tenantIds: { other: {} } }, TENANT)).to.equal(false);
  });
});
