/**
 * Unit tests for `matchLicenses`. Covers class match, endorsement subset,
 * and expiration.
 *
 * @see shared/jobRequirementMatchers/matchLicenses.ts
 */

import { matchLicenses } from '../jobRequirementMatchers/matchLicenses';
import type { LicenseRecordV1 } from '../licenseRecord';

const TODAY = '2026-04-25';

const cdlA = (overrides: Partial<LicenseRecordV1> = {}): LicenseRecordV1 => ({
  schemaVersion: 1,
  licenseClass: 'CDL Class A',
  endorsements: ['H', 'T'],
  expirationDate: '2028-06-15',
  ...overrides,
});

describe('matchLicenses — not_applicable', () => {
  it('returns not_applicable when required.licenseClass is empty', () => {
    const r = matchLicenses({ required: { licenseClass: '' }, todayISO: TODAY });
    expect(r.status).toBe('not_applicable');
    expect(r.reason).toBe('required_class_empty');
  });
});

describe('matchLicenses — incomplete', () => {
  it('returns incomplete when worker has no licenses', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A' },
      todayISO: TODAY,
    });
    expect(r.status).toBe('incomplete');
    expect(r.reason).toBe('worker_has_no_licenses');
  });

  it('returns incomplete with empty workerLicenses array', () => {
    const r = matchLicenses({
      required: { licenseClass: 'Forklift' },
      workerLicenses: [],
      todayISO: TODAY,
    });
    expect(r.status).toBe('incomplete');
  });
});

describe('matchLicenses — class match', () => {
  it('passes when class matches case-insensitively, no endorsements required', () => {
    const r = matchLicenses({
      required: { licenseClass: 'forklift' },
      workerLicenses: [{ schemaVersion: 1, licenseClass: 'Forklift' }],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
  });

  it('fails when worker holds a different class', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A' },
      workerLicenses: [{ schemaVersion: 1, licenseClass: 'CDL Class B' }],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('class_not_held');
  });
});

describe('matchLicenses — endorsements', () => {
  it('passes when all required endorsements are present', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A', requiredEndorsements: ['H'] },
      workerLicenses: [cdlA()],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
    expect(r.details?.missingEndorsements).toEqual([]);
  });

  it('passes when worker has additional endorsements beyond required', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A', requiredEndorsements: ['H'] },
      workerLicenses: [cdlA({ endorsements: ['H', 'T', 'X', 'P'] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
  });

  it('fails when a required endorsement is missing, surfaces it in details', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A', requiredEndorsements: ['H', 'X'] },
      workerLicenses: [cdlA({ endorsements: ['H'] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('missing_endorsement');
    expect(r.details?.missingEndorsements).toEqual(['X']);
  });

  it('matches endorsements case-insensitively', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A', requiredEndorsements: ['h'] },
      workerLicenses: [cdlA({ endorsements: ['H'] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
  });
});

describe('matchLicenses — expiration', () => {
  it('fails when matched license has expired', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A' },
      workerLicenses: [cdlA({ expirationDate: '2020-01-01', endorsements: [] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('expired');
    expect(r.details?.expired).toBe(true);
  });

  it('passes when expiration is future-dated', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A' },
      workerLicenses: [cdlA({ expirationDate: '2030-01-01', endorsements: [] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
  });

  it('passes when expiration is null / absent', () => {
    const r = matchLicenses({
      required: { licenseClass: 'Forklift' },
      workerLicenses: [{ schemaVersion: 1, licenseClass: 'Forklift', expirationDate: null }],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
  });

  it('treats today === expirationDate as still valid (not yet expired)', () => {
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A' },
      workerLicenses: [cdlA({ expirationDate: TODAY, endorsements: [] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_pass');
  });

  it('endorsement failure takes priority over expiration in reason code', () => {
    // Two failure conditions; missing_endorsement wins per current ordering.
    const r = matchLicenses({
      required: { licenseClass: 'CDL Class A', requiredEndorsements: ['X'] },
      workerLicenses: [cdlA({ expirationDate: '2020-01-01', endorsements: ['H'] })],
      todayISO: TODAY,
    });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('missing_endorsement');
  });
});
