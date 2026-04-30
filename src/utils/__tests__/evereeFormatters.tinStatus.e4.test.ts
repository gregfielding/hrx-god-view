/**
 * E.4 — `formatTinStatus` 4-state coverage. Pre-E.4 the formatter
 * collapsed `NEEDS_VERIFICATION`, `SENT_FOR_VERIFICATION`, and `PENDING`
 * into a single "IRS verification pending" / `default` chip — UI consumers
 * (specifically the `EmployeePayrollSection` TIN badge) couldn't tell
 * "worker hasn't started yet" apart from "submitted to IRS, waiting on
 * response". E.4 splits them so the badge reads:
 *
 *   - VERIFIED              → success / "IRS verified"
 *   - SENT_FOR_VERIFICATION → info    / "Submitted to IRS"
 *   - NEEDS_VERIFICATION    → default / "Not submitted"
 *   - MISMATCH              → error   / "IRS rejected — needs correction"
 *
 * These tests pin the new copy + colors for every documented state +
 * alias. If any case here drifts, the EmployeePayrollSection icon picker
 * (`color === 'info'` ↔ HourglassTopIcon) will quietly break.
 *
 * Sister to `src/shared/__tests__/readinessStatusFromEvereeMirror.test.ts`
 * — that file pins the Everee status → canonical readiness status mapping
 * (E.3); this file pins canonical Everee status → chip display (E.4).
 *
 * Note: this test file uses Jest (not Mocha + Chai) per the web-app
 * convention — `src/utils/__tests__/*` runs under CRA's Jest setup.
 */

import { formatTinStatus } from '../evereeFormatters';

describe('formatTinStatus — E.4 four-state TIN-verification chip', () => {
  describe('canonical Everee statuses', () => {
    it('VERIFIED → success / "IRS verified"', () => {
      expect(formatTinStatus('VERIFIED')).toEqual({
        label: 'IRS verified',
        color: 'success',
      });
    });

    it('SENT_FOR_VERIFICATION → info / "Submitted to IRS" (NEW state)', () => {
      // Pre-E.4 this collapsed into "IRS verification pending" / default.
      // The new mapping carries its own `info` color so the TIN badge
      // gets a distinct hourglass icon (see EmployeePayrollSection).
      expect(formatTinStatus('SENT_FOR_VERIFICATION')).toEqual({
        label: 'Submitted to IRS',
        color: 'info',
      });
    });

    it('NEEDS_VERIFICATION → default / "Not submitted"', () => {
      // Pre-E.4 said "IRS verification pending" which read as "we're waiting
      // on the IRS" — but really nothing has been submitted yet. New copy
      // is unambiguous about which side hasn't done its part.
      expect(formatTinStatus('NEEDS_VERIFICATION')).toEqual({
        label: 'Not submitted',
        color: 'default',
      });
    });

    it('MISMATCH → error / "IRS rejected — needs correction"', () => {
      expect(formatTinStatus('MISMATCH')).toEqual({
        label: 'IRS rejected — needs correction',
        color: 'error',
      });
    });
  });

  describe('aliases — historical Everee names', () => {
    it('NEEDS_VERIFY → same as NEEDS_VERIFICATION', () => {
      expect(formatTinStatus('NEEDS_VERIFY')).toEqual({
        label: 'Not submitted',
        color: 'default',
      });
    });

    it('INVALID → same as MISMATCH', () => {
      expect(formatTinStatus('INVALID')).toEqual({
        label: 'IRS rejected — needs correction',
        color: 'error',
      });
    });

    it('PENDING → SENT_FOR_VERIFICATION semantics (info / "Submitted to IRS")', () => {
      // Critical alias — pre-E.4 this collapsed PENDING into "Not
      // submitted" semantics, which is exactly backwards: PENDING in
      // Everee's vocabulary means "submitted, waiting on IRS response".
      // Catching this reversal in a test prevents a regression where a
      // worker who actually submitted shows up as "Not submitted".
      expect(formatTinStatus('PENDING')).toEqual({
        label: 'Submitted to IRS',
        color: 'info',
      });
    });

    it('SUBMITTED → SENT_FOR_VERIFICATION semantics (info / "Submitted to IRS")', () => {
      expect(formatTinStatus('SUBMITTED')).toEqual({
        label: 'Submitted to IRS',
        color: 'info',
      });
    });
  });

  describe('case + whitespace tolerance', () => {
    it('lowercase verified still maps to verified branch', () => {
      expect(formatTinStatus('verified')).toEqual({
        label: 'IRS verified',
        color: 'success',
      });
    });

    it('mixed-case + leading/trailing whitespace tolerated', () => {
      expect(formatTinStatus('  Sent_For_Verification  ')).toEqual({
        label: 'Submitted to IRS',
        color: 'info',
      });
    });
  });

  describe('null / empty / unknown fallbacks', () => {
    it('null → "Unknown" / default', () => {
      expect(formatTinStatus(null)).toEqual({ label: 'Unknown', color: 'default' });
    });

    it('undefined → "Unknown" / default', () => {
      expect(formatTinStatus(undefined)).toEqual({ label: 'Unknown', color: 'default' });
    });

    it('empty string → "Unknown" / default', () => {
      expect(formatTinStatus('')).toEqual({ label: 'Unknown', color: 'default' });
    });

    it('unknown future state → titleCased / default (forward-compat fallback)', () => {
      // Anything Everee adds later (e.g. EXPIRING) renders without a
      // crash. Color defaults to neutral; surfaces can override copy via
      // their own switch on the raw status if they care to.
      expect(formatTinStatus('NEW_FUTURE_STATE')).toEqual({
        label: 'New Future State',
        color: 'default',
      });
    });
  });
});
