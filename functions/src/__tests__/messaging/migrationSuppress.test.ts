/**
 * Unit tests for `migrationSuppress.userIsInActiveMigration`.
 *
 * The helper is the single decision point for "should this messaging
 * trigger / scheduler suppress for an active migration?" — every gate
 * site reads it. So we exercise the full prefix matrix here, including
 * defensive shapes (non-string, null, whitespace).
 *
 * Mocha + Chai (matches sibling tests in `functions/src/__tests__/...`).
 */
import { expect } from 'chai';
import {
  userIsInActiveMigration,
  APPLY_WIZARD_SUPPRESSION_REASON,
  AUTO_INTERVIEW_SUPPRESSION_OUTCOME,
  MIGRATION_SUPPRESSION_LOG_TAG,
} from '../../messaging/migrationSuppress';

describe('migrationSuppress.userIsInActiveMigration', () => {
  describe('positive matches (suppression triggers)', () => {
    it('matches BI.0 Tempworks emergency import canonical value', () => {
      expect(
        userIsInActiveMigration({ migrationSource: 'tempworks_emergency_2026-05-07' }),
      ).to.equal(true);
    });

    it('matches BI.1 future tempworks_bulk_invite source', () => {
      expect(userIsInActiveMigration({ migrationSource: 'tempworks_bulk_invite' })).to.equal(true);
    });

    it('matches forward-compat bi1_pilot prefix (BI.1 P3 messaging engine)', () => {
      expect(userIsInActiveMigration({ migrationSource: 'bi1_pilot' })).to.equal(true);
    });

    it('matches forward-compat bi1_phase_3_dispatch prefix', () => {
      expect(userIsInActiveMigration({ migrationSource: 'bi1_phase_3_dispatch' })).to.equal(true);
    });

    it('trims whitespace before matching (defensive against schema drift)', () => {
      expect(userIsInActiveMigration({ migrationSource: '  tempworks_emergency_2026-05-07  ' })).to.equal(true);
      expect(userIsInActiveMigration({ migrationSource: '\nbi1_pilot\n' })).to.equal(true);
    });
  });

  describe('negative matches (do not suppress)', () => {
    it('returns false for unset migrationSource', () => {
      expect(userIsInActiveMigration({})).to.equal(false);
    });

    it('returns false for null doc data', () => {
      expect(userIsInActiveMigration(null)).to.equal(false);
    });

    it('returns false for undefined doc data', () => {
      expect(userIsInActiveMigration(undefined)).to.equal(false);
    });

    it('returns false for empty string migrationSource', () => {
      expect(userIsInActiveMigration({ migrationSource: '' })).to.equal(false);
    });

    it('returns false for whitespace-only migrationSource', () => {
      expect(userIsInActiveMigration({ migrationSource: '   ' })).to.equal(false);
    });

    it('returns false for unrecognized prefix (manual_csv)', () => {
      expect(userIsInActiveMigration({ migrationSource: 'manual_csv' })).to.equal(false);
    });

    it('returns false for unrecognized prefix (other)', () => {
      expect(userIsInActiveMigration({ migrationSource: 'other' })).to.equal(false);
    });

    it('does NOT match a string that contains tempworks_ as a substring (anchored regex)', () => {
      // `^tempworks_` requires prefix match — `legacy_tempworks_x` should
      // not be treated as an active migration. Defends against future
      // archive / legacy columns sneaking through.
      expect(userIsInActiveMigration({ migrationSource: 'legacy_tempworks_2024' })).to.equal(false);
    });

    it('does NOT match a string that contains bi1_ as a substring (anchored regex)', () => {
      expect(userIsInActiveMigration({ migrationSource: 'foo_bi1_archived' })).to.equal(false);
    });
  });

  describe('defensive type handling', () => {
    it('returns false when migrationSource is a number', () => {
      expect(userIsInActiveMigration({ migrationSource: 12345 } as unknown as Record<string, unknown>)).to.equal(false);
    });

    it('returns false when migrationSource is an object', () => {
      expect(
        userIsInActiveMigration({ migrationSource: { source: 'tempworks_x' } } as unknown as Record<string, unknown>),
      ).to.equal(false);
    });

    it('returns false when migrationSource is an array', () => {
      expect(
        userIsInActiveMigration({ migrationSource: ['tempworks_x'] } as unknown as Record<string, unknown>),
      ).to.equal(false);
    });

    it('returns false when migrationSource is null', () => {
      expect(
        userIsInActiveMigration({ migrationSource: null } as unknown as Record<string, unknown>),
      ).to.equal(false);
    });

    it('returns false when migrationSource is boolean true', () => {
      expect(
        userIsInActiveMigration({ migrationSource: true } as unknown as Record<string, unknown>),
      ).to.equal(false);
    });
  });

  describe('exported audit constants', () => {
    it('APPLY_WIZARD_SUPPRESSION_REASON is a non-empty string used in the apply-wizard scheduler patch', () => {
      expect(APPLY_WIZARD_SUPPRESSION_REASON).to.be.a('string');
      expect(APPLY_WIZARD_SUPPRESSION_REASON.length).to.be.greaterThan(0);
    });

    it('AUTO_INTERVIEW_SUPPRESSION_OUTCOME is a non-empty string used in the auto-interview scheduler patch', () => {
      expect(AUTO_INTERVIEW_SUPPRESSION_OUTCOME).to.be.a('string');
      expect(AUTO_INTERVIEW_SUPPRESSION_OUTCOME.length).to.be.greaterThan(0);
    });

    it('MIGRATION_SUPPRESSION_LOG_TAG is a non-empty string for cross-trigger log dashboards', () => {
      expect(MIGRATION_SUPPRESSION_LOG_TAG).to.be.a('string');
      expect(MIGRATION_SUPPRESSION_LOG_TAG.length).to.be.greaterThan(0);
    });
  });
});
