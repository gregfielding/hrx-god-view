import { getWorkerPayrollLanding } from '../workerPayrollRouting';

describe('workerPayrollRouting', () => {
  it('returns empty when map missing or empty', () => {
    expect(getWorkerPayrollLanding(undefined).kind).toBe('empty');
    expect(getWorkerPayrollLanding(null).kind).toBe('empty');
    expect(getWorkerPayrollLanding({}).kind).toBe('empty');
  });

  it('redirects when exactly one Everee tenant', () => {
    const r = getWorkerPayrollLanding({ '3138': 'wid-1' });
    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') expect(r.evereeTenantId).toBe('3138');
  });

  it('shows picker when multiple tenants', () => {
    const r = getWorkerPayrollLanding({ '3138': 'a', '2320': 'b' });
    expect(r.kind).toBe('picker');
    if (r.kind === 'picker') {
      expect(r.evereeTenantIds.sort()).toEqual(['2320', '3138']);
    }
  });
});
