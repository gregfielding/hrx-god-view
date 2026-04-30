/**
 * EE.4 Layer 2 — pin the server-side onboarding-completion matcher rules.
 *
 * Pre-EE.4, `isEvereeOnboardingComplete` (the matcher backing
 * `evereeGetMyOnboardingStatus` and `evereeAdminGetWorker`) accepted any
 * "ACTIVE" / "DONE" string in `status`/`workerStatus`/`account.status` as
 * evidence of onboarding completion. That conflated **lifecycle status**
 * (Everee's `status: 'ACTIVE'` means the employment is active — workers
 * mid-onboarding can be ACTIVE) with **onboarding status** (Everee's
 * dedicated `onboardingStatus: 'COMPLETE'` is what actually signals
 * onboarding completion). The conflation produced false positives that:
 *
 *   1) Mirrored `status: 'onboarding_complete'` to the link doc
 *      (`apiObservedOnboardingCompleteAt` set — locking in the deadlock).
 *   2) Made the next preflight ask for `WORKER_HOME` from Everee, which
 *      Everee correctly rejected with EMB-202 because onboarding wasn't
 *      actually finished. The bridge protocol break (EMB-102) meant the
 *      iframe's EMB-202 toast never reached our client recovery handler,
 *      so the deadlock never self-healed.
 *
 * `inspectEvereeOnboardingState` is the new shared helper. The matcher
 * proper (`isEvereeOnboardingComplete`) is just `inspect().complete`,
 * but the inspect variant is exported so tests can reason about *why*
 * the matcher returned what it did, not just the boolean.
 */

import { expect } from 'chai';

import { inspectEvereeOnboardingState } from '../../integrations/everee/evereeCallables';

describe('inspectEvereeOnboardingState (EE.4 Layer 2)', () => {
  describe('REJECTS lifecycle / employment status as onboarding-complete evidence', () => {
    // The historical bug — these all used to return `complete: true`.
    it('rejects status: ACTIVE (lifecycle, not onboarding)', () => {
      const r = inspectEvereeOnboardingState({ status: 'ACTIVE' });
      expect(r.complete).to.equal(false);
      expect(r.onboardingStatus).to.equal(null);
    });

    it('rejects workerStatus: ACTIVE', () => {
      expect(inspectEvereeOnboardingState({ workerStatus: 'ACTIVE' }).complete).to.equal(false);
    });

    it('rejects account.status: ACTIVE', () => {
      expect(
        inspectEvereeOnboardingState({ account: { status: 'ACTIVE' } }).complete,
      ).to.equal(false);
    });

    it('rejects raw status string DONE / COMPLETE on the legacy `status` field', () => {
      // These strings ARE valid onboarding completion values when found
      // on `onboardingStatus`, but they're invalid when found on the
      // employment-lifecycle `status` field. Pre-EE.4, the matcher
      // didn't distinguish.
      expect(inspectEvereeOnboardingState({ status: 'DONE' }).complete).to.equal(false);
      expect(inspectEvereeOnboardingState({ status: 'COMPLETE' }).complete).to.equal(false);
    });
  });

  describe('accepts dedicated onboarding signals', () => {
    it('accepts onboardingComplete: true (boolean)', () => {
      const r = inspectEvereeOnboardingState({ onboardingComplete: true });
      expect(r.complete).to.equal(true);
      expect(r.onboardingCompleteBool).to.equal(true);
      expect(r.onboardingStatus).to.equal(null);
    });

    it('accepts onboardingStatus: COMPLETE (string)', () => {
      const r = inspectEvereeOnboardingState({ onboardingStatus: 'COMPLETE' });
      expect(r.complete).to.equal(true);
      expect(r.onboardingStatus).to.equal('COMPLETE');
    });

    it('accepts onboardingStatus values COMPLETED / ONBOARDING_COMPLETE', () => {
      expect(
        inspectEvereeOnboardingState({ onboardingStatus: 'COMPLETED' }).complete,
      ).to.equal(true);
      expect(
        inspectEvereeOnboardingState({ onboardingStatus: 'ONBOARDING_COMPLETE' }).complete,
      ).to.equal(true);
    });

    it('accepts nested onboarding.complete: true', () => {
      const r = inspectEvereeOnboardingState({ onboarding: { complete: true } });
      expect(r.complete).to.equal(true);
    });

    it('accepts nested onboarding.status: COMPLETE', () => {
      const r = inspectEvereeOnboardingState({ onboarding: { status: 'COMPLETE' } });
      expect(r.complete).to.equal(true);
      expect(r.onboardingStatus).to.equal('COMPLETE');
    });
  });

  describe('unanimity rule when both signals present', () => {
    it('accepts when both signals agree on complete', () => {
      const r = inspectEvereeOnboardingState({
        onboardingComplete: true,
        onboardingStatus: 'COMPLETE',
      });
      expect(r.complete).to.equal(true);
    });

    it('REJECTS when onboardingComplete: true but onboardingStatus: IN_PROGRESS', () => {
      // Greg's exact deadlock case: the worker was mid-onboarding and
      // Everee returned conflicting signals. Pre-EE.4 the boolean alone
      // was enough; post-EE.4 we require unanimity when both are present.
      const r = inspectEvereeOnboardingState({
        onboardingComplete: true,
        onboardingStatus: 'IN_PROGRESS',
      });
      expect(r.complete).to.equal(false);
      expect(r.onboardingCompleteBool).to.equal(true);
      expect(r.onboardingStatus).to.equal('IN_PROGRESS');
    });

    it('REJECTS when onboardingComplete: false but onboardingStatus: COMPLETE', () => {
      const r = inspectEvereeOnboardingState({
        onboardingComplete: false,
        onboardingStatus: 'COMPLETE',
      });
      expect(r.complete).to.equal(false);
    });
  });

  describe('default behavior', () => {
    it('returns false when no onboarding signals are present', () => {
      const r = inspectEvereeOnboardingState({});
      expect(r.complete).to.equal(false);
      expect(r.onboardingStatus).to.equal(null);
      expect(r.onboardingCompleteBool).to.equal(null);
    });

    it('returns false on a worker mid-onboarding with only lifecycle ACTIVE', () => {
      // Realistic Everee response shape for Greg's deadlock case.
      const r = inspectEvereeOnboardingState({
        id: 'a39debb3-...',
        status: 'ACTIVE',
        lifecycleStatus: 'ACTIVE',
        employmentType: 'EMPLOYEE',
        onboardingStatus: 'IN_PROGRESS',
        onboardingComplete: false,
      });
      expect(r.complete).to.equal(false);
    });

    it('returns true on a worker who has actually finished onboarding', () => {
      const r = inspectEvereeOnboardingState({
        id: 'a39debb3-...',
        status: 'ACTIVE',
        lifecycleStatus: 'ACTIVE',
        employmentType: 'EMPLOYEE',
        onboardingStatus: 'COMPLETE',
        onboardingComplete: true,
      });
      expect(r.complete).to.equal(true);
    });
  });

  describe('case + whitespace tolerance on onboardingStatus', () => {
    it('accepts lowercase complete (uppercased internally)', () => {
      const r = inspectEvereeOnboardingState({ onboardingStatus: 'complete' });
      expect(r.complete).to.equal(true);
      expect(r.onboardingStatus).to.equal('COMPLETE');
    });

    it('trims whitespace', () => {
      expect(
        inspectEvereeOnboardingState({ onboardingStatus: '  COMPLETE  ' }).complete,
      ).to.equal(true);
    });
  });
});
