/**
 * Unit tests for LanguageProficiency types, ordinal helper, and legacy parser.
 *
 * Locks the proficiency hierarchy and the parse contract for legacy
 * `users.languages: string[]` entries. Default-level decision (`'conversational'`
 * when unspecified) is asserted explicitly so future changes surface here.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.5
 */

import {
  LANGUAGE_PROFICIENCY_V1_VERSION,
  LanguageProficiencyLevel,
  isLanguageProficiencyLevel,
  languageProficiencyOrdinal,
  parseLegacyLanguageString,
} from '../languageProficiency';

describe('LanguageProficiency — schema lock', () => {
  it('uses schema version 1', () => {
    expect(LANGUAGE_PROFICIENCY_V1_VERSION).toBe(1);
  });
});

describe('languageProficiencyOrdinal', () => {
  it('orders basic < conversational < fluent < native strictly', () => {
    expect(languageProficiencyOrdinal('basic')).toBeLessThan(
      languageProficiencyOrdinal('conversational'),
    );
    expect(languageProficiencyOrdinal('conversational')).toBeLessThan(
      languageProficiencyOrdinal('fluent'),
    );
    expect(languageProficiencyOrdinal('fluent')).toBeLessThan(
      languageProficiencyOrdinal('native'),
    );
  });

  it('basic is rank 1, native is rank 4', () => {
    expect(languageProficiencyOrdinal('basic')).toBe(1);
    expect(languageProficiencyOrdinal('native')).toBe(4);
  });

  it('worker level >= required minLevel evaluates correctly', () => {
    // Native always satisfies any minLevel.
    expect(languageProficiencyOrdinal('native') >= languageProficiencyOrdinal('basic')).toBe(true);
    expect(languageProficiencyOrdinal('native') >= languageProficiencyOrdinal('fluent')).toBe(true);
    // Basic only satisfies minLevel basic.
    expect(languageProficiencyOrdinal('basic') >= languageProficiencyOrdinal('conversational')).toBe(false);
    // Equal level passes.
    expect(languageProficiencyOrdinal('fluent') >= languageProficiencyOrdinal('fluent')).toBe(true);
  });
});

describe('isLanguageProficiencyLevel', () => {
  it.each(['basic', 'conversational', 'fluent', 'native'])(
    'returns true for %s',
    (val) => {
      expect(isLanguageProficiencyLevel(val)).toBe(true);
    },
  );

  it.each([
    'BASIC',                  // case-sensitive — the type union is lowercase only
    'beginner',               // not a recognized tier
    'intermediate',
    '',
    null,
    undefined,
    42,
  ])('returns false for %p', (val) => {
    expect(isLanguageProficiencyLevel(val)).toBe(false);
  });
});

describe('parseLegacyLanguageString', () => {
  describe('plain language name → conversational default', () => {
    it.each<[string, string]>([
      ['Spanish', 'Spanish'],
      ['English', 'English'],
      ['Mandarin', 'Mandarin'],
      ['  Spanish  ', 'Spanish'],
    ])('%j → { language: %s, level: conversational }', (input, expectedLanguage) => {
      const result = parseLegacyLanguageString(input);
      expect(result).toEqual({ language: expectedLanguage, level: 'conversational' });
    });
  });

  describe('parenthetical level', () => {
    it.each<[string, string, LanguageProficiencyLevel]>([
      ['Spanish (basic)', 'Spanish', 'basic'],
      ['Spanish (conversational)', 'Spanish', 'conversational'],
      ['Spanish (fluent)', 'Spanish', 'fluent'],
      ['Spanish (native)', 'Spanish', 'native'],
      ['Spanish (FLUENT)', 'Spanish', 'fluent'],
      ['Mandarin Chinese (native)', 'Mandarin Chinese', 'native'],
    ])('%j → { language: %s, level: %s }', (input, language, level) => {
      expect(parseLegacyLanguageString(input)).toEqual({ language, level });
    });
  });

  describe('hyphen / colon separators', () => {
    it.each<[string, string, LanguageProficiencyLevel]>([
      ['Spanish - native', 'Spanish', 'native'],
      ['Spanish-fluent', 'Spanish', 'fluent'],
      ['Spanish: basic', 'Spanish', 'basic'],
      ['Spanish:native', 'Spanish', 'native'],
    ])('%j → { language: %s, level: %s }', (input, language, level) => {
      expect(parseLegacyLanguageString(input)).toEqual({ language, level });
    });
  });

  describe('returns null for invalid input', () => {
    it.each<unknown>([
      '',
      '   ',
      null,
      undefined,
      42,
      {},
      [],
    ])('null for %p', (input) => {
      expect(parseLegacyLanguageString(input)).toBeNull();
    });
  });

  it('treats "Spanish (gibberish)" as plain language with default level', () => {
    // Falls through to the no-separator branch since the tail doesn't match
    // a known level. Worker said "Spanish (gibberish)" — best we can do is
    // call it Spanish at the default level.
    const result = parseLegacyLanguageString('Spanish (gibberish)');
    expect(result).toEqual({ language: 'Spanish (gibberish)', level: 'conversational' });
  });

  it('does not infer level from arbitrary words like "good" or "fluently"', () => {
    expect(parseLegacyLanguageString('Spanish (good)')).toEqual({
      language: 'Spanish (good)',
      level: 'conversational',
    });
  });
});
