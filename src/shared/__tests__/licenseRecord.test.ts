/**
 * Unit tests for LicenseRecordV1 + RequiredLicenseV1 type shapes.
 *
 * These types are runtime-neutral — they're consumed by `matchLicenses.ts`
 * (Phase B.3). The tests here just lock in the schema-version constant and
 * confirm the types compile / accept the documented examples without
 * requiring any helper code in this file (there's no parser/normalizer for
 * licenses; the field is greenfield, no legacy data).
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.2
 */

import {
  LICENSE_RECORD_V1_VERSION,
  LicenseRecordV1,
  RequiredLicenseV1,
} from '../licenseRecord';

describe('LicenseRecordV1 — schema lock', () => {
  it('uses schema version 1', () => {
    expect(LICENSE_RECORD_V1_VERSION).toBe(1);
  });

  it('compiles a minimal CDL record', () => {
    const cdl: LicenseRecordV1 = {
      schemaVersion: 1,
      licenseClass: 'CDL Class A',
    };
    expect(cdl.licenseClass).toBe('CDL Class A');
    expect(cdl.endorsements).toBeUndefined();
  });

  it('compiles a CDL record with endorsements + expiration + state', () => {
    const cdl: LicenseRecordV1 = {
      schemaVersion: 1,
      licenseClass: 'CDL Class A',
      endorsements: ['H', 'T', 'X'],
      expirationDate: '2028-06-15',
      issuingState: 'CA',
      licenseNumber: 'A1234567',
    };
    expect(cdl.endorsements).toEqual(['H', 'T', 'X']);
    expect(cdl.expirationDate).toBe('2028-06-15');
    expect(cdl.issuingState).toBe('CA');
  });

  it('accepts null for nullable fields (Firestore `null` round-trip)', () => {
    const license: LicenseRecordV1 = {
      schemaVersion: 1,
      licenseClass: 'Forklift',
      expirationDate: null,
      issuingState: null,
      licenseNumber: null,
    };
    expect(license.expirationDate).toBeNull();
  });
});

describe('RequiredLicenseV1 — schema lock', () => {
  it('compiles a minimal class-only requirement', () => {
    const req: RequiredLicenseV1 = { licenseClass: 'Forklift' };
    expect(req.licenseClass).toBe('Forklift');
    expect(req.requiredEndorsements).toBeUndefined();
  });

  it('compiles a CDL requirement with endorsements', () => {
    const req: RequiredLicenseV1 = {
      licenseClass: 'CDL Class A',
      requiredEndorsements: ['H'], // hazmat required
    };
    expect(req.requiredEndorsements).toEqual(['H']);
  });
});
