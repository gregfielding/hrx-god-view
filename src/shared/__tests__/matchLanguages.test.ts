/**
 * Unit tests for `matchLanguages`.
 *
 * @see shared/jobRequirementMatchers/matchLanguages.ts
 */

import { matchLanguages } from '../jobRequirementMatchers/matchLanguages';

describe('matchLanguages', () => {
  describe('not_applicable', () => {
    it('returns not_applicable when required.language is empty', () => {
      const r = matchLanguages({ required: { language: '', minLevel: 'basic' } });
      expect(r.status).toBe('not_applicable');
      expect(r.reason).toBe('required_language_empty');
    });
  });

  describe('incomplete', () => {
    it('returns incomplete when worker has no languages at all', () => {
      const r = matchLanguages({ required: { language: 'Spanish', minLevel: 'basic' } });
      expect(r.status).toBe('incomplete');
      expect(r.reason).toBe('language_not_on_profile');
    });

    it('returns incomplete when required language is not in worker V2 list', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'basic' },
        workerLanguagesV2: [{ language: 'French', level: 'fluent' }],
      });
      expect(r.status).toBe('incomplete');
    });
  });

  describe('complete_pass', () => {
    it('passes when worker V2 level >= minLevel', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'conversational' },
        workerLanguagesV2: [{ language: 'Spanish', level: 'fluent' }],
      });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.matchSource).toBe('v2');
    });

    it('passes when V2 level == minLevel', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'fluent' },
        workerLanguagesV2: [{ language: 'Spanish', level: 'fluent' }],
      });
      expect(r.status).toBe('complete_pass');
    });

    it('matches case-insensitively on language name', () => {
      const r = matchLanguages({
        required: { language: 'spanish', minLevel: 'basic' },
        workerLanguagesV2: [{ language: 'Spanish', level: 'native' }],
      });
      expect(r.status).toBe('complete_pass');
    });

    it('falls back to legacy parsing when V2 absent', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'fluent' },
        workerLegacyLanguages: ['Spanish (fluent)', 'English (native)'],
      });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.matchSource).toBe('legacy_parsed');
    });

    it('legacy plain string defaults to conversational and meets basic minLevel', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'basic' },
        workerLegacyLanguages: ['Spanish'],
      });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.matchedEntry?.level).toBe('conversational');
    });
  });

  describe('complete_fail', () => {
    it('fails when worker level < minLevel', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'fluent' },
        workerLanguagesV2: [{ language: 'Spanish', level: 'basic' }],
      });
      expect(r.status).toBe('complete_fail');
      expect(r.reason).toBe('level_below_minimum');
    });

    it('legacy plain string default (conversational) fails when minLevel is fluent', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'fluent' },
        workerLegacyLanguages: ['Spanish'],
      });
      expect(r.status).toBe('complete_fail');
    });
  });

  describe('V2 wins over legacy', () => {
    it('V2 takes precedence', () => {
      const r = matchLanguages({
        required: { language: 'Spanish', minLevel: 'fluent' },
        workerLanguagesV2: [{ language: 'Spanish', level: 'native' }],
        workerLegacyLanguages: ['Spanish (basic)'], // would fail if used
      });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.matchSource).toBe('v2');
    });
  });
});
