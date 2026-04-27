/**
 * Unit tests for `evereeToReadinessStatus`. Covers every Everee status
 * value × the bank-account-verified split.
 *
 * See `docs/READINESS_EXECUTION_MATRIX.md` §5.3 for the spec.
 */

import { evereeToReadinessStatus } from '../readinessStatusFromEveree';

describe('evereeToReadinessStatus', () => {
  describe('null/undefined status', () => {
    it('returns incomplete for both items when status is null', () => {
      expect(evereeToReadinessStatus({ status: null })).toEqual({
        evereeProfile: 'incomplete',
        directDeposit: 'incomplete',
      });
    });

    it('returns incomplete for both when status is undefined', () => {
      expect(evereeToReadinessStatus({ status: undefined })).toEqual({
        evereeProfile: 'incomplete',
        directDeposit: 'incomplete',
      });
    });
  });

  describe('mid-flow states', () => {
    it('invited → in_progress for both', () => {
      expect(evereeToReadinessStatus({ status: 'invited' })).toEqual({
        evereeProfile: 'in_progress',
        directDeposit: 'in_progress',
      });
    });

    it('in_progress → in_progress for both', () => {
      expect(evereeToReadinessStatus({ status: 'in_progress' })).toEqual({
        evereeProfile: 'in_progress',
        directDeposit: 'in_progress',
      });
    });
  });

  describe('onboarding_complete', () => {
    it('with verified bank account → complete_pass for both', () => {
      expect(
        evereeToReadinessStatus({
          status: 'onboarding_complete',
          bankAccountVerified: true,
        }),
      ).toEqual({
        evereeProfile: 'complete_pass',
        directDeposit: 'complete_pass',
      });
    });

    it('with unverified bank account → profile complete_pass, direct_deposit in_progress', () => {
      expect(
        evereeToReadinessStatus({
          status: 'onboarding_complete',
          bankAccountVerified: false,
        }),
      ).toEqual({
        evereeProfile: 'complete_pass',
        directDeposit: 'in_progress',
      });
    });

    it('with bankAccountVerified omitted → profile complete_pass, direct_deposit in_progress', () => {
      // Default-conservative: if the flag wasn't set, assume DD isn't
      // verified yet rather than passing the worker on missing data.
      expect(
        evereeToReadinessStatus({ status: 'onboarding_complete' }),
      ).toEqual({
        evereeProfile: 'complete_pass',
        directDeposit: 'in_progress',
      });
    });
  });

  describe('failure states', () => {
    it('failed → needs_review for both', () => {
      expect(evereeToReadinessStatus({ status: 'failed' })).toEqual({
        evereeProfile: 'needs_review',
        directDeposit: 'needs_review',
      });
    });

    it('rejected → needs_review for both', () => {
      // Recoverable — CSA can re-invite. Distinct from terminal complete_fail.
      expect(evereeToReadinessStatus({ status: 'rejected' })).toEqual({
        evereeProfile: 'needs_review',
        directDeposit: 'needs_review',
      });
    });
  });
});
