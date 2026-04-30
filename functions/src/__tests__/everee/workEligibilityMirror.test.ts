/**
 * Unit tests for the W.1 server-side work-eligibility mirror writer.
 *
 * Coverage maps directly onto the W.1 spec acceptance scenarios:
 *
 *   1. Everee/W-2 path → writes `workEligibility: true` + `source: 'everee_i9'`.
 *   2. Idempotency: second call with same state writes nothing.
 *   3. EEO preservation: `gender` / `veteranStatus` / `disabilityStatus`
 *      survive across mirror writes (so W.3 can clean them up later).
 *   4. 1099 contractor on-call path → writes `source: 'contractor_no_i9_required'`.
 *   5. Pre-existing real worker attestation (empty / non-system source) is
 *      *upgraded* to the system source on next mirror — `source` and
 *      `attestedAt` move, but the actual answers (`requireSponsorship` + EEO)
 *      are preserved. (This is the "no-clobber-of-data" rule the helper docs
 *      document; see the helper file for ADR.)
 *
 * Tests stub Firestore via sinon — Admin SDK semantics for the dotted-key
 * trap are pinned in `__tests__/firestore/adminSdkSetMergeDottedKeys.test.ts`
 * (an emulator-backed test). This file is mock-based because the rule we're
 * pinning is logical (idempotency, source upgrade, EEO preservation), not
 * Firestore-write-semantic.
 */

import * as admin from 'firebase-admin';
import * as sinon from 'sinon';
import { expect } from 'chai';

import { mirrorWorkEligibilityFromAuthoritativeSource } from '../../utils/workEligibilityMirror';

interface FakeUserDocState {
  exists: boolean;
  data?: Record<string, unknown>;
}

interface MirrorTestHarness {
  /** Last `update()` payload captured by the stub (null if no write happened). */
  lastUpdate: Record<string, unknown> | null;
  /** Number of times `update()` was called. */
  updateCallCount: number;
  /** Reset the captured state for the next assertion. */
  reset: () => void;
}

function installFirestoreStubs(
  sandbox: sinon.SinonSandbox,
  initialState: FakeUserDocState,
): MirrorTestHarness {
  // Mutable state we can flip between calls (e.g. to assert idempotency
  // after the first write).
  const state: FakeUserDocState = {
    exists: initialState.exists,
    data: initialState.data ? { ...initialState.data } : undefined,
  };
  const harness: MirrorTestHarness = {
    lastUpdate: null,
    updateCallCount: 0,
    reset() {
      this.lastUpdate = null;
      this.updateCallCount = 0;
    },
  };

  const userRef = {
    get: sandbox.stub().callsFake(async () => ({
      exists: state.exists,
      data: () => (state.exists ? { ...(state.data || {}) } : undefined),
    })),
    update: sandbox.stub().callsFake(async (payload: Record<string, unknown>) => {
      harness.updateCallCount += 1;
      harness.lastUpdate = payload;
      // Mirror the write back into our fake state so a subsequent
      // `get()` reflects the new value (used by the idempotency test).
      const nextData: Record<string, unknown> = {
        ...(state.data || {}),
        ...payload,
      };
      // Resolve the serverTimestamp sentinel into a stable marker so the
      // fake "doc" doesn't carry the FieldValue object across reads.
      const att = nextData.workEligibilityAttestation as
        | Record<string, unknown>
        | undefined;
      if (att && att.attestedAt && typeof att.attestedAt === 'object') {
        att.attestedAt = '__server_timestamp_resolved__';
      }
      state.data = nextData;
      state.exists = true;
    }),
  };

  const docStub = sandbox.stub(admin.firestore(), 'doc');
  docStub.callsFake((path: string) => {
    if (path === 'users/u-test') {
      return userRef as unknown as FirebaseFirestore.DocumentReference;
    }
    // Any unrelated doc lookup — return a benign empty stub so we don't
    // mask real bugs as missing-collection errors.
    return {
      get: sandbox.stub().resolves({ exists: false, data: () => undefined }),
      update: sandbox.stub().resolves(undefined),
    } as unknown as FirebaseFirestore.DocumentReference;
  });

  return harness;
}

describe('mirrorWorkEligibilityFromAuthoritativeSource (W.1)', () => {
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'warn');
    sandbox.stub(console, 'info');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('input validation', () => {
    it('returns missing_userid when userId is empty', async () => {
      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: '',
        source: 'everee_i9',
        callerContext: 'test',
      });
      expect(result.written).to.equal(false);
      expect(result.reason).to.equal('missing_userid');
    });

    it('returns invalid_source for an unknown source value', async () => {
      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        // Cast through `unknown` to simulate a malformed caller in JS land.
        source: 'random_string' as unknown as 'everee_i9',
        callerContext: 'test',
      });
      expect(result.written).to.equal(false);
      expect(result.reason).to.equal('invalid_source');
    });
  });

  describe('Everee / W-2 (source = everee_i9)', () => {
    it('writes workEligibility:true + source:everee_i9 for an empty user doc', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {},
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_w2_empty_user',
      });

      expect(result.written).to.equal(true);
      expect(result.reason).to.equal('wrote');
      expect(harness.updateCallCount).to.equal(1);
      expect(harness.lastUpdate?.workEligibility).to.equal(true);
      const att = harness.lastUpdate?.workEligibilityAttestation as Record<
        string,
        unknown
      >;
      expect(att.authorizedToWorkUS).to.equal(true);
      expect(att.source).to.equal('everee_i9');
      // Default for a worker who never answered the question.
      expect(att.requireSponsorship).to.equal(false);
      // serverTimestamp sentinel is opaque; just confirm it's set.
      expect(att.attestedAt).to.exist;
      // EEO untouched on a brand-new write — undefined inputs don't appear.
      expect(att.gender).to.equal(undefined);
      expect(att.veteranStatus).to.equal(undefined);
      expect(att.disabilityStatus).to.equal(undefined);
    });

    it('is idempotent — second call with same source writes nothing', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {},
      });

      const first = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_idempotency_first',
      });
      expect(first.written).to.equal(true);
      expect(harness.updateCallCount).to.equal(1);

      // Reset the harness counters but NOT the fake state — the user doc
      // now reads back as `{ workEligibility: true, attestation.source: 'everee_i9' }`.
      harness.reset();

      const second = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_idempotency_second',
      });

      expect(second.written).to.equal(false);
      expect(second.reason).to.equal('already_at_target');
      expect(harness.updateCallCount).to.equal(0);
    });

    it('preserves existing requireSponsorship answer when first writing the system source', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {
          // Worker said "no, I don't need sponsorship" via the wizard
          // before the mirror existed; it must survive the upgrade.
          workEligibilityAttestation: {
            authorizedToWorkUS: true,
            requireSponsorship: false,
            attestedAt: 'old_timestamp',
            // No `source` set — represents pre-W.1 / wizard-collected state.
          },
          workEligibility: true,
        },
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_preserve_sponsorship',
      });

      expect(result.written).to.equal(true);
      expect(result.previousSource).to.equal('');
      const att = harness.lastUpdate?.workEligibilityAttestation as Record<
        string,
        unknown
      >;
      expect(att.requireSponsorship).to.equal(false);
      expect(att.source).to.equal('everee_i9');
    });

    it('preserves existing EEO fields (gender / veteranStatus / disabilityStatus)', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {
          workEligibilityAttestation: {
            authorizedToWorkUS: true,
            requireSponsorship: true,
            attestedAt: 'old_timestamp',
            gender: 'female',
            veteranStatus: 'protected_veteran',
            disabilityStatus: 'no',
            // No source set — pre-W.1 wizard collection.
          },
          workEligibility: true,
        },
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_preserve_eeo',
      });

      expect(result.written).to.equal(true);
      const att = harness.lastUpdate?.workEligibilityAttestation as Record<
        string,
        unknown
      >;
      expect(att.gender).to.equal('female');
      expect(att.veteranStatus).to.equal('protected_veteran');
      expect(att.disabilityStatus).to.equal('no');
      // requireSponsorship answer also preserved.
      expect(att.requireSponsorship).to.equal(true);
      // Source / authorizedToWorkUS upgraded.
      expect(att.source).to.equal('everee_i9');
      expect(att.authorizedToWorkUS).to.equal(true);
    });
  });

  describe('1099 contractor (source = contractor_no_i9_required)', () => {
    it('writes workEligibility:true + source:contractor_no_i9_required', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {},
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'contractor_no_i9_required',
        callerContext: 'test_1099_empty_user',
      });

      expect(result.written).to.equal(true);
      expect(harness.updateCallCount).to.equal(1);
      expect(harness.lastUpdate?.workEligibility).to.equal(true);
      const att = harness.lastUpdate?.workEligibilityAttestation as Record<
        string,
        unknown
      >;
      expect(att.source).to.equal('contractor_no_i9_required');
      expect(att.authorizedToWorkUS).to.equal(true);
    });

    it('is idempotent for the contractor source', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {
          workEligibility: true,
          workEligibilityAttestation: {
            authorizedToWorkUS: true,
            requireSponsorship: false,
            attestedAt: 'old_timestamp',
            source: 'contractor_no_i9_required',
          },
        },
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'contractor_no_i9_required',
        callerContext: 'test_1099_idempotent',
      });

      expect(result.written).to.equal(false);
      expect(result.reason).to.equal('already_at_target');
      expect(harness.updateCallCount).to.equal(0);
    });

    it('upgrades a worker who already has source: everee_i9 if the contractor mirror runs', async () => {
      // Edge case: a worker with a W-2 employment elsewhere (Everee I-9 done)
      // gets added to a 1099 entity later. Our rule says system sources can
      // upgrade between each other; the data is preserved.
      const harness = installFirestoreStubs(sandbox, {
        exists: true,
        data: {
          workEligibility: true,
          workEligibilityAttestation: {
            authorizedToWorkUS: true,
            requireSponsorship: false,
            attestedAt: 'i9_timestamp',
            source: 'everee_i9',
            gender: 'male',
          },
        },
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'contractor_no_i9_required',
        callerContext: 'test_cross_source_upgrade',
      });

      expect(result.written).to.equal(true);
      expect(result.previousSource).to.equal('everee_i9');
      const att = harness.lastUpdate?.workEligibilityAttestation as Record<
        string,
        unknown
      >;
      expect(att.source).to.equal('contractor_no_i9_required');
      // Data preserved across the source change.
      expect(att.gender).to.equal('male');
      expect(att.requireSponsorship).to.equal(false);
    });
  });

  describe('user doc edge cases', () => {
    it('returns user_doc_missing without writing when the user doc does not exist', async () => {
      const harness = installFirestoreStubs(sandbox, {
        exists: false,
      });

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_missing_user_doc',
      });

      expect(result.written).to.equal(false);
      expect(result.reason).to.equal('user_doc_missing');
      expect(harness.updateCallCount).to.equal(0);
    });

    it('returns write_failed and never throws when the read fails', async () => {
      const docStub = sandbox.stub(admin.firestore(), 'doc');
      docStub.returns({
        get: sandbox.stub().rejects(new Error('boom')),
        update: sandbox.stub(),
      } as unknown as FirebaseFirestore.DocumentReference);

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'everee_i9',
        callerContext: 'test_read_failed',
      });

      expect(result.written).to.equal(false);
      expect(result.reason).to.equal('write_failed');
    });

    it('returns write_failed and never throws when the update fails', async () => {
      const docStub = sandbox.stub(admin.firestore(), 'doc');
      docStub.returns({
        get: sandbox.stub().resolves({ exists: true, data: () => ({}) }),
        update: sandbox.stub().rejects(new Error('write boom')),
      } as unknown as FirebaseFirestore.DocumentReference);

      const result = await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: 'u-test',
        source: 'contractor_no_i9_required',
        callerContext: 'test_update_failed',
      });

      expect(result.written).to.equal(false);
      expect(result.reason).to.equal('write_failed');
    });
  });
});
