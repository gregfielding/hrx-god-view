import {
  formatWorkerFacingScreeningPackage,
  screeningTypeGroupLabel,
  workerFacingScreeningPrimaryLineFromRecord,
} from '../formatWorkerFacingScreeningPackage';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';

describe('formatWorkerFacingScreeningPackage', () => {
  it('prefers service names and stable summary', () => {
    const r = formatWorkerFacingScreeningPackage({
      packageName: 'CORT Basic',
      services: [
        { name: ' Social Security Locator ', type: 'ssnt' },
        { name: 'CrimNet', type: 'cnet' },
        { name: '4 Panel Urine', type: 'drug' },
      ],
    });
    expect(r.title).toMatch(/Complete these required screenings/i);
    expect(r.summary).toBe('Social Security Locator, CrimNet, 4 Panel Urine');
    expect(r.items).toHaveLength(3);
  });

  it('dedupes by normalized name', () => {
    const r = formatWorkerFacingScreeningPackage({
      services: [{ name: 'CrimNet' }, { name: ' crimnet ' }],
    });
    expect(r.items).toHaveLength(1);
  });

  it('falls back without using package name as primary title', () => {
    const r = formatWorkerFacingScreeningPackage({ packageName: 'CORT Basic', services: [] });
    expect(r.items).toHaveLength(0);
    expect(r.title).toBe('Required screening');
    expect(r.summary).toContain('Complete required screening');
  });

  it('screeningTypeGroupLabel maps known codes', () => {
    expect(screeningTypeGroupLabel('drug')).toBe('Drug screening');
    expect(screeningTypeGroupLabel('ssnt')).toBe('Social Security trace');
  });
});

describe('workerFacingScreeningPrimaryLineFromRecord', () => {
  it('uses requestedServicesCatalog when present', () => {
    const r = {
      requestedPackageName: 'CORT Basic',
      requestedServicesCatalog: [
        { id: '1', name: 'Alpha', type: 'cnet' },
        { id: '2', name: 'Beta', type: 'drug' },
      ],
    } as BackgroundCheckRecord;
    expect(workerFacingScreeningPrimaryLineFromRecord(r)).toBe('Alpha, Beta');
  });
});
