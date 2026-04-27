/**
 * Unit tests for the EducationLevel enum, ordinal helper, and legacy parser.
 *
 * Locks in the Phase B.0 schema decision (matrix §B + GED + trade) and the
 * legacy adapter contract — `'highschool'` (no underscore) from production
 * data normalizes to `'high_school'`; freeform / unknown strings return null.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.4
 */

import {
  EDUCATION_LEVEL_ORDINAL,
  EDUCATION_LEVEL_V1_VERSION,
  EducationLevel,
  educationLevelOrdinal,
  isEducationLevel,
  parseLegacyEducationLevel,
} from '../educationLevel';

describe('EducationLevel — schema lock', () => {
  it('uses schema version 1', () => {
    expect(EDUCATION_LEVEL_V1_VERSION).toBe(1);
  });

  it('contains exactly the 8 canonical values, in ranking order', () => {
    // Snapshot of the Phase B.0 decision. Adding / removing values must update
    // the matrix doc AND `parseLegacyEducationLevel` AND any consuming matcher.
    const expected: EducationLevel[] = [
      'none',
      'high_school',
      'ged',
      'trade',
      'associate',
      'bachelor',
      'master',
      'doctorate',
    ];
    // Sort by ordinal then by alpha to break the high_school/ged tie deterministically.
    const fromMap = (Object.keys(EDUCATION_LEVEL_ORDINAL) as EducationLevel[]).sort((a, b) => {
      const d = EDUCATION_LEVEL_ORDINAL[a] - EDUCATION_LEVEL_ORDINAL[b];
      return d !== 0 ? d : a.localeCompare(b);
    });
    // Expected order with the same tie-breaker (ged < high_school alphabetically).
    const expectedSorted = [...expected].sort((a, b) => {
      const d = EDUCATION_LEVEL_ORDINAL[a] - EDUCATION_LEVEL_ORDINAL[b];
      return d !== 0 ? d : a.localeCompare(b);
    });
    expect(fromMap).toEqual(expectedSorted);
  });
});

describe('educationLevelOrdinal', () => {
  it('ranks none lowest', () => {
    expect(educationLevelOrdinal('none')).toBe(0);
  });

  it('ranks high_school and ged equally', () => {
    expect(educationLevelOrdinal('high_school')).toBe(educationLevelOrdinal('ged'));
  });

  it('ranks trade strictly above high_school and ged', () => {
    expect(educationLevelOrdinal('trade')).toBeGreaterThan(educationLevelOrdinal('high_school'));
    expect(educationLevelOrdinal('trade')).toBeGreaterThan(educationLevelOrdinal('ged'));
  });

  it('ranks associate, bachelor, master, doctorate strictly increasing', () => {
    expect(educationLevelOrdinal('associate')).toBeLessThan(educationLevelOrdinal('bachelor'));
    expect(educationLevelOrdinal('bachelor')).toBeLessThan(educationLevelOrdinal('master'));
    expect(educationLevelOrdinal('master')).toBeLessThan(educationLevelOrdinal('doctorate'));
  });

  it('worker level >= required level evaluates correctly across the hierarchy', () => {
    // Common matcher comparisons.
    expect(educationLevelOrdinal('master') >= educationLevelOrdinal('bachelor')).toBe(true);
    expect(educationLevelOrdinal('high_school') >= educationLevelOrdinal('associate')).toBe(false);
    expect(educationLevelOrdinal('ged') >= educationLevelOrdinal('high_school')).toBe(true);
    expect(educationLevelOrdinal('trade') >= educationLevelOrdinal('high_school')).toBe(true);
  });
});

describe('isEducationLevel', () => {
  it.each([
    'none',
    'high_school',
    'ged',
    'trade',
    'associate',
    'bachelor',
    'master',
    'doctorate',
  ])('returns true for canonical value %s', (val) => {
    expect(isEducationLevel(val)).toBe(true);
  });

  it.each([
    'highschool',     // legacy form
    'high school',
    'HIGH_SCHOOL',
    'High School',
    'BS',
    '',
    null,
    undefined,
    42,
    {},
  ])('returns false for non-canonical input %p', (val) => {
    expect(isEducationLevel(val)).toBe(false);
  });
});

describe('parseLegacyEducationLevel', () => {
  describe('canonical values pass through', () => {
    it.each<[string, EducationLevel]>([
      ['none', 'none'],
      ['high_school', 'high_school'],
      ['ged', 'ged'],
      ['trade', 'trade'],
      ['associate', 'associate'],
      ['bachelor', 'bachelor'],
      ['master', 'master'],
      ['doctorate', 'doctorate'],
    ])('%s → %s', (input, expected) => {
      expect(parseLegacyEducationLevel(input)).toBe(expected);
    });
  });

  describe('legacy dropdown forms', () => {
    it.each<[string, EducationLevel]>([
      ['highschool', 'high_school'],
      ['HIGHSCHOOL', 'high_school'],
      ['high school', 'high_school'],
      ['High School', 'high_school'],
      ['hs', 'high_school'],
      ['HS', 'high_school'],
      ['diploma', 'high_school'],
    ])('%s → %s', (input, expected) => {
      expect(parseLegacyEducationLevel(input)).toBe(expected);
    });
  });

  describe('common abbreviations + variants', () => {
    it.each<[string, EducationLevel]>([
      // none
      ['no education', 'none'],
      ['No Education', 'none'],
      // trade
      ['vocational', 'trade'],
      ['cert', 'trade'],
      ['certificate', 'trade'],
      // associate
      ['AA', 'associate'],
      ['as', 'associate'],
      ['AAS', 'associate'],
      ['associates', 'associate'],
      // bachelor
      ['BA', 'bachelor'],
      ['BS', 'bachelor'],
      ['bachelors', 'bachelor'],
      // master
      ['MA', 'master'],
      ['MS', 'master'],
      ['MBA', 'master'],
      ['masters', 'master'],
      // doctorate
      ['PhD', 'doctorate'],
      ['EdD', 'doctorate'],
      ['MD', 'doctorate'],
      ['JD', 'doctorate'],
    ])('%s → %s', (input, expected) => {
      expect(parseLegacyEducationLevel(input)).toBe(expected);
    });
  });

  describe('whitespace, hyphens, slashes collapse', () => {
    it.each<[string, EducationLevel]>([
      ['  high   school  ', 'high_school'],
      ['high-school', 'high_school'],
      ['high/school', 'high_school'],
      ['HIGH - SCHOOL', 'high_school'],
    ])('%j → %s', (input, expected) => {
      expect(parseLegacyEducationLevel(input)).toBe(expected);
    });
  });

  describe('returns null for unknown / freeform / invalid', () => {
    it.each<unknown>([
      'Unknown',                  // resume parser default
      'University of California', // school name, not level
      'something arbitrary',
      '',
      '   ',
      null,
      undefined,
      42,
      true,
      {},
      [],
    ])('returns null for input %p', (input) => {
      expect(parseLegacyEducationLevel(input)).toBeNull();
    });
  });
});
