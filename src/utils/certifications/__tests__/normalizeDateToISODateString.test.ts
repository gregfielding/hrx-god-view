import { normalizeDateToISODateString } from '../../../shared/certifications/normalizeDateToISODateString';

describe('normalizeDateToISODateString', () => {
  it('parses YYYY-MM-DD and returns UTC date string', () => {
    expect(normalizeDateToISODateString('2026-03-15')).toBe('2026-03-15');
  });

  it('returns null for empty or invalid', () => {
    expect(normalizeDateToISODateString('')).toBe(null);
    expect(normalizeDateToISODateString('not a date')).toBe(null);
  });

  it('strips time from ISO datetime strings', () => {
    expect(normalizeDateToISODateString('2026-01-02T15:30:00.000Z')).toBe('2026-01-02');
  });
});
