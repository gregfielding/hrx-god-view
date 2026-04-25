/**
 * Unit tests for `accuSourceToReadinessStatus`. The translator is pure;
 * coverage target is every input enum value plus the verdict-aggregation
 * priority ladder.
 *
 * See `docs/READINESS_EXECUTION_MATRIX.md` §5.1 for the spec these tests
 * encode.
 */

import {
  accuSourceToReadinessStatus,
  AccuSourceHrxStatus,
  AccuSourceLineVerdict,
} from '../readinessStatusFromAccuSource';

describe('accuSourceToReadinessStatus', () => {
  describe('hrxStatus = null/undefined', () => {
    it('returns incomplete for null hrxStatus', () => {
      expect(accuSourceToReadinessStatus({ hrxStatus: null, serviceVerdicts: [] })).toBe(
        'incomplete',
      );
    });

    it('returns incomplete for undefined hrxStatus', () => {
      expect(accuSourceToReadinessStatus({ hrxStatus: undefined, serviceVerdicts: [] })).toBe(
        'incomplete',
      );
    });
  });

  describe('in-progress hrxStatus values', () => {
    const inFlightStatuses: AccuSourceHrxStatus[] = [
      'draft',
      'submitted',
      'awaiting_applicant',
      'in_progress',
      'report_ready',
      'drug_report_ready',
    ];

    it.each(inFlightStatuses)('returns in_progress for %s', (status) => {
      expect(accuSourceToReadinessStatus({ hrxStatus: status, serviceVerdicts: [] })).toBe(
        'in_progress',
      );
    });

    it('still returns in_progress when verdicts are partial', () => {
      // A line might have a verdict before the order's hrxStatus flips
      // to 'completed'. Until the doc is fully complete, we shouldn't
      // resolve the readiness item.
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'report_ready',
          serviceVerdicts: ['PASSED', 'PASSED'],
        }),
      ).toBe('in_progress');
    });
  });

  describe('canceled', () => {
    it('returns not_applicable', () => {
      expect(accuSourceToReadinessStatus({ hrxStatus: 'canceled', serviceVerdicts: [] })).toBe(
        'not_applicable',
      );
    });
  });

  describe('error', () => {
    it('returns needs_review', () => {
      expect(accuSourceToReadinessStatus({ hrxStatus: 'error', serviceVerdicts: [] })).toBe(
        'needs_review',
      );
    });
  });

  describe('completed — verdict aggregation', () => {
    it('returns complete_pass when all verdicts are PASSED', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['PASSED', 'PASSED', 'PASSED'],
        }),
      ).toBe('complete_pass');
    });

    it('returns complete_pass for a single PASSED verdict', () => {
      expect(
        accuSourceToReadinessStatus({ hrxStatus: 'completed', serviceVerdicts: ['PASSED'] }),
      ).toBe('complete_pass');
    });

    it('returns complete_fail when any verdict is FAILED, even amid PASSEDs', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['PASSED', 'PASSED', 'FAILED', 'PASSED'],
        }),
      ).toBe('complete_fail');
    });

    it('returns needs_review when any verdict is NEEDS_REVIEW (no FAILED)', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['PASSED', 'NEEDS_REVIEW', 'PASSED'],
        }),
      ).toBe('needs_review');
    });

    it('FAILED beats NEEDS_REVIEW in the priority ladder', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['NEEDS_REVIEW', 'FAILED'],
        }),
      ).toBe('complete_fail');
    });

    it('returns in_progress when any verdict is PENDING (no FAILED, no NEEDS_REVIEW)', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['PASSED', 'PENDING'],
        }),
      ).toBe('in_progress');
    });

    it('NEEDS_REVIEW beats PENDING in the priority ladder', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['PENDING', 'NEEDS_REVIEW'],
        }),
      ).toBe('needs_review');
    });

    it('returns in_progress for completed with empty verdicts (defensive)', () => {
      // Shouldn't happen in practice but the translator must not pass a
      // worker on no data.
      expect(
        accuSourceToReadinessStatus({ hrxStatus: 'completed', serviceVerdicts: [] }),
      ).toBe('in_progress');
    });
  });

  describe('markedCompleteOutsideHrx override', () => {
    it('short-circuits to complete_pass regardless of hrxStatus', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'draft',
          serviceVerdicts: [],
          markedCompleteOutsideHrx: true,
        }),
      ).toBe('complete_pass');
    });

    it('short-circuits to complete_pass even when verdicts include FAILED', () => {
      // The CSA-marker callable pre-stamps PASSED on all services, but
      // we honor the explicit override regardless.
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'completed',
          serviceVerdicts: ['FAILED'],
          markedCompleteOutsideHrx: true,
        }),
      ).toBe('complete_pass');
    });

    it('does NOT short-circuit when markedCompleteOutsideHrx is false', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'draft',
          serviceVerdicts: [],
          markedCompleteOutsideHrx: false,
        }),
      ).toBe('in_progress');
    });

    it('does NOT short-circuit when markedCompleteOutsideHrx is omitted', () => {
      expect(
        accuSourceToReadinessStatus({
          hrxStatus: 'draft',
          serviceVerdicts: [],
        }),
      ).toBe('in_progress');
    });
  });

  describe('verdict order independence', () => {
    it('aggregation is order-independent', () => {
      const verdicts: AccuSourceLineVerdict[][] = [
        ['PASSED', 'FAILED'],
        ['FAILED', 'PASSED'],
      ];
      const results = verdicts.map((v) =>
        accuSourceToReadinessStatus({ hrxStatus: 'completed', serviceVerdicts: v }),
      );
      expect(results[0]).toBe('complete_fail');
      expect(results[1]).toBe('complete_fail');
    });
  });
});
