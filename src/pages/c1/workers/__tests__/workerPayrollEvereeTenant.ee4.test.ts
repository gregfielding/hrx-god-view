/**
 * EE.4 — pin the post-fix matcher + TTL behaviors that prevent the
 * EMB-202 deadlock from re-emerging.
 *
 * Three layers under test:
 *
 *   Layer 1 (`looksLikeOnboardingCompleteMessage`)
 *     - Was: substring regex matched any envelope containing
 *       "ONBOARDING_COMPLETE", including intermediate Everee SDK events
 *       like `BANK_ONBOARDING_COMPLETE_STEP_3` or
 *       `I9_SECTION_1_ONBOARDING_COMPLETE`. One false positive →
 *       `clientObservedOnboardingCompleteAt` stamp → next page load
 *       requests `WORKER_HOME` → Everee EMB-202 → unrecoverable (the
 *       host-bridge break swallowed the recovery message).
 *     - Now: strict whitelist of dedicated event-name fields, exact
 *       match against the terminal event set, with an additional
 *       blacklist of intermediate fragments. False negatives are safe
 *       (the Layer-2 server preflight catches real completions on the
 *       next load); false positives are not.
 *
 *   Layer 3 (`isStampWithinTtl`)
 *     - 1-hour TTL on optimistic stamps so an unrecoverable bad stamp
 *       eventually gets ignored even if the preflight is unreachable.
 *
 * (Layer 2 — the server-side `inspectEvereeOnboardingState` matcher —
 * is pinned in `functions/src/__tests__/everee/inspectEvereeOnboardingState.ee4.test.ts`.)
 */

// Pure-helper module, intentionally split out of `WorkerPayrollEvereeTenant.tsx`
// (which pulls in React, MUI, react-router-dom, Firebase…) so this test can
// run under CRA's Jest config without dragging the whole page module in.
import {
  isStampWithinTtl,
  looksLikeOnboardingCompleteMessage,
} from '../workerPayrollEvereeMatchers';

describe('EE.4 Layer 1 — looksLikeOnboardingCompleteMessage', () => {
  describe('accepts unambiguous terminal completion events', () => {
    it.each([
      'WORKER_ONBOARDING_COMPLETE',
      'WORKER_ONBOARDING_COMPLETED',
      'WORKER_ONBOARDED',
      'ONBOARDING_COMPLETE',
      'ONBOARDING_COMPLETED',
      'ONBOARDING_FINISHED',
    ])('accepts terminal event %s on `type`', (eventName) => {
      expect(looksLikeOnboardingCompleteMessage({ type: eventName })).toBe(true);
    });

    it.each(['type', 'event', 'eventType', 'name', 'kind'])(
      'accepts terminal event on dedicated field "%s"',
      (field) => {
        expect(looksLikeOnboardingCompleteMessage({ [field]: 'ONBOARDING_COMPLETE' })).toBe(true);
      },
    );

    it('accepts case-insensitive (lowercase) terminal event', () => {
      expect(looksLikeOnboardingCompleteMessage({ type: 'onboarding_complete' })).toBe(true);
      expect(looksLikeOnboardingCompleteMessage({ event: 'Worker_Onboarded' })).toBe(true);
    });

    it('accepts a bare string payload that is a terminal event', () => {
      expect(looksLikeOnboardingCompleteMessage('ONBOARDING_COMPLETE')).toBe(true);
    });
  });

  describe('REJECTS intermediate / partial events that previously fired the deadlock', () => {
    it.each([
      // Substring of "ONBOARDING_COMPLETE" with intermediate fragment.
      'BANK_ONBOARDING_COMPLETE_STEP_3',
      'I9_SECTION_1_ONBOARDING_COMPLETE',
      'DIRECT_DEPOSIT_ONBOARDING_COMPLETE',
      'PERSONAL_INFO_SECTION_COMPLETE',
      'W4_SECTION_COMPLETE',
      'STEP_COMPLETE',
      'SECTION_SAVED',
      'BANK_ACCOUNT_ADDED',
      'I9_SECTION_1_COMPLETE',
      'TAX_FORM_PROGRESS',
      'PERSONAL_INFO_UPDATED',
      'DD_SETUP_COMPLETE',
      // Free-form payload mentioning the substring.
      'onboarding-complete-step-3',
      'workflow_onboarding_in_progress',
    ])('rejects intermediate event %s', (eventName) => {
      expect(looksLikeOnboardingCompleteMessage({ type: eventName })).toBe(false);
    });

    it('rejects when the would-be terminal event lives on `status` (intermediate progress field)', () => {
      // `status` was a source of false positives in the old matcher; the new
      // matcher only reads from `type`/`event`/`eventType`/`name`/`kind`.
      expect(looksLikeOnboardingCompleteMessage({ status: 'ONBOARDING_COMPLETE' })).toBe(false);
      expect(looksLikeOnboardingCompleteMessage({ state: 'onboarding-complete' })).toBe(false);
    });

    it('rejects an Everee bridge lifecycle envelope (`MESSAGE_PORT_REGISTERED` / `DISMISS`)', () => {
      // These actually appear in the iframe message stream — they must
      // never be misread as completion.
      expect(
        looksLikeOnboardingCompleteMessage({
          eventType: 'MESSAGE_PORT_REGISTERED',
          error: false,
          eventHandlerName: 'hrx_default',
        }),
      ).toBe(false);
      expect(looksLikeOnboardingCompleteMessage({ eventType: 'DISMISS', error: false })).toBe(
        false,
      );
    });

    it('rejects empty / non-event payloads', () => {
      expect(looksLikeOnboardingCompleteMessage(null)).toBe(false);
      expect(looksLikeOnboardingCompleteMessage(undefined)).toBe(false);
      expect(looksLikeOnboardingCompleteMessage('')).toBe(false);
      expect(looksLikeOnboardingCompleteMessage({})).toBe(false);
      expect(looksLikeOnboardingCompleteMessage({ unrelated: 'foo' })).toBe(false);
    });
  });
});

describe('EE.4 Layer 3 — isStampWithinTtl', () => {
  const TTL_MS = 60 * 60 * 1000; // 1 hour

  it('returns false for falsy values', () => {
    expect(isStampWithinTtl(null, TTL_MS)).toBe(false);
    expect(isStampWithinTtl(undefined, TTL_MS)).toBe(false);
    expect(isStampWithinTtl(0, TTL_MS)).toBe(false);
  });

  it('accepts a Firestore Timestamp-shaped value within TTL', () => {
    const recentMs = Date.now() - 5 * 60 * 1000; // 5 min ago
    const ts = { toMillis: () => recentMs };
    expect(isStampWithinTtl(ts, TTL_MS)).toBe(true);
  });

  it('rejects a Firestore Timestamp older than TTL', () => {
    const oldMs = Date.now() - 2 * TTL_MS;
    const ts = { toMillis: () => oldMs };
    expect(isStampWithinTtl(ts, TTL_MS)).toBe(false);
  });

  it('accepts a `{seconds, nanoseconds}` shape within TTL', () => {
    const recentSec = Math.floor(Date.now() / 1000) - 5 * 60;
    expect(isStampWithinTtl({ seconds: recentSec, nanoseconds: 0 }, TTL_MS)).toBe(true);
  });

  it('rejects a `{seconds, nanoseconds}` shape older than TTL', () => {
    const oldSec = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    expect(isStampWithinTtl({ seconds: oldSec, nanoseconds: 0 }, TTL_MS)).toBe(false);
  });

  it('accepts a numeric millis value within TTL', () => {
    expect(isStampWithinTtl(Date.now() - 1000, TTL_MS)).toBe(true);
  });

  it('returns false when toMillis throws (defensive)', () => {
    const ts = {
      toMillis: () => {
        throw new Error('boom');
      },
    };
    expect(isStampWithinTtl(ts, TTL_MS)).toBe(false);
  });
});
