/**
 * Unit tests for `matchEducation`.
 *
 * @see shared/jobRequirementMatchers/matchEducation.ts
 */

import { matchEducation } from '../jobRequirementMatchers/matchEducation';

describe('matchEducation', () => {
  describe('not_applicable', () => {
    it('returns not_applicable when JO has no requirement', () => {
      const r = matchEducation({});
      expect(r.status).toBe('not_applicable');
      expect(r.reason).toBe('no_requirement');
    });

    it("returns not_applicable when JO requires 'none'", () => {
      const r = matchEducation({ required: 'none' });
      expect(r.status).toBe('not_applicable');
    });
  });

  describe('incomplete', () => {
    it('returns incomplete when worker has no V2 and no legacy', () => {
      const r = matchEducation({ required: 'high_school' });
      expect(r.status).toBe('incomplete');
      expect(r.reason).toBe('worker_level_unknown');
      expect(r.details?.workerLevelSource).toBe('none');
    });

    it("returns incomplete when worker's legacy string is unparseable", () => {
      const r = matchEducation({ required: 'high_school', workerLegacyLevel: 'Unknown' });
      expect(r.status).toBe('incomplete');
      expect(r.details?.workerLevel).toBeNull();
    });
  });

  describe('complete_pass', () => {
    it('passes when V2 level meets required', () => {
      const r = matchEducation({ required: 'high_school', workerLevelV2: 'bachelor' });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.workerLevelSource).toBe('v2');
    });

    it('passes with equal levels (high_school === ged ordinal)', () => {
      const r = matchEducation({ required: 'high_school', workerLevelV2: 'ged' });
      expect(r.status).toBe('complete_pass');
    });

    it('passes when V2 absent but legacy parses to sufficient level', () => {
      const r = matchEducation({ required: 'high_school', workerLegacyLevel: 'highschool' });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.workerLevelSource).toBe('legacy_parsed');
      expect(r.details?.workerLevel).toBe('high_school');
    });

    it('passes when legacy parses to a higher level (BS → bachelor)', () => {
      const r = matchEducation({ required: 'associate', workerLegacyLevel: 'BS' });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.workerLevel).toBe('bachelor');
    });
  });

  describe('complete_fail', () => {
    it('fails when worker level is below requirement', () => {
      const r = matchEducation({ required: 'bachelor', workerLevelV2: 'high_school' });
      expect(r.status).toBe('complete_fail');
      expect(r.reason).toBe('level_below_required');
    });

    it('fails when legacy parses to a low level', () => {
      const r = matchEducation({ required: 'master', workerLegacyLevel: 'high school' });
      expect(r.status).toBe('complete_fail');
    });
  });

  describe('V2 wins over legacy', () => {
    it('V2 takes precedence even when legacy is present', () => {
      const r = matchEducation({
        required: 'bachelor',
        workerLevelV2: 'master',
        workerLegacyLevel: 'highschool', // would otherwise fail
      });
      expect(r.status).toBe('complete_pass');
      expect(r.details?.workerLevelSource).toBe('v2');
    });
  });
});
