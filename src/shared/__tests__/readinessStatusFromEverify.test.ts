/**
 * Unit tests for `everifyToReadinessStatus`. Covers every value in the
 * `EverifyHrxStatus` union plus null/undefined.
 *
 * See `docs/READINESS_EXECUTION_MATRIX.md` §5.2 for the spec.
 */

import {
  everifyToReadinessStatus,
  EverifyHrxStatus,
} from '../readinessStatusFromEverify';

describe('everifyToReadinessStatus', () => {
  describe('null/undefined', () => {
    it('returns incomplete for null', () => {
      expect(everifyToReadinessStatus({ hrxStatus: null })).toBe('incomplete');
    });

    it('returns incomplete for undefined', () => {
      expect(everifyToReadinessStatus({ hrxStatus: undefined })).toBe('incomplete');
    });
  });

  describe('not-yet-submitted states', () => {
    const incompleteStatuses: EverifyHrxStatus[] = ['draft', 'ready'];

    it.each(incompleteStatuses)('returns incomplete for %s', (status) => {
      expect(everifyToReadinessStatus({ hrxStatus: status })).toBe('incomplete');
    });
  });

  describe('in-flight states (with USCIS)', () => {
    const inFlightStatuses: EverifyHrxStatus[] = [
      'submitted',
      'pending',
      'dhs_verification_in_process',
    ];

    it.each(inFlightStatuses)('returns in_progress for %s', (status) => {
      expect(everifyToReadinessStatus({ hrxStatus: status })).toBe('in_progress');
    });
  });

  describe('admin-action-required states', () => {
    const reviewStatuses: EverifyHrxStatus[] = [
      'tnc',
      'further_action_required',
      'error',
    ];

    it.each(reviewStatuses)('returns needs_review for %s', (status) => {
      expect(everifyToReadinessStatus({ hrxStatus: status })).toBe('needs_review');
    });
  });

  describe('terminal positive', () => {
    it('returns complete_pass for employment_authorized', () => {
      expect(everifyToReadinessStatus({ hrxStatus: 'employment_authorized' })).toBe(
        'complete_pass',
      );
    });
  });

  describe('terminal negative', () => {
    const failStatuses: EverifyHrxStatus[] = ['final_nonconfirmation', 'closed'];

    it.each(failStatuses)('returns complete_fail for %s', (status) => {
      expect(everifyToReadinessStatus({ hrxStatus: status })).toBe('complete_fail');
    });
  });

  describe('closure_duplicate', () => {
    it('returns not_applicable (the other case is the source of truth)', () => {
      expect(everifyToReadinessStatus({ hrxStatus: 'closure_duplicate' })).toBe(
        'not_applicable',
      );
    });
  });
});
