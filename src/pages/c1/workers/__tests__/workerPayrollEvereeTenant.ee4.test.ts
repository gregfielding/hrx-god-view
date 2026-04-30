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
  decideExperienceType,
  dispatchEvereeIframeMessage,
  isStampWithinTtl,
  looksLikeAlreadyCompleteError,
  looksLikeNotYetCompleteError,
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

describe('EE.4 Phase 2 Change 3 — looksLikeOnboardingCompleteMessage extra rejection cases', () => {
  // The spec calls out these specific patterns ("STEP, SECTION, SAVED, ADDED,
  // UPDATED, MESSAGE_PORT_REGISTERED, DISMISS"). The base matcher tests above
  // cover most via composite event names; these cases pin the bare-fragment
  // and forward-compat shapes that the spec explicitly requires we reject.
  it.each([
    'ADDED',
    'UPDATED',
    'SAVED',
    'DISMISS',
    'MESSAGE_PORT_REGISTERED',
    // Forward-compat: Everee could ship a `*_STEP_N` constant tomorrow.
    'WORKER_ONBOARDING_COMPLETE_STEP_4',
    'ONBOARDING_COMPLETE_STEP_1',
    // Hyphenated / lowercased free-form payload mentioning the substring.
    'onboarding-complete-progress',
    // Common Everee SDK lifecycle envelopes.
    'WORKER_ONBOARDING_PROGRESS',
    'WORKER_ONBOARDING_STARTED',
  ])('rejects %s as a terminal completion signal', (eventName) => {
    expect(looksLikeOnboardingCompleteMessage({ type: eventName })).toBe(false);
    expect(looksLikeOnboardingCompleteMessage({ eventType: eventName })).toBe(false);
  });

  it('rejects iframe envelopes that include a terminal-looking value on the wrong field', () => {
    // Everee puts intermediate progress data on `payload`/`data`/`status`;
    // those fields are deliberately NOT scanned by the matcher, so a stray
    // "ONBOARDING_COMPLETE" string nested under them must not flip the swap.
    expect(looksLikeOnboardingCompleteMessage({ payload: 'ONBOARDING_COMPLETE' })).toBe(false);
    expect(looksLikeOnboardingCompleteMessage({ data: 'ONBOARDING_COMPLETE' })).toBe(false);
    expect(looksLikeOnboardingCompleteMessage({ status: 'COMPLETE' })).toBe(false);
  });
});

describe('EE.4 Phase 2 — looksLikeAlreadyCompleteError (EMB-201)', () => {
  it.each([
    'EMB-201',
    'EMB-201: Onboarding already complete',
    'Onboarding already complete',
    'onboarding already complete', // case-insensitive
  ])('matches "%s" anywhere in the payload', (text) => {
    expect(looksLikeAlreadyCompleteError({ message: text })).toBe(true);
    expect(looksLikeAlreadyCompleteError({ errorMessage: text })).toBe(true);
    expect(looksLikeAlreadyCompleteError(text)).toBe(true);
  });

  it('matches when the error blob lives on `error.message`', () => {
    expect(
      looksLikeAlreadyCompleteError({ error: { message: 'EMB-201: already complete' } }),
    ).toBe(true);
  });

  it('does not match unrelated payloads', () => {
    expect(looksLikeAlreadyCompleteError({ message: 'EMB-202' })).toBe(false);
    expect(looksLikeAlreadyCompleteError({ message: 'something else' })).toBe(false);
    expect(looksLikeAlreadyCompleteError(null)).toBe(false);
    expect(looksLikeAlreadyCompleteError(undefined)).toBe(false);
  });
});

describe('EE.4 Phase 2 — looksLikeNotYetCompleteError (EMB-202)', () => {
  it.each([
    'EMB-202',
    'EMB-202: Onboarding not yet complete',
    'Onboarding not yet complete',
    'Only the ONBOARDING experience is available',
  ])('matches "%s" anywhere in the payload', (text) => {
    expect(looksLikeNotYetCompleteError({ message: text })).toBe(true);
    expect(looksLikeNotYetCompleteError(text)).toBe(true);
  });

  it('does not match EMB-201 / unrelated payloads', () => {
    expect(looksLikeNotYetCompleteError({ message: 'EMB-201' })).toBe(false);
    expect(looksLikeNotYetCompleteError({ message: 'random error' })).toBe(false);
  });
});

describe('EE.4 Phase 2 Change 2 — decideExperienceType (canonical-only decision)', () => {
  it('returns forcedExperience verbatim when set, regardless of API state', () => {
    expect(
      decideExperienceType({
        forcedExperience: 'WORKER_HOME',
        apiPreflightOk: true,
        apiSaysComplete: false, // even if API disagrees
      }),
    ).toBe('WORKER_HOME');
    expect(
      decideExperienceType({
        forcedExperience: 'ONBOARDING',
        apiPreflightOk: true,
        apiSaysComplete: true,
      }),
    ).toBe('ONBOARDING');
  });

  it('returns WORKER_HOME when API says complete', () => {
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: true,
        apiSaysComplete: true,
      }),
    ).toBe('WORKER_HOME');
  });

  it('returns ONBOARDING when API says NOT complete', () => {
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: true,
        apiSaysComplete: false,
      }),
    ).toBe('ONBOARDING');
  });

  it('returns ONBOARDING (safe default) when API preflight failed', () => {
    // Deadlock-fuel removed: pre-EE.4 this branch fell back to local
    // Firestore stamps. Now we never trust them — wrong experience is
    // worse than one extra session swap.
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: false,
        apiSaysComplete: false,
      }),
    ).toBe('ONBOARDING');
  });

  it('still returns ONBOARDING when API failed (apiSaysComplete is meaningless when !apiPreflightOk)', () => {
    // The function MUST NOT route on `apiSaysComplete` when the preflight
    // didn't succeed — even though `apiSaysComplete` is technically a
    // boolean, it carries no signal in this branch.
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: false,
        apiSaysComplete: true, // stale, ignore
      }),
    ).toBe('ONBOARDING');
  });
});

describe('EE.4 Phase 2 Change 1 — dispatchEvereeIframeMessage (no Firestore writes)', () => {
  function makeArgs(currentExperience: 'WORKER_HOME' | 'ONBOARDING' | null) {
    const calls: string[] = [];
    const onComplete = jest.fn(() => {
      calls.push('onComplete');
    });
    const onNotYetComplete = jest.fn(() => {
      calls.push('onNotYetComplete');
    });
    return {
      args: { currentExperience, onComplete, onNotYetComplete },
      onComplete,
      onNotYetComplete,
      calls,
    };
  }

  it('iframe terminal event (WORKER_ONBOARDING_COMPLETE) → onComplete fires (UI swap), no other side-effects', () => {
    const { args, onComplete, onNotYetComplete } = makeArgs('ONBOARDING');
    dispatchEvereeIframeMessage({ type: 'WORKER_ONBOARDING_COMPLETE' }, args);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it('iframe terminal event when already on WORKER_HOME → no-op (avoids re-entrant swap)', () => {
    const { args, onComplete, onNotYetComplete } = makeArgs('WORKER_HOME');
    dispatchEvereeIframeMessage({ type: 'WORKER_ONBOARDING_COMPLETE' }, args);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it('intermediate iframe event (STEP_COMPLETE) → no callbacks fire', () => {
    // Pre-EE.4 the matcher false-positive on this name caused the deadlock.
    // Pin the inverse here: the simplified dispatcher must not swap.
    const { args, onComplete, onNotYetComplete } = makeArgs('ONBOARDING');
    dispatchEvereeIframeMessage({ type: 'STEP_COMPLETE' }, args);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it.each([
    'BANK_ONBOARDING_COMPLETE_STEP_3',
    'I9_SECTION_1_ONBOARDING_COMPLETE',
    'PERSONAL_INFO_UPDATED',
    'BANK_ACCOUNT_ADDED',
    'WORKER_ONBOARDING_PROGRESS',
    'MESSAGE_PORT_REGISTERED',
    'DISMISS',
  ])('intermediate iframe event %s → no callbacks fire', (eventName) => {
    const { args, onComplete, onNotYetComplete } = makeArgs('ONBOARDING');
    dispatchEvereeIframeMessage({ type: eventName }, args);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it('iframe EMB-201 toast (already complete) → onComplete fires', () => {
    const { args, onComplete, onNotYetComplete } = makeArgs('ONBOARDING');
    dispatchEvereeIframeMessage({ message: 'EMB-201: Onboarding already complete' }, args);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it('iframe EMB-202 toast (not yet complete) when on WORKER_HOME → onNotYetComplete fires', () => {
    const { args, onComplete, onNotYetComplete } = makeArgs('WORKER_HOME');
    dispatchEvereeIframeMessage({ message: 'EMB-202: Onboarding not yet complete' }, args);
    expect(onNotYetComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('iframe EMB-202 toast when ALREADY on ONBOARDING → no-op (already in the right experience)', () => {
    // The only escape from this state is a fresh session-create with
    // forcedExperience=null → preflight → WORKER_HOME. Don't re-set
    // forcedExperience back to ONBOARDING in a tight loop.
    const { args, onComplete, onNotYetComplete } = makeArgs('ONBOARDING');
    dispatchEvereeIframeMessage({ message: 'EMB-202: Onboarding not yet complete' }, args);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it('garbage / null payload → no callbacks fire', () => {
    const { args, onComplete, onNotYetComplete } = makeArgs('ONBOARDING');
    dispatchEvereeIframeMessage(null, args);
    dispatchEvereeIframeMessage(undefined, args);
    dispatchEvereeIframeMessage({}, args);
    dispatchEvereeIframeMessage('hello', args);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onNotYetComplete).not.toHaveBeenCalled();
  });

  it('EMB-202 takes priority over an intermediate completion-shaped event in the same payload', () => {
    // Defensive ordering: if Everee ever ships a payload with both an
    // intermediate event name AND an EMB-202 error blob, the error blob wins
    // because it carries higher signal about the actual session state.
    const { args, onNotYetComplete } = makeArgs('WORKER_HOME');
    dispatchEvereeIframeMessage(
      {
        type: 'STEP_COMPLETE',
        message: 'EMB-202: Onboarding not yet complete',
      },
      args,
    );
    expect(onNotYetComplete).toHaveBeenCalledTimes(1);
  });
});

describe('EE.4 Acceptance — stale-stamp resilience (decision-layer)', () => {
  // Spec acceptance criterion: "Manually setting a stale stamp on Firestore
  // for a non-onboarded worker → next session creation correctly ignores it
  // and requests ONBOARDING based on live Everee API state."
  //
  // The decision happens entirely in `decideExperienceType`. The local
  // stamp is read via `detectOnboardingComplete` for diagnostic logging
  // only — it never reaches the decision matrix. These tests pin that
  // contract by simulating "stamp says one thing, API says the opposite"
  // and confirming the API wins every time.
  it('API says NOT complete → ONBOARDING (even though caller could have stale stamp)', () => {
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: true,
        apiSaysComplete: false,
      }),
    ).toBe('ONBOARDING');
  });

  it('API says complete → WORKER_HOME (regardless of any local stamps)', () => {
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: true,
        apiSaysComplete: true,
      }),
    ).toBe('WORKER_HOME');
  });

  it('API failed → ONBOARDING (no local-stamp fallback — that was the deadlock fuel)', () => {
    expect(
      decideExperienceType({
        forcedExperience: null,
        apiPreflightOk: false,
        apiSaysComplete: false,
      }),
    ).toBe('ONBOARDING');
  });
});
