// src/forms/__tests__/dealStageAdapter.test.ts
// Vitest skeleton for adapter parity with legacy stageData reads/writes

import { describe, it, expect } from 'vitest';
import { getValue, setValue, toNumberSafe, toISODate, coerceSelect, type Deal } from '../dealStageAdapter';

describe('dealStageAdapter', () => {
  const dealFixture: Deal = {
    id: 'd1',
    companyId: 'c123',
    companyName: 'Acme Co',
    stageData: {
      discovery: { jobTitle: 'Warehouse Associate', notes: 'Forklift required' },
      qualification: {
        experienceLevel: 'intermediate',
        startDate: '2025-09-01',
        payRate: '18.50',
        workersNeeded: '12',
        worksiteId: 'loc-1',
        worksiteName: 'Dallas DC',
        priority: 'high',
        shiftType: 'night',
      },
      scoping: { estimatedRevenue: '25000' },
    },
  };

  it('reads values from the expected stage paths', () => {
    expect(getValue('jobTitle', dealFixture)).toBe('Warehouse Associate');
    expect(getValue('experienceLevel', dealFixture)).toBe('intermediate');
    expect(getValue('startDate', dealFixture)).toBe('2025-09-01');
    expect(getValue('payRate', dealFixture)).toBe('18.50');
    expect(getValue('workersNeeded', dealFixture)).toBe('12');
    expect(getValue('estimatedRevenue', dealFixture)).toBe('25000');
    expect(getValue('companyId', dealFixture)).toBe('c123');
    expect(getValue('worksiteName', dealFixture)).toBe('Dallas DC');
  });

  it('writes values to the correct stage paths', () => {
    const draft: Deal = JSON.parse(JSON.stringify(dealFixture));
    setValue('jobTitle', 'Picker/Packer', draft);
    setValue('workersNeeded', 20, draft);
    setValue('companyId', 'c999', draft);
    expect(draft.stageData?.discovery?.jobTitle).toBe('Picker/Packer');
    expect(draft.stageData?.qualification?.workersNeeded).toBe(20);
    expect(draft.companyId).toBe('c999');
  });

  it('coercion helpers behave deterministically', () => {
    expect(toNumberSafe('18.50')).toBe(18.5);
    expect(toNumberSafe('abc')).toBeUndefined();
    expect(typeof toISODate('2025-09-01')).toBe('string');
    expect(coerceSelect('ADVANCED', ['entry','intermediate','advanced'] as const, 'entry')).toBe('advanced');
    expect(coerceSelect('', ['low','medium','high'] as const, 'low')).toBe('low');
  });
});
